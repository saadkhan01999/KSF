/* ==========================================================================
   Subscriptions
   --------------------------------------------------------------------------
   Four plans, all documents in subscription_plans: Basic (free, permanent),
   Weekly, Monthly and Annual. Two principles run through everything here.

   1. The pharmacy's data is never the hostage. A trial ending, a card
      failing, a plan being cancelled — none of them delete a medicine, a
      batch, a sale or a prescription. The account moves to Basic or into a
      grace period; only which features are reachable changes.

   2. The browser is never believed about money. A payment is real when the
      provider says so, over a signed webhook or a server-to-server check.
      Every provider event is recorded under a unique (provider, event_id), so
      a retried delivery extends the period exactly once.
   ========================================================================== */

import { env } from '../config/env.js';
import { col, tx, s } from '../db/mongo.js';
import type { Plan, Subscription, SubscriptionPayment } from '../db/types.js';
import { TRIAL_PLAN_KEY } from '../domain/plans.js';
import { notify } from '../core/trails.js';
import { nowIso, plusDays, randomUUID, toInt, toStr } from '../core/util.js';
import { secureReference } from '../security/crypto.js';
import { sendMail, templates } from './mailer.js';

export const STATUSES = Object.freeze({
  TRIAL: 'trial', ACTIVE: 'active', PAYMENT_PENDING: 'payment_pending', PAST_DUE: 'past_due',
  GRACE: 'grace', CANCELLED: 'cancelled', EXPIRED: 'expired', SUSPENDED: 'suspended'
});

/* Statuses in which the paid feature set is available. Cancelled still works
   until the period it was paid for runs out — the pharmacy paid for it. */
const ENTITLED = new Set<string>([STATUSES.TRIAL, STATUSES.ACTIVE, STATUSES.PAST_DUE, STATUSES.GRACE, STATUSES.CANCELLED]);

export interface PlanView {
  id: string; key: string; name: string; tagline: string | null; description: string | null; period: string;
  periodDays: number; pricePaisa: number; currency: string; annualDiscountPercent: number; graceDays: number;
  limits: { desktopDevices: number; mobileDevices: number; users: number; branches: number; medicines: number };
  features: string[]; autoRenew: boolean; isDefault: boolean; isFree: boolean; sortOrder: number; status?: string; isPublic?: boolean;
}

export const planView = (row: Plan): PlanView => ({
  id: row.id, key: row.key, name: row.name, tagline: row.tagline, description: row.description, period: row.period,
  periodDays: row.period_days, pricePaisa: row.price_paisa, currency: row.currency,
  annualDiscountPercent: row.annual_discount_pct, graceDays: row.grace_days,
  limits: {
    desktopDevices: row.max_desktop_devices, mobileDevices: row.max_mobile_devices, users: row.max_users,
    branches: row.max_branches, medicines: row.max_medicines
  },
  features: row.features ?? [], autoRenew: !!row.auto_renew, isDefault: !!row.is_default, isFree: !!row.is_free,
  sortOrder: row.sort_order, status: row.status, isPublic: !!row.is_public
});

export const listPlans = async (): Promise<PlanView[]> =>
  (await col.plans().find({ status: 'active', is_public: 1 }).sort({ sort_order: 1 }).toArray()).map(planView);

export const getPlan = async (key: unknown): Promise<PlanView | null> => {
  const row = await col.plans().findOne({ key: String(key || '') });
  return row ? planView(row) : null;
};

export const defaultPlan = async (): Promise<PlanView | null> => {
  const row = await col.plans().findOne({ is_default: 1, status: 'active' }, { sort: { sort_order: 1 } });
  return row ? planView(row) : null;
};

