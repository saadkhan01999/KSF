/* ==========================================================================
   Billing and Subscription
   --------------------------------------------------------------------------
   What a pharmacy Admin sees under Settings, and the endpoints a payment
   provider calls when money actually moves.

   The browser can ask to change plan, ask to cancel and ask for a checkout
   reference. It cannot make a subscription active — only a verified provider
   event does that, or the platform Super Admin confirming a transfer against
   the bank statement. Somebody with the developer tools open can call every
   endpoint in this file and still not give themselves a paid plan.
   ========================================================================== */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { col } from '../db/mongo.js';
import { bad, missing, tooMany } from '../core/errors.js';
import { auditLog, logActivity, notify, securityEvent } from '../core/trails.js';
import { nowIso, rateLimit, toStr } from '../core/util.js';
import { publicRoute, route } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import {
  cancelSubscription, changePlan, currentSubscription, getPlan, handleWebhook, listPlans, STATUSES, subscriptionState
} from '../services/subscriptions.js';
import {
  adapterFor, attemptsFor, availableProviders, confirmReturn, createAttempt, defaultProviderKey, listProviders, providerPortal, receiveEvent,
  refundsFor, setProviderRenewal, settleFromProvider
} from '../services/payments/index.js';
import { referralSummary } from '../services/referrals.js';

const PAYMENT_FIELDS = {
  _id: 0, id: 1, amount_paisa: 1, currency: 1, status: 1, kind: 1, provider: 1, provider_reference: 1, method: 1,
  failure_code: 1, failure_message: 1, period_start: 1, period_end: 1, paid_at: 1, refunded_paisa: 1, created_at: 1,
  invoice_no: 1, plan_name: 1
};

/* ------------------------------------------------------------ what we have */
route('GET', '/api/v1/billing', 'settings.read', async (ctx) => {
  const [subscription, current, plans, payments, referrals] = await Promise.all([
    subscriptionState(ctx.pharmacyId),
    currentSubscription(ctx.pharmacyId),
    listPlans(),
    col.subscriptionPayments().find({ pharmacy_id: ctx.pharmacyId }, { projection: PAYMENT_FIELDS }).sort({ created_at: -1 }).limit(50).toArray(),
    referralSummary(ctx.pharmacyId, ctx.user.id)
  ]);
  /* The card on file, when a provider renews the plan by itself. */
  const renewer = current?.provider_customer_id ? adapterFor(current.provider) : null;
  return {
    subscription, plans, payments, referrals, canManage: ctx.can('settings.write'),
    providers: availableProviders().map(({ key, label, mode, note, methods }) => ({ key, label, mode, note, methods })),
    defaultProvider: defaultProviderKey(),
    card: renewer ? { provider: renewer.label, canChange: !!renewer.portal } : null
  };
});

route('GET', '/api/v1/billing/payments', 'settings.read', async (ctx) => ({
  data: await col.subscriptionPayments().find({ pharmacy_id: ctx.pharmacyId }, { projection: PAYMENT_FIELDS }).sort({ created_at: -1 }).limit(200).toArray()
}));

/* ------------------------------------------------------------ changing it */
route('POST', '/api/v1/billing/plan', 'settings.write', async (ctx) => {
  const planKey = toStr(ctx.body.planKey, 30);
  const plan = await getPlan(planKey);
  if (!plan || plan.status !== 'active' || !plan.isPublic) return bad('Choose one of the available plans.', 'planKey');

  const before = await subscriptionState(ctx.pharmacyId);
  const result = await changePlan({ pharmacyId: ctx.pharmacyId, planKey });
  if (!result.ok) bad(result.reason ?? 'The plan could not be changed.');
  const after = await subscriptionState(ctx.pharmacyId);

  await logActivity(ctx, { action: 'billing.plan-changed', entity: 'subscription', entityId: after?.subscriptionId, severity: 'warn', summary: `Plan changed from ${before?.planName} to ${after?.planName}` });
  await auditLog(ctx, {
    action: 'billing.plan-changed', entity: 'subscription', entityId: after?.subscriptionId, summary: `Plan changed from ${before?.planName} to ${after?.planName}`,
    before: { plan: before?.plan, status: before?.status }, after: { plan: after?.plan, status: after?.status }
  });
  return {
    subscription: after,
    message: plan.isFree
      ? `Your pharmacy is now on the ${plan.name} plan. Nothing has been deleted — premium features are simply locked.`
      : `The ${plan.name} plan is ready. It becomes active as soon as the payment clears; nothing changes until then.`
  };
});

