/* ==========================================================================
   Password hashing and policy
   --------------------------------------------------------------------------
   A password is never stored or logged. What is stored records how it was
   hashed as well as the hash:

       scrypt$N=32768,r=8,p=3$<salt hex>$<hash hex>

   scrypt is memory-hard, listed by OWASP, and built into Node — so the server
   installs on any Windows counter or Linux host with no native compiler. If
   the configured cost changes, an account is re-hashed the next time its
   owner signs in (`needsRehash`).
   ========================================================================== */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { env } from '../config/env.js';

const scrypt = (password: string, salt: string, keylen: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => (error ? reject(error) : resolve(derived)));
  });

const KEY_LENGTH = 64;
export const PASSWORD_MIN_LENGTH = env.PASSWORD_MIN_LENGTH;
const currentParams = `N=${env.PASSWORD_SCRYPT_N},r=${env.PASSWORD_SCRYPT_R},p=${env.PASSWORD_SCRYPT_P}`;

const parseParams = (text: string): { N: number; r: number; p: number } => {
  const values = Object.fromEntries(text.split(',').filter(Boolean).map((pair) => {
    const [key, value] = pair.split('=');
    return [key, Number(value)];
  }));
  return { N: values.N || env.PASSWORD_SCRYPT_N, r: values.r || env.PASSWORD_SCRYPT_R, p: values.p || env.PASSWORD_SCRYPT_P };
};

async function derive(password: string, salt: string, params: { N: number; r: number; p: number }): Promise<string> {
  const derived = await scrypt(password, salt, KEY_LENGTH, { ...params, maxmem: 256 * params.N * params.r });
  return derived.toString('hex');
}

const sameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${currentParams}$${salt}$${await derive(password, salt, parseParams(currentParams))}`;
}

/**
 * Check a password against what is stored. A missing account costs the same
 * time as a wrong password, so the two cannot be told apart by timing.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<{ ok: boolean; needsRehash: boolean }> {
  const parts = String(stored || '').split('$');
  if (parts.length === 4 && parts[0] === 'scrypt') {
    const [, params, salt, hash] = parts;
    const ok = sameSecret(await derive(password, salt, parseParams(params)), hash);
    return { ok, needsRehash: ok && params !== currentParams };
  }
  await derive(password, 'ksf-timing-equaliser', parseParams(currentParams));
  return { ok: false, needsRehash: false };
}

/* --------------------------------------------------------- password policy */

/* Exactly the rules the password field lists beside the box, and nothing it
   does not show: a password with every rule ticked is always accepted. The
   person chooses their own password; the length and character mix, scrypt and
   the sign-in lock-out are what protect it. */
const RULES: Array<[RegExp, string]> = [
  [/[a-z]/, 'Password must include a lowercase letter.'],
  [/[A-Z]/, 'Password must include an uppercase letter.'],
  [/\d/, 'Password must include a number.'],
  [/[^A-Za-z0-9]/, 'Password must include a special character.']
];

/** Why this password cannot be used, or null if it can. */
export function passwordProblem(password: string): string | null {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (value.length > 200) return 'Password must be 200 characters or fewer.';
  for (const [pattern, message] of RULES) {
    if (!pattern.test(value)) return message;
  }
  return null;
}

/** Strength on a 0–4 scale for the meter beside the field. Advisory only. */
export function passwordStrength(password: string): { score: number; label: string } {
  const value = String(password || '');
  if (!value) return { score: 0, label: 'Empty' };
  let score = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  if (new Set(value).size >= 10) score += 1;
  const clamped = Math.min(4, score);
  return { score: clamped, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][clamped] };
}
