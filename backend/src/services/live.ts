/* ==========================================================================
   Live updates
   --------------------------------------------------------------------------
   When the Super Admin changes a plan's price, or a pharmacy's subscription
   moves — a payment clears, a trial ends, a plan is cancelled — every open
   screen that shows it is told, so the pricing page, the dashboard, billing
   and the checkout agree without anybody pressing reload.

   Where the news comes from: MongoDB change streams on the plans and the
   subscriptions, so a change made anywhere (a provider's webhook, the hourly
   maintenance, another server, the console) is seen once and the same way.
   On a database that cannot open a change stream, a poll of the same two
   collections every 15 seconds takes over.

   How it reaches the browser: Server-Sent Events. The server closes each
   stream after about 50 seconds and the browser reconnects at once, quoting
   the last event it saw. That keeps the feed working through a proxy that
   holds a response back until it ends, and a short history replays what
   happened between two connections. An event only says what changed; the
   browser then asks for the new figures through the ordinary, permissioned
   endpoints, so the stream itself carries nothing private.
   ========================================================================== */

import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { ChangeStream } from 'mongodb';
import { col } from '../db/mongo.js';

export type LiveEvent =
  | { type: 'plans.changed' }
  | { type: 'subscription.changed'; pharmacyId: string };

/** Who a stream is for: a visitor, one pharmacy's people, or the platform team. */
export interface Audience { pharmacyId: string | null; platform: boolean }
export const VISITOR: Audience = { pharmacyId: null, platform: false };

interface Stamped { seq: number; event: LiveEvent }

/* A new id for every start, so a browser can tell that the history it is
   quoting belongs to a server that has since restarted. */
const BOOT = randomUUID().slice(0, 8);
const HISTORY_SIZE = 500;
const STREAM_LIFETIME_MS = 50_000;
const HEARTBEAT_MS = 20_000;
/* A payment touches the subscription several times in a few milliseconds;
   one event after the last of them is enough. */
const SETTLE_MS = 250;

const history: Stamped[] = [];
const listeners = new Set<(stamped: Stamped) => void>();
const settling = new Map<string, NodeJS.Timeout>();
let seq = 0;

const keyOf = (event: LiveEvent): string => (event.type === 'subscription.changed' ? `${event.type}:${event.pharmacyId}` : event.type);

function emit(event: LiveEvent): void {
  seq += 1;
  const stamped = { seq, event };
  history.push(stamped);
  if (history.length > HISTORY_SIZE) history.shift();
  for (const listener of listeners) listener(stamped);
}

/** Tell every interested screen, once a burst of changes has settled. */
export function publish(event: LiveEvent): void {
  const key = keyOf(event);
  clearTimeout(settling.get(key));
  settling.set(key, setTimeout(() => { settling.delete(key); emit(event); }, SETTLE_MS));
}

export function concerns(audience: Audience, event: LiveEvent): boolean {
  if (event.type === 'plans.changed') return true;
  return audience.platform || audience.pharmacyId === event.pharmacyId;
}

const frame = (stamped: Stamped): string => `id: ${BOOT}:${stamped.seq}\nevent: ${stamped.event.type}\ndata: ${JSON.stringify(stamped.event)}\n\n`;

/**
 * Serve one stream. `lastEventId` is what the browser saw last; anything
 * newer is replayed first. When the gap cannot be filled — the server
 * restarted, or the history has moved on — the browser is told to `resync`,
 * which means "fetch everything again".
 */
export function openStream(res: Response, audience: Audience, lastEventId?: string): void {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 2000\n\n');

  const [boot, last] = String(lastEventId ?? '').split(':');
  if (boot && last) {
    const since = Number(last);
    const missed = history.filter((stamped) => stamped.seq > since);
    const complete = boot === BOOT && (missed.length === 0 || missed[0].seq === since + 1 || since >= seq);
    if (!complete) res.write(`id: ${BOOT}:${seq}\nevent: resync\ndata: {}\n\n`);
    else for (const stamped of missed) if (concerns(audience, stamped.event)) res.write(frame(stamped));
  }
  res.write(`id: ${BOOT}:${seq}\nevent: ready\ndata: {}\n\n`);

  const listener = (stamped: Stamped) => { if (concerns(audience, stamped.event)) res.write(frame(stamped)); };
  listeners.add(listener);
  const heartbeat = setInterval(() => res.write(': still here\n\n'), HEARTBEAT_MS);
  const lifetime = setTimeout(() => res.end(), STREAM_LIFETIME_MS);
  res.on('close', () => {
    listeners.delete(listener);
    clearInterval(heartbeat);
    clearTimeout(lifetime);
  });
}

/* ============================== THE SOURCE ============================== */

let streams: ChangeStream[] = [];
let poller: NodeJS.Timeout | null = null;
let restart: NodeJS.Timeout | null = null;
let stopped = false;

/** Fallback: look for anything updated since the last look. */
function startPolling(): void {
  if (poller) return;
  let since = new Date().toISOString();
  poller = setInterval(() => {
    const now = new Date().toISOString();
    void Promise.all([
      col.plans().countDocuments({ updated_at: { $gt: since } }),
      col.subscriptions().find({ updated_at: { $gt: since } }, { projection: { pharmacy_id: 1 } }).toArray()
    ]).then(([plans, subscriptions]) => {
      if (plans) publish({ type: 'plans.changed' });
      for (const row of subscriptions) publish({ type: 'subscription.changed', pharmacyId: row.pharmacy_id });
      since = now;
    }).catch((error: Error) => console.warn(`[KSF] live updates: poll failed (${error.message})`));
  }, 15_000);
  poller.unref();
}

const unsupported = (error: Error & { code?: number }): boolean =>
  error.code === 40573 || error.code === 136 || /replica set|change stream|not supported/i.test(error.message);

function closeStreams(): void {
  for (const stream of streams) void stream.close().catch(() => undefined);
  streams = [];
}

function watch(): void {
  closeStreams();
  const plans = col.plans().watch([], {});
  const subscriptions = col.subscriptions().watch(
    [{ $match: { operationType: { $in: ['insert', 'update', 'replace'] } } }],
    { fullDocument: 'updateLookup' }
  );
  plans.on('change', () => publish({ type: 'plans.changed' }));
  subscriptions.on('change', (change) => {
    const pharmacyId = 'fullDocument' in change ? change.fullDocument?.pharmacy_id : undefined;
    if (pharmacyId) publish({ type: 'subscription.changed', pharmacyId });
  });
  const failed = (error: Error) => {
    if (stopped || !streams.length) return;
    closeStreams();
    if (unsupported(error)) {
      console.warn('[KSF] live updates: this database cannot open a change stream, so plans and subscriptions are checked every 15 seconds instead.');
      startPolling();
      return;
    }
    /* A network blip: the driver already retried what it could. Start again. */
    console.warn(`[KSF] live updates: change stream stopped (${error.message}); restarting in 5 seconds.`);
    restart = setTimeout(() => { restart = null; if (!stopped) watch(); }, 5000);
    restart.unref();
  };
  plans.on('error', failed);
  subscriptions.on('error', failed);
  streams = [plans, subscriptions];
}

/** Start watching. Safe to call more than once; returns how to stop. */
export function startLiveFeed(): () => Promise<void> {
  stopped = false;
  if (!streams.length && !poller) watch();
  return async () => {
    stopped = true;
    if (restart) clearTimeout(restart);
    if (poller) clearInterval(poller);
    poller = null;
    for (const timer of settling.values()) clearTimeout(timer);
    settling.clear();
    await Promise.all(streams.map((stream) => stream.close().catch(() => undefined)));
    streams = [];
  };
}
