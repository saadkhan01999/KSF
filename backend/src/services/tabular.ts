/* ==========================================================================
   Reading the customer's file
   --------------------------------------------------------------------------
   Three formats, no dependencies:

     CSV   RFC 4180, delimiter detected (comma, semicolon, tab or pipe — Excel
           in a European locale writes semicolons), byte-order mark stripped,
           quoted fields with commas and newlines handled.
     JSON  an array of objects, or an object with a data / items / records
           array inside it.
     XLSX  read directly: an .xlsx is a ZIP of XML and Node has inflateRaw, so
           the first worksheet and the shared strings are read without a
           library. Formula cells use their cached value.

   Two rules apply to every format. A cell beginning with = + - @ is a formula
   to Excel, so it is neutralised and the change reported, never made quietly.
   And the extension is not trusted: XLSX must start with the ZIP signature,
   text must decode as UTF-8 without NUL bytes.
   ========================================================================== */

import { inflateRawSync } from 'node:zlib';
import { env } from '../config/env.js';

export const MAX_ROWS = env.MIGRATION_MAX_ROWS;

type Failure = { ok: false; reason: string };

/* --------------------------------------------------------- file sniffing */
export function detectFormat(buffer: Buffer, fileName = ''): { ok: true; kind: 'csv' | 'json' | 'xlsx' } | Failure {
  const extension = String(fileName).toLowerCase().split('.').pop();
  if (buffer.length < 2) return { ok: false, reason: 'That file is empty.' };

  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05);
  if (isZip) {
    if (extension === 'xlsx' || extension === 'xlsm') return { ok: true, kind: 'xlsx' };
    return { ok: false, reason: 'That file is a compressed archive but is not named as a spreadsheet. Save it as .xlsx or export a CSV.' };
  }
  if (extension === 'xlsx' || extension === 'xls') {
    return {
      ok: false,
      reason: extension === 'xls'
        ? 'The old .xls format is not supported. Open it in Excel and use Save As to make an .xlsx or a CSV.'
        : 'That file is named .xlsx but is not a spreadsheet. It may have been renamed.'
    };
  }
  if (buffer.includes(0)) return { ok: false, reason: 'That file contains binary data and cannot be read as text.' };
  const text = buffer.toString('utf8');
  if (text.includes('�')) return { ok: false, reason: 'That file is not valid UTF-8 text. Re-save it as CSV UTF-8 from Excel.' };
  const head = text.replace(/^﻿/, '').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return { ok: true, kind: 'json' };
  if (extension === 'json') return { ok: false, reason: 'That file is named .json but does not contain JSON.' };
  return { ok: true, kind: 'csv' };
}

/* ---------------------------------------------------- formula neutralising */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutraliseCell(raw: unknown): { value: string; changed: boolean } {
  const value = String(raw ?? '');
  if (!FORMULA_START.test(value)) return { value, changed: false };
  /* A negative number is a value, not a formula. */
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return { value, changed: false };
  return { value: `'${value}`, changed: true };
}

/* ----------------------------------------------------------------- CSV */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((row) => row.trim()) ?? '';
  const counts = [',', ';', '\t', '|'].map((delimiter) => ({
    delimiter,
    /* Only separators outside quotes count. */
    n: (line.match(new RegExp(`\\${delimiter}(?=(?:[^"]*"[^"]*")*[^"]*$)`, 'g')) ?? []).length
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].delimiter : ',';
}

export function parseCsv(text: string, delimiter: string | null = null): string[][] {
  const source = String(text).replace(/^﻿/, '');
  const sep = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') { quoted = true; index += 1; continue; }
    if (char === sep) { row.push(field); field = ''; index += 1; continue; }
    if (char === '\r') { index += 1; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; index += 1; continue; }
    field += char;
    index += 1;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((line) => line.some((cell) => String(cell).trim() !== ''));
}

/* ---------------------------------------------------------------- XLSX */

/** The entries of a ZIP archive by name; stored (0) and deflated (8) entries. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const flags = buffer.readUInt16LE(offset + 6);
    let compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const dataStart = offset + 30 + nameLength + extraLength;
    /* Streamed entries keep their sizes in a trailing descriptor: take
       everything up to the next header instead. */
    if ((flags & 0x08) !== 0 || compressedSize === 0) {
      const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
      const end = [next, central].filter((position) => position > 0).sort((a, b) => a - b)[0] ?? buffer.length;
      compressedSize = Math.max(0, end - dataStart - ((flags & 0x08) ? 16 : 0));
    }
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    try {
      files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    } catch {
      /* An entry that will not inflate is skipped; the sheet may still read. */
    }
    offset = dataStart + compressedSize;
  }
  return files;
}

const unescapeXml = (value: string): string => String(value)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&amp;/g, '&');

