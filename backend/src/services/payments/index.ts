/* ==========================================================================
   Taking a subscription payment
   --------------------------------------------------------------------------
   The adapters know how to talk to one provider each. This file is the part
   that trusts none of them.

     1. createAttempt()       The server writes down what it expects — which
                              pharmacy, which plan, how much, in what currency
                              — under a reference it generated. The amount
                              comes from the plan document, never the request.
     2. The customer pays at the provider.
     3. settleFromProvider()  A callback or a status lookup arrives. The
                              signature (the adapter's job), the reference,
                              the amount, the currency and the transition are
                              all checked before anything moves.
     4. reconcile()           For callbacks that never arrive: ask the
                              provider where it can, expire where it cannot.

   It never takes a result from the browser, and it never applies the same
   provider reference twice: the ledger is unique on (provider, reference).
   ========================================================================== */

import { env } from '../../config/env.js';
import { col } from '../../db/mongo.js';
import type { PaymentAttempt } from '../../db/types.js';
import { auditLog } from '../../core/trails.js';
import { nowIso, plusDays, randomUUID, toInt, toStr } from '../../core/util.js';
import { secureReference } from '../../security/crypto.js';
import { getPlan, recordPayment } from '../subscriptions.js';
import { bankTransfer, easypaisa, gateway, jazzcash } from './adapters.js';
import { canMoveTo, PAYMENT_STATUS, setting, type Adapter, type ProviderOutcome } from './provider.js';

export { PAYMENT_STATUS };

const ADAPTERS: Adapter[] = [gateway, jazzcash, easypaisa, bankTransfer];
const byKey = new Map(ADAPTERS.map((adapter) => [adapter.key, adapter]));

export const adapterFor = (key: unknown): Adapter | null => byKey.get(String(key ?? '').toLowerCase()) ?? null;

export const listProviders = () => ADAPTERS.map((adapter) => ({ ...adapter.describe(), methods: adapter.methods, capabilities: adapter.capabilities }));
export const availableProviders = () => listProviders().filter((provider) => provider.configured);

/** The configured default, or the first provider that is usable. */
export function defaultProviderKey(): string {
  const preferred = env.PAYMENT_PROVIDER.toLowerCase();
  const available = availableProviders();
  if (preferred && available.some((provider) => provider.key === preferred)) return preferred;
  return available[0]?.key ?? '';
}

/** Who did something to a payment, for the trails. */
export interface PaymentActor { id: string; full_name: string; role_name?: string; ip: string; userAgent: string; supportMode?: boolean }

/* ------------------------------------------------------------ the attempt */
export async function createAttempt(input: {
  pharmacyId: string; subscriptionId: string; planKey: string; providerKey: string; actorId?: string | null; purpose?: string;
}) {
  const adapter = adapterFor(input.providerKey);
  if (!adapter) return { ok: false as const, reason: 'That payment method is not one this installation offers.' };
  const state = adapter.configured();
  if (!state.ok) return { ok: false as const, reason: `${adapter.label} is not configured on this installation.` };

  const plan = await getPlan(input.planKey);
  if (!plan || plan.status !== 'active') return { ok: false as const, reason: 'Choose one of the available plans.' };
  if (plan.isFree) return { ok: false as const, reason: 'The Basic plan is free — there is nothing to pay.' };

  const reference = secureReference('KSFPAY');
  const built = adapter.createRequest({
    reference, amountPaisa: plan.pricePaisa, currency: plan.currency || 'PKR', description: `KSF ${plan.name} plan`,
    returnUrl: `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/api/v1/payments/return/${adapter.key}`
  });
  if (!built.ok) return { ok: false as const, reason: built.reason ?? 'The payment could not be started.' };

  const at = nowIso();
  const id = randomUUID();
  const attempt: PaymentAttempt = {
    _id: id, id, reference, pharmacy_id: input.pharmacyId, subscription_id: input.subscriptionId, purpose: input.purpose ?? 'subscription',
    plan_key: plan.key, provider: adapter.key, method: adapter.methods[0] ?? null, amount_paisa: plan.pricePaisa, currency: plan.currency || 'PKR',
    status: PAYMENT_STATUS.CREATED, provider_reference: null, provider_status: null, redirect_url: built.redirect?.url ?? null,
    request_payload: JSON.stringify({ redirect: built.redirect ?? null, instructions: built.instructions ?? null }).slice(0, 8000),
    last_checked_at: null, check_count: 0, failure_reason: null, created_by: input.actorId ?? null, created_at: at, updated_at: at,
    expires_at: built.expiresAt ?? plusDays(1)
  };
  await col.paymentAttempts().insertOne(attempt);
  return {
    ok: true as const, attempt, reference, redirect: built.redirect ?? null, instructions: built.instructions ?? null,
    amountPaisa: plan.pricePaisa, currency: attempt.currency, plan: { key: plan.key, name: plan.name }
  };
}