/** The end of a period that starts now, for a plan of this shape. */
export function periodEnd(plan: Pick<PlanView, 'period' | 'periodDays'>, from = new Date()): string {
  const date = new Date(from);
  if (plan.period === 'perpetual') return new Date(date.getTime() + 100 * 365 * 86_400_000).toISOString();
  if (plan.period === 'week') date.setUTCDate(date.getUTCDate() + 7);
  else if (plan.period === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (plan.period === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCDate(date.getUTCDate() + (plan.periodDays || 30));
  return date.toISOString();
}

export type CurrentSubscription = Subscription & {
  plan_name: string; plan_period: string; plan_features: string[]; max_desktop_devices: number;
  max_mobile_devices: number; max_users: number; max_branches: number; max_medicines: number;
  grace_days: number; is_free: 0 | 1;
};

/** The pharmacy's current subscription, with its plan's details alongside. */
export async function currentSubscription(pharmacyId: string): Promise<CurrentSubscription | null> {
  const subscription = await col.subscriptions().findOne({ pharmacy_id: pharmacyId }, { sort: { created_at: -1 }, ...s() });
  if (!subscription) return null;
  const plan = await col.plans().findOne({ _id: subscription.plan_id });
  return {
    ...subscription,
    plan_name: plan?.name ?? subscription.plan_key, plan_period: plan?.period ?? 'month',
    plan_features: plan?.features ?? [], max_desktop_devices: plan?.max_desktop_devices ?? 1,
    max_mobile_devices: plan?.max_mobile_devices ?? 1, max_users: plan?.max_users ?? 3,
    max_branches: plan?.max_branches ?? 1, max_medicines: plan?.max_medicines ?? 500,
    grace_days: plan?.grace_days ?? 7, is_free: plan?.is_free ?? 0
  };
}

/**
 * Everything the web app needs to decide what to show. Computed, never
 * cached, so a trial that expired overnight is right on the first load.
 */
export async function subscriptionState(pharmacyId: string | null) {
  if (!pharmacyId) return null;
  const subscription = await currentSubscription(pharmacyId);
  if (!subscription) {
    const plan = await defaultPlan();
    return {
      subscriptionId: null, plan: plan?.key ?? 'basic', planName: plan?.name ?? 'Basic', status: STATUSES.ACTIVE,
      entitled: true, features: plan?.features ?? [], planFeatures: plan?.features ?? [], limits: plan?.limits ?? {},
      isFree: true, autoRenew: false, daysLeft: null, trial: null
    };
  }
  const trial = await col.trials().findOne({ pharmacy_id: pharmacyId, status: 'active' }, { sort: { created_at: -1 } });
  const endsAt = subscription.status === STATUSES.GRACE && subscription.grace_until ? subscription.grace_until : subscription.current_period_end;
  const daysLeft = endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000)) : null;
  /* `features` is what can be used now; `planFeatures` what the plan
     includes. They differ while a plan waits for payment. */
  const entitled = ENTITLED.has(subscription.status);
  const basic = entitled ? null : await defaultPlan();
  return {
    subscriptionId: subscription.id, plan: subscription.plan_key, planName: subscription.plan_name,
    status: subscription.status, entitled,
    features: entitled ? subscription.plan_features : (basic?.features ?? []),
    planFeatures: subscription.plan_features,
    limits: {
      desktopDevices: subscription.max_desktop_devices, mobileDevices: subscription.max_mobile_devices,
      users: subscription.max_users, branches: subscription.max_branches, medicines: subscription.max_medicines
    },
    isFree: !!subscription.is_free, autoRenew: !!subscription.auto_renew, startedAt: subscription.started_at,
    periodStart: subscription.current_period_start, periodEnd: subscription.current_period_end,
    renewalAt: subscription.renewal_at, graceUntil: subscription.grace_until, cancelledAt: subscription.cancelled_at,
    failedPayments: subscription.failed_payments, daysLeft,
    trial: trial ? {
      id: trial.id, source: trial.source, days: trial.days, startedAt: trial.started_at, expiresAt: trial.expires_at,
      daysLeft: Math.max(0, Math.ceil((new Date(trial.expires_at).getTime() - Date.now()) / 86_400_000))
    } : null
  };
}

export async function hasFeature(pharmacyId: string, featureKey: string): Promise<boolean> {
  return (await subscriptionState(pharmacyId))?.features.includes(featureKey) ?? false;
}

/* --------------------------------------------------------------- lifecycle */

/**
 * Put a pharmacy on a plan. Choosing a paid plan does not grant it: the
 * account starts on payment_pending with the free features, and only a
 * verified provider event moves it to active. `activateWithoutPayment` is
 * for the Super Admin and is never reachable from a pharmacy's browser.
 */
