/* ==========================================================================
   Sessions: JWT access tokens and rotating refresh tokens
   --------------------------------------------------------------------------
   Two tokens, two jobs.

     Access token    A JWT (HS256, JWT_ACCESS_SECRET) valid for
                     JWT_ACCESS_MINUTES (15 by default). The web app keeps it
                     in memory only and sends it as `Authorization: Bearer`.
                     Being short-lived, a leaked one is worth very little.

     Refresh token   A JWT (HS256, JWT_REFRESH_SECRET — a different key) in an
                     HttpOnly, SameSite=Strict cookie scoped to /api/v1/auth.
                     JavaScript can never read it. It is exchanged for a new
                     access token, and every exchange ROTATES it: the old one
                     stops working the moment the new one is issued.

   Each sign-in is a row in `sessions`. The refresh token carries the session
   id and a one-time `jti`; only the SHA-256 of the current jti is stored.
   Presenting a refresh token whose jti is not the current one means it was
   copied — so the whole session is revoked on the spot (reuse detection).

   Because every request also checks the session row, signing out, a
   password change, suspending somebody or removing a device takes effect
   immediately, not when an access token happens to expire.

   Three clocks still run on every session:
     idle       SESSION_IDLE_MINUTES without activity ends it
     sliding    the refresh token's own expiry, renewed on each rotation
     absolute   SESSION_ABSOLUTE_HOURS after sign-in, never extended
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { col } from '../db/mongo.js';
import type { Session } from '../db/types.js';
import { nowIso, plusHours, plusMinutes, plusDays, sha256, uid } from '../core/util.js';
import { secret } from './crypto.js';

export interface AccessClaims { sub: string; sid: string; pid: string | null; typ: 'access' }
interface RefreshClaims { sub: string; sid: string; jti: string; typ: 'refresh' }

const signOptions = { algorithm: 'HS256' as const, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE };

export function signAccessToken(session: Session, pharmacyId: string | null): { token: string; expiresAt: string } {
  const expiresIn = env.JWT_ACCESS_MINUTES * 60;
  const token = jwt.sign({ sid: session.id, pid: pharmacyId, typ: 'access' }, env.JWT_ACCESS_SECRET, {
    ...signOptions, subject: session.user_id, expiresIn
  });
  return { token, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

function signRefreshToken(userId: string, sessionId: string, jti: string): string {
  return jwt.sign({ sid: sessionId, typ: 'refresh' }, env.JWT_REFRESH_SECRET, {
    ...signOptions, subject: userId, jwtid: jti, expiresIn: env.JWT_REFRESH_DAYS * 86_400
  });
}

export type VerifyFailure = 'expired' | 'invalid';

export function verifyAccessToken(token: string): AccessClaims | VerifyFailure {
  try {
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { ...signOptions, algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (claims.typ !== 'access' || !claims.sub || !claims.sid) return 'invalid';
    return { sub: claims.sub, sid: claims.sid, pid: claims.pid ?? null, typ: 'access' };
  } catch (error) {
    return (error as Error).name === 'TokenExpiredError' ? 'expired' : 'invalid';
  }
}

function verifyRefreshToken(token: string): RefreshClaims | null {
  try {
    const claims = jwt.verify(token, env.JWT_REFRESH_SECRET, { ...signOptions, algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (claims.typ !== 'refresh' || !claims.sub || !claims.sid || !claims.jti) return null;
    return { sub: claims.sub, sid: claims.sid, jti: claims.jti, typ: 'refresh' };
  } catch {
    return null;
  }
}

/** Start a session; returns the refresh token to put in the cookie. */
export async function createSession(input: { userId: string; deviceId: string | null; ip: string | null; userAgent: string }): Promise<{ session: Session; refreshToken: string }> {
  const at = nowIso();
  const jti = secret(24);
  const session: Session = {
    _id: '', id: uid('SES'), user_id: input.userId, device_id: input.deviceId, refresh_hash: sha256(jti),
    ip: input.ip, user_agent: (input.userAgent || '').slice(0, 200), created_at: at, last_seen_at: at,
    expires_at: plusDays(env.JWT_REFRESH_DAYS), absolute_expires_at: plusHours(env.SESSION_ABSOLUTE_HOURS),
    revoked_at: null, revoked_reason: null, elevated_until: null, rotations: 0
  };
  session._id = session.id;
  await col.sessions().insertOne(session);
  return { session, refreshToken: signRefreshToken(input.userId, session.id, jti) };
}

