/* ==========================================================================
   Subscriptions
   --------------------------------------------------------------------------
   Three plans, all documents in subscription_plans (domain/plans.ts):
   Starter (the free 15-day trial every pharmacy starts on), Monthly (Rs 1,500,
   or Rs 1,300 through a referral, for up to three months) and Yearly
   (Rs 12,000). Every plan includes every feature. Two principles run through
   everything here.

   1. The pharmacy's data is never the hostage. A trial ending, a card
      failing, a plan being cancelled — none of them delete a medicine, a
      batch, a sale or a prescription. When there is no plan the pharmacy is
      asked to choose one, and its records can still be read and exported;
      only changing them waits for the payment.

   2. The browser is never believed about money. A payment is real when the
      provider says so, over a signed webhook or a server-to-server check.
      Every provider event is recorded under a unique (provider, event_id), so
      a retried delivery extends the period exactly once. Choosing a plan
      changes nothing by itself: the plan starts when its payment clears.
   ========================================================================== */

import { env } from '../config/env.js';
import { col, tx, s } from '../db/mongo.js';
import type { Plan, Subscription, SubscriptionPayment, Trial } from '../db/types.js';
import { FEATURES, TRIAL_PLAN_KEY } from '../domain/plans.js';
import { HttpError } from '../core/errors.js';
import { nextNumber, notify } from '../core/trails.js';
import { nowIso, plusDays, randomUUID, toInt, toStr } from '../core/util.js';
import { secureReference } from '../security/crypto.js';
import { sendMail, templates } from './mailer.js';

export const STATUSES = Object.freeze({
  TRIAL: 'trial', ACTIVE: 'active', PAYMENT_PENDING: 'payment_pending', PAST_DUE: 'past_due',
  GRACE: 'grace', CANCELLED: 'cancelled', EXPIRED: 'expired', SUSPENDED: 'suspended'
});

/* Statuses in which the pharmacy can work. Cancelled still works until the
   period it was paid for runs out — the pharmacy paid for it. */
const ENTITLED = new Set<string>([STATUSES.TRIAL, STATUSES.ACTIVE, STATUSES.PAST_DUE, STATUSES.GRACE, STATUSES.CANCELLED]);
/* These two end on their date to the second, without waiting for the hourly
   maintenance: a trial that ran out at 10:00 is over at 10:00. */
const UNTIL_PERIOD_END = new Set<string>([STATUSES.TRIAL, STATUSES.CANCELLED]);

/** Can this subscription be worked on right now? */
export function isEntitled(subscription: Pick<Subscription, 'status' | 'current_period_end'>, now = Date.now()): boolean {
  if (!ENTITLED.has(subscription.status)) return false;
  if (UNTIL_PERIOD_END.has(subscription.status)) return new Date(subscription.current_period_end).getTime() > now;
  return true;
}

