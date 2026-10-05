/* ==========================================================================
   npm run db:backup            take a backup
   npm run db:backup -- --verify <file>   check one can be restored
   --------------------------------------------------------------------------
   One compressed file per backup: the first line is a manifest (database,
   time, collections and document counts), every following line is one
   document in MongoDB Extended JSON, so dates, decimals and ids come back
   exactly as they went in. A SHA-256 of the content is kept beside it, and
   --verify re-reads the file, recounts every collection and checks the hash
   — a backup that has never been verified is a hope, not a backup.

   For Atlas, the cluster's own continuous backup is the first line of
   defence; this file is the copy you keep yourself, off the cluster.
   ========================================================================== */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { BSON } from 'mongodb';
import { env, fromRoot } from '../config/env.js';
import { connect, db, disconnect } from '../db/mongo.js';

const { EJSON } = BSON;

export const BACKUP_FOLDER = (): string => fromRoot(process.env.BACKUP_DIR || '.data/backups');

export interface Manifest { format: 'ksf-backup'; version: 1; database: string; takenAt: string; collections: Record<string, number> }

async function* lines(manifest: Manifest, names: string[]): AsyncGenerator<string> {
  yield `${JSON.stringify(manifest)}\n`;
  for (const name of names) {
    for await (const doc of db().collection(name).find({})) yield `${EJSON.stringify({ c: name, d: doc }, { relaxed: false })}\n`;
  }
}

export async function takeBackup(): Promise<{ file: string; manifest: Manifest; bytes: number }> {
  const names = (await db().listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name).filter((name) => !name.startsWith('system.')).sort();
  const collections: Record<string, number> = {};
  for (const name of names) collections[name] = await db().collection(name).countDocuments();
  const manifest: Manifest = { format: 'ksf-backup', version: 1, database: env.MONGODB_DB, takenAt: new Date().toISOString(), collections };

  mkdirSync(BACKUP_FOLDER(), { recursive: true });
  const file = join(BACKUP_FOLDER(), `ksf-${env.MONGODB_DB}-${manifest.takenAt.replace(/[:.]/g, '-')}.ndjson.gz`);
  await pipeline(Readable.from(lines(manifest, names)), createGzip({ level: 9 }), createWriteStream(file));
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(`${file}.sha256`, `${hash}  ${basename(file)}\n`);
  return { file, manifest, bytes: statSync(file).size };
}

/** Read a backup back, one document at a time. */
export async function* readBackup(file: string): AsyncGenerator<{ manifest: Manifest } | { collection: string; doc: Record<string, unknown> }> {
  const reader = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let first = true;
  for await (const line of reader) {
    if (!line.trim()) continue;
    if (first) {
      const manifest = JSON.parse(line) as Manifest;
      if (manifest.format !== 'ksf-backup') throw new Error('That file is not a KSF backup.');
      first = false;
      yield { manifest };
      continue;
    }
    const entry = EJSON.parse(line, { relaxed: false }) as { c: string; d: Record<string, unknown> };
    yield { collection: entry.c, doc: entry.d };
  }
}

export async function verifyBackup(file: string): Promise<{ ok: boolean; problems: string[]; manifest: Manifest | null }> {
  const problems: string[] = [];
  if (!existsSync(file)) return { ok: false, problems: [`${file} does not exist.`], manifest: null };
  const sidecar = `${file}.sha256`;
  if (existsSync(sidecar)) {
    const expected = readFileSync(sidecar, 'utf8').split(/\s+/)[0];
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (expected !== actual) problems.push('The checksum does not match: the file has been changed or damaged since it was written.');
  } else {
    problems.push('There is no .sha256 file beside the backup, so its integrity cannot be proven.');
  }
  let manifest: Manifest | null = null;
  const counted: Record<string, number> = {};
  try {
    for await (const entry of readBackup(file)) {
      if ('manifest' in entry) manifest = entry.manifest;
      else counted[entry.collection] = (counted[entry.collection] ?? 0) + 1;
    }
  } catch (error) {
    problems.push(`The file could not be read to the end: ${(error as Error).message}`);
  }
  for (const [name, expected] of Object.entries(manifest?.collections ?? {})) {
    if ((counted[name] ?? 0) !== expected) problems.push(`${name}: the manifest says ${expected} document(s), the file holds ${counted[name] ?? 0}.`);
  }
  return { ok: problems.length === 0, problems, manifest };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === '--verify') {
    const file = resolve(args[1] ?? '');
    const result = await verifyBackup(file);
    console.log(result.ok ? `\n  ok  ${basename(file)} is complete and unchanged.` : `\n FIX ${basename(file)}:`);
    for (const problem of result.problems) console.log(`      - ${problem}`);
    if (result.manifest) {
      const total = Object.values(result.manifest.collections).reduce((sum, value) => sum + value, 0);
      console.log(`      ${result.manifest.database}, taken ${result.manifest.takenAt}, ${total} document(s) in ${Object.keys(result.manifest.collections).length} collection(s).\n`);
    }
    return result.ok ? 0 : 1;
  }

  await connect();
  const { file, manifest, bytes } = await takeBackup();
  const total = Object.values(manifest.collections).reduce((sum, value) => sum + value, 0);
  console.log(`\n  ok  Backup written: ${file}`);
  console.log(`      ${total} document(s) from ${Object.keys(manifest.collections).length} collection(s), ${(bytes / 1024).toFixed(1)} KB compressed.`);
  const check = await verifyBackup(file);
  console.log(check.ok ? '  ok  Verified: the file reads back completely.\n' : `  FIX Verification failed: ${check.problems.join(' ')}\n`);
  return check.ok ? 0 : 1;
}

if (process.argv[1] && /backup\.(ts|js)$/.test(process.argv[1])) {
  main()
    .then(async (code) => { await disconnect(); process.exit(code); })
    .catch(async (error) => { console.error(`\n FIX ${(error as Error).message}\n`); await disconnect(); process.exit(1); });
}
