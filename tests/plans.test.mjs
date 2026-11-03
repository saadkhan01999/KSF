/* The price sheet, end to end: Starter, Monthly and Yearly.

   Every pharmacy starts on the 15-day free trial with every feature. A
   pharmacy that came through a referral pays Rs 1,300 a month on Monthly,
   everyone else Rs 1,500; Monthly runs for three months at most; Yearly is
   Rs 12,000. When the trial or a plan ends, the pharmacy's records can still
   be read but not changed until it pays, and nothing is ever deleted. An
   installation from before the price sheet moves to it once, without
   locking anybody out or taking away what was paid for.

   Dates are moved in the database itself — the only way to make fifteen
   days pass in a test — and the hourly maintenance is run by hand. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, TEST_PASSWORD, codeFor, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;
const BANK = { BANK_ACCOUNT_TITLE: 'KSF Pharmacy Systems', BANK_ACCOUNT_NUMBER: '0123456789', BANK_NAME: 'Test Bank' };
const DAY = 86_400_000;

describe('the price sheet: Starter, Monthly and Yearly', { skip }, () => {
  let server;
  let admin;
  let mongo;
  let maintenance;
  let referrer;
  let referred;
  let direct;

  /** Sign a pharmacy up through the real flow with a referral code. */
  const registerWithCode = async (firstName, email, referralCode) => {
    const client = new Client(server.base);
    await client.post('/api/v1/register/start', { firstName, lastName: 'Test', email, password: TEST_PASSWORD, mobile: '0300 1234567', referralCode });
    const reply = await client.post('/api/v1/register/verify-email', { code: await codeFor(client, email) }, 201);
    client.token = reply.accessToken;
    return { client, pharmacyId: reply.data.pharmacyId };
  };
  const offer = (billing, key) => billing.plans.find((plan) => plan.key === key);
  const subscriptionOf = (pharmacyId) => mongo.col.subscriptions().findOne({ pharmacy_id: pharmacyId }, { sort: { created_at: -1 } });
  const setDates = async (pharmacyId, fields) => {
    const subscription = await subscriptionOf(pharmacyId);
    await mongo.col.subscriptions().updateOne({ _id: subscription._id }, { $set: fields });
  };
  /** Pay by bank transfer and have the platform confirm it against its statement. */
  const payByTransfer = async (client, pharmacyId, planKey) => {
    const checkout = await client.post('/api/v1/billing/checkout', { planKey, provider: 'bank-transfer', amountPaisa: 1 });
    const attempts = await admin.get('/api/v1/platform/payments/attempts?status=open');
    const attempt = attempts.data.find((row) => row.reference === checkout.reference);
    assert.equal(attempt.pharmacy_id, pharmacyId);
    await admin.post(`/api/v1/platform/payments/attempts/${attempt.id}/verify`, { statementReference: `STMT-${checkout.reference}` });
    return checkout;
  };

  before(async () => {
    Object.assign(process.env, BANK);
    server = await startServer();
    mongo = await import('../backend/src/db/mongo.ts');
    ({ runSubscriptionMaintenance: maintenance } = await import('../backend/src/services/subscriptions.ts'));
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    await admin.post('/api/v1/auth/verify-identity', { password: SUPER_ADMIN.password });
    referrer = await registerPharmacy(server.base, 'Referrer', 'referrer@plans.test');
  });
  after(async () => {
    for (const key of Object.keys(BANK)) delete process.env[key];
    await server?.stop();
  });

  it('offers exactly the three plans on the sheet, each with every feature and no limit on records', async () => {
    const plans = await new Client(server.base).get('/api/v1/public/plans');
    assert.deepEqual(plans.data.map((plan) => plan.key), ['starter', 'monthly', 'yearly']);
    assert.equal(plans.trialDays, 15);
    const [starter, monthly, yearly] = plans.data;
    assert.equal(starter.pricePaisa, 0);
    assert.equal(starter.isTrial, true);
    assert.equal(starter.trialDays, 15);
    assert.equal(monthly.pricePaisa, 150_000);
    assert.equal(monthly.referralPricePaisa, 130_000);
    assert.equal(monthly.maxCycles, 3);
    assert.equal(monthly.period, 'month');
    assert.equal(yearly.pricePaisa, 1_200_000);
    assert.equal(yearly.period, 'year');
    assert.equal(Math.round(yearly.annualDiscountPercent), 33);
    for (const plan of plans.data) {
      assert.equal(plan.features.length, 12, `${plan.key} has every feature`);
      assert.deepEqual([plan.limits.users, plan.limits.branches, plan.limits.medicines], [-1, -1, -1]);
    }
  });

  it('starts every pharmacy on the free trial, and prices Monthly at Rs 1,300 through a referral', async () => {
    const code = (await referrer.client.get('/api/v1/billing')).referrals.code;
    referred = await registerWithCode('Referred', 'referred@plans.test', code);
    const billing = await referred.client.get('/api/v1/billing');
    assert.equal(billing.subscription.status, 'trial');
    assert.equal(billing.subscription.referralPricing, true);
    assert.equal(offer(billing, 'monthly').yourPricePaisa, 130_000);
    assert.equal(offer(billing, 'monthly').referralApplied, true);
    assert.equal(offer(billing, 'yearly').yourPricePaisa, 1_200_000);
    assert.equal(offer(billing, 'starter').available, false);

    const mine = await referrer.client.get('/api/v1/billing');
    assert.equal(offer(mine, 'monthly').yourPricePaisa, 150_000);
    assert.equal(mine.referrals.successful, 1);
    assert.deepEqual(mine.referrals.prices.map((row) => [row.plan, row.pricePaisa, row.listPricePaisa]), [['monthly', 130_000, 150_000]]);
  });

  it('takes a referral code after registering, but never the pharmacy’s own, and only once', async () => {
    direct = await registerPharmacy(server.base, 'Direct', 'direct@plans.test');
    const own = (await direct.client.get('/api/v1/billing')).referrals.code;
    assert.equal((await direct.client.call('POST', '/api/v1/billing/referral', { code: own })).status, 400);
    const code = (await referrer.client.get('/api/v1/billing')).referrals.code;
    const applied = await direct.client.post('/api/v1/billing/referral', { code });
    assert.equal(offer(applied, 'monthly').yourPricePaisa, 130_000);
    assert.equal((await direct.client.call('POST', '/api/v1/billing/referral', { code })).status, 400);
    /* Back to the list price for the rest of these tests. */
    await mongo.col.referrals().updateMany({ referred_pharmacy_id: direct.pharmacyId }, { $set: { status: 'rejected' } });
    assert.equal(offer(await direct.client.get('/api/v1/billing'), 'monthly').yourPricePaisa, 150_000);
  });

  it('charges the referral price at checkout whatever the browser sends, and keeps the trial days', async () => {
    const checkout = await payByTransfer(referred.client, referred.pharmacyId, 'monthly');
    assert.equal(checkout.amountPaisa, 130_000);
    const state = await referred.client.get('/api/v1/billing/entitlements');
    assert.equal(state.plan, 'monthly');
    assert.equal(state.status, 'active');
    assert.equal(state.pricePaisa, 130_000);
    assert.deepEqual(state.cycles, { used: 1, max: 3, period: 'month' });
    assert.ok(state.daysLeft >= 15 + 28, `the month starts where the trial ends: ${state.daysLeft} day(s) left`);
    const [invoice] = (await referred.client.get('/api/v1/billing')).payments;
    assert.equal(invoice.amount_paisa, 130_000);
    assert.equal(invoice.plan_name, 'Monthly');
  });

  it('refuses changes after the free trial ends, but never reading, and says why', async () => {
    await setDates(direct.pharmacyId, { current_period_end: new Date(Date.now() - 60_000).toISOString() });
    /* Over to the second, before any maintenance has run. */
    const state = await direct.client.get('/api/v1/billing/entitlements');
    assert.equal(state.locked, true);
    assert.equal(state.entitled, false);
    assert.equal(state.status, 'expired');
    assert.deepEqual(state.features, []);

    const refused = await direct.client.call('POST', '/api/v1/categories', { name: 'After the trial' });
    assert.equal(refused.status, 402);
    assert.equal(refused.body.code, 'plan_required');
    assert.match(refused.body.message, /free trial has ended.*Monthly or Yearly/);
    await direct.client.get('/api/v1/medicines');
    await direct.client.get('/api/v1/billing');
    /* The way to a plan stays open. */
    const chosen = await direct.client.post('/api/v1/billing/plan', { planKey: 'yearly' });
    assert.equal(chosen.subscription.pendingPlan.key, 'yearly');

    const summary = await maintenance();
    assert.ok(summary.trialsEnded >= 1);
    assert.equal((await subscriptionOf(direct.pharmacyId)).status, 'expired');
    const notices = await direct.client.get('/api/v1/notifications');
    assert.ok(notices.data.some((row) => row.title === 'Your free trial has ended'));
  });

  it('opens again the moment the chosen plan is paid for', async () => {
    const checkout = await payByTransfer(direct.client, direct.pharmacyId, undefined);
    assert.equal(checkout.plan.key, 'yearly');
    assert.equal(checkout.amountPaisa, 1_200_000);
    const state = await direct.client.get('/api/v1/billing/entitlements');
    assert.equal(state.plan, 'yearly');
    assert.equal(state.locked, false);
    assert.ok(state.daysLeft >= 364);
    await direct.client.post('/api/v1/categories', { name: 'Back in business' }, 201);
  });

  it('ends a cancelled plan on its last paid day, and an unpaid renewal after its grace period', async () => {
    await referred.client.post('/api/v1/billing/cancel', { reason: 'Testing the end of a plan' });
    await setDates(referred.pharmacyId, { current_period_end: new Date(Date.now() - 60_000).toISOString() });
    assert.equal((await referred.client.get('/api/v1/billing/entitlements')).locked, true);
    await maintenance();
    assert.equal((await subscriptionOf(referred.pharmacyId)).status, 'expired');

    await setDates(direct.pharmacyId, { current_period_end: new Date(Date.now() - 60_000).toISOString() });
    await maintenance();
    const grace = await subscriptionOf(direct.pharmacyId);
    assert.equal(grace.status, 'grace');
    assert.ok(new Date(grace.grace_until).getTime() > Date.now() + 13 * DAY, 'Yearly has 14 days of grace');
    assert.equal((await direct.client.get('/api/v1/billing/entitlements')).locked, false);
    await setDates(direct.pharmacyId, { grace_until: new Date(Date.now() - 60_000).toISOString() });
    await maintenance();
    assert.equal((await subscriptionOf(direct.pharmacyId)).status, 'expired');
    assert.equal((await direct.client.call('POST', '/api/v1/categories', { name: 'Grace is over' })).body.code, 'plan_required');
  });

  it('lets the Super Admin start a plan without payment, or give a trial more days', async () => {
    await admin.post(`/api/v1/platform/pharmacies/${direct.pharmacyId}/subscription`, { planKey: 'monthly', note: 'Goodwill' });
    assert.equal((await direct.client.get('/api/v1/billing/entitlements')).plan, 'monthly');
    await direct.client.post('/api/v1/categories', { name: 'Goodwill month' }, 201);

    const late = await registerPharmacy(server.base, 'Late', 'late@plans.test');
    await admin.post(`/api/v1/platform/pharmacies/${late.pharmacyId}/subscription`, { extendDays: 5, note: 'Opened late' });
    const state = await late.client.get('/api/v1/billing/entitlements');
    assert.equal(state.status, 'trial');
    assert.equal(state.trial.daysLeft, 20);
    /* A payment recorded by hand on a trial must say which plan it is for. */
    const unnamed = await admin.call('POST', `/api/v1/platform/pharmacies/${late.pharmacyId}/payments`, { amountPaisa: 150_000, reference: 'CASH-1' });
    assert.equal(unnamed.status, 400);
    await admin.post(`/api/v1/platform/pharmacies/${late.pharmacyId}/payments`, { amountPaisa: 150_000, reference: 'CASH-1', planKey: 'monthly' }, 201);
    assert.equal((await late.client.get('/api/v1/billing/entitlements')).plan, 'monthly');
  });

  it('runs the housekeeping for the scheduler (Vercel Cron) only with its secret', async () => {
    const url = `${server.base}/api/v1/cron/maintenance`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer not-the-secret' } })).status, 401);
    const ran = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    assert.equal(ran.status, 200);
    const body = await ran.json();
    assert.equal(body.ok, true);
    assert.ok('trialsEnded' in body.subscriptions);
    assert.deepEqual(body.problems, []);
  });

  it('moves an older installation to the three plans once, keeping what was paid for', async () => {
    const { adoptPriceSheet } = await import('../backend/src/db/bootstrap.ts');
    /* Put back the 2.5 plans: a free Basic everybody fell back to, and the old Monthly price. */
    const at = new Date().toISOString();
    await mongo.col.plans().insertOne({
      _id: 'PLAN-BASIC', id: 'PLAN-BASIC', key: 'basic', name: 'Basic', tagline: null, description: null, period: 'perpetual', period_days: 0,
      price_paisa: 0, currency: 'PKR', annual_discount_pct: 0, trial_days: 0, grace_days: 0, max_desktop_devices: 1, max_mobile_devices: 1,
      max_users: 3, max_branches: 1, max_medicines: 500, features: ['pos.core'], auto_renew: 0, is_default: 1, is_public: 1, is_free: 1,
      sort_order: 0, status: 'active', created_at: at, updated_at: at
    });
    await mongo.col.plans().updateOne({ key: 'monthly' }, { $set: { price_paisa: 390_000, referral_price_paisa: null, max_cycles: 0 } });
    const old = await registerPharmacy(server.base, 'Old', 'old@plans.test');
    await setDates(old.pharmacyId, { plan_key: 'basic', plan_id: 'PLAN-BASIC', status: 'active', current_period_end: new Date(Date.now() + 3650 * DAY).toISOString() });
    const paid = await registerPharmacy(server.base, 'Paid', 'paid@plans.test');
    await admin.post(`/api/v1/platform/pharmacies/${paid.pharmacyId}/subscription`, { planKey: 'yearly' });
    await mongo.col.counters().deleteOne({ _id: 'plans:price-sheet-2026-11' });

    const moved = await adoptPriceSheet();
    assert.ok(moved.trials >= 1);
    const basic = await mongo.col.plans().findOne({ key: 'basic' });
    assert.equal(basic.status, 'retired');
    assert.equal(basic.is_default, 0);
    const monthly = await mongo.col.plans().findOne({ key: 'monthly' });
    assert.deepEqual([monthly.price_paisa, monthly.referral_price_paisa, monthly.max_cycles], [150_000, 130_000, 3]);
    const state = await old.client.get('/api/v1/billing/entitlements');
    assert.equal(state.plan, 'starter');
    assert.equal(state.status, 'trial');
    assert.equal(state.trial.daysLeft, 15);
    const kept = await paid.client.get('/api/v1/billing/entitlements');
    assert.equal(kept.plan, 'yearly');
    assert.equal(kept.status, 'active');
    /* Once only: a price the Super Admin changes later is never put back. */
    assert.deepEqual(await adoptPriceSheet(), { trials: 0 });
    const plans = await new Client(server.base).get('/api/v1/public/plans');
    assert.deepEqual(plans.data.map((plan) => plan.key), ['starter', 'monthly', 'yearly']);
  });
});