export interface PlanView {
  id: string; key: string; name: string; tagline: string | null; description: string | null; period: string;
  periodDays: number; pricePaisa: number; currency: string; annualDiscountPercent: number; graceDays: number;
  limits: { desktopDevices: number; mobileDevices: number; users: number; branches: number; medicines: number };
  features: string[]; autoRenew: boolean; isDefault: boolean; isFree: boolean; sortOrder: number; status?: string; isPublic?: boolean;
  /** The free trial: started once, at registration, and never bought. */
  isTrial: boolean; trialDays: number;
  /** What a pharmacy that came through a referral pays instead, or null. */
  referralPricePaisa: number | null;
  /** How many periods one pharmacy may buy; 0 for no limit. */
  maxCycles: number;
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
  sortOrder: row.sort_order, status: row.status, isPublic: !!row.is_public,
  isTrial: !!row.is_trial, trialDays: row.trial_days ?? 0,
  referralPricePaisa: row.referral_price_paisa ?? null, maxCycles: row.max_cycles ?? 0
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

/** The free trial plan (Starter). */
export const trialPlan = async (): Promise<PlanView | null> => {
  const row = await col.plans().findOne({ is_trial: 1, status: 'active' }, { sort: { sort_order: 1 } })
    ?? await col.plans().findOne({ key: TRIAL_PLAN_KEY });
  return row ? planView(row) : null;
};

/** How many days the free trial runs, as the Super Admin has set it. */
export const trialLength = (plan: Pick<PlanView, 'trialDays' | 'periodDays'> | null): number =>
  plan?.trialDays || plan?.periodDays || 15;

/* ------------------------------------------------------------ the price */

/** Did this pharmacy register through a referral that was honoured? */
export async function hasReferralPricing(pharmacyId: string): Promise<boolean> {
  return !!(await col.referrals().findOne({ referred_pharmacy_id: pharmacyId, status: 'converted' }, { projection: { _id: 1 } }));
}

/** What a pharmacy pays for a period of this plan: the referral price when it came through one. */
export function priceFor(plan: Pick<PlanView, 'pricePaisa' | 'referralPricePaisa'>, referred: boolean): number {
  const special = plan.referralPricePaisa;
  return referred && special !== null && special >= 0 && special < plan.pricePaisa ? special : plan.pricePaisa;
}

/** Periods of this plan the pharmacy has paid for. */
export const cyclesUsed = (pharmacyId: string, planKey: string): Promise<number> =>
  col.subscriptionPayments().countDocuments({ pharmacy_id: pharmacyId, plan_key: planKey, status: 'succeeded' });

const PERIOD_WORD: Record<string, string> = { week: 'week', month: 'month', year: 'year', trial: 'day' };
const periods = (plan: Pick<PlanView, 'period'>, n: number): string => `${n} ${PERIOD_WORD[plan.period] ?? 'period'}${n === 1 ? '' : 's'}`;

/** A plan as one pharmacy sees it: its own price, and whether it can still have it. */
export interface PlanOffer extends PlanView {
  yourPricePaisa: number; referralApplied: boolean;
  cyclesUsed: number; cyclesLeft: number | null;
  available: boolean; unavailableReason: string | null;
}

/** Can this pharmacy choose this plan, and if not, why not — in words it can act on. */
function availability(plan: PlanView, used: number, others: PlanView[]): string | null {
  if (plan.status !== 'active' || !plan.isPublic) return 'That plan is not offered any more.';
  if (plan.isTrial) return 'The free trial is started once, when the pharmacy registers. Choose a paid plan to carry on.';
  if (plan.maxCycles > 0 && used >= plan.maxCycles) {
    const next = others.filter((other) => other.key !== plan.key && !other.isTrial && other.status === 'active').map((other) => other.name);
    return `${plan.name} is a starter plan for the first ${periods(plan, plan.maxCycles)}, and this pharmacy has had them.${next.length ? ` Choose ${next.join(' or ')} to carry on.` : ''}`;
  }
  return null;
}

/** Every public plan, priced and checked for this pharmacy. */
export async function offersFor(pharmacyId: string): Promise<PlanOffer[]> {
  const [plans, referred] = await Promise.all([listPlans(), hasReferralPricing(pharmacyId)]);
  const used = await Promise.all(plans.map((plan) => (plan.maxCycles > 0 ? cyclesUsed(pharmacyId, plan.key) : Promise.resolve(0))));
  return plans.map((plan, index) => {
    const reason = availability(plan, used[index], plans);
    const yourPricePaisa = priceFor(plan, referred);
    return {
      ...plan, yourPricePaisa, referralApplied: yourPricePaisa < plan.pricePaisa,
      cyclesUsed: used[index], cyclesLeft: plan.maxCycles > 0 ? Math.max(0, plan.maxCycles - used[index]) : null,
      available: !reason, unavailableReason: reason
    };
  });
}

/** One plan for one pharmacy, or the reason it cannot have it. */
export async function offerFor(pharmacyId: string, planKey: string): Promise<{ ok: true; offer: PlanOffer } | { ok: false; reason: string }> {
  const plan = await getPlan(planKey);
  if (!plan) return { ok: false, reason: 'Choose one of the available plans.' };
  const offers = await offersFor(pharmacyId);
  const offer = offers.find((row) => row.key === plan.key);
  if (!offer) return { ok: false, reason: plan.status === 'active' ? 'That plan is not offered any more.' : 'Choose one of the available plans.' };
  if (!offer.available) return { ok: false, reason: offer.unavailableReason ?? 'That plan cannot be chosen.' };
  return { ok: true, offer };
}

/** The end of a period that starts now, for a plan of this shape. */
export function periodEnd(plan: Pick<PlanView, 'period' | 'periodDays'>, from = new Date()): string {
  const date = new Date(from);
  if (plan.period === 'perpetual') return new Date(date.getTime() + 100 * 365 * 86_400_000).toISOString();
  if (plan.period === 'trial') return new Date(date.getTime() + (plan.periodDays || 15) * 86_400_000).toISOString();
  if (plan.period === 'week') date.setUTCDate(date.getUTCDate() + 7);
  else if (plan.period === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (plan.period === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCDate(date.getUTCDate() + (plan.periodDays || 30));
  return date.toISOString();
}

export type CurrentSubscription = Subscription & {
  plan_name: string; plan_period: string; plan_features: string[]; max_desktop_devices: number;
  max_mobile_devices: number; max_users: number; max_branches: number; max_medicines: number;
  grace_days: number; is_free: 0 | 1; is_trial: 0 | 1; max_cycles: number;
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
    grace_days: plan?.grace_days ?? 7, is_free: plan?.is_free ?? 0, is_trial: plan?.is_trial ?? 0, max_cycles: plan?.max_cycles ?? 0
  };
}

/** Everything the web app needs when a pharmacy has no plan at all. */
const NO_PLAN = {
  subscriptionId: null, plan: 'none', planName: 'No plan', status: STATUSES.EXPIRED, entitled: false, locked: true,
  features: [] as string[], planFeatures: [] as string[], limits: {}, isFree: false, isTrial: false, autoRenew: false,
  pricePaisa: 0, startedAt: null, periodStart: null, periodEnd: null, renewalAt: null, graceUntil: null, cancelledAt: null,
  endedAt: null, failedPayments: 0, daysLeft: null, trial: null, pendingPlan: null, cycles: null, referralPricing: false
};

/**
 * Everything the web app needs to decide what to show. Computed, never
 * cached, so a trial that expired overnight is right on the first load.
 * `locked` is the one the screens care most about: true when the trial or
 * the plan has ended and the pharmacy needs to choose one to carry on.
 */
export async function subscriptionState(pharmacyId: string | null) {
  if (!pharmacyId) return null;
  const subscription = await currentSubscription(pharmacyId);
  if (!subscription) return NO_PLAN;
  const [trial, referralPricing, used] = await Promise.all([
    col.trials().findOne({ pharmacy_id: pharmacyId, status: 'active' }, { sort: { created_at: -1 } }),
    hasReferralPricing(pharmacyId),
    subscription.max_cycles > 0 ? cyclesUsed(pharmacyId, subscription.plan_key) : Promise.resolve(0)
  ]);
  const endsAt = subscription.status === STATUSES.GRACE && subscription.grace_until ? subscription.grace_until : subscription.current_period_end;
  const daysLeft = endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000)) : null;
  /* `features` is what can be used now; `planFeatures` what the plan
     includes. They differ once the trial or the plan has ended. */
  const entitled = isEntitled(subscription);
  const status = !entitled && subscription.status === STATUSES.TRIAL ? STATUSES.EXPIRED : subscription.status;
  const pending = subscription.pending_plan_key ? await getPlan(subscription.pending_plan_key) : null;
  return {
    subscriptionId: subscription.id, plan: subscription.plan_key, planName: subscription.plan_name,
    status, entitled, locked: !entitled,
    features: entitled ? subscription.plan_features : [],
    planFeatures: subscription.plan_features,
    limits: {
      desktopDevices: subscription.max_desktop_devices, mobileDevices: subscription.max_mobile_devices,
      users: subscription.max_users, branches: subscription.max_branches, medicines: subscription.max_medicines
    },
    isFree: !!subscription.is_free, isTrial: !!subscription.is_trial, autoRenew: !!subscription.auto_renew,
    pricePaisa: subscription.price_paisa, startedAt: subscription.started_at,
    periodStart: subscription.current_period_start, periodEnd: subscription.current_period_end,
    renewalAt: subscription.renewal_at, graceUntil: subscription.grace_until, cancelledAt: subscription.cancelled_at,
    endedAt: subscription.ended_at, failedPayments: subscription.failed_payments, daysLeft: entitled ? daysLeft : 0,
    pendingPlan: pending ? { key: pending.key, name: pending.name } : null,
    /* "Month 2 of 3" on a plan that runs for a set number of periods. */
    cycles: subscription.max_cycles > 0 ? { used, max: subscription.max_cycles, period: subscription.plan_period } : null,
    referralPricing,
    trial: trial ? {
      id: trial.id, source: trial.source, days: trial.days, startedAt: trial.started_at, expiresAt: trial.expires_at,
      daysLeft: Math.max(0, Math.ceil((new Date(trial.expires_at).getTime() - Date.now()) / 86_400_000))
    } : null
  };
}

