/* ==========================================================================
   Small helpers used everywhere: dates, identifiers, input cleaning and the
   Pakistan-specific validators.

   Dates are stored as ISO-8601 strings (UTC). Every boundary a query uses is
   worked out here in JavaScript, so a report means the same thing whichever
   MongoDB server it runs against.
   ========================================================================== */

import { createHash, randomUUID } from 'node:crypto';

/* ------------------------------------------------------------------ dates */
export const nowIso = (): string => new Date().toISOString();
export const today = (): string => new Date().toISOString().slice(0, 10);
export const plusHours = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();
export const plusMinutes = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();
export const plusDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

/** A calendar date `days` from today, as YYYY-MM-DD. Negative goes back. */
export const addDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** The first day of the month, optionally offset. startOfMonth(-1) is last month. */
export function startOfMonth(offsetMonths = 0): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offsetMonths);
  return date.toISOString().slice(0, 10);
}

export const daysFromNow = (dateStr: string): number =>
  Math.ceil((new Date(`${dateStr}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);

/* ------------------------------------------------------------ identifiers */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** A readable, unguessable id: MED-3F9A21C4. */
export const uid = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
export { randomUUID };

export const slugify = (value: string): string => String(value).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ---------------------------------------------------------- input cleaning */
export const toInt = (value: unknown, fallback = 0): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

export const toStr = (value: unknown, max = 400): string =>
  (value === undefined || value === null ? '' : String(value).trim().slice(0, max));

export const safeJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

/** Escapes a value for use inside a MongoDB regular expression. */
export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive "contains", the MongoDB equivalent of SQL LIKE '%x%'. */
export const contains = (value: string): RegExp => new RegExp(escapeRegex(value), 'i');

/**
 * Anything a person types that another person will later read goes through
 * here: control characters, zero-width and bidirectional-override characters
 * (used to disguise text) and runs of blank lines are removed.
 */
export const sanitiseText = (value: unknown, max = 4000): string => String(value ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
  .replace(/[​-‏‪-‮⁠-⁯﻿]/g, '')
  .replace(/\r\n/g, '\n')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim()
  .slice(0, max);

/* ------------------------------------------------------------- validators */
export const isEmail = (value: unknown): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ''));
export const isCnic = (value: unknown): boolean => !value || /^\d{5}-\d{7}-\d$/.test(String(value).trim());
export const isPkPhone = (value: unknown): boolean => {
  if (!value) return true;
  const compact = String(value).replace(/\s/g, '');
  return /^(\+92|0)?[\s-]?3\d{2}[\s-]?\d{4}[\s-]?\d{3}$/.test(compact)
    || /^(\+92|0)?[\s-]?\d{2,3}[\s-]?\d{7,8}$/.test(compact);
};

/** Only ever show part of an address back to somebody: n****a@gmail.com */
export const maskEmail = (email: string): string => {
  const [name = '', domain] = String(email || '').split('@');
  if (!domain) return '';
  const visible = name.length <= 2
    ? name.slice(0, 1)
    : `${name[0]}${'*'.repeat(Math.min(6, name.length - 2))}${name.slice(-1)}`;
  return `${visible}@${domain}`;
};

/* ---------------------------------------------------------- rate limiting */
/* A fixed-window counter held in memory. One API process serves the
   platform; a multi-instance deployment would move this to a shared store. */
interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export interface RateResult { ok: boolean; remaining: number; retryAfter: number }

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) return { ok: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  return { ok: true, remaining: limit - bucket.count, retryAfter: 0 };
}

/** Read a bucket without adding to it — sign-in counts failures only. */
export function rateLimitStatus(key: string, limit: number): RateResult {
  const bucket = buckets.get(key);
  const now = Date.now();
  if (!bucket || bucket.resetAt <= now) return { ok: true, remaining: limit, retryAfter: 0 };
  if (bucket.count >= limit) return { ok: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  return { ok: true, remaining: limit - bucket.count, retryAfter: 0 };
}

export const clearRateLimit = (key: string): boolean => buckets.delete(key);