export async function startSubscription(input: {
  pharmacyId: string; planKey: string; source?: string; autoRenew?: boolean | null;
  provider?: string | null; providerReference?: string | null; activateWithoutPayment?: boolean;
}): Promise<Subscription> {
  const plan = (await getPlan(input.planKey)) ?? (await defaultPlan());
  if (!plan) throw new Error('No subscription plans are configured.');
  const at = nowIso();
  const id = secureReference('SUB');
  const ends = periodEnd(plan);
  const status = plan.isFree || input.activateWithoutPayment ? STATUSES.ACTIVE : STATUSES.PAYMENT_PENDING;
  const doc: Subscription = {
    _id: id, id, pharmacy_id: input.pharmacyId, plan_id: plan.id, plan_key: plan.key, status,
    price_paisa: plan.pricePaisa, currency: plan.currency,
    auto_renew: input.autoRenew === null || input.autoRenew === undefined ? (plan.autoRenew ? 1 : 0) : (input.autoRenew ? 1 : 0),
    started_at: at, current_period_start: at, current_period_end: ends, renewal_at: plan.isFree ? null : ends,
    grace_until: null, cancelled_at: null, cancel_reason: null, ended_at: null, source: input.source ?? 'signup',
    provider: input.provider ?? null, provider_reference: input.providerReference ?? null, failed_payments: 0,
    created_at: at, updated_at: at
  };
  await col.subscriptions().insertOne(doc, s());
  await col.pharmacies().updateOne({ _id: input.pharmacyId }, { $set: { subscription_id: id, plan_key: plan.key } }, s());
  return doc;
}

/** Start a premium trial. One per account, ever. */
export async function startTrial(input: {
  pharmacyId: string; days?: number; source?: string; referralId?: string | null; planKey?: string;
}): Promise<{ ok: boolean; reason?: string; trial?: unknown }> {
  if (await col.trials().findOne({ pharmacy_id: input.pharmacyId })) return { ok: false, reason: 'A trial has already been used on this account.' };
  const plan = await getPlan(input.planKey ?? TRIAL_PLAN_KEY);
  if (!plan) return { ok: false, reason: 'The trial plan is not configured.' };
  const days = input.days ?? env.REFERRAL_TRIAL_DAYS;
  const at = nowIso();
  const expires = plusDays(days);
  const id = secureReference('TRL');

  return tx(async () => {
    const subscription = await currentSubscription(input.pharmacyId);
    if (subscription) {
      await col.subscriptions().updateOne({ _id: subscription.id }, {
        $set: {
          plan_id: plan.id, plan_key: plan.key, status: STATUSES.TRIAL, price_paisa: 0, current_period_start: at,
          current_period_end: expires, renewal_at: null, source: input.source ?? 'referral', updated_at: at
        }
      }, s());
      await col.pharmacies().updateOne({ _id: input.pharmacyId }, { $set: { plan_key: plan.key } }, s());
    }
    const trial = {
      _id: id, id, pharmacy_id: input.pharmacyId, subscription_id: subscription?.id ?? null, plan_key: plan.key,
      source: input.source ?? 'referral', referral_id: input.referralId ?? null, days, started_at: at,
      expires_at: expires, ended_at: null, status: 'active', created_at: at, updated_at: at
    };
    await col.trials().insertOne(trial, s());
    return { ok: true, trial };
  });
}

