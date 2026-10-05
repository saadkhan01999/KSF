/* ==========================================================================
   Identifiers, secrets and the audit-chain hash
   --------------------------------------------------------------------------
   References (SUB-2026-X8K42P7, REF-X82K9Q) are unpredictable but are not
   secrets: knowing one grants nothing. Secrets (refresh tokens, device keys,
   one-time codes) come from the CSPRNG and only their SHA-256 is stored, so
   a copy of the database cannot be replayed against the running service.
   ========================================================================== */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/* Crockford base32 without I, L, O, U: nothing that can be misread on a
   receipt or misheard on a call. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomToken(length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** PREFIX-YYYY-XXXXXXX, e.g. SUB-2026-X8K42P7. */
export const secureReference = (prefix: string, { year = new Date().getFullYear(), length = 7 } = {}): string =>
  `${prefix}-${year}-${randomToken(length)}`;

/** PREFIX-XXXXXX, for things that get typed by hand. */
export const shortReference = (prefix: string, length = 6): string => `${prefix}-${randomToken(length)}`;
export const referralCode = (): string => shortReference('REF', 6);

/** 256 bits of secret, url-safe. Never stored as it is. */
export const secret = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** What is stored in place of a secret. */
export const fingerprint = (value: string): string => createHash('sha256').update(String(value)).digest('hex');

/** Constant-time comparison. */
export function sameSecret(a: unknown, b: unknown): boolean {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A uniformly drawn numeric code that may start with a zero. */
export function numericCode(digits = 6): string {
  let out = '';
  for (let index = 0; index < digits; index += 1) out += String(randomInt(10));
  return out;
}

export interface AuditEntryCore {
  sequence: number; prevHash: string | null; pharmacyId: string; userId: string | null; action: string;
  entity: string | null; entityId: string | null; summary: string | null; createdAt: string;
}

/**
 * The hash of one audit entry, binding it to the entry before it. Change any
 * field of any row and every hash after it stops matching.
 */
export function auditHash(entry: AuditEntryCore): string {
  const canonical = [
    entry.sequence, entry.prevHash ?? '', entry.pharmacyId, entry.userId ?? '', entry.action,
    entry.entity ?? '', entry.entityId ?? '', entry.summary ?? '', entry.createdAt
  ].join('\u001f');
  return createHash('sha256').update(canonical).digest('hex');
}
