/* ==========================================================================
   Stripe
   --------------------------------------------------------------------------
   Card payments through Stripe Checkout, Stripe's own hosted page: no card
   number ever reaches KSF. A plan that renews (weekly, monthly, annual) is a
   Stripe subscription, so Stripe charges each period itself and tells KSF by
   webhook; a plan that does not renew is a single payment.

   The REST API is called directly — form-encoded requests and a pinned API
   version — so there is no SDK to keep up to date, and every reply this file
   reads is listed in one place. Webhooks are verified with the endpoint's
   signing secret over the exact bytes Stripe sent, with a five-minute window
   against replays; a browser coming back from Checkout is never believed —
   the session is looked up from this server instead.

   Settings: STRIPE_SECRET_KEY (sk_test_… or sk_live_…), STRIPE_WEBHOOK_SECRET
   (whsec_…), and optionally STRIPE_RECURRING=false to take single payments.
   ========================================================================== */

import {
  hmacHex, PAYMENT_STATUS, requireEnv, sameSignature, setting,
  type Adapter, type PaymentRequest, type ProviderEvent, type ProviderOutcome
} from './provider.js';

const STRIPE_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const API = 'https://api.stripe.com/v1';
/* Pinned, so a change on Stripe's side cannot change what these replies mean. */
const API_VERSION = '2024-06-20';
/* How old a webhook may be before it is treated as a replay. Stripe's own default. */
const TOLERANCE_SECONDS = 300;
/* Stripe's interval for each KSF period that renews. */
const INTERVALS: Record<string, string> = { week: 'week', month: 'month', year: 'year' };

export class StripeError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'StripeError';
  }
}

/** Stripe's nested form encoding: { a: { b: 1 }, c: [{ d: 2 }] } → a[b]=1&c[0][d]=2. */
export function formEncode(value: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === '') continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(item)) {
      item.forEach((entry, index) => {
        if (entry && typeof entry === 'object') formEncode(entry as Record<string, unknown>, `${name}[${index}]`, out);
        else out.append(`${name}[${index}]`, String(entry));
      });
    } else if (typeof item === 'object') {
      formEncode(item as Record<string, unknown>, name, out);
    } else {
      out.append(name, String(item));
    }
  }
  return out;
}