/** Move to another plan. A paid plan takes effect when payment is confirmed. */
export async function changePlan(input: { pharmacyId: string; planKey: string; activate?: boolean }): Promise<{ ok: boolean; reason?: string; subscription?: Subscription | null }> {
  const plan = await getPlan(input.planKey);
  if (!plan) return { ok: false, reason: 'That plan does not exist.' };
  const subscription = await currentSubscription(input.pharmacyId);
  if (!subscription) {
    return { ok: true, subscription: await startSubscription({ pharmacyId: input.pharmacyId, planKey: input.planKey, source: 'upgrade', activateWithoutPayment: input.activate }) };
  }
  const at = nowIso();
  if (plan.isFree || input.activate) {
    await col.subscriptions().updateOne({ _id: subscription.id }, {
      $set: {
        plan_id: plan.id, plan_key: plan.key, status: STATUSES.ACTIVE, price_paisa: plan.pricePaisa,
        auto_renew: plan.isFree ? 0 : 1, current_period_start: at, current_period_end: periodEnd(plan),
        renewal_at: plan.isFree ? null : periodEnd(plan), grace_until: null, updated_at: at
      }
    });
  } else {
    await col.subscriptions().updateOne({ _id: subscription.id }, {
      $set: { plan_id: plan.id, plan_key: plan.key, status: STATUSES.PAYMENT_PENDING, price_paisa: plan.pricePaisa, auto_renew: 1, updated_at: at }
    });
  }
  await col.pharmacies().updateOne({ _id: input.pharmacyId }, { $set: { plan_key: plan.key } });
  return { ok: true, subscription: await col.subscriptions().findOne({ _id: subscription.id }) };
}

/** Cancel: auto-renewal stops, the paid period is honoured to its end. */
export async function cancelSubscription(input: { pharmacyId: string; reason?: string }): Promise<{ ok: boolean; reason?: string; endsAt?: string }> {
  const subscription = await currentSubscription(input.pharmacyId);
  if (!subscription) return { ok: false, reason: 'There is no subscription to cancel.' };
  const at = nowIso();
  await col.subscriptions().updateOne({ _id: subscription.id }, {
    $set: { status: STATUSES.CANCELLED, auto_renew: 0, cancelled_at: at, cancel_reason: toStr(input.reason, 300), renewal_at: null, updated_at: at }
  });
  return { ok: true, endsAt: subscription.current_period_end };
}

/* ---------------------------------------------------------------- payments */

/**
 * Record a payment and, if it succeeded, extend the period. The provider
 * reference is unique per provider, so the same charge is applied once.
 */
export async function recordPayment(input: {
  pharmacyId: string; subscriptionId: string; amountPaisa: number; currency?: string; status?: string;
  kind?: string; provider?: string; providerReference?: string | null; providerEventId?: string | null;
  method?: string | null; failureCode?: string | null; failureMessage?: string | null; attemptId?: string | null;
  verifiedBy?: string | null;
}): Promise<{ ok: boolean; duplicate?: boolean; reason?: string; payment?: SubscriptionPayment | null }> {
  const provider = input.provider ?? 'manual';
  const status = input.status ?? 'succeeded';
  const reference = input.providerReference ?? `local-${randomUUID()}`;
  const existing = await col.subscriptionPayments().findOne({ provider, provider_reference: reference });
  if (existing) return { ok: true, duplicate: true, payment: existing };

  const subscription = await col.subscriptions().findOne({ _id: input.subscriptionId, pharmacy_id: input.pharmacyId });
  if (!subscription) return { ok: false, reason: 'That subscription could not be found.' };
  const plan = await getPlan(subscription.plan_key);
  const at = nowIso();

  return tx(async () => {
    const periodStart = status === 'succeeded' ? at : subscription.current_period_start;
    const nextEnd = status === 'succeeded' && plan ? periodEnd(plan, new Date()) : subscription.current_period_end;
    const id = randomUUID();
    const payment: SubscriptionPayment = {
      _id: id, id, subscription_id: subscription.id, pharmacy_id: input.pharmacyId, amount_paisa: input.amountPaisa,
      currency: input.currency ?? 'PKR', status, kind: input.kind ?? 'renewal', provider, provider_reference: reference,
      provider_event_id: input.providerEventId ?? null, method: input.method ?? null, failure_code: input.failureCode ?? null,
      failure_message: input.failureMessage ?? null, period_start: periodStart, period_end: nextEnd,
      paid_at: status === 'succeeded' ? at : null, provider_status: null, fee_paisa: null, settled_at: null,
      refunded_paisa: null, cancelled_at: null, expires_at: null, verified_by: input.verifiedBy ?? null,
      verified_at: input.verifiedBy ? at : null, statement_reference: null, attempt_id: input.attemptId ?? null,
      created_at: at, updated_at: at
    };
    await col.subscriptionPayments().insertOne(payment, s());

    if (status === 'succeeded') {
      await col.subscriptions().updateOne({ _id: subscription.id }, {
        $set: {
          status: STATUSES.ACTIVE, current_period_start: periodStart, current_period_end: nextEnd, renewal_at: nextEnd,
          grace_until: null, failed_payments: 0, provider, provider_reference: reference, updated_at: at
        }
      }, s());
    } else {
      /* A failure switches nothing off: a grace period starts and the
         pharmacy Admin is told. */
      const graceUntil = subscription.grace_until ?? plusDays(plan?.graceDays ?? 7);
      await col.subscriptions().updateOne({ _id: subscription.id }, {
        $set: { status: STATUSES.GRACE, grace_until: graceUntil, updated_at: at }, $inc: { failed_payments: 1 }
      }, s());
      await notify(input.pharmacyId, {
        type: 'billing', severity: 'warn', title: 'We could not take your subscription payment',
        body: `Nothing has been deleted and the pharmacy keeps working until ${graceUntil.slice(0, 10)}. Please update the payment method under Settings, Billing and Subscription.`,
        link: '/settings?tab=billing'
      });
    }
    return { ok: true, duplicate: false, payment };
  });
}