route('POST', '/api/v1/billing/auto-renew', 'settings.write', async (ctx) => {
  const subscription = await currentSubscription(ctx.pharmacyId);
  if (!subscription) return missing('There is no subscription on this pharmacy.');
  if (subscription.is_free) bad('The Basic plan is free and has nothing to renew.');
  const enabled = !!ctx.body.enabled;
  /* A card the provider renews (Stripe) is told first; if it cannot be, nothing changes here either. */
  await setProviderRenewal(subscription, enabled).catch((error: Error) => bad(`${error.message} Nothing was changed.`));
  await col.subscriptions().updateOne({ _id: subscription.id }, { $set: { auto_renew: enabled ? 1 : 0, updated_at: nowIso() } });
  await auditLog(ctx, { action: 'billing.auto-renew', entity: 'subscription', entityId: subscription.id, summary: `Automatic renewal turned ${enabled ? 'on' : 'off'}` });
  return {
    subscription: await subscriptionState(ctx.pharmacyId),
    message: enabled ? 'Automatic renewal is on.'
      : `Automatic renewal is off. The plan runs until ${subscription.current_period_end.slice(0, 10)} and then moves to Basic. Nothing is deleted.`
  };
});

route('POST', '/api/v1/billing/cancel', 'settings.write', async (ctx) => {
  const current = await currentSubscription(ctx.pharmacyId);
  if (current?.is_free) bad('The Basic plan is free — there is nothing to cancel.');
  if (current?.status === STATUSES.CANCELLED) bad('This subscription is already cancelled.');
  /* Stop the card renewing at the end of the paid period before saying it is cancelled. */
  if (current) await setProviderRenewal(current, false).catch((error: Error) => bad(`${error.message} Nothing was cancelled.`));
  const result = await cancelSubscription({ pharmacyId: ctx.pharmacyId, reason: toStr(ctx.body.reason, 300) });
  if (!result.ok) bad(result.reason ?? 'The subscription could not be cancelled.');
  const endsOn = String(result.endsAt).slice(0, 10);
  const state = await subscriptionState(ctx.pharmacyId);
  await logActivity(ctx, { action: 'billing.cancelled', entity: 'subscription', entityId: state?.subscriptionId, severity: 'warn', summary: `Subscription cancelled by ${ctx.user.full_name}` });
  await auditLog(ctx, { action: 'billing.cancelled', entity: 'subscription', entityId: state?.subscriptionId, summary: `Cancelled, paid period runs to ${endsOn}` });
  await notify(ctx.pharmacyId, {
    type: 'billing', severity: 'info', title: 'Your subscription has been cancelled',
    body: `You keep everything you have paid for until ${endsOn}, then the pharmacy moves to the free Basic plan. No record is deleted at any point.`,
    link: '/settings?tab=billing'
  });
  return { subscription: state, endsAt: result.endsAt, message: `Cancelled. Your plan keeps working until ${endsOn}, and none of your data is affected.` };
});

/**
 * Start a payment. The amount is read from the plan document, never the
 * request. Nothing here takes money or changes the subscription.
 */
