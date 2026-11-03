/* ==========================================================================
   KSF on a serverless host (Vercel)
   --------------------------------------------------------------------------
   The same application as server.ts, without listen(): Vercel hands each
   request to `handle`, and the function instance is reused between
   requests, so the database connection, the start-up checks (indexes,
   plans, the Super Admin) and the live feed are set up once per instance,
   on its first request. Housekeeping is started by Vercel Cron through
   /api/v1/cron/maintenance (modules/cron.ts), since nothing runs here
   between requests.

   For a VPS (Hostinger) or Docker, server.ts is still the entry point:
   one long-running process is cheaper and simpler there.
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect, databaseHint } from './db/mongo.js';
import { bootstrap } from './db/bootstrap.js';
import './modules/index.js';
import { createApp } from './http/app.js';
import { startLiveFeed } from './services/live.js';

const app = createApp();
let starting: Promise<void> | null = null;

/** Connect and check the database, once per instance; tried again after a failure. */
function ready(): Promise<void> {
  starting ??= (async () => {
    await connect();
    await bootstrap({ silent: true });
    startLiveFeed();
  })().catch((error: Error) => {
    starting = null;
    throw error;
  });
  return starting;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await ready();
  } catch (error) {
    /* The usual first-deployment problem: the database cannot be reached.
       Say so in the function log, with what to do, and answer plainly. */
    console.error('[KSF] The database could not be reached:', (error as Error).message);
    for (const line of databaseHint(error as Error)) console.error(`      ${line}`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ message: 'The KSF server cannot reach its database right now. The site owner can see why in the Vercel function logs.' }));
    return;
  }
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