async function markAttempt(attempt: PaymentAttempt, status: string, extra: {
  providerReference?: string; providerStatus?: string; method?: string | null; failure?: string; checked?: boolean;
} = {}): Promise<boolean> {
  /* Conditional on the status read, so two callbacks racing each other
     cannot both move the same attempt. */
  const at = nowIso();
  const set: Partial<PaymentAttempt> = { status, updated_at: at };
  if (extra.providerReference) set.provider_reference = extra.providerReference;
  if (extra.providerStatus) set.provider_status = extra.providerStatus;
  if (extra.method) set.method = extra.method;
  if (extra.failure) set.failure_reason = extra.failure;
  if (extra.checked) set.last_checked_at = at;
  const result = await col.paymentAttempts().updateOne({ _id: attempt.id, status: attempt.status }, { $set: set });
  return result.modifiedCount === 1;
}

/* ----------------------------------------------------------- settlement */
export async function settleFromProvider(input: { providerKey: string; outcome: ProviderOutcome; source?: string }) {
  const adapter = adapterFor(input.providerKey);
  const { outcome } = input;
  if (!adapter) return { ok: false, reason: 'Unknown provider.' };
  if (!outcome.ok) return { ok: false, reason: outcome.reason || 'The provider message did not verify.' };
  const reference = toStr(outcome.reference, 80);
  if (!reference) return { ok: false, reason: 'The provider message carried no reference.' };

  const attempt = await col.paymentAttempts().findOne({ reference });
  if (!attempt) return { ok: false, reason: 'No payment request matches that reference.' };
  if (attempt.provider !== adapter.key) return { ok: false, reason: 'That reference belongs to a different provider.' };

  /* The two checks that stop a tampered or replayed callback becoming money. */
  if (outcome.status === PAYMENT_STATUS.SUCCEEDED) {
    const amountPaisa = toInt(outcome.amountPaisa, -1);
    if (amountPaisa !== attempt.amount_paisa) {
      await markAttempt(attempt, PAYMENT_STATUS.FAILED, {
        providerStatus: toStr(outcome.providerStatus, 120), failure: `Amount mismatch: asked for ${attempt.amount_paisa}, was told ${amountPaisa}`
      });
      return { ok: false, reason: 'The amount did not match the payment request.', mismatch: true };
    }
    if (toStr(outcome.currency, 8) !== attempt.currency) return { ok: false, reason: 'The currency did not match the payment request.', mismatch: true };
  }

  const status = outcome.status ?? PAYMENT_STATUS.FAILED;
  if (!canMoveTo(attempt.status, status)) return { ok: true, ignored: true, reason: `Already ${attempt.status}; ignoring a late ${status}.` };
  const moved = await markAttempt(attempt, status, {
    providerReference: toStr(outcome.providerReference, 120), providerStatus: toStr(outcome.providerStatus, 120),
    method: toStr(outcome.method, 40) || null, checked: input.source === 'lookup'
  });
  if (!moved) return { ok: true, ignored: true, reason: 'Another message about this payment was applied first.' };

  if (status !== PAYMENT_STATUS.SUCCEEDED) {
    /* A failure is recorded against the subscription too, so the grace period
       and the warning happen exactly as for a failed renewal. */
    if (attempt.subscription_id && status === PAYMENT_STATUS.FAILED) {
      await recordPayment({
        pharmacyId: attempt.pharmacy_id, subscriptionId: attempt.subscription_id, amountPaisa: attempt.amount_paisa, currency: attempt.currency,
        status: 'failed', kind: 'checkout', provider: adapter.key, providerReference: toStr(outcome.providerReference, 120) || `${reference}-failed`,
        failureCode: toStr(outcome.providerStatus, 60), failureMessage: toStr(outcome.reason, 200), attemptId: attempt.id
      });
    }
    return { ok: true, applied: false, status };
  }

  if (!attempt.subscription_id) return { ok: true, applied: false, status };
  const result = await recordPayment({
    pharmacyId: attempt.pharmacy_id, subscriptionId: attempt.subscription_id, amountPaisa: attempt.amount_paisa, currency: attempt.currency,
    status: 'succeeded', kind: attempt.purpose === 'subscription' ? 'checkout' : attempt.purpose, provider: adapter.key,
    providerReference: toStr(outcome.providerReference, 120) || reference, method: toStr(outcome.method, 40) || null, attemptId: attempt.id
  });
  if (result.ok && !result.duplicate && result.payment) {
    await col.subscriptionPayments().updateOne({ _id: result.payment.id }, {
      $set: { provider_status: toStr(outcome.providerStatus, 120) || null, fee_paisa: toInt(outcome.feePaisa, 0) || null, updated_at: nowIso() }
    });
  }
  return { ok: true, applied: !result.duplicate, duplicate: !!result.duplicate, status };
}

