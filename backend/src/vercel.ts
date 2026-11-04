/* ==========================================================================
   KSF on Vercel: the API as one function
   --------------------------------------------------------------------------
   The same application as server.ts, without listen(): Vercel hands each
   request to the default export, and keeps the function instance between
   requests, so the database connection, the start-up checks (indexes,
   plans, the Super Admin) and the live feed are set up once per instance,
   on its first request. Every route already lives under /api/v1, which is
   the path the project's rewrites send here, so nothing is renamed.

   Housekeeping is started by Vercel Cron through /api/v1/cron/maintenance
   (modules/cron.ts), since nothing runs between requests. On a VPS
   (Hostinger) or Docker, server.ts is the entry point instead; when Vercel
   itself picks server.js (its Express detection does, for a project rooted
   at backend/ or the backend service), server.js hands every request here.
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONFIG_PROBLEMS } from './config/env.js';
import { connect, databaseHint } from './db/mongo.js';
import { bootstrap } from './db/bootstrap.js';
import './modules/index.js';
import { createApp } from './http/app.js';
import { startLiveFeed } from './services/live.js';

/* Made on the first request, so importing this file (server.js does) costs nothing. */
let app: ReturnType<typeof createApp> | null = null;
let starting: Promise<void> | null = null;

/** Which step failed: reaching the database, or the start-up checks after it. */
class StartError extends Error {
  constructor(readonly step: 'database' | 'checks', readonly reason: Error) { super(reason.message); }
}

/** Connect and check the database, once per instance; tried again after a failure. */
function ready(): Promise<void> {
  starting ??= (async () => {
    try { await connect(); } catch (error) { throw new StartError('database', error as Error); }
    try { await bootstrap({ silent: true }); } catch (error) { throw new StartError('checks', error as Error); }
    startLiveFeed();
  })().catch((error: Error) => {
    starting = null;
    throw error;
  });
  return starting;
}

/* An error message can quote the connection string; never its user and password. */
const withoutSecrets = (text: string): string => text.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1***@').slice(0, 400);

const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A plain answer for when KSF cannot run here yet: JSON for the API, a short page for a browser. */
function unavailable(req: IncomingMessage, res: ServerResponse, title: string, lines: string[]): void {
  res.statusCode = 503;
  if (String(req.url ?? '').startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ message: `${title} ${lines.join(' ')}`.trim() }));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KSF needs setting up</title>`
    + `<body style="font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 16px;line-height:1.6;color:#132A22">`
    + `<h1 style="font-size:22px">${escape(title)}</h1><ul>${lines.map((line) => `<li><code>${escape(line)}</code></li>`).join('')}</ul>`
    + `<p>Add them in Vercel &rsaquo; the project &rsaquo; Settings &rsaquo; Environment Variables, then redeploy. The list of every setting is in deploy/VERCEL_DEPLOYMENT.txt.</p></body>`);
}

export default async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  /* A setting missing or wrong: say which, instead of a crashed function. */
  if (CONFIG_PROBLEMS.length) {
    unavailable(req, res, 'KSF cannot start yet: these settings need attention.', CONFIG_PROBLEMS);
    return;
  }
  try {
    await ready();
  } catch (error) {
    const failure = error instanceof StartError ? error : new StartError('checks', error as Error);
    if (failure.step === 'database') {
      /* The usual first-deployment problem: the database cannot be reached.
         Say so in the function log, with what to do, and answer plainly. */
      console.error('[KSF] The database could not be reached:', failure.reason.message);
      for (const line of databaseHint(failure.reason)) console.error(`      ${line}`);
      unavailable(req, res, 'The KSF server cannot reach its database right now.', [
        withoutSecrets(failure.reason.message),
        'Check MONGODB_URI, and that MongoDB Atlas > Network Access allows 0.0.0.0/0. The Vercel function logs say exactly why.'
      ]);
      return;
    }
    /* Reached the database, but a start-up check (indexes, plans, the Super
       Admin) failed: say which, rather than blaming the database. */
    console.error('[KSF] The start-up checks failed:', failure.reason);
    unavailable(req, res, 'The KSF server reached its database but could not finish starting.', [withoutSecrets(failure.reason.message)]);
    return;
  }
  app ??= createApp();
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
