/* ==========================================================================
   What a payment provider has to be able to do
   --------------------------------------------------------------------------
   One shape, so the rest of the application never asks which provider it is
   talking to. Three rules hold for every adapter:

   1. An adapter never decides that money arrived. It reports what the
      provider said; the caller checks amount, currency and reference against
      what the server asked for.
   2. An adapter that is not configured is not available — no sandbox
      fallback, no pretend mode.
   3. Card numbers never reach this application. Every adapter redirects to
      the provider's hosted page or takes a wallet or bank reference.
   ========================================================================== */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const PAYMENT_STATUS = Object.freeze({
  CREATED: 'created', PENDING: 'pending', SUCCEEDED: 'succeeded', FAILED: 'failed',
  CANCELLED: 'cancelled', EXPIRED: 'expired', REFUNDED: 'refunded'
});
export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

const TERMINAL = new Set<string>([PAYMENT_STATUS.SUCCEEDED, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELLED, PAYMENT_STATUS.EXPIRED, PAYMENT_STATUS.REFUNDED]);

/**
 * Is this transition allowed? Providers deliver callbacks out of order; a
 * late "pending" must not undo a success, and a success can only be refunded.
 */
export function canMoveTo(from: string | null, to: string): boolean {
  if (from === to) return false;
  if (!from) return true;
  if (from === PAYMENT_STATUS.SUCCEEDED) return to === PAYMENT_STATUS.REFUNDED;
  return !TERMINAL.has(from);
}

/** A provider setting, read from the environment at the moment it is needed. */
export const setting = (name: string, fallback = ''): string => String(process.env[name] ?? fallback).trim();

export function requireEnv(names: string[]): { ok: boolean; missing: string[] } {
  const missing = names.filter((name) => !setting(name));
  return { ok: missing.length === 0, missing };
}

/** Constant-time comparison of two signatures. */
export function sameSignature(a: unknown, b: unknown): boolean {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export const hmacHex = (key: string, payload: string | Buffer, algorithm = 'sha256'): string =>
  createHmac(algorithm, key).update(payload).digest('hex');

/** Paisa to the provider's "1234.00" in whole currency units. */
export const paisaToUnits = (paisa: number): string => (Math.round(Number(paisa) || 0) / 100).toFixed(2);

/** And back, without a float that can lose a rupee. */
export function unitsToPaisa(units: unknown): number | null {
  const text = String(units ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/* ------------------------------------------------------------------ shapes */
export interface ProviderOutcome {
  ok: boolean; reason?: string; reference?: string; providerReference?: string; amountPaisa?: number | null;
  currency?: string; status?: PaymentStatus; providerStatus?: string; method?: string | null; feePaisa?: number | null;
  /** A provider that renews by itself (Stripe) says which of its subscriptions this payment started. */
  recurring?: { subscriptionId: string | null; customerId: string | null };
}

export interface RedirectRequest { url: string; method: 'POST' | 'GET'; fields: Record<string, string> }

export interface BuiltRequest {
  ok: boolean; reason?: string; redirect?: RedirectRequest; instructions?: Record<string, unknown>; expiresAt?: string;
  /** The provider's own id for the request (a Stripe Checkout Session), kept for lookups. */
  providerReference?: string;
}

/** What the server asks a provider for. The amount comes from the plan, never a browser. */
export interface PaymentRequest {
  reference: string; amountPaisa: number; currency: string; description: string; returnUrl: string; cancelUrl: string;
  plan: { key: string; name: string; period: string };
  /** Renew automatically at the provider (Stripe subscription mode) rather than one payment. */
  recurring: boolean;
  customerEmail?: string | null;
  metadata: Record<string, string>;
}

/**
 * One verified event from a provider that bills on its own schedule (Stripe),
 * reduced to what KSF acts on. The adapter only reads and verifies; what the
 * event does to a subscription is decided in payments/index.ts.
 */
export type ProviderEvent =
  | { ok: false; reason: string }
  | { ok: true; id: string; type: string; kind: 'checkout'; outcome: ProviderOutcome }
  | {
    ok: true; id: string; type: string; kind: 'renewal'; subscriptionId: string; invoiceId: string;
    amountPaisa: number; currency: string; paid: boolean; failure?: string;
  }
  | { ok: true; id: string; type: string; kind: 'renewal-setting'; subscriptionId: string; renews: boolean }
  | { ok: true; id: string; type: string; kind: 'ended'; subscriptionId: string }
  | { ok: true; id: string; type: string; kind: 'ignored' };

export interface CallbackInput {
  body?: Record<string, any>; query?: Record<string, string>; raw?: Buffer | string | null; headers?: Record<string, unknown>;
}

export interface Adapter {
  key: string;
  label: string;
  methods: string[];
  capabilities: { redirect: boolean; lookup: boolean; refund: boolean; webhook: boolean };
  configured(): { ok: boolean; missing: string[] };
  describe(): { key: string; label: string; configured: boolean; missing: string[]; mode: string; verified: boolean; note: string };
  createRequest(input: PaymentRequest): BuiltRequest | Promise<BuiltRequest>;
  verifyCallback(input: CallbackInput): ProviderOutcome;
  lookup?(input: { reference: string; providerReference: string | null }): Promise<ProviderOutcome>;
  refund?(input: { providerReference: string | null; currency: string; amountPaisa: number; reason: string }): Promise<ProviderOutcome>;
  /** A provider whose webhook carries many kinds of event: verify one and say what it means. */
  parseEvent?(input: CallbackInput): ProviderEvent;
  /** Stop, or resume, the provider's own renewals: at the period's end, or at once. */
  setRenewal?(providerSubscriptionId: string, renew: boolean, immediately?: boolean): Promise<ProviderOutcome>;
  /** The provider's page where a customer changes their card. */
  portal?(customerId: string, returnUrl: string): Promise<{ ok: boolean; url?: string; reason?: string }>;
}