route('POST', '/api/v1/billing/checkout', 'settings.write', async (ctx) => {
  const subscription = await currentSubscription(ctx.pharmacyId);
  if (!subscription) return missing('There is no subscription on this pharmacy.');
  const providerKey = toStr(ctx.body.provider, 40).toLowerCase() || defaultProviderKey();
  if (!providerKey) bad('No payment method is configured on this installation yet. The platform administrator can set one up — see docs/PAYMENTS.md.');
  const result = await createAttempt({
    pharmacyId: ctx.pharmacyId, subscriptionId: subscription.id, planKey: toStr(ctx.body.planKey, 30) || subscription.plan_key, providerKey, actorId: ctx.user.id
  });
  if (!result.ok) return bad(result.reason);
  await logActivity(ctx, { action: 'billing.checkout-started', entity: 'subscription', entityId: subscription.id, summary: `Payment ${result.reference} started through ${providerKey}` });
  return {
    reference: result.reference, provider: providerKey, amountPaisa: result.amountPaisa, currency: result.currency, plan: result.plan,
    redirect: result.redirect, instructions: result.instructions,
    note: 'Your plan becomes active when the payment is confirmed to this server — not from this browser.'
  };
});

/* The provider's own page for changing the card (Stripe's billing portal). */
route('POST', '/api/v1/billing/portal', 'settings.write', async (ctx) => {
  const subscription = await currentSubscription(ctx.pharmacyId);
  if (!subscription) return missing('There is no subscription on this pharmacy.');
  const portal = await providerPortal(subscription, `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/settings?tab=billing`);
  if (!portal.ok || !portal.url) bad(portal.reason ?? 'The card page could not be opened.');
  return { url: portal.url };
});

/* What this installation can actually take payment with. */
route('GET', '/api/v1/billing/providers', 'settings.read', async () => ({ data: listProviders(), default: defaultProviderKey() }));

route('GET', '/api/v1/billing/attempts', 'settings.read', async (ctx) => ({
  data: await attemptsFor(ctx.pharmacyId), refunds: await refundsFor(ctx.pharmacyId)
}));

/* ------------------------------------------------- provider callbacks */

const callbackInput = (ctx: Ctx, withBody: boolean) => ({
  body: withBody ? ctx.body : {}, query: Object.fromEntries(ctx.query), raw: withBody ? ctx.rawBody : '', headers: ctx.headers
});

/**
 * Where the customer's browser lands after paying. A courtesy, not a source
 * of truth: the signature is checked, the amount compared against what the
 * server wrote down, and the customer sent back into the app either way.
 */
async function returnFromProvider(ctx: Ctx, withBody: boolean) {
  const providerKey = toStr(ctx.params.provider, 40).toLowerCase();
  const adapter = adapterFor(providerKey);
  if (!adapter) return bad('Unknown payment provider.');
  const applied = await confirmReturn(adapter, toStr(ctx.query.get('ref'), 80), callbackInput(ctx, withBody));
  const status = applied.ok && 'applied' in applied && applied.applied ? 'paid' : 'mismatch' in applied && applied.mismatch ? 'mismatch' : 'pending';
  return { __redirect: `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/settings?tab=billing&payment=${status}`, ok: applied.ok };
}

publicRoute('POST', '/api/v1/payments/return/:provider', (ctx) => returnFromProvider(ctx, true), { allowCrossOrigin: true });
publicRoute('GET', '/api/v1/payments/return/:provider', (ctx) => returnFromProvider(ctx, false), { allowCrossOrigin: true });

/**
 * The provider's server-to-server call — the one that counts. Signature,
 * reference, amount and currency, then the transition. A duplicate delivery
 * does nothing; a replay with a changed amount is refused and recorded.
 */