/** Can the pharmacy change its records — is it on its trial, or a plan that has not ended? */
export async function workingState(pharmacyId: string): Promise<{ ok: boolean; afterTrial: boolean }> {
  const subscription = await col.subscriptions().findOne({ pharmacy_id: pharmacyId }, { sort: { created_at: -1 }, projection: { status: 1, current_period_end: 1, plan_key: 1 } });
  if (!subscription) return { ok: false, afterTrial: true };
  if (isEntitled(subscription)) return { ok: true, afterTrial: false };
  const plan = await col.plans().findOne({ key: subscription.plan_key }, { projection: { is_trial: 1 } });
  return { ok: false, afterTrial: subscription.status === STATUSES.TRIAL || !!plan?.is_trial };
}

export async function hasFeature(pharmacyId: string, featureKey: string): Promise<boolean> {
  return (await subscriptionState(pharmacyId))?.features.includes(featureKey) ?? false;
}

/**
 * Refuse a request for something the pharmacy's plan does not include, with
 * 402 and the plans that do include it — so the screen can offer the upgrade
 * instead of an error. Nothing is deleted when a feature is locked; it simply
 * cannot be reached until the plan includes it again.
 */
export async function requireFeature(pharmacyId: string, featureKey: string): Promise<void> {
  const state = await subscriptionState(pharmacyId);
  if (state?.features.includes(featureKey)) return;
  if (state?.locked) throw planRequired(state.isTrial || state.plan === 'none');
  const name = FEATURES.find(([key]) => key === featureKey)?.[1] ?? featureKey;
  const plans = (await listPlans()).filter((plan) => !plan.isTrial && plan.features.includes(featureKey)).map((plan) => ({ key: plan.key, name: plan.name }));
  const error = new HttpError(
    402,
    `${name} is not part of your current plan.${plans.length ? ` It comes with ${plans.map((plan) => plan.name).join(', ')}.` : ''} Upgrade under Settings › Billing.`,
    undefined,
    'feature_locked'
  );
  error.details = { feature: featureKey, featureName: name, plans };
  throw error;
}

/** The refusal for a change made with no plan: what happened, that nothing is lost, and what to do. */
export function planRequired(afterTrial = false): HttpError {
  const error = new HttpError(
    402,
    `${afterTrial ? 'Your free trial has ended.' : 'Your plan has ended.'} Choose the Monthly or Yearly plan under Settings › Billing to carry on — every record is safe and can still be viewed.`,
    undefined,
    'plan_required'
  );
  error.details = { billing: '/settings?tab=billing' };
  return error;
}

/* --------------------------------------------------------------- lifecycle */

