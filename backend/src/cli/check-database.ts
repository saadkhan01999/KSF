/* ==========================================================================
   npm run db:check — is the database reachable, and is it ready?
   --------------------------------------------------------------------------
   Connects with the MONGODB_URI in .env, then reports in plain words: the
   server version, whether transactions are available, the collections and
   how many documents each holds, whether the indexes are in place, whether
   the plans exist and whether the platform Super Admin has been created.
   Changes nothing, so it is safe to run against production.
   ========================================================================== */

import { env } from '../config/env.js';
import { connect, db, describeDatabase, disconnect, supportsTransactions } from '../db/mongo.js';

const tick = (ok: boolean): string => (ok ? '  ok ' : ' FIX ');

async function main(): Promise<number> {
  console.log(`\nKSF database check — ${describeDatabase()}\n`);
  try {
    await connect();
  } catch (error) {
    console.error(`${tick(false)} Could not connect: ${(error as Error).message}`);
    console.error('      Check MONGODB_URI in .env, that the cluster allows this computer\'s IP address,');
    console.error('      and that the username and password are right (special characters must be URL-encoded).');
    return 1;
  }

  const info = await db().admin().command({ buildInfo: 1 }).catch(() => ({ version: 'unknown' }));
  console.log(`${tick(true)} Connected to MongoDB ${info.version}`);
  console.log(`${tick(supportsTransactions())} Transactions ${supportsTransactions()
    ? 'available (replica set or Atlas)'
    : 'NOT available — a single standalone server. KSF still runs, but use Atlas or a replica set in production.'}`);

  const collections = (await db().listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name).sort();
  if (!collections.length) {
    console.log(`${tick(false)} The database "${env.MONGODB_DB}" is empty. Start the server once (npm start) and it will create everything it needs.`);
    return 1;
  }

  let problems = 0;
  const plans = await db().collection('subscription_plans').countDocuments();
  const admins = await db().collection('users').countDocuments({ is_platform_admin: 1 });
  const usersIndex = (await db().collection('users').indexes()).some((index) => index.key?.email === 1 && index.unique);
  console.log(`${tick(plans > 0)} ${plans} subscription plan(s)`);
  console.log(`${tick(admins === 1)} ${admins} platform Super Admin account(s)${admins === 0 ? ' — set SUPER_ADMIN_* in .env and start the server' : ''}`);
  console.log(`${tick(usersIndex)} Unique e-mail index on users`);
  if (!plans) problems += 1;
  if (admins !== 1) problems += 1;
  if (!usersIndex) problems += 1;

  console.log('\n  Collection                     Documents');
  console.log('  ------------------------------ ---------');
  for (const name of collections) {
    const count = await db().collection(name).estimatedDocumentCount();
    console.log(`  ${name.padEnd(30)} ${String(count).padStart(9)}`);
  }
  console.log(problems ? `\n${problems} thing(s) to fix.\n` : '\nEverything is in place.\n');
  return problems ? 1 : 0;
}

main()
  .then(async (code) => { await disconnect(); process.exit(code); })
  .catch(async (error) => { console.error(error); await disconnect(); process.exit(1); });