/**
 * One event from the payment provider. Written down first, under a unique
 * (provider, event_id); a second delivery of the same event does nothing.
 */
export async function handleWebhook(event: {
  provider: string; eventId: string; type: string; signatureValid: boolean; payload: Record<string, any>;
}): Promise<{ ok: boolean; duplicate?: boolean; status?: string; result?: string; reason?: string }> {
  const { provider, eventId, type, signatureValid, payload } = event;
  if (!provider || !eventId) return { ok: false, reason: 'The event is missing its provider or id.' };

  const seen = await col.webhookEvents().findOne({ provider, event_id: eventId });
  if (seen) return { ok: true, duplicate: true, status: seen.status };

  const id = randomUUID();
  try {
    await col.webhookEvents().insertOne({
      _id: id, id, provider, event_id: eventId, event_type: toStr(type, 80), signature_valid: signatureValid ? 1 : 0,
      payload: JSON.stringify(payload ?? {}).slice(0, 20_000), status: 'received', result: null,
      received_at: nowIso(), processed_at: null
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return { ok: true, duplicate: true, status: 'received' };
    throw error;
  }

  const finish = async (status: string, result: string) => {
    await col.webhookEvents().updateOne({ _id: id }, { $set: { status, result: toStr(result, 300), processed_at: nowIso() } });
    return { ok: status === 'processed', duplicate: false, status, result };
  };

  /* Unsigned: recorded as evidence of somebody poking at it, never applied. */
  if (!signatureValid) return finish('failed', 'The signature did not verify.');

  const subscriptionId = toStr(payload?.subscriptionId, 60);
  const subscription = subscriptionId ? await col.subscriptions().findOne({ _id: subscriptionId }) : null;
  if (!subscription) return finish('ignored', 'No subscription matched the event.');

  if (type === 'payment.succeeded' || type === 'invoice.paid') {
    /* The amount is the subscription's, never the event's. */
    const claimed = toInt(payload.amountPaisa, subscription.price_paisa);
    if (claimed !== subscription.price_paisa) {
      return finish('ignored', `The event says ${claimed} paisa; this subscription costs ${subscription.price_paisa}. Nothing was applied.`);
    }
    const result = await recordPayment({
      pharmacyId: subscription.pharmacy_id, subscriptionId: subscription.id, amountPaisa: subscription.price_paisa,
      currency: subscription.currency, status: 'succeeded', kind: toStr(payload.kind, 20) || 'renewal', provider,
      providerReference: toStr(payload.reference, 120) || `evt-${eventId}`, providerEventId: eventId, method: toStr(payload.method, 40)
    });
    return finish('processed', result.duplicate ? 'Already applied.' : 'Subscription extended.');
  }
  if (type === 'payment.failed' || type === 'invoice.payment_failed') {
    await recordPayment({
      pharmacyId: subscription.pharmacy_id, subscriptionId: subscription.id,
      amountPaisa: toInt(payload.amountPaisa, subscription.price_paisa), status: 'failed', kind: 'renewal', provider,
      providerReference: toStr(payload.reference, 120) || `evt-${eventId}`, providerEventId: eventId,
      failureCode: toStr(payload.failureCode, 60), failureMessage: toStr(payload.failureMessage, 200)
    });
    return finish('processed', 'Grace period started, nothing removed.');
  }
  if (type === 'subscription.cancelled') {
    await cancelSubscription({ pharmacyId: subscription.pharmacy_id, reason: 'Cancelled at the payment provider' });
    return finish('processed', 'Auto-renewal stopped.');
  }
  return finish('ignored', `Nothing to do for ${type}.`);
}

/* ======================== reminders, dunning, expiry ====================== */

/** The person to write to about a pharmacy's subscription: its Admin. */
async function billingContact(pharmacyId: string) {
  const user = await col.users().findOne({ pharmacy_id: pharmacyId, is_owner: 1, status: 'active' }, { sort: { created_at: 1 } });
  if (!user) return null;
  const pharmacy = await col.pharmacies().findOne({ _id: pharmacyId }, { projection: { name: 1 } });
  return { id: user.id, email: user.email, full_name: user.full_name, pharmacy_name: pharmacy?.name ?? 'Your pharmacy' };
}

/** Tell the Admin something about their subscription, exactly once. */
async function noticeOnce(input: {
  key: string; pharmacyId: string; template: string; subject: string; text: string; html: string;
  severity: string; title: string; body: string;
}): Promise<boolean> {
  const contact = await billingContact(input.pharmacyId);
  if (!contact?.email) return false;
  const result = await sendMail({
    to: contact.email, noticeKey: input.key, pharmacyId: input.pharmacyId, template: input.template,
    subject: input.subject, text: input.text, html: input.html, retry: true
  });
  if (result.duplicate) return false;
  await notify(input.pharmacyId, { type: 'billing', severity: input.severity, title: input.title, body: input.body, link: '/settings?tab=billing' });
  return true;
}

async function sendRenewalNotices(summary: { remindersSent: number; dunningSent: number }): Promise<void> {
  const now = Date.now();
  const day = 86_400_000;
  const renewing = await col.subscriptions().find({
    status: { $in: [STATUSES.ACTIVE, STATUSES.GRACE] }, auto_renew: 1, price_paisa: { $gt: 0 },
    current_period_end: { $gt: new Date(now).toISOString(), $lte: new Date(now + 8 * day).toISOString() }
  }).toArray();
  for (const subscription of renewing) {
    const daysLeft = Math.ceil((new Date(subscription.current_period_end).getTime() - now) / day);
    const stage = daysLeft <= 1 ? 1 : daysLeft <= 7 ? 7 : null;
    if (!stage) continue;
    const contact = await billingContact(subscription.pharmacy_id);
    if (!contact) continue;
    const amount = `Rs ${(subscription.price_paisa / 100).toLocaleString('en-PK')}`;
    const on = subscription.current_period_end.slice(0, 10);
    const sent = await noticeOnce({
      key: `renewal-${stage}:${subscription.id}:${on}`, pharmacyId: subscription.pharmacy_id, template: 'renewalReminder',
      severity: 'info', title: stage === 1 ? 'Your subscription renews tomorrow' : 'Your subscription renews in a week',
      body: `${subscription.plan_key} · ${amount} on ${on}. Nothing to do if your payment method is up to date.`,
      ...templates.renewalReminder({ name: contact.full_name, pharmacy: contact.pharmacy_name, plan: subscription.plan_key, amount, on, days: stage })
    });
    if (sent) summary.remindersSent += 1;
  }

  const inGrace = await col.subscriptions().find({ status: STATUSES.GRACE, grace_until: { $ne: null, $gt: new Date(now).toISOString() } }).toArray();
  for (const subscription of inGrace) {
    const until = subscription.grace_until!.slice(0, 10);
    const daysLeft = Math.ceil((new Date(subscription.grace_until!).getTime() - now) / day);
    const stage = daysLeft <= 2 ? 'final' : 'first';
    const contact = await billingContact(subscription.pharmacy_id);
    if (!contact) continue;
    const amount = `Rs ${(subscription.price_paisa / 100).toLocaleString('en-PK')}`;
    const sent = await noticeOnce({
      key: `dunning-${stage}:${subscription.id}:${until}`, pharmacyId: subscription.pharmacy_id, template: 'paymentMissed',
      severity: 'warn', title: stage === 'final' ? 'Your subscription is about to move to Basic' : 'We could not take your subscription payment',
      body: `The pharmacy keeps working until ${until}. After that it moves to the free Basic plan — nothing is deleted.`,
      ...templates.paymentMissed({
        name: contact.full_name, pharmacy: contact.pharmacy_name, amount, until, daysLeft: Math.max(0, daysLeft),
        attempts: subscription.failed_payments ?? 0, final: stage === 'final'
      })
    });
    if (sent) summary.dunningSent += 1;
  }
}

/**
 * Move subscriptions and trials on when their dates pass. Runs at start-up
 * and hourly; safe to run as often as you like. Nothing here deletes data.
 */
export async function runSubscriptionMaintenance() {
  const at = nowIso();
  const summary = { trialsEnded: 0, graceStarted: 0, expired: 0, remindersSent: 0, dunningSent: 0 };
  const basic = await defaultPlan();

  const toBasic = async (subscriptionId: string, pharmacyId: string) => {
    if (!basic) return;
    await col.subscriptions().updateOne({ _id: subscriptionId }, {
      $set: {
        plan_id: basic.id, plan_key: basic.key, status: STATUSES.ACTIVE, price_paisa: 0, auto_renew: 0,
        current_period_start: at, current_period_end: periodEnd(basic), grace_until: null, renewal_at: null, updated_at: at
      }
    });
    await col.pharmacies().updateOne({ _id: pharmacyId }, { $set: { plan_key: basic.key } });
  };

  for (const trial of await col.trials().find({ status: 'active', expires_at: { $lte: at } }).toArray()) {
    await col.trials().updateOne({ _id: trial.id }, { $set: { status: 'expired', ended_at: at, updated_at: at } });
    const subscription = await currentSubscription(trial.pharmacy_id);
    if (subscription && subscription.status === STATUSES.TRIAL) await toBasic(subscription.id, trial.pharmacy_id);
    await notify(trial.pharmacy_id, {
      type: 'billing', severity: 'info', title: 'Your premium trial has ended',
      body: 'Your pharmacy has moved to the free Basic plan. Every medicine, batch, sale and prescription is exactly where you left it — only the premium features are now locked.',
      link: '/settings?tab=billing'
    });
    summary.trialsEnded += 1;
  }

  const lapsed = await col.subscriptions().find({
    status: { $in: [STATUSES.ACTIVE, STATUSES.PAYMENT_PENDING] }, current_period_end: { $lte: at }, grace_until: null
  }).toArray();
  for (const subscription of lapsed) {
    const plan = await getPlan(subscription.plan_key);
    if (plan?.isFree) continue;
    const graceUntil = plusDays(plan?.graceDays ?? 7);
    await col.subscriptions().updateOne({ _id: subscription.id }, { $set: { status: STATUSES.GRACE, grace_until: graceUntil, updated_at: at } });
    await notify(subscription.pharmacy_id, {
      type: 'billing', severity: 'warn', title: 'Your subscription is due for renewal',
      body: `The pharmacy carries on working normally until ${graceUntil.slice(0, 10)}. Nothing will be deleted after that either — the account moves to the free Basic plan.`,
      link: '/settings?tab=billing'
    });
    summary.graceStarted += 1;
  }

  for (const subscription of await col.subscriptions().find({ status: STATUSES.GRACE, grace_until: { $ne: null, $lte: at } }).toArray()) {
    await toBasic(subscription.id, subscription.pharmacy_id);
    await notify(subscription.pharmacy_id, {
      type: 'billing', severity: 'warn', title: 'Your pharmacy has moved to the Basic plan',
      body: 'The subscription was not renewed. Your data has not been touched — every record is still here. Upgrade whenever you are ready.',
      link: '/settings?tab=billing'
    });
    summary.expired += 1;
  }

  await sendRenewalNotices(summary);
  return summary;
}
