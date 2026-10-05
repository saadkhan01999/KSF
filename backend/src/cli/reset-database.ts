/* ==========================================================================
   npm run db:reset -- --yes
   --------------------------------------------------------------------------
   Empties the database named in .env and sets it up again from nothing:
   indexes, plans and the platform Super Admin. For a development or test
   database. A backup is taken first anyway, and the command refuses to run
   when NODE_ENV=production unless --production is also given.
   ========================================================================== */

import { env, IS_PROD } from '../config/env.js';
import { connect, db, disconnect } from '../db/mongo.js';
import { bootstrap } from '../db/bootstrap.js';
import { takeBackup } from './backup.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (IS_PROD && !args.includes('--production')) {
    console.error('\n FIX NODE_ENV is production. Resetting would delete every pharmacy. Add --production only if that is truly what you want.\n');
    return 1;
  }
  if (!args.includes('--yes')) {
    console.log(`\n  This deletes everything in the database "${env.MONGODB_DB}" and starts it again empty`);
    console.log('  (plans and the Super Admin from .env only). Run again with --yes to go ahead.\n');
    return 0;
  }
  await connect();
  const safety = await takeBackup();
  console.log(`\n  ok  Backup taken first: ${safety.file}`);
  await db().dropDatabase();
  await bootstrap({ silent: true });
  console.log(`  ok  "${env.MONGODB_DB}" is empty and ready. Sign in as ${env.SUPER_ADMIN_EMAIL || 'the Super Admin'}.\n`);
  return 0;
}

main()
  .then(async (code) => { await disconnect(); process.exit(code); })
  .catch(async (error) => { console.error(`\n FIX ${(error as Error).message}\n`); await disconnect(); process.exit(1); });
