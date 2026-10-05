/* ==========================================================================
   One-time codes: e-mail verification, password reset, e-mail change.
     - Only the SHA-256 of a code is stored.
     - A code expires (OTP_EXPIRY_MINUTES), has a limited number of guesses,
       and works exactly once.
     - Issuing a new code retires the previous one for the same purpose.
     - Sends are counted and capped per hour.
   ========================================================================== */

import { env } from '../config/env.js';
import { col } from '../db/mongo.js';
import type { VerificationCode } from '../db/types.js';
import { nowIso, plusMinutes, randomUUID, sha256 } from '../core/util.js';
import { numericCode, sameSecret } from './crypto.js';

export const PURPOSES = Object.freeze({
  EMAIL_VERIFY: 'email_verify',
  PASSWORD_RESET: 'password_reset',
  EMAIL_CHANGE: 'email_change'
});

export async function issueCode(input: {
  purpose: string; email: string; userId?: string | null; pharmacyId?: string | null;
  referenceId?: string | null; ip?: string | null; digits?: number;
}): Promise<{ code: string | null; expiresAt: string | null; sends: number; throttled: boolean }> {
  const address = String(input.email || '').toLowerCase();
  const windowStart = new Date(Date.now() - 3_600_000).toISOString();
  const recent = await col.verificationCodes().countDocuments({ purpose: input.purpose, email: address, created_at: { $gt: windowStart } });
  if (recent >= env.OTP_MAX_SENDS) return { code: null, expiresAt: null, sends: recent, throttled: true };

  const at = nowIso();
  await col.verificationCodes().updateMany(
    { purpose: input.purpose, email: address, consumed_at: null }, { $set: { consumed_at: at } }
  );

  const code = numericCode(input.digits ?? 6);
  const id = randomUUID();
  const doc: VerificationCode = {
    _id: id, id, purpose: input.purpose, email: address, user_id: input.userId ?? null,
    pharmacy_id: input.pharmacyId ?? null, reference_id: input.referenceId ?? null, code_hash: sha256(code),
    attempts: 0, max_attempts: env.OTP_MAX_ATTEMPTS, sent_count: recent + 1, ip: input.ip ?? null,
    expires_at: plusMinutes(env.OTP_EXPIRY_MINUTES), consumed_at: null, created_at: at
  };
  await col.verificationCodes().insertOne(doc);
  return { code, expiresAt: doc.expires_at, sends: recent + 1, throttled: false };
}

export async function verifyCode(input: { purpose: string; email: string; code: unknown }): Promise<
  { ok: true; record: VerificationCode } | { ok: false; reason: 'missing' | 'expired' | 'attempts' | 'wrong'; attemptsLeft?: number }
> {
  const address = String(input.email || '').toLowerCase();
  const supplied = String(input.code || '').replace(/\s/g, '');
  const record = await col.verificationCodes().findOne(
    { purpose: input.purpose, email: address, consumed_at: null }, { sort: { created_at: -1 } }
  );
  if (!record) return { ok: false, reason: 'missing' };

  const burn = () => col.verificationCodes().updateOne({ _id: record.id }, { $set: { consumed_at: nowIso() } });
  if (new Date(record.expires_at).getTime() < Date.now()) { await burn(); return { ok: false, reason: 'expired' }; }
  if (record.attempts >= record.max_attempts) { await burn(); return { ok: false, reason: 'attempts' }; }

  if (!sameSecret(sha256(supplied), record.code_hash)) {
    const attempts = record.attempts + 1;
    await col.verificationCodes().updateOne({ _id: record.id }, { $set: { attempts } });
    if (attempts >= record.max_attempts) { await burn(); return { ok: false, reason: 'attempts', attemptsLeft: 0 }; }
    return { ok: false, reason: 'wrong', attemptsLeft: record.max_attempts - attempts };
  }

  await burn();
  return { ok: true, record };
}

export async function pendingCode(purpose: string, email: string) {
  const record = await col.verificationCodes().findOne(
    { purpose, email: String(email || '').toLowerCase(), consumed_at: null, expires_at: { $gt: nowIso() } },
    { sort: { created_at: -1 } }
  );
  if (!record) return null;
  return {
    expiresAt: record.expires_at,
    secondsLeft: Math.max(0, Math.round((new Date(record.expires_at).getTime() - Date.now()) / 1000)),
    attemptsLeft: Math.max(0, record.max_attempts - record.attempts),
    sends: record.sent_count
  };
}

export async function pruneCodes(days = 7): Promise<void> {
  await col.verificationCodes().deleteMany({ created_at: { $lt: new Date(Date.now() - days * 86_400_000).toISOString() } });
}
