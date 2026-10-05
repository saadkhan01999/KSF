/* ==========================================================================
   KSF Pharmacy Management System — API server entry point
   --------------------------------------------------------------------------
   Connect to MongoDB, make sure the indexes, plans and the platform Super
   Admin exist, register every module's routes, then serve. Housekeeping
   (subscription dates, the mail retry queue, old sessions and codes) runs at
   start-up and then hourly; a failure there is logged and never stops the
   server.
   ========================================================================== */

import { env, VERSION } from './config/env.js';
import { connect, describeDatabase, disconnect, supportsTransactions } from './db/mongo.js';
import { bootstrap } from './db/bootstrap.js';
import './modules/index.js';
import { createApp } from './http/app.js';
import { runSubscriptionMaintenance } from './services/subscriptions.js';
import { drainMailQueue } from './services/mailer.js';
import { pruneSessions } from './security/sessions.js';
import { pruneCodes } from './security/otp.js';

async function maintenance(): Promise<void> {
  try {
    const summary = await runSubscriptionMaintenance();
    if (summary.trialsEnded || summary.graceStarted || summary.expired) {
      console.log(`[KSF] subscriptions: ${summary.trialsEnded} trial(s) ended, ${summary.graceStarted} in grace, ${summary.expired} moved to Basic`);
    }
    const mail = await drainMailQueue();
    if (mail.tried) console.log(`[KSF] mail queue: ${mail.sent} sent, ${mail.failed} still failing of ${mail.tried} retried`);
    await pruneSessions();
    await pruneCodes();
  } catch (error) {
    console.error('[KSF] maintenance failed:', (error as Error).message);
  }
}

async function start(): Promise<void> {
  const startedAt = Date.now();
  await connect();
  await bootstrap();
  await maintenance();
  setInterval(maintenance, 60 * 60 * 1000).unref();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`KSF API v${VERSION} listening on http://127.0.0.1:${env.PORT}`);
    console.log(`Database: ${describeDatabase()}${supportsTransactions() ? ' · transactions on' : ' · standalone (no transactions)'}`);
    console.log(`Ready in ${Date.now() - startedAt}ms`);
  });

  const stop = (signal: string) => {
    console.log(`[KSF] ${signal} received, shutting down`);
    server.close(() => { void disconnect().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

start().catch((error) => {
  console.error('[KSF] The server could not start.');
  console.error((error as Error).message);
  if (/ECONNREFUSED|querySrv|ENOTFOUND|Server selection/i.test(String((error as Error).message))) {
    console.error('      Check MONGODB_URI in .env and that the database is reachable from this computer.');
  }
  process.exit(1);
});
