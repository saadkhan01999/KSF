/* ==========================================================================
   Vercel Function: the whole KSF API
   --------------------------------------------------------------------------
   The same application as backend/src/server.ts, without listen(): Vercel
   hands each request to the default export below, and keeps the function
   instance between requests, so the database connection, the start-up
   checks (indexes, plans, the Super Admin) and the live feed are set up once
   per instance, on its first request. vercel.json sends every /api/…
   request here, and Express sees the address that was asked for
   (/api/v1/…), so every route works as it does on a normal server.

   Housekeeping is started by Vercel Cron through /api/v1/cron/maintenance
   (backend/src/modules/cron.ts), since nothing runs between requests.
   The application is built from backend/src by `npm run build`; on a VPS
   (Hostinger) or Docker, backend/src/server.ts is the entry point instead.
   ========================================================================== */

import { connect, databaseHint } from '../backend/dist/db/mongo.js';
import { bootstrap } from '../backend/dist/db/bootstrap.js';
import '../backend/dist/modules/index.js';
import { createApp } from '../backend/dist/http/app.js';
import { startLiveFeed } from '../backend/dist/services/live.js';

const app = createApp();
let starting = null;

/** Connect and check the database, once per instance; tried again after a failure. */
function ready() {
  starting ??= (async () => {
    await connect();
    await bootstrap({ silent: true });
    startLiveFeed();
  })().catch((error) => {
    starting = null;
    throw error;
  });
  return starting;
}

export default async function handle(req, res) {
  try {
    await ready();
  } catch (error) {
    /* The usual first-deployment problem: the database cannot be reached.
       Say so in the function log, with what to do, and answer plainly. */
    console.error('[KSF] The database could not be reached:', error.message);
    for (const line of databaseHint(error)) console.error(`      ${line}`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ message: 'The KSF server cannot reach its database right now. The site owner can see why in the Vercel function logs.' }));
    return;
  }
  app(req, res);
}
