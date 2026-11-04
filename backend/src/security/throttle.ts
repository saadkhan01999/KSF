/* ==========================================================================
   Shared counters and one-time tickets
   --------------------------------------------------------------------------
   The limits that protect accounts (sign-in, sign-up, codes, password
   reset) and the tickets of a two-step sign-in live in MongoDB rather than
   in one server's memory. On Vercel every request can reach a different
   instance, and an instance can start fresh at any time: a counter kept in
   memory there resets whenever an attacker is lucky, and a ticket issued by
   one instance is unknown to the next, so a correct two-step code was
   refused. Both collections clean themselves up through a TTL index on
   expires_at.

   Busy limits that only stop a stuck tab (writes per minute, live streams,
   messages) stay in memory: they cost nothing and per-instance is enough.
   ========================================================================== */

import { col } from '../db/mongo.js';
import { secret } from './crypto.js';
import { sha256, type RateResult } from '../core/util.js';

const retryIn = (expiresAt: Date, now: number): number => Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));

/** Count one more against `key`, in a window of `windowMs`; one atomic update. */
export async function hit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const now = new Date();
  const open = { $gt: ['$expires_at', now] };
  const counter = await col.rateLimits().findOneAndUpdate(
    { _id: key },
    [{
      $set: {
        count: { $cond: [open, { $add: ['$count', 1] }, 1] },
        expires_at: { $cond: [open, '$expires_at', new Date(now.getTime() + windowMs)] }
      }
    }],
    { upsert: true, returnDocument: 'after' }
  );
  const count = counter?.count ?? 1;
  const expiresAt = counter?.expires_at ?? new Date(now.getTime() + windowMs);
  if (count > limit) return { ok: false, remaining: 0, retryAfter: retryIn(expiresAt, now.getTime()) };
  return { ok: true, remaining: limit - count, retryAfter: 0 };
}

/** Read a counter without adding to it — sign-in counts failures only. */
export async function peek(key: string, limit: number): Promise<RateResult> {
  const now = Date.now();
  const counter = await col.rateLimits().findOne({ _id: key, expires_at: { $gt: new Date(now) } });
  if (!counter) return { ok: true, remaining: limit, retryAfter: 0 };
  if (counter.count >= limit) return { ok: false, remaining: 0, retryAfter: retryIn(counter.expires_at, now) };
  return { ok: true, remaining: limit - counter.count, retryAfter: 0 };
}

export async function clear(key: string): Promise<void> {
  await col.rateLimits().deleteOne({ _id: key });
}

/* --------------------------------------------------------------- tickets
   The ticket itself goes to the browser; only its hash is stored, so a copy
   of the database holds nothing that could finish somebody's sign-in. */

export interface Ticket { userId: string; attempts: number }

const ticketId = (token: unknown): string => sha256(`ticket:${String(token ?? '')}`);

export async function issueTicket(kind: string, userId: string, minutes = 5): Promise<string> {
  const token = secret(24);
  await col.authTickets().insertOne({ _id: ticketId(token), kind, user_id: userId, attempts: 0, expires_at: new Date(Date.now() + minutes * 60_000) });
  return token;
}

/** The ticket, if it exists, is of this kind and has not expired. */
export async function readTicket(token: unknown, kind: string): Promise<Ticket | null> {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  const ticket = await col.authTickets().findOne({ _id: ticketId(token), kind, expires_at: { $gt: new Date() } });
  return ticket ? { userId: ticket.user_id, attempts: ticket.attempts } : null;
}

/** One more wrong answer on this ticket; returns how many there have been. */
export async function countAttempt(token: unknown): Promise<number> {
  const ticket = await col.authTickets().findOneAndUpdate({ _id: ticketId(token) }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
  return ticket?.attempts ?? Number.POSITIVE_INFINITY;
}

export async function dropTicket(token: unknown): Promise<void> {
  await col.authTickets().deleteOne({ _id: ticketId(token) });
}