/* --------------------------------------------------------- reconciliation */
/** Chase the payments nobody told us about. Safe to run as often as you like. */
export async function reconcile({ limit = 50 } = {}) {
  const at = nowIso();
  const summary = { checked: 0, settled: 0, expired: 0, unknown: 0 };
  const open = await col.paymentAttempts().find({ status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING] } }).sort({ created_at: 1 }).limit(limit).toArray();

  for (const attempt of open) {
    const adapter = adapterFor(attempt.provider);
    summary.checked += 1;
    if (adapter?.capabilities.lookup && adapter.lookup) {
      try {
        const outcome = await adapter.lookup({ reference: attempt.reference, providerReference: attempt.provider_reference });
        await col.paymentAttempts().updateOne({ _id: attempt.id }, { $set: { last_checked_at: at, updated_at: at }, $inc: { check_count: 1 } });
        if (outcome.ok && outcome.status !== PAYMENT_STATUS.PENDING) {
          const applied = await settleFromProvider({ providerKey: attempt.provider, outcome, source: 'lookup' });
          if (applied.ok && applied.applied) summary.settled += 1;
          continue;
        }
      } catch (error) {
        /* A provider that is down is not a reason to expire a payment. */
        console.warn(`[KSF] status lookup failed for ${attempt.reference}: ${(error as Error).message}`);
        summary.unknown += 1;
        continue;
      }
    }
    if (attempt.expires_at && attempt.expires_at <= at) {
      await markAttempt(attempt, PAYMENT_STATUS.EXPIRED, { failure: 'No confirmation was received before it expired.' });
      summary.expired += 1;
    } else {
      summary.unknown += 1;
    }
  }
  return summary;
}

/* ------------------------------------------------------- manual transfer */
/**
 * Confirm a bank transfer against the statement. Done by the platform Super
 * Admin, who is the one who can see the platform's bank account, and it is
 * the most accountable path in the system: who, when, and which line.
 */
