/* ==========================================================================
   The scheduler's door
   --------------------------------------------------------------------------
   On a serverless host (Vercel) nothing runs between requests, so the
   hourly housekeeping a normal server does by itself is started from
   outside: Vercel Cron calls this address on the schedule in
   deploy/vercel/vercel.json,
   with "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET set the
   address does not exist; with it, anybody else is turned away.
   ========================================================================== */

import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../core/errors.js';
import { nowIso } from '../core/util.js';
import { publicRoute } from '../http/router.js';
import { runMaintenance } from '../services/maintenance.js';

const matches = (given: string, expected: string): boolean => {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};

publicRoute('GET', '/api/v1/cron/maintenance', async (ctx) => {
  if (!env.CRON_SECRET) throw new HttpError(404, 'Not found.');
  if (!matches(String(ctx.headers.authorization ?? ''), `Bearer ${env.CRON_SECRET}`)) throw new HttpError(401, 'Only the scheduler may run this.');
  const summary = await runMaintenance();
  return { ok: summary.problems.length === 0, ranAt: nowIso(), ...summary };
});