/**
 * Put a pharmacy on a plan straight away. The free trial and a free plan
 * start at once; a paid plan only with `activateWithoutPayment`, which is for
 * the Super Admin and never reachable from a pharmacy's browser. Without it a
 * paid plan waits for its first payment and the pharmacy has no plan yet.
 */
export async function startSubscription(input: {
  pharmacyId: string; planKey: string; source?: string; autoRenew?: boolean | null;
  provider?: string | null; providerReference?: string | null; activateWithoutPayment?: boolean;
}): Promise<Subscription> {
  const plan = (await getPlan(input.planKey)) ?? (await defaultPlan());
  if (!plan) throw new Error('No subscription plans are configured.');
  const at = nowIso();
  const id = secureReference('SUB');
  const ends = plan.isTrial ? periodEnd({ period: 'trial', periodDays: trialLength(plan) }) : periodEnd(plan);
  const status = plan.isTrial ? STATUSES.TRIAL : plan.isFree || input.activateWithoutPayment ? STATUSES.ACTIVE : STATUSES.PAYMENT_PENDING;
  const doc: Subscription = {
    _id: id, id, pharmacy_id: input.pharmacyId, plan_id: plan.id, plan_key: plan.key, status,
    price_paisa: plan.isTrial ? 0 : priceFor(plan, await hasReferralPricing(input.pharmacyId)), currency: plan.currency,
    auto_renew: plan.isFree ? 0 : input.autoRenew === null || input.autoRenew === undefined ? (plan.autoRenew ? 1 : 0) : (input.autoRenew ? 1 : 0),
    started_at: at, current_period_start: at, current_period_end: status === STATUSES.PAYMENT_PENDING ? at : ends,
    renewal_at: plan.isFree || status === STATUSES.PAYMENT_PENDING ? null : ends,
    grace_until: null, cancelled_at: null, cancel_reason: null, ended_at: null, source: input.source ?? 'signup',
    provider: input.provider ?? null, provider_reference: input.providerReference ?? null, failed_payments: 0,
    pending_plan_key: null, created_at: at, updated_at: at
  };
  await col.subscriptions().insertOne(doc, s());
  await col.pharmacies().updateOne({ _id: input.pharmacyId }, { $set: { subscription_id: id, plan_key: plan.key } }, s());
  return doc;
}

/**
 * Start the free trial: every feature, for the Starter plan's days. One per
 * account, ever — `again` is for the Super Admin, and for an installation
 * moving from the old free plan, never for a pharmacy's browser.
 */
export async function startTrial(input: {
  pharmacyId: string; days?: number; source?: string; referralId?: string | null; planKey?: string; again?: boolean;
}): Promise<{ ok: boolean; reason?: string; trial?: Trial; subscription?: Subscription }> {
  if (!input.again && await col.trials().findOne({ pharmacy_id: input.pharmacyId })) return { ok: false, reason: 'A trial has already been used on this account.' };
  const plan = input.planKey ? await getPlan(input.planKey) : await trialPlan();
  if (!plan) return { ok: false, reason: 'The trial plan is not configured.' };
  const days = input.days ?? trialLength(plan);
  const at = nowIso();
  const expires = plusDays(days);
  const id = secureReference('TRL');
  const source = input.source ?? 'signup';

  return tx(async () => {
    let subscription: Subscription | null = await currentSubscription(input.pharmacyId);
    if (subscription) {
      await col.subscriptions().updateOne({ _id: subscription.id }, {
        $set: {
          plan_id: plan.id, plan_key: plan.key, status: STATUSES.TRIAL, price_paisa: 0, auto_renew: 0, current_period_start: at,
          current_period_end: expires, renewal_at: null, grace_until: null, ended_at: null, source, pending_plan_key: null, updated_at: at
        }
      }, s());
      await col.pharmacies().updateOne({ _id: input.pharmacyId }, { $set: { plan_key: plan.key } }, s());
    } else {
      subscription = await startSubscription({ pharmacyId: input.pharmacyId, planKey: plan.key, source });
      await col.subscriptions().updateOne({ _id: subscription.id }, { $set: { current_period_end: expires } }, s());
    }
    /* One running trial at a time: a fresh one closes the last. */
    await col.trials().updateMany({ pharmacy_id: input.pharmacyId, status: 'active' }, { $set: { status: 'replaced', ended_at: at, updated_at: at } }, s());
    const trial: Trial = {
      _id: id, id, pharmacy_id: input.pharmacyId, subscription_id: subscription.id, plan_key: plan.key,
      source, referral_id: input.referralId ?? null, days, started_at: at,
      expires_at: expires, ended_at: null, status: 'active', created_at: at, updated_at: at
    };
    await col.trials().insertOne(trial, s());
    return { ok: true, trial, subscription };
  });
}

/**
 * Choose a plan. For the pharmacy (no `activate`) this only writes the
 * choice down: the trial or the current plan carries on untouched, and the
 * new plan starts when its payment clears. The Super Admin's `activate`
 * starts it at once, without a payment (a complimentary or negotiated plan).
 */
