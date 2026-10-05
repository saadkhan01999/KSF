/* ==========================================================================
   npm run db:restore -- <file> --yes
   --------------------------------------------------------------------------
   Puts a backup back. The file is verified first; then, before anything is
   touched, a fresh backup of what the database holds now is taken, so a
   restore can itself be undone. Each collection in the backup is emptied and
   refilled; the indexes are rebuilt afterwards.

   Without --yes it only says what it would do. Stop the API server first —
   a till writing a sale half-way through a restore helps nobody.
   ========================================================================== */

import { basename, resolve } from 'node:path';
import type { Document } from 'mongodb';
import { env } from '../config/env.js';
import { connect, db, disconnect } from '../db/mongo.js';
import { ensureIndexes } from '../db/bootstrap.js';
import { readBackup, takeBackup, verifyBackup } from './backup.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => !arg.startsWith('--'));
  if (!fileArg) {
    console.log('\nUsage: npm run db:restore -- <backup file> --yes\n');
    return 1;
  }
  const file = resolve(fileArg);
  const check = await verifyBackup(file);
  if (!check.ok || !check.manifest) {
    console.error(`\n FIX ${basename(file)} cannot be restored:`);
    for (const problem of check.problems) console.error(`      - ${problem}`);
    return 1;
  }
  const { manifest } = check;
  const total = Object.values(manifest.collections).reduce((sum, value) => sum + value, 0);
  console.log(`\n  Backup of "${manifest.database}" taken ${manifest.takenAt}: ${total} document(s) in ${Object.keys(manifest.collections).length} collection(s).`);
  console.log(`  Target: database "${env.MONGODB_DB}". Every collection in the backup will be replaced.`);
  if (!args.includes('--yes')) {
    console.log('\n  Nothing has been changed. Run again with --yes to restore.\n');
    return 0;
  }

  await connect();
  const safety = await takeBackup();
  console.log(`  ok  Current data saved first: ${safety.file}`);

  for (const name of Object.keys(manifest.collections)) await db().collection(name).deleteMany({});
  let buffer: Document[] = [];
  let current = '';
  let written = 0;
  const flush = async () => {
    if (buffer.length) await db().collection(current).insertMany(buffer, { ordered: false });
    written += buffer.length;
    buffer = [];
  };
  for await (const entry of readBackup(file)) {
    if ('manifest' in entry) continue;
    if (entry.collection !== current) { await flush(); current = entry.collection; }
    buffer.push(entry.doc);
    if (buffer.length >= 1000) await flush();
  }
  await flush();
  await ensureIndexes();
  console.log(`  ok  Restored ${written} document(s). Start the server again.\n`);
  return 0;
}

main()
  .then(async (code) => { await disconnect(); process.exit(code); })
  .catch(async (error) => { console.error(`\n FIX ${(error as Error).message}\n`); await disconnect(); process.exit(1); });