publicRoute('POST', '/api/v1/payments/webhook/:provider', async (ctx) => {
  const limit = rateLimit(`payhook:${ctx.ip}`, 240, 60_000);
  if (!limit.ok) tooMany('Too many callbacks.', limit.retryAfter);
  const providerKey = toStr(ctx.params.provider, 40).toLowerCase();
  const adapter = adapterFor(providerKey);
  if (!adapter) return { received: true, applied: false, reason: 'unknown provider', __status: 404 };

  /* A provider with many kinds of event (Stripe) is handled whole: verified,
     recorded once under its event id, then applied. A forged one is answered
     400, which Stripe shows in its dashboard rather than retrying for days. */
  if (adapter.parseEvent) {
    const result = await receiveEvent(adapter, callbackInput(ctx, true));
    if (!result.ok) {
      await securityEvent({ type: 'payment.callback-rejected', severity: 'warn', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent, detail: `${providerKey}: ${result.detail}` });
      return { received: false, reason: result.detail, __status: 400 };
    }
    return { received: true, status: result.status, duplicate: !!result.duplicate, detail: result.detail ?? null };
  }

  const outcome = adapter.verifyCallback(callbackInput(ctx, true));
  if (!outcome.ok) {
    await securityEvent({ type: 'payment.callback-rejected', severity: 'warn', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent, detail: `${providerKey}: ${outcome.reason}` });
    /* 200 on purpose: a provider given a 4xx retries for hours, and a forged
       callback is not worth that traffic. It is recorded either way. */
    return { received: true, applied: false, reason: 'not verified' };
  }
  const applied = await settleFromProvider({ providerKey, outcome, source: 'webhook' });
  if ('mismatch' in applied && applied.mismatch) {
    await securityEvent({
      type: 'payment.amount-mismatch', severity: 'danger', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent,
      detail: `${providerKey} ${toStr(outcome.reference, 60)}: ${applied.reason}`
    });
  }
  return {
    received: true, applied: 'applied' in applied && !!applied.applied, duplicate: 'duplicate' in applied && !!applied.duplicate,
    ignored: 'ignored' in applied && !!applied.ignored, status: 'status' in applied ? applied.status ?? null : null
  };
}, { allowCrossOrigin: true });

/**
 * Subscription events from a provider that bills on its own schedule.
 * HMAC-SHA256 over the exact bytes of the body; anything unsigned is written
 * down as evidence and never applied.
 */
publicRoute('POST', '/api/v1/webhooks/payments/:provider', async (ctx) => {
  const limit = rateLimit(`hook:${ctx.ip}`, 120, 60_000);
  if (!limit.ok) tooMany('Too many webhook deliveries.', limit.retryAfter);
  const provider = toStr(ctx.params.provider, 40).toLowerCase();
  const key = env.PAYMENT_WEBHOOK_SECRET;
  const supplied = String(ctx.headers['x-ksf-signature'] || ctx.headers['x-signature'] || '').replace(/^sha256=/, '');
  let signatureValid = false;
  if (key && supplied && ctx.rawBody) {
    const expected = Buffer.from(createHmac('sha256', key).update(ctx.rawBody).digest('hex'), 'utf8');
    const given = Buffer.from(supplied, 'utf8');
    signatureValid = expected.length === given.length && timingSafeEqual(expected, given);
  }
  const result = await handleWebhook({
    provider, eventId: toStr(ctx.body.id ?? ctx.body.eventId, 120), type: toStr(ctx.body.type ?? ctx.body.event, 80),
    signatureValid, payload: ctx.body.data ?? ctx.body
  });
  if (!result.ok && !result.duplicate && !result.status) return { received: true, applied: false, reason: result.reason, __status: 400 };
  return { received: true, duplicate: !!result.duplicate, applied: result.status === 'processed', status: result.status, detail: result.result ?? null };
}, { allowCrossOrigin: true });

/* --------------------------------------------------------- the plan list */
route('GET', '/api/v1/billing/plans', null, async () => ({ data: await listPlans() }));

/* Feature gating is answered by the server, so a hidden button is never the
   only thing between somebody and a paid feature. */
route('GET', '/api/v1/billing/entitlements', null, async (ctx) => {
  const state = await subscriptionState(ctx.pharmacyId);
  return {
    ...state,
    needsAttention: ([STATUSES.PAST_DUE, STATUSES.GRACE, STATUSES.PAYMENT_PENDING] as string[]).includes(String(state?.status))
  };
});
