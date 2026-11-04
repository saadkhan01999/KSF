/* ==========================================================================
   Two-step sign-in: time-based one-time passwords (RFC 6238) and recovery
   codes. Works with Google Authenticator, Microsoft Authenticator, 1Password
   and every other standard app. No third-party dependency.
   ========================================================================== */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { col } from '../db/mongo.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('That is not a valid authenticator key.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit shared secret, in the form the app is shown. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

export function totpAt(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(counter)));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export const totpNow = (secret: string, at = Date.now()): string =>
  totpAt(secret, Math.floor(at / 1000 / TOTP_STEP_SECONDS));

/** One step either side covers a phone clock thirty seconds out. */
/** The time step a code belongs to (within the allowed drift), or null when it matches none. */
export function totpStep(secret: string | null | undefined, token: unknown, { window = 1, at = Date.now() } = {}): number | null {
  if (!secret) return null;
  const digits = String(token || '').replace(/\D/g, '');
  if (digits.length !== TOTP_DIGITS) return null;
  const counter = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
  const supplied = Buffer.from(digits, 'utf8');
  let matched: number | null = null;
  /* Every candidate is compared, so a near miss is not answered faster. */
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = Buffer.from(totpAt(secret, counter + drift), 'utf8');
    if (candidate.length === supplied.length && timingSafeEqual(candidate, supplied)) matched = counter + drift;
  }
  return matched;
}

export const verifyTotp = (secret: string | null | undefined, token: unknown, options: { window?: number; at?: number } = {}): boolean =>
  totpStep(secret, token, options) !== null;

/**
 * Accept a code once (RFC 6238 §5.2). A code stays valid for its 30 seconds
 * plus the drift allowed either side, so one seen over a shoulder or on a
 * shared screen could otherwise sign in a second time. The step is recorded
 * with a single conditional update, so two requests racing with the same
 * code cannot both succeed.
 */
export async function consumeTotp(userId: string, secret: string | null | undefined, token: unknown): Promise<'accepted' | 'wrong' | 'reused'> {
  const step = totpStep(secret, token);
  if (step === null) return 'wrong';
  const used = await col.users().updateOne(
    { _id: userId, $or: [{ totp_last_step: { $exists: false } }, { totp_last_step: null }, { totp_last_step: { $lt: step } }] },
    { $set: { totp_last_step: step } }
  );
  return used.modifiedCount === 1 ? 'accepted' : 'reused';
}

export const REUSED_CODE_MESSAGE = 'That code has already been used. Wait for the next one in your authenticator app.';

export const otpauthUrl = ({ issuer, account, secret }: { issuer: string; account: string; secret: string }): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
  + `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Ten single-use codes in two readable groups: ABCDE-FGHJK. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let code = '';
    for (let position = 0; position < 10; position += 1) {
      if (position === 5) code += '-';
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    codes.push(code);
  }
  return codes;
}

export const normaliseRecoveryCode = (code: unknown): string => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
