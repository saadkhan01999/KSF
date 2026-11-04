/* ==========================================================================
   Barcodes: reading what a scan says
   --------------------------------------------------------------------------
   Pure functions, no database. A scan arrives as text: a plain barcode
   (EAN-13, UPC, Code 128 …), a GS1 code from the 2D DataMatrix on a medicine
   pack, a GS1 "Digital Link" from a QR code, or any other text a QR code can
   hold. These turn it into the barcode to look up and keep, and read what a
   product's name says about it (strength, form, pack size).
   ========================================================================== */

/* -------------------------------------------------------------- GS1 codes
   The 2D DataMatrix on a medicine pack holds GS1 "Application Identifiers":
   01 the product number (GTIN-14), 17 the expiry (YYMMDD), 10 the batch and
   21 the serial. Scanners send it with or without brackets, with a GS
   character (0x1D) after each variable-length field, and sometimes with a
   "]d2" prefix naming the symbology. Without the GS characters a batch and a
   serial cannot be told apart, so then only the fixed-length fields are read.

   A QR code can carry the same as a web address, a GS1 Digital Link:
   https://id.gs1.org/01/08964000111222/10/AB12/21/X9?17=271231 */
export interface Gs1Code { gtin: string; expiry: string | null; batch: string | null; serial: string | null }

const GS = '\u001d';
const FIXED_AI: Record<string, number> = { '01': 14, '11': 6, '15': 6, '17': 6 };
const VARIABLE_AI = new Set(['10', '21']);