export async function verifyManualPayment(input: { attemptId: string; statementReference: string; note?: string; actor: PaymentActor }) {
  const attempt = await col.paymentAttempts().findOne({ _id: input.attemptId });
  if (!attempt) return { ok: false, reason: 'That payment request could not be found.' };
  if (attempt.provider !== 'bank-transfer') return { ok: false, reason: 'Only a bank transfer is confirmed by hand.' };
  if (!input.statementReference) return { ok: false, reason: 'Record the reference from the bank statement.' };
  if (attempt.status === PAYMENT_STATUS.SUCCEEDED) return { ok: true, duplicate: true, reason: 'That transfer has already been confirmed.' };
  if (!canMoveTo(attempt.status, PAYMENT_STATUS.SUCCEEDED)) return { ok: false, reason: `That payment is ${attempt.status} and cannot be confirmed.` };
  if (setting('PAYMENT_ALLOW_SELF_VERIFY') !== 'true' && attempt.created_by === input.actor.id) {
    return { ok: false, reason: 'Somebody other than the person who requested this payment has to confirm it.' };
  }
  if (!attempt.subscription_id) return { ok: false, reason: 'That payment is not linked to a subscription.' };

  const moved = await markAttempt(attempt, PAYMENT_STATUS.SUCCEEDED, { providerReference: attempt.reference, providerStatus: 'verified-by-hand' });
  if (!moved) return { ok: true, duplicate: true, reason: 'That transfer was confirmed a moment ago.' };
  const result = await recordPayment({
    pharmacyId: attempt.pharmacy_id, subscriptionId: attempt.subscription_id, amountPaisa: attempt.amount_paisa, currency: attempt.currency,
    status: 'succeeded', kind: 'checkout', provider: 'bank-transfer', providerReference: attempt.reference, method: 'transfer',
    attemptId: attempt.id, verifiedBy: input.actor.id
  });
  if (result.payment) {
    await col.subscriptionPayments().updateOne({ _id: result.payment.id }, { $set: { statement_reference: toStr(input.statementReference, 120), updated_at: nowIso() } });
  }
  await auditLog({ pharmacyId: attempt.pharmacy_id, user: input.actor, ip: input.actor.ip, userAgent: input.actor.userAgent, supportMode: input.actor.supportMode }, {
    action: 'billing.transfer-verified', entity: 'payment', entityId: attempt.id,
    summary: `Bank transfer ${attempt.reference} confirmed against statement ${toStr(input.statementReference, 60)}${input.note ? ` — ${toStr(input.note, 120)}` : ''}`
  });
  return { ok: true, duplicate: !!result.duplicate, pharmacyId: attempt.pharmacy_id };
}