export async function changePlan(input: { pharmacyId: string; planKey: string; activate?: boolean }): Promise<{ ok: boolean; reason?: string; subscription?: Subscription | null; pending?: boolean }> {
  const plan = await getPlan(input.planKey);
  if (!plan) return { ok: false, reason: 'That plan does not exist.' };
  if (plan.isTrial) {
    if (!input.activate) return { ok: false, reason: 'The free trial is started once, when the pharmacy registers.' };
    const restarted = await startTrial({ pharmacyId: input.pharmacyId, planKey: plan.key, source: 'platform', again: true });
    return restarted.ok ? { ok: true, subscription: await col.subscriptions().findOne({ _id: restarted.subscription!.id }) } : { ok: false, reason: restarted.reason };
  }
  const subscription = await currentSubscription(input.pharmacyId);
  if (!subscription) {
    return { ok: true, subscription: await startSubscription({ pharmacyId: input.pharmacyId, planKey: input.planKey, source: 'upgrade', activateWithoutPayment: input.activate }) };
  }
  const at = nowIso();
  if (!plan.isFree && !input.activate) {
    await col.subscriptions().updateOne({ _id: subscription.id }, { $set: { pending_plan_key: plan.key, updated_at: at } });
    return { ok: true, pending: true, subscription: await col.subscriptions().findOne({ _id: subscription.id }) };
  }
  /* A different plan replaces what the provider was renewing (Stripe): stop
     it now, or the card would be charged for the old plan as well. */
  if (subscription.plan_key !== plan.key && subscription.provider_subscription_id) {
    const { setProviderRenewal } = await import('./payments/index.js');
    try {
      await setProviderRenewal(subscription, false, true);
    } catch (error) {
      return { ok: false, reason: `${(error as Error).message}. Nothing was changed — try again in a moment.` };
    }
  }
  const ends = periodEnd(plan);
  await col.subscriptions().updateOne({ _id: subscription.id }, {
    $set: {
      plan_id: plan.id, plan_key: plan.key, status: STATUSES.ACTIVE, price_paisa: priceFor(plan, await hasReferralPricing(input.pharmacyId)),
      auto_renew: plan.isFree ? 0 : 1, current_period_start: at, current_period_end: ends,
      renewal_at: plan.isFree ? null : ends, grace_until: null, ended_at: null, pending_plan_key: null, updated_at: at
    }
  });
  await col.trials().updateMany({ pharmacy_id: input.pharmacyId, status: 'active' }, { $set: { status: 'converted', ended_at: at, updated_at: at } });
  await col.pharmacies().updateOne({ _id: input.pharmacyId }, { $set: { plan_key: plan.key } });
  return { ok: true, subscription: await col.subscriptions().findOne({ _id: subscription.id }) };
}

/** Cancel: auto-renewal stops, the paid period is honoured to its end. */
export async function cancelSubscription(input: { pharmacyId: string; reason?: string }): Promise<{ ok: boolean; reason?: string; endsAt?: string }> {
  const subscription = await currentSubscription(input.pharmacyId);
  if (!subscription) return { ok: false, reason: 'There is no subscription to cancel.' };
  const at = nowIso();
  await col.subscriptions().updateOne({ _id: subscription.id }, {
    $set: { status: STATUSES.CANCELLED, auto_renew: 0, cancelled_at: at, cancel_reason: toStr(input.reason, 300), renewal_at: null, pending_plan_key: null, updated_at: at }
  });
  return { ok: true, endsAt: subscription.current_period_end };
}

/* ---------------------------------------------------------------- payments */

/**
 * Record a payment and, if it succeeded, start or extend the period. A
 * provider's reference is unique per provider, so the same charge is applied
 * once; a slip number recorded by hand is unique within its pharmacy.
 *
 * `planKey` is the plan the payment was for, when the pharmacy chose one at
 * checkout: the subscription moves to it as the money arrives. Days already
 * paid for, or left on the trial, are never lost — the new period starts
 * where the current one ends.
 */