/** Is this session still usable right now? Revokes it, with the reason, if not. */
export async function liveSession(sessionId: string): Promise<Session | null> {
  const session = await col.sessions().findOne({ _id: sessionId });
  if (!session || session.revoked_at) return null;
  const now = Date.now();
  const reason =
    new Date(session.absolute_expires_at).getTime() < now ? 'absolute-expiry'
      : new Date(session.expires_at).getTime() < now ? 'expired'
        : now - new Date(session.last_seen_at).getTime() > env.SESSION_IDLE_MINUTES * 60_000 ? 'idle'
          : null;
  if (reason) {
    await revokeSession(session.id, reason);
    return null;
  }
  return session;
}

/**
 * Exchange a refresh token for a fresh pair. Returns null when the token is
 * no good; revokes the whole session when it is a replay of a used token.
 */
export async function rotateRefreshToken(token: string): Promise<{ session: Session; refreshToken: string } | { reused: true } | null> {
  const claims = verifyRefreshToken(token);
  if (!claims) return null;
  const session = await liveSession(claims.sid);
  if (!session || session.user_id !== claims.sub) return null;

  if (session.refresh_hash !== sha256(claims.jti)) {
    await revokeSession(session.id, 'refresh-token-reused');
    return { reused: true };
  }

  const jti = secret(24);
  const ceiling = new Date(session.absolute_expires_at).getTime();
  const sliding = Math.min(Date.now() + env.JWT_REFRESH_DAYS * 86_400_000, ceiling);
  const rotated = await col.sessions().findOneAndUpdate(
    { _id: session.id, refresh_hash: session.refresh_hash, revoked_at: null },
    { $set: { refresh_hash: sha256(jti), expires_at: new Date(sliding).toISOString(), last_seen_at: nowIso() }, $inc: { rotations: 1 } },
    { returnDocument: 'after' }
  );
  /* Two tabs refreshing at the same instant: the second loses the race and
     must not be treated as an attacker — it simply asks again. */
  if (!rotated) return null;
  return { session: rotated, refreshToken: signRefreshToken(session.user_id, session.id, jti) };
}

/** Record activity, at most once a minute per session, for the idle clock. */
export async function touchSession(session: Session, ip: string | null): Promise<void> {
  if (Date.now() - new Date(session.last_seen_at).getTime() < 60_000) return;
  const at = nowIso();
  await col.sessions().updateOne({ _id: session.id }, { $set: { last_seen_at: at, ...(ip ? { ip } : {}) } });
  if (session.device_id) {
    await col.devices().updateOne({ _id: session.device_id }, { $set: { last_active_at: at, ...(ip ? { last_ip: ip } : {}) } });
  }
}

export async function revokeSession(sessionId: string, reason = 'signed-out'): Promise<void> {
  await col.sessions().updateOne({ _id: sessionId, revoked_at: null }, { $set: { revoked_at: nowIso(), revoked_reason: reason } });
}

/** End every session for a user, optionally sparing one. Returns how many. */
export async function revokeAllSessions(userId: string, { except = null as string | null, reason = 'signed-out-everywhere' } = {}): Promise<number> {
  const result = await col.sessions().updateMany(
    { user_id: userId, revoked_at: null, ...(except ? { _id: { $ne: except } } : {}) },
    { $set: { revoked_at: nowIso(), revoked_reason: reason } }
  );
  return result.modifiedCount;
}

export async function revokeDeviceSessions(deviceId: string, reason = 'device-removed'): Promise<number> {
  const result = await col.sessions().updateMany(
    { device_id: deviceId, revoked_at: null }, { $set: { revoked_at: nowIso(), revoked_reason: reason } }
  );
  return result.modifiedCount;
}

/** Mark the session as recently re-verified, for step-up protected actions. */
export const elevateSession = async (sessionId: string): Promise<void> => {
  await col.sessions().updateOne({ _id: sessionId }, { $set: { elevated_until: plusMinutes(env.STEP_UP_MINUTES) } });
};

export const isElevated = (session: Session | null): boolean =>
  !!session?.elevated_until && new Date(session.elevated_until).getTime() > Date.now();

/** Live sessions with their device, for the Security Centre. */
export async function listSessions(userId: string) {
  return col.sessions().aggregate([
    { $match: { user_id: userId, revoked_at: null, expires_at: { $gt: nowIso() } } },
    { $sort: { last_seen_at: -1 } },
    { $lookup: { from: 'devices', localField: 'device_id', foreignField: '_id', as: 'device' } },
    {
      $project: {
        _id: 0, id: 1, created_at: 1, last_seen_at: 1, expires_at: 1, ip: 1, user_agent: 1, device_id: 1,
        device_label: { $first: '$device.label' }, device_category: { $first: '$device.category' },
        platform: { $first: '$device.platform' }, browser: { $first: '$device.browser' }
      }
    }
  ]).toArray();
}

/** Revoked and expired rows are evidence for a while, then removed. */
export async function pruneSessions(days = 30): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await col.sessions().deleteMany({ $or: [{ revoked_at: { $ne: null, $lt: cutoff } }, { expires_at: { $lt: cutoff } }] });
}