/** One call to the Stripe API. Throws StripeError with Stripe's own message. */
export async function stripeRequest<T = Record<string, any>>(
  method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string
): Promise<T> {
  const encoded = formEncode(params).toString();
  const response = await fetch(`${API}${path}${method === 'GET' && encoded ? `?${encoded}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${setting('STRIPE_SECRET_KEY')}`,
      'Stripe-Version': API_VERSION,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: method === 'POST' ? encoded : undefined,
    signal: AbortSignal.timeout(Number(setting('STRIPE_TIMEOUT_MS') || 15_000))
  });
  const json = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new StripeError(String(json.error?.message || `Stripe answered ${response.status}.`), response.status, json.error?.code);
  return json as T;
}

/**
 * Check a Stripe-Signature header: `t=<seconds>,v1=<hex>[,v1=…]`, an HMAC-SHA256
 * of "<t>.<raw body>" with the endpoint's signing secret. Any v1 may match
 * (Stripe sends two while a secret is being rolled).
 */
export function verifyStripeSignature(raw: string, header: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): { ok: boolean; reason?: string } {
  const pairs = header.split(',').map((part) => part.trim().split('=') as [string, string]);
  const timestamp = Number(pairs.find(([key]) => key === 't')?.[1]);
  const signatures = pairs.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !signatures.length) return { ok: false, reason: 'The Stripe-Signature header is missing or malformed.' };
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return { ok: false, reason: 'The event is older than five minutes — treated as a replay.' };
  const expected = hmacHex(secret, `${timestamp}.${raw}`);
  return signatures.some((signature) => sameSignature(expected, signature)) ? { ok: true } : { ok: false, reason: 'The signature did not verify.' };
}

const idOf = (value: unknown): string | null =>
  (typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : null);

/** What a Checkout Session says, as a payment outcome against our reference. */
export function sessionOutcome(session: Record<string, any>): ProviderOutcome {
  const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
  const status = paid ? PAYMENT_STATUS.SUCCEEDED : session.status === 'expired' ? PAYMENT_STATUS.EXPIRED : PAYMENT_STATUS.PENDING;
  const subscriptionId = idOf(session.subscription);
  return {
    ok: true,
    reference: String(session.client_reference_id || session.metadata?.ksf_reference || ''),
    /* Until it is paid, the session itself — it is what a later lookup asks
       for. Once paid, the invoice when there is one: the renewal webhooks
       name the same invoice, so the first payment can never count twice. */
    providerReference: paid ? idOf(session.invoice) ?? idOf(session.payment_intent) ?? String(session.id ?? '') : String(session.id ?? ''),
    amountPaisa: typeof session.amount_total === 'number' ? session.amount_total : null,
    currency: String(session.currency || '').toUpperCase(),
    status,
    providerStatus: `${session.status ?? ''}/${session.payment_status ?? ''}`,
    method: 'card',
    recurring: subscriptionId ? { subscriptionId, customerId: idOf(session.customer) } : undefined
  };
}

/** The Stripe subscription an invoice belongs to, in either API shape. */
const invoiceSubscription = (invoice: Record<string, any>): string | null =>
  idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);

/** Read and verify one webhook delivery, and say what it means for KSF. */
export function parseStripeEvent(raw: string, signatureHeader: string, secret: string, nowSeconds?: number): ProviderEvent {
  const verified = verifyStripeSignature(raw, signatureHeader, secret, nowSeconds);
  if (!verified.ok) return { ok: false, reason: verified.reason ?? 'The signature did not verify.' };
  let event: Record<string, any>;
  try { event = JSON.parse(raw) as Record<string, any>; } catch { return { ok: false, reason: 'The event was not valid JSON.' }; }
  const id = String(event.id ?? '');
  const type = String(event.type ?? '');
  if (!id || !type) return { ok: false, reason: 'The event has no id or type.' };
  const object = (event.data?.object ?? {}) as Record<string, any>;
  const ignored: ProviderEvent = { ok: true, id, type, kind: 'ignored' };

  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.expired':
      return { ok: true, id, type, kind: 'checkout', outcome: sessionOutcome(object) };
    case 'checkout.session.async_payment_failed':
      return { ok: true, id, type, kind: 'checkout', outcome: { ...sessionOutcome(object), status: PAYMENT_STATUS.FAILED } };
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const subscriptionId = invoiceSubscription(object);
      /* The first invoice is the Checkout payment, settled from its session. */
      if (!subscriptionId || object.billing_reason === 'subscription_create') return ignored;
      const paid = type !== 'invoice.payment_failed';
      return {
        ok: true, id, type, kind: 'renewal', subscriptionId, invoiceId: String(object.id ?? ''), paid,
        amountPaisa: Number(paid ? object.amount_paid : object.amount_due) || 0, currency: String(object.currency || '').toUpperCase(),
        failure: paid ? undefined : String(object.last_finalization_error?.message ?? 'The card was declined or could not be charged.')
      };
    }
    case 'customer.subscription.updated':
      return { ok: true, id, type, kind: 'renewal-setting', subscriptionId: String(object.id ?? ''), renews: !object.cancel_at_period_end && object.status !== 'canceled' };
    case 'customer.subscription.deleted':
      return { ok: true, id, type, kind: 'ended', subscriptionId: String(object.id ?? '') };
    default:
      return ignored;
  }
}

/** Stripe accepts an expiry between 30 minutes and 24 hours from now. */
function sessionExpiry(): number {
  const minutes = Math.min(24 * 60, Math.max(30, Number(setting('STRIPE_EXPIRY_MINUTES') || 60)));
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

export const stripe: Adapter = {
  key: 'stripe',
  label: 'Card (Stripe)',
  methods: ['card'],
  capabilities: { redirect: true, lookup: true, refund: true, webhook: true },
  configured: () => requireEnv(STRIPE_ENV),
  describe() {
    const state = requireEnv(STRIPE_ENV);
    const live = setting('STRIPE_SECRET_KEY').startsWith('sk_live_');
    return {
      key: 'stripe', label: 'Card (Stripe)', configured: state.ok, missing: state.missing, mode: live ? 'live' : 'test',
      verified: state.ok, note: 'Visa and Mastercard on Stripe Checkout. Plans renew automatically through Stripe; card details never reach KSF.'
    };
  },

  async createRequest(request: PaymentRequest) {
    const state = requireEnv(STRIPE_ENV);
    if (!state.ok) return { ok: false, reason: `Stripe is not configured: ${state.missing.join(', ')}` };
    const interval = INTERVALS[request.plan.period];
    const recurring = request.recurring && !!interval && setting('STRIPE_RECURRING') !== 'false';
    const price = {
      currency: request.currency.toLowerCase(), unit_amount: request.amountPaisa,
      product_data: { name: request.description }, ...(recurring ? { recurring: { interval } } : {})
    };
    try {
      const session = await stripeRequest('POST', '/checkout/sessions', {
        mode: recurring ? 'subscription' : 'payment',
        client_reference_id: request.reference,
        success_url: request.returnUrl,
        cancel_url: request.cancelUrl,
        customer_email: request.customerEmail ?? undefined,
        line_items: [{ quantity: 1, price_data: price }],
        metadata: request.metadata,
        ...(recurring ? { subscription_data: { metadata: request.metadata } } : { payment_intent_data: { metadata: request.metadata } }),
        expires_at: sessionExpiry()
      }, `ksf-checkout-${request.reference}`);
      return {
        ok: true, providerReference: String(session.id), redirect: { url: String(session.url), method: 'GET' as const, fields: {} },
        expiresAt: new Date(Number(session.expires_at) * 1000).toISOString()
      };
    } catch (error) {
      return { ok: false, reason: `Stripe could not start the payment: ${(error as Error).message}` };
    }
  },

  /* The generic callback path is not Stripe's: its webhook goes through
     parseEvent, and a returning browser is confirmed by lookup. */
  verifyCallback: () => ({ ok: false, reason: 'Stripe payments are confirmed by its signed webhook or a lookup, never by the browser.' }),

  parseEvent({ raw, headers = {} }) {
    const secret = setting('STRIPE_WEBHOOK_SECRET');
    if (!secret) return { ok: false, reason: 'Stripe is not configured.' };
    if (!raw) return { ok: false, reason: 'The raw body was not available to verify.' };
    return parseStripeEvent(String(raw), String(headers['stripe-signature'] ?? ''), secret);
  },

  async lookup({ providerReference }) {
    if (!providerReference?.startsWith('cs_')) return { ok: false, reason: 'No Stripe Checkout Session is recorded for this payment.' };
    return sessionOutcome(await stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(providerReference)}`));
  },

  async refund({ providerReference, amountPaisa, reason }) {
    /* A subscription's payment is recorded under its invoice; the money is
       on the invoice's PaymentIntent. */
    let paymentIntent = providerReference;
    if (providerReference?.startsWith('in_')) {
      const invoice = await stripeRequest('GET', `/invoices/${encodeURIComponent(providerReference)}`);
      paymentIntent = idOf(invoice.payment_intent) ?? idOf(invoice.payments?.data?.[0]?.payment?.payment_intent);
    }
    if (!paymentIntent?.startsWith('pi_')) return { ok: false, reason: 'The Stripe payment behind this charge could not be found.' };
    const refund = await stripeRequest('POST', '/refunds', {
      payment_intent: paymentIntent, amount: amountPaisa, reason: 'requested_by_customer', metadata: { ksf_reason: reason.slice(0, 200) }
    });
    return {
      ok: true, providerReference: String(refund.id),
      status: refund.status === 'succeeded' ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PENDING, providerStatus: String(refund.status)
    };
  },

  async setRenewal(subscriptionId, renew, immediately = false) {
    const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`;
    const updated = immediately ? await stripeRequest('DELETE', path) : await stripeRequest('POST', path, { cancel_at_period_end: !renew });
    return { ok: true, providerReference: subscriptionId, providerStatus: String(updated.status) };
  },

  async portal(customerId, returnUrl) {
    try {
      const session = await stripeRequest('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
      return { ok: true, url: String(session.url) };
    } catch (error) {
      return { ok: false, reason: `Stripe could not open the card page: ${(error as Error).message}` };
    }
  }
};