/** Column letters to a zero-based index: A→0, Z→25, AA→26. */
export function columnIndex(reference: string): number {
  const letters = String(reference).replace(/\d+/g, '').toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Excel keeps dates as a serial number counting from 1899-12-30. */
export function excelSerialToDate(serial: unknown): string | null {
  const number = Number(serial);
  if (!Number.isFinite(number) || number <= 0 || number > 60000) return null;
  const date = new Date(Math.round((number - 25569) * 86_400_000));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function parseXlsx(buffer: Buffer): { ok: true; rows: string[][]; sheet: string } | Failure {
  const files = readZip(buffer);
  if (!files.size) return { ok: false, reason: 'That spreadsheet could not be opened. Try saving it again as .xlsx, or export a CSV.' };

  /* Excel stores repeated text once and refers to it by index. */
  const shared: string[] = [];
  const sharedXml = files.get('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const match of sharedXml.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((run) => unescapeXml(run[1])).join(''));
    }
  }
  const sheetName = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetName) return { ok: false, reason: 'That spreadsheet has no worksheet in it.' };

  const rows: string[][] = [];
  for (const rowMatch of files.get(sheetName)!.toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const inner = cellMatch[2];
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? 'n';
      let value: string;
      if (type === 's') value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? -1)] ?? '';
      else if (type === 'inlineStr') value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((run) => unescapeXml(run[1])).join('');
      else value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      const at = reference ? columnIndex(reference) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    if (cells.length || /<c[^>]*\/>/.test(rowMatch[1])) rows.push(cells);
  }
  const useful = rows.filter((row) => row.some((cell) => String(cell).trim() !== ''));
  if (!useful.length) return { ok: false, reason: 'That worksheet has no data in it.' };
  return { ok: true, rows: useful, sheet: sheetName.replace('xl/worksheets/', '') };
}

/* ---------------------------------------------------------------- JSON */
export function parseJsonRows(text: string): { ok: true; columns: string[]; rows: string[][] } | Failure {
  let parsed: any;
  try { parsed = JSON.parse(String(text).replace(/^﻿/, '')); } catch (error) { return { ok: false, reason: `That JSON could not be read: ${(error as Error).message}` }; }
  const list = Array.isArray(parsed) ? parsed : parsed?.data ?? parsed?.items ?? parsed?.records ?? parsed?.rows;
  if (!Array.isArray(list)) return { ok: false, reason: 'The JSON must be an array of records, or an object with a data, items or records array inside it.' };
  if (!list.length) return { ok: false, reason: 'That file has no records in it.' };
  if (typeof list[0] !== 'object' || list[0] === null) return { ok: false, reason: 'Each record must be an object with named fields.' };
  const columns = [...new Set(list.flatMap((item: Record<string, unknown>) => Object.keys(item ?? {})))];
  const rows = list.map((item: Record<string, unknown>) => columns.map((column) => {
    const value = item?.[column];
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }));
  return { ok: true, columns, rows };
}

/* ------------------------------------------------------- the front door */
export interface Table { ok: true; kind: string; columns: string[]; rows: Record<string, string>[]; truncated: boolean; sanitised: number }

export function readTable(buffer: Buffer, fileName: string): Table | Failure {
  const format = detectFormat(buffer, fileName);
  if (!format.ok) return format;

  let columns: string[] = [];
  let matrix: string[][] = [];
  if (format.kind === 'xlsx') {
    const sheet = parseXlsx(buffer);
    if (!sheet.ok) return sheet;
    [columns, ...matrix] = sheet.rows;
  } else if (format.kind === 'json') {
    const parsed = parseJsonRows(buffer.toString('utf8'));
    if (!parsed.ok) return parsed;
    columns = parsed.columns;
    matrix = parsed.rows;
  } else {
    const parsed = parseCsv(buffer.toString('utf8'));
    if (parsed.length < 2) return { ok: false, reason: 'That file needs a header row and at least one row of data.' };
    [columns, ...matrix] = parsed;
  }

  const headers = columns.map((name, index) => String(name ?? '').replace(/^﻿/, '').trim() || `Column ${index + 1}`);
  /* Duplicate headers are made unique so a mapping can address them. */
  const seen = new Map<string, number>();
  const unique = headers.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });

  let sanitised = 0;
  const rows = matrix.slice(0, MAX_ROWS).map((line) => {
    const record: Record<string, string> = {};
    unique.forEach((name, index) => {
      const safe = neutraliseCell(line[index]);
      if (safe.changed) sanitised += 1;
      record[name] = safe.value.trim();
    });
    return record;
  });
  return { ok: true, kind: format.kind, columns: unique, rows, truncated: matrix.length > MAX_ROWS, sanitised };
}