export async function recordPayment(input: {
  pharmacyId: string; subscriptionId: string; amountPaisa: number; currency?: string; status?: string;
  kind?: string; provider?: string; providerReference?: string | null; providerEventId?: string | null;
  method?: string | null; failureCode?: string | null; failureMessage?: string | null; attemptId?: string | null;
  verifiedBy?: string | null; planKey?: string | null;
}): Promise<{ ok: boolean; duplicate?: boolean; reason?: string; payment?: SubscriptionPayment | null }> {
  const provider = input.provider ?? 'manual';
  const status = input.status ?? 'succeeded';
  const reference = input.providerReference ?? `local-${randomUUID()}`;
  const existing = await col.subscriptionPayments().findOne(
    provider === 'manual' ? { provider, provider_reference: reference, pharmacy_id: input.pharmacyId } : { provider, provider_reference: reference }
  );
  if (existing) return { ok: true, duplicate: true, payment: existing };

  const subscription = await col.subscriptions().findOne({ _id: input.subscriptionId, pharmacy_id: input.pharmacyId });
  if (!subscription) return { ok: false, reason: 'That subscription could not be found.' };
  const switching = !!input.planKey && input.planKey !== subscription.plan_key;
  const plan = await getPlan(input.planKey || subscription.plan_key);
  const at = nowIso();

  const recorded = await tx(async () => {
    const succeeded = status === 'succeeded';
    /* Paid days and trial days run on; a period that has ended starts again from now. */
    const from = succeeded && isEntitled(subscription) && new Date(subscription.current_period_end).getTime() > Date.now()
      ? new Date(subscription.current_period_end) : new Date();
    const periodStart = succeeded ? at : subscription.current_period_start;
    const nextEnd = succeeded && plan ? periodEnd(plan, from) : subscription.current_period_end;
    const id = randomUUID();
    const payment: SubscriptionPayment = {
      _id: id, id, subscription_id: subscription.id, pharmacy_id: input.pharmacyId, amount_paisa: input.amountPaisa,
      currency: input.currency ?? 'PKR', status, kind: input.kind ?? 'renewal', provider, provider_reference: reference,
      provider_event_id: input.providerEventId ?? null, method: input.method ?? null, failure_code: input.failureCode ?? null,
      failure_message: input.failureMessage ?? null, period_start: periodStart, period_end: nextEnd,
      paid_at: succeeded ? at : null, provider_status: null, fee_paisa: null, settled_at: null,
      refunded_paisa: null, cancelled_at: null, expires_at: null, verified_by: input.verifiedBy ?? null,
      verified_at: input.verifiedBy ? at : null, statement_reference: null, attempt_id: input.attemptId ?? null,
      created_at: at, updated_at: at,
      /* Every successful payment is an invoice, numbered once, across the platform. */
      invoice_no: succeeded ? await invoiceNumber(at) : null,
      plan_key: plan?.key ?? subscription.plan_key, plan_name: plan?.name ?? subscription.plan_key
    };
    await col.subscriptionPayments().insertOne(payment, s());

    if (succeeded) {
      await col.subscriptions().updateOne({ _id: subscription.id }, {
        $set: {
          status: STATUSES.ACTIVE, current_period_start: periodStart, current_period_end: nextEnd, renewal_at: nextEnd,
          grace_until: null, ended_at: null, failed_payments: 0, provider, provider_reference: reference, pending_plan_key: null, updated_at: at,
          /* A plan chosen at checkout: the subscription becomes that plan, at the price that was charged for it. */
          ...(input.planKey && plan ? {
            plan_id: plan.id, plan_key: plan.key, price_paisa: input.amountPaisa,
            ...(switching ? { auto_renew: plan.autoRenew ? 1 : 0, cancelled_at: null, cancel_reason: null } : {})
          } : {})
        }
      }, s());
      if (input.planKey && plan) await col.pharmacies().updateOne({ _id: input.pharmacyId }, { $set: { plan_key: plan.key } }, s());
      /* The trial has done its job. */
      await col.trials().updateMany({ pharmacy_id: input.pharmacyId, status: 'active' }, { $set: { status: 'converted', ended_at: at, updated_at: at } }, s());
    } else if (input.kind === 'checkout' || ![STATUSES.ACTIVE, STATUSES.PAST_DUE, STATUSES.GRACE].includes(subscription.status as 'active')) {
      /* A payment that did not go through for a plan not yet started — on the
         trial, or after a plan has ended — changes nothing: no grace period
         is earned by a failed card. */
      await notify(input.pharmacyId, {
        type: 'billing', severity: 'warn', title: 'The payment did not go through',
        body: 'Nothing was charged and nothing has changed. You can try again, or choose another way to pay, under Settings › Billing.',
        link: '/settings?tab=billing'
      });
    } else {
      /* A renewal that failed switches nothing off: a grace period starts and
         the pharmacy Admin is told. */
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
  if (recorded.payment?.status === 'succeeded') {
    await sendReceipt(recorded.payment);
    if (plan) await closeFinalCycle(input.pharmacyId, subscription.id, plan);
  }
  return recorded;
}

/**
 * A plan sold for a set number of periods (Monthly, three months): once the
 * last one is paid for, it stops renewing — at the provider too — and the
 * pharmacy is told, in good time, to choose the plan that comes next.
 */
async function closeFinalCycle(pharmacyId: string, subscriptionId: string, plan: PlanView): Promise<void> {
  if (plan.maxCycles <= 0) return;
  const used = await cyclesUsed(pharmacyId, plan.key);
  if (used < plan.maxCycles) return;
  const subscription = await col.subscriptions().findOne({ _id: subscriptionId });
  if (!subscription || subscription.plan_key !== plan.key) return;
  if (subscription.provider_subscription_id) {
    const { setProviderRenewal } = await import('./payments/index.js');
    await setProviderRenewal(subscription, false).catch((error: Error) => console.error(`[KSF] ${error.message} (${subscriptionId})`));
  }
  await col.subscriptions().updateOne({ _id: subscriptionId }, { $set: { auto_renew: 0, renewal_at: null, updated_at: nowIso() } });
  const others = (await listPlans()).filter((other) => other.key !== plan.key && !other.isTrial).map((other) => other.name);
  await notify(pharmacyId, {
    type: 'billing', severity: 'info', title: `This is the last ${PERIOD_WORD[plan.period] ?? 'period'} of your ${plan.name} plan`,
    body: `${plan.name} runs for ${periods(plan, plan.maxCycles)}, and yours ends on ${subscription.current_period_end.slice(0, 10)}. ${others.length ? `Choose ${others.join(' or ')} before then to carry on without a break.` : ''}`.trim(),
    link: '/settings?tab=billing'
  });
}

/** KSF-INV-2026-000123: numbered per calendar year, never reused. */
const invoiceNumber = (at: string): Promise<string> => nextNumber('platform', `invoice-${at.slice(0, 4)}`, `KSF-INV-${at.slice(0, 4)}`);

/** E-mail the receipt to the pharmacy's Admin and put a note in its notifications. Once per payment. */
async function sendReceipt(payment: SubscriptionPayment): Promise<void> {
  try {
    const contact = await billingContact(payment.pharmacy_id);
    const amount = `Rs ${(payment.amount_paisa / 100).toLocaleString('en-PK')}`;
    const period = payment.period_end ? `until ${payment.period_end.slice(0, 10)}` : '';
    if (contact?.email) {
      await sendMail({
        to: contact.email, noticeKey: `receipt:${payment.id}`, pharmacyId: payment.pharmacy_id, template: 'paymentReceipt', retry: true,
        ...templates.paymentReceipt({
          name: contact.full_name, pharmacy: contact.pharmacy_name, invoiceNo: payment.invoice_no ?? payment.id, amount,
          plan: payment.plan_name ?? 'KSF', period, paidOn: (payment.paid_at ?? payment.created_at).slice(0, 10)
        })
      });
    }
    await notify(payment.pharmacy_id, {
      type: 'billing', severity: 'success', title: `Payment received — ${payment.invoice_no ?? amount}`,
      body: `${amount} for the ${payment.plan_name ?? ''} plan${period ? `, ${period}` : ''}. The receipt is under Settings › Billing.`, link: '/settings?tab=billing'
    });
  } catch (error) {
    /* The payment stands either way; a receipt that failed can be printed from Billing. */
    console.warn(`[KSF] receipt for ${payment.id} could not be sent: ${(error as Error).message}`);
  }
}

/** Number the successful payments recorded before invoices were numbered. Safe to repeat. */
export async function numberPastInvoices(): Promise<number> {
  const unnumbered = await col.subscriptionPayments()
    .find({ status: { $in: ['succeeded', 'refunded'] }, invoice_no: null })
    .sort({ paid_at: 1, created_at: 1 }).limit(500).toArray();
  for (const payment of unnumbered) {
    const plan = await col.plans().findOne({ key: (await col.subscriptions().findOne({ _id: payment.subscription_id }))?.plan_key ?? '' });
    await col.subscriptionPayments().updateOne({ _id: payment.id, invoice_no: null }, {
      $set: { invoice_no: await invoiceNumber(payment.paid_at ?? payment.created_at), plan_name: payment.plan_name ?? plan?.name ?? null }
    });
  }
  return unnumbered.length;
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

const rs = (paisa: number): string => `Rs ${(paisa / 100).toLocaleString('en-PK')}`;

/** "Monthly — Rs 1,500 a month (Rs 1,300 with a referral), for up to 3 months", for each plan this pharmacy can still choose. */
async function choiceLines(pharmacyId: string): Promise<string[]> {
  return (await offersFor(pharmacyId)).filter((offer) => offer.available).map((offer) => {
    const per = PERIOD_WORD[offer.period] ?? 'period';
    const special = offer.referralPricePaisa !== null && offer.referralPricePaisa < offer.pricePaisa
      ? (offer.referralApplied ? ' (your referral price)' : ` (${rs(offer.referralPricePaisa)} with a referral)`) : '';
    const limit = offer.cyclesLeft !== null ? `, for up to ${periods(offer, offer.cyclesLeft)}` : '';
    return `${offer.name} — ${rs(offer.yourPricePaisa)} a ${per}${special}${limit}`;
  });
}

async function sendRenewalNotices(summary: { remindersSent: number; dunningSent: number; endingSent: number }): Promise<void> {
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
    const planName = (await getPlan(subscription.plan_key))?.name ?? subscription.plan_key;
    const sent = await noticeOnce({
      key: `renewal-${stage}:${subscription.id}:${on}`, pharmacyId: subscription.pharmacy_id, template: 'renewalReminder',
      severity: 'info', title: stage === 1 ? 'Your subscription renews tomorrow' : 'Your subscription renews in a week',
      body: `${planName} · ${amount} on ${on}. Nothing to do if your payment method is up to date.`,
      ...templates.renewalReminder({ name: contact.full_name, pharmacy: contact.pharmacy_name, plan: planName, amount, on, days: stage })
    });
    if (sent) summary.remindersSent += 1;
  }

  /* The trial, and a plan that will not renew (its last month, or renewal
     switched off): a word three days and one day before, so the choice of
     what comes next is never a surprise at the counter. */
  const ending = await col.subscriptions().find({
    $or: [{ status: STATUSES.TRIAL }, { status: { $in: [STATUSES.ACTIVE, STATUSES.CANCELLED] }, auto_renew: 0, price_paisa: { $gt: 0 } }],
    current_period_end: { $gt: new Date(now).toISOString(), $lte: new Date(now + 3 * day).toISOString() }
  }).toArray();
  for (const subscription of ending) {
    const daysLeft = Math.ceil((new Date(subscription.current_period_end).getTime() - now) / day);
    const stage = daysLeft <= 1 ? 1 : 3;
    const contact = await billingContact(subscription.pharmacy_id);
    if (!contact) continue;
    const on = subscription.current_period_end.slice(0, 10);
    const trial = subscription.status === STATUSES.TRIAL;
    const planName = (await getPlan(subscription.plan_key))?.name ?? subscription.plan_key;
    const sent = await noticeOnce({
      key: `ending-${stage}:${subscription.id}:${on}`, pharmacyId: subscription.pharmacy_id, template: 'planEnding',
      severity: 'info', title: trial ? `Your free trial ends ${stage === 1 ? 'tomorrow' : `in ${daysLeft} days`}` : `Your ${planName} plan ends ${stage === 1 ? 'tomorrow' : `on ${on}`}`,
      body: 'Choose Monthly or Yearly under Settings › Billing to carry on without a break. Nothing you have entered is lost either way.',
      ...templates.planEnding({ name: contact.full_name, pharmacy: contact.pharmacy_name, what: trial ? 'free trial' : `${planName} plan`, on, days: daysLeft, choices: await choiceLines(subscription.pharmacy_id) })
    });
    if (sent) summary.endingSent += 1;
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
      severity: 'warn', title: stage === 'final' ? 'Your plan ends in a few days' : 'We could not take your subscription payment',
      body: `The pharmacy keeps working until ${until}. After that you will be asked to choose a plan — nothing is deleted.`,
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
 * and hourly (or once a day from a scheduler, on a serverless host); safe to
 * run as often as you like. Nothing here deletes data.
 *
 *   trial ends                    -> expired: the pharmacy chooses a plan
 *   paid period ends, renewing    -> grace, while the renewal is collected
 *   paid period ends, not renewing (its last month, cancelled, renewal off)
 *                                 -> expired
 *   grace ends                    -> expired
 */
export async function runSubscriptionMaintenance() {
  const at = nowIso();
  const summary = { trialsEnded: 0, graceStarted: 0, expired: 0, remindersSent: 0, dunningSent: 0, endingSent: 0 };

  const expire = async (subscriptionId: string) => {
    /* A card the provider would go on charging is stopped first. */
    const current = await col.subscriptions().findOne({ _id: subscriptionId });
    if (current?.provider_subscription_id) {
      const { setProviderRenewal } = await import('./payments/index.js');
      await setProviderRenewal(current, false, true).catch((error: Error) => console.error(`[KSF] ${error.message} (${subscriptionId})`));
    }
    await col.subscriptions().updateOne({ _id: subscriptionId }, {
      $set: { status: STATUSES.EXPIRED, auto_renew: 0, grace_until: null, renewal_at: null, ended_at: at, updated_at: at }
    });
  };

  for (const trial of await col.trials().find({ status: 'active', expires_at: { $lte: at } }).toArray()) {
    await col.trials().updateOne({ _id: trial.id }, { $set: { status: 'expired', ended_at: at, updated_at: at } });
  }
  for (const subscription of await col.subscriptions().find({ status: STATUSES.TRIAL, current_period_end: { $lte: at } }).toArray()) {
    await expire(subscription.id);
    await notify(subscription.pharmacy_id, {
      type: 'billing', severity: 'warn', title: 'Your free trial has ended',
      body: 'Choose the Monthly or Yearly plan to carry on. Every medicine, batch, sale and prescription is exactly where you left it, and can still be viewed.',
      link: '/settings?tab=billing'
    });
    summary.trialsEnded += 1;
  }

  const lapsed = await col.subscriptions().find({
    status: { $in: [STATUSES.ACTIVE, STATUSES.PAYMENT_PENDING, STATUSES.CANCELLED] }, current_period_end: { $lte: at }, grace_until: null
  }).toArray();
  for (const subscription of lapsed) {
    const plan = await getPlan(subscription.plan_key);
    if (plan?.isFree && !plan.isTrial) continue;
    if (subscription.status === STATUSES.ACTIVE && subscription.auto_renew && subscription.price_paisa > 0) {
      const graceUntil = plusDays(plan?.graceDays ?? 7);
      await col.subscriptions().updateOne({ _id: subscription.id }, { $set: { status: STATUSES.GRACE, grace_until: graceUntil, updated_at: at } });
      await notify(subscription.pharmacy_id, {
        type: 'billing', severity: 'warn', title: 'Your subscription is due for renewal',
        body: `The pharmacy carries on working normally until ${graceUntil.slice(0, 10)}. Nothing will be deleted after that either — you will simply be asked to choose a plan.`,
        link: '/settings?tab=billing'
      });
      summary.graceStarted += 1;
      continue;
    }
    await expire(subscription.id);
    if (subscription.status !== STATUSES.PAYMENT_PENDING) {
      await notify(subscription.pharmacy_id, {
        type: 'billing', severity: 'warn', title: `Your ${plan?.name ?? ''} plan has ended`.replace('  ', ' '),
        body: 'Choose the Monthly or Yearly plan to carry on. Your data has not been touched — every record is still here and can still be viewed.',
        link: '/settings?tab=billing'
      });
    }
    summary.expired += 1;
  }

  for (const subscription of await col.subscriptions().find({ status: STATUSES.GRACE, grace_until: { $ne: null, $lte: at } }).toArray()) {
    await expire(subscription.id);
    await notify(subscription.pharmacy_id, {
      type: 'billing', severity: 'warn', title: 'Your subscription has ended',
      body: 'The renewal was not paid. Your data has not been touched — every record is still here. Choose a plan whenever you are ready and everything carries on.',
      link: '/settings?tab=billing'
    });
    summary.expired += 1;
  }

  await sendRenewalNotices(summary);
  await numberPastInvoices();
  return summary;
}