/* ------------------------------------------------------------- refunds */
export async function requestRefund(input: { paymentId: string; amountPaisa: number; reason: string; actor: PaymentActor }) {
  const payment = await col.subscriptionPayments().findOne({ _id: input.paymentId });
  if (!payment) return { ok: false, reason: 'That payment could not be found.' };
  if (payment.status !== 'succeeded') return { ok: false, reason: 'Only a payment that succeeded can be refunded.' };
  const already = payment.refunded_paisa ?? 0;
  const remaining = payment.amount_paisa - already;
  if (remaining <= 0) return { ok: false, reason: 'That payment has already been refunded in full.' };
  /* No amount means the whole of what is left — what "refund" almost always means. */
  const amount = input.amountPaisa > 0 ? input.amountPaisa : remaining;
  if (amount > remaining) return { ok: false, reason: 'That is more than is left on the payment.' };

  const adapter = adapterFor(payment.provider);
  const at = nowIso();
  const id = randomUUID();
  const trail = { pharmacyId: payment.pharmacy_id, user: input.actor, ip: input.actor.ip, userAgent: input.actor.userAgent, supportMode: input.actor.supportMode };
  await col.paymentRefunds().insertOne({
    _id: id, id, payment_id: payment.id, pharmacy_id: payment.pharmacy_id, amount_paisa: amount, currency: payment.currency,
    reason: toStr(input.reason, 200) || null, status: 'pending', provider: payment.provider ?? 'manual', provider_reference: null,
    provider_status: null, requested_by: input.actor.id, requested_at: at, completed_at: null, failure_message: null
  });

  /* Where the provider has no refund API, the row is the instruction: the
     refund is made in the provider's own portal and marked complete here. */
  if (!adapter?.capabilities.refund || !adapter.refund) {
    await auditLog(trail, {
      action: 'billing.refund-requested', entity: 'payment', entityId: payment.id,
      summary: `Refund of Rs ${(amount / 100).toLocaleString('en-PK')} recorded; ${payment.provider ?? 'this provider'} has no refund API, so it is made in their portal`
    });
    return { ok: true, manual: true, refundId: id, status: 'pending' };
  }

  try {
    const outcome = await adapter.refund({ providerReference: payment.provider_reference ?? null, currency: payment.currency, amountPaisa: amount, reason: toStr(input.reason, 200) });
    if (!outcome.ok) {
      await col.paymentRefunds().updateOne({ _id: id }, { $set: { status: 'failed', failure_message: toStr(outcome.reason, 200) } });
      return { ok: false, reason: outcome.reason ?? 'The provider refused the refund.' };
    }
    const done = outcome.status === PAYMENT_STATUS.REFUNDED || outcome.status === PAYMENT_STATUS.SUCCEEDED;
    await col.paymentRefunds().updateOne({ _id: id }, {
      $set: { status: done ? 'completed' : 'pending', provider_reference: toStr(outcome.providerReference, 120) || null, provider_status: toStr(outcome.providerStatus, 120) || null, completed_at: done ? nowIso() : null }
    });
    if (done) await applyRefund(payment.id, amount);
    await auditLog(trail, { action: 'billing.refunded', entity: 'payment', entityId: payment.id, summary: `Rs ${(amount / 100).toLocaleString('en-PK')} refunded through ${payment.provider}` });
    return { ok: true, refundId: id, status: done ? 'completed' : 'pending' };
  } catch (error) {
    await col.paymentRefunds().updateOne({ _id: id }, { $set: { status: 'failed', failure_message: toStr((error as Error).message, 200) } });
    return { ok: false, reason: `The provider could not be reached: ${(error as Error).message}` };
  }
}

/** Add a completed refund to its payment, atomically. */
export async function applyRefund(paymentId: string, amount: number): Promise<void> {
  await col.subscriptionPayments().updateOne({ _id: paymentId }, [{
    $set: {
      refunded_paisa: { $add: [{ $ifNull: ['$refunded_paisa', 0] }, amount] },
      status: { $cond: [{ $gte: [{ $add: [{ $ifNull: ['$refunded_paisa', 0] }, amount] }, '$amount_paisa'] }, 'refunded', '$status'] },
      updated_at: nowIso()
    }
  }]);
}

/* --------------------------------------------------------------- reading */
export const attemptsFor = (pharmacyId: string, limit = 50) => col.paymentAttempts().find({ pharmacy_id: pharmacyId }, {
  projection: {
    _id: 0, id: 1, reference: 1, provider: 1, method: 1, amount_paisa: 1, currency: 1, status: 1, provider_status: 1, plan_key: 1,
    created_at: 1, updated_at: 1, expires_at: 1, failure_reason: 1
  }
}).sort({ created_at: -1 }).limit(limit).toArray();

export const refundsFor = (pharmacyId: string, limit = 50) => col.paymentRefunds().aggregate([
  { $match: { pharmacy_id: pharmacyId } },
  { $sort: { requested_at: -1 } },
  { $limit: limit },
  { $lookup: { from: 'subscription_payments', localField: 'payment_id', foreignField: '_id', as: '__p', pipeline: [{ $project: { provider_reference: 1 } }] } },
  { $set: { payment_reference: { $first: '$__p.provider_reference' } } },
  { $project: { __p: 0 } }
]).toArray();