/** YYMMDD as an ISO date; a day of 00 means the end of that month. */
function gs1Date(value: string | null | undefined): string | null {
  if (!value || !/^\d{6}$/.test(value)) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  if (month < 1 || month > 12) return null;
  const day = Number(value.slice(4, 6)) || new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A GS1 Digital Link web address: the product number after /01/ (or /gtin/). */
function digitalLink(text: string): Gs1Code | null {
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  const at = parts.findIndex((part) => part === '01' || part.toLowerCase() === 'gtin');
  const gtin = at >= 0 ? parts[at + 1] ?? '' : '';
  if (!/^(\d{8}|\d{12,14})$/.test(gtin)) return null;
  const after = (ai: string) => {
    const index = parts.indexOf(ai, at + 2);
    return index > at ? parts[index + 1] ?? null : null;
  };
  return {
    gtin: gtin.padStart(14, '0'),
    expiry: gs1Date(url.searchParams.get('17') ?? after('17')),
    batch: after('10') ?? url.searchParams.get('10') ?? null,
    serial: after('21') ?? url.searchParams.get('21') ?? null
  };
}

export function gs1Of(code: string): Gs1Code | null {
  const link = digitalLink(code.trim());
  if (link) return link;
  /* The symbology prefix (]d2 DataMatrix, ]Q3 QR, ]C1 GS1-128, ]e0 DataBar),
     and the FNC1 some scanners send as a leading GS. */
  const text = code.trim().replace(/^\][A-Za-z]\d/, '').replace(/^\u001d+/, '');
  if (text.startsWith('(')) {
    const fields = new Map([...text.matchAll(/\((\d{2,4})\)([^(]*)/g)].map((match) => [match[1], match[2].replace(GS, '').trim()]));
    const gtin = fields.get('01') ?? '';
    return /^\d{14}$/.test(gtin) ? { gtin, expiry: gs1Date(fields.get('17')), batch: fields.get('10') || null, serial: fields.get('21') || null } : null;
  }
  if (text.length < 16 || !/^01\d{14}/.test(text)) return null;

  const found: Gs1Code = { gtin: '', expiry: null, batch: null, serial: null };
  const separated = text.includes(GS);
  let at = 0;
  while (at < text.length) {
    if (text[at] === GS) { at += 1; continue; }
    const ai = text.slice(at, at + 2);
    if (ai in FIXED_AI) {
      const value = text.slice(at + 2, at + 2 + FIXED_AI[ai]);
      if (ai === '01') found.gtin = value;
      if (ai === '17') found.expiry = gs1Date(value);
      at += 2 + FIXED_AI[ai];
    } else if (VARIABLE_AI.has(ai) && separated) {
      const end = text.indexOf(GS, at + 2);
      const value = text.slice(at + 2, end < 0 ? undefined : end);
      if (ai === '10') found.batch = value || null; else found.serial = value || null;
      at = end < 0 ? text.length : end + 1;
    } else {
      break;
    }
  }
  return /^\d{14}$/.test(found.gtin) ? found : null;
}

/**
 * What to store on a medicine for a scanned code: a GS1 code's product
 * number as the barcode printed on the box (EAN-13, or EAN-8 for a small
 * pack); anything else as scanned, without spaces or control characters.
 */
export function canonicalBarcode(code: string): string {
  const gs1 = gs1Of(code);
  if (gs1) return gs1.gtin.startsWith('000000') ? gs1.gtin.slice(6) : gs1.gtin.startsWith('0') ? gs1.gtin.slice(1) : gs1.gtin;
  return code.replace(/[\s\u0000-\u001f]/g, '');
}

/**
 * Barcode variants worth trying for one scan. UPC-A on imported stock is 12
 * digits where the same product is listed as a 13-digit EAN with a leading
 * zero, and a code pasted out of a spreadsheet has usually lost its leading
 * zeros. Each candidate is an exact match or not a match at all.
 */
export function barcodeVariants(code: string): string[] {
  const digits = gs1Of(code)?.gtin ?? code.replace(/[\s\u0000-\u001f]/g, '');
  const variants = new Set([digits]);
  if (/^\d+$/.test(digits)) {
    variants.add(digits.replace(/^0+/, ''));
    if (digits.length < 13) variants.add(digits.padStart(13, '0'));
    if (digits.length < 12) variants.add(digits.padStart(12, '0'));
  }
  return [...variants].filter(Boolean);
}

/** A product number (EAN-8, UPC-A, EAN-13, GTIN-14) — the only kind worth asking a product database about. */
export const isProductNumber = (barcode: string): boolean => /^(\d{8}|\d{12,14})$/.test(barcode);

/* ------------------------------------------------- what a name tells us */

export interface NameFacts { strength: string | null; form: string | null; packSize: string | null }

/* The catalogue's forms, and the words a pack uses for each. */
const FORM_WORDS: Array<[string, RegExp]> = [
  ['Tablet', /\b(tablets?|tabs?|caplets?)\b/i],
  ['Capsule', /\b(capsules?|caps?)\b/i],
  ['Syrup', /\b(syrups?|elixir)\b/i],
  ['Suspension', /\b(suspensions?|susp)\b/i],
  ['Injection', /\b(injections?|inj|vials?|ampoules?|amps?)\b/i],
  ['Inhaler', /\b(inhalers?|evohaler|accuhaler|rotacaps)\b/i],
  ['Cream', /\b(creams?|gel)\b/i],
  ['Ointment', /\b(ointments?|oint)\b/i],
  ['Lotion', /\b(lotions?)\b/i],
  ['Drops', /\b(drops?|eye ?drops|ear ?drops)\b/i],
  ['Solution', /\b(solutions?|soln|mouthwash)\b/i],
  ['Sachet', /\b(sachets?)\b/i],
  ['Powder', /\b(powders?)\b/i],
  ['Strips', /\b(strips?)\b/i]
];

const STRENGTH = /(\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|g|ml|iu|%)(?:\s?\/\s?\d*(?:[.,]\d+)?\s?(?:mg|ml|g|dose))?(?:\s?\+\s?\d+(?:[.,]\d+)?\s?(?:mg|mcg|g))*)/i;
const PACK = /\b(?:pack of\s?(\d+)|(\d+)\s?(?:'s|s|x|tablets?|tabs?|capsules?|caps?|sachets?|pcs|pieces|strips?)\b)/i;

/** Strength, form and pack size, as far as a product's name and quantity say them. */
export function nameFacts(name: string, quantity = ''): NameFacts {
  const text = `${name} ${quantity}`.replace(/\s+/g, ' ');
  const strength = STRENGTH.exec(name)?.[1]?.replace(/\s+/g, '') ?? null;
  const form = FORM_WORDS.find(([, words]) => words.test(text))?.[0] ?? null;
  const pack = PACK.exec(text.replace(STRENGTH, ' '));
  const count = pack?.[1] ?? pack?.[2];
  const packSize = count ? `${count} ${form === 'Capsule' ? 'capsules' : form === 'Sachet' ? 'sachets' : form === 'Tablet' ? 'tablets' : 'units'}`
    : quantity.trim() && /\d/.test(quantity) ? quantity.trim().slice(0, 60) : null;
  return { strength: strength && strength.length <= 60 ? strength : null, form, packSize };
}
