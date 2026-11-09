/* Stripe, end to end, against a real MongoDB and a stand-in for Stripe's API.

   Stripe's REST API is answered in-process (the server's own fetch is
   intercepted for api.stripe.com only); webhooks are signed exactly as
   Stripe signs them. A pharmacy on its free trial pays for Monthly on
   Checkout, comes back, is renewed, fails a renewal, gets a refund, changes
   its card, reaches the third and last month of Monthly — which stops
   renewing by itself — and moves to Yearly; every forged, replayed, stale or
   mispriced message is refused. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Client, SUPER_ADMIN, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;
const WEBHOOK_SECRET = 'whsec_test_ksf';

/* ------------------------------------------------- a stand-in for Stripe */
const calls = [];
/* The latest Checkout session. Each one has its own subscription at Stripe
   (sub_1, sub_2…) and charges what the session was created for. */
let session = { id: '', reference: '', paid: false, amount: 0, subscription: '', invoice: '' };
let sessions = 0;
const realFetch = globalThis.fetch;
const MONTHLY = 140_000;
const YEARLY = 1_200_000;

function stripeReply(method, path, params) {
  if (method === 'POST' && path === '/v1/checkout/sessions') {
    sessions += 1;
    session = {
      id: `cs_test_${sessions}`, reference: params.get('client_reference_id'), paid: false,
      amount: Number(params.get('line_items[0][price_data][unit_amount]')), subscription: `sub_${sessions}`, invoice: sessions === 1 ? 'in_first' : `in_first_${sessions}`
    };
    return { id: session.id, url: `https://checkout.stripe.com/c/pay/${session.id}`, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  }
  if (method === 'GET' && path === `/v1/checkout/sessions/${session.id}`) {
    return {
      id: session.id, client_reference_id: session.reference, status: session.paid ? 'complete' : 'open',
      payment_status: session.paid ? 'paid' : 'unpaid', amount_total: session.amount, currency: 'pkr',
      invoice: session.invoice, subscription: session.subscription, customer: 'cus_1'
    };
  }
  if (method === 'GET' && path === '/v1/invoices/in_renewal') return { id: 'in_renewal', payment_intent: 'pi_renewal' };
  if (method === 'POST' && path === '/v1/refunds') return { id: 're_1', status: 'succeeded' };
  const subscription = /^\/v1\/subscriptions\/(sub_\d+)$/.exec(path);
  if (subscription) return { id: subscription[1], status: method === 'DELETE' ? 'canceled' : 'active' };
  if (method === 'POST' && path === '/v1/billing_portal/sessions') return { url: 'https://billing.stripe.com/p/session/test_1' };
  return { __status: 404, error: { message: `No stand-in for ${method} ${path}` } };
}

/** Sign an event the way Stripe does: HMAC-SHA256 of "<t>.<body>". */
function signed(event, { secret = WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(event);
  return { raw, signature: `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex')}` };
}

const invoiceEvent = (id, type, invoice) => ({ id, type, data: { object: { object: 'invoice', subscription: 'sub_1', currency: 'pkr', ...invoice } } });

describe('Stripe payments, renewals and invoices', { skip }, () => {
  let server;
  let owner;
  let pharmacyId;
  let admin;

  const deliver = async ({ raw, signature }) => {
    const response = await realFetch(`${server.base}/api/v1/payments/webhook/stripe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: raw
    });
    return { status: response.status, body: await response.json() };
  };
  const paymentCount = async () => (await owner.get('/api/v1/billing')).payments.filter((row) => row.status === 'succeeded').length;

  before(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_ksf';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (!href.startsWith('https://api.stripe.com/')) return realFetch(url, init);
      const address = new URL(href);
      const method = init.method ?? 'GET';
      const params = new URLSearchParams(method === 'GET' ? address.search : String(init.body ?? ''));
      calls.push({ method, path: address.pathname, params, headers: init.headers });
      const { __status, ...body } = stripeReply(method, address.pathname, params);
      return new Response(JSON.stringify(body), { status: __status ?? 200, headers: { 'content-type': 'application/json' } });
    };
    server = await startServer();
    ({ client: owner, pharmacyId } = await registerPharmacy(server.base, 'Stripe', 'stripe@pharmacy.test'));
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  });
  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await server?.stop();
  });

  it('offers Stripe as the default way to pay once it is configured', async () => {
    const providers = await owner.get('/api/v1/billing/providers');
    assert.equal(providers.default, 'stripe');
    assert.equal(providers.data.find((row) => row.key === 'stripe').mode, 'test');
  });

  it('starts a Checkout subscription for the price the plan says, not the browser', async () => {
    const chosen = await owner.post('/api/v1/billing/plan', { planKey: 'monthly' });
    /* Choosing changes nothing yet: the trial carries on until the money arrives. */
    assert.equal(chosen.subscription.status, 'trial');
    assert.equal(chosen.subscription.pendingPlan.key, 'monthly');
    const checkout = await owner.post('/api/v1/billing/checkout', { planKey: 'monthly', amountPaisa: 1 });
    assert.equal(checkout.redirect.method, 'GET');
    assert.match(checkout.redirect.url, /^https:\/\/checkout\.stripe\.com\//);
    const created = calls.find((call) => call.path === '/v1/checkout/sessions');
    assert.equal(created.params.get('mode'), 'subscription');
    assert.equal(created.params.get('line_items[0][price_data][unit_amount]'), String(MONTHLY));
    assert.equal(created.params.get('line_items[0][price_data][currency]'), 'pkr');
    assert.equal(created.params.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(created.params.get('client_reference_id'), checkout.reference);
    assert.match(created.params.get('success_url'), new RegExp(`/api/v1/payments/return/stripe\\?ref=${checkout.reference}$`));
    assert.equal(created.params.get('metadata[ksf_pharmacy_id]'), pharmacyId);
    assert.equal(created.headers['Idempotency-Key'], `ksf-checkout-${checkout.reference}`);
    const state = await owner.get('/api/v1/billing/entitlements');
    assert.equal(state.status, 'trial');
    assert.equal(state.entitled, true);
  });

  it('believes a returning browser only after asking Stripe', async () => {
    const early = await owner.call('GET', `/api/v1/payments/return/stripe?ref=${session.reference}`);
    assert.equal(early.status, 303);
    assert.match(early.body.redirect, /payment=pending/);
    assert.equal((await owner.get('/api/v1/billing/entitlements')).status, 'trial');

    session.paid = true;
    const back = await owner.call('GET', `/api/v1/payments/return/stripe?ref=${session.reference}`);
    assert.match(back.body.redirect, /payment=paid/);
    const state = await owner.get('/api/v1/billing/entitlements');
    assert.equal(state.status, 'active');
    assert.equal(state.plan, 'monthly');
    assert.equal(state.pendingPlan, null);
    /* The trial's days are not lost: the month starts where the trial ends. */
    assert.ok(state.daysLeft >= 15 + 28, `expected the trial days plus a month, got ${state.daysLeft}`);
    assert.deepEqual(state.cycles, { used: 1, max: 3, period: 'month' });
    const [payment] = (await owner.get('/api/v1/billing')).payments;
    assert.match(payment.invoice_no, /^KSF-INV-\d{4}-\d{6}$/);
    assert.equal(payment.provider_reference, 'in_first');
  });

  it('applies the same payment only once when the webhook follows', async () => {
    const completed = signed({
      id: 'evt_checkout', type: 'checkout.session.completed',
      data: { object: { id: session.id, client_reference_id: session.reference, status: 'complete', payment_status: 'paid', amount_total: MONTHLY, currency: 'pkr', invoice: 'in_first', subscription: 'sub_1', customer: 'cus_1' } }
    });
    assert.equal((await deliver(completed)).status, 200);
    assert.equal((await deliver(completed)).body.duplicate, true);
    assert.equal(await paymentCount(), 1);
  });

  it('refuses forged, stale and unsigned events', async () => {
    const event = invoiceEvent('evt_forged', 'invoice.paid', { id: 'in_forged', billing_reason: 'subscription_cycle', amount_paid: MONTHLY });
    assert.equal((await deliver(signed(event, { secret: 'whsec_wrong' }))).status, 400);
    assert.equal((await deliver(signed(event, { at: Math.floor(Date.now() / 1000) - 3600 }))).status, 400);
    assert.equal((await deliver({ raw: JSON.stringify(event), signature: '' })).status, 400);
    assert.equal(await paymentCount(), 1);
  });

  it('renews when Stripe charges the next period, once, and only at the right price', async () => {
    const renewal = signed(invoiceEvent('evt_renewal', 'invoice.paid', { id: 'in_renewal', billing_reason: 'subscription_cycle', amount_paid: MONTHLY }));
    assert.equal((await deliver(renewal)).body.status, 'processed');
    /* invoice.payment_succeeded arrives for the same invoice: still one payment. */
    await deliver(signed(invoiceEvent('evt_renewal_2', 'invoice.payment_succeeded', { id: 'in_renewal', billing_reason: 'subscription_cycle', amount_paid: MONTHLY })));
    assert.equal(await paymentCount(), 2);

    const cheap = await deliver(signed(invoiceEvent('evt_cheap', 'invoice.paid', { id: 'in_cheap', billing_reason: 'subscription_cycle', amount_paid: 100 })));
    assert.equal(cheap.body.status, 'ignored');
    assert.equal(await paymentCount(), 2);
  });

  it('starts a grace period when a renewal fails, and nothing is switched off', async () => {
    await deliver(signed(invoiceEvent('evt_failed', 'invoice.payment_failed', { id: 'in_failed', billing_reason: 'subscription_cycle', amount_due: MONTHLY })));
    const state = await owner.get('/api/v1/billing/entitlements');
    assert.equal(state.status, 'grace');
    assert.equal(state.entitled, true);
  });

  it('numbers every invoice and shows it to its pharmacy and the platform only', async () => {
    const list = await owner.get('/api/v1/billing/invoices');
    assert.equal(list.total, 2);
    const invoice = (await owner.get(`/api/v1/billing/invoices/${list.data[0].id}`)).data;
    assert.match(invoice.number, /^KSF-INV-/);
    assert.equal(invoice.buyer.name, "Stripe's Pharmacy");
    assert.equal(invoice.totals.totalPaisa, MONTHLY);
    assert.equal(invoice.payment.provider, 'Card (Stripe)');
    assert.notEqual(list.data[0].invoice_no, list.data[1].invoice_no);

    const { client: other } = await registerPharmacy(server.base, 'Other', 'other@stripe.test');
    await other.get(`/api/v1/billing/invoices/${list.data[0].id}`, 404);
    assert.equal((await admin.get(`/api/v1/platform/invoices/${list.data[0].id}`)).data.number, invoice.number);
  });

  it('refunds through Stripe on the PaymentIntent behind the invoice', async () => {
    const renewal = (await owner.get('/api/v1/billing/invoices')).data.find((row) => row.kind === 'renewal');
    await admin.post('/api/v1/auth/verify-identity', { password: SUPER_ADMIN.password });
    await admin.post(`/api/v1/platform/payments/${renewal.id}/refund`, { reason: 'Charged twice by mistake' });
    const refund = calls.find((call) => call.path === '/v1/refunds');
    assert.equal(refund.params.get('payment_intent'), 'pi_renewal');
    assert.equal(refund.params.get('amount'), String(MONTHLY));
    assert.equal((await owner.get(`/api/v1/billing/invoices/${renewal.id}`)).data.status, 'refunded');
  });

  it('opens the card page, and stops renewing at Stripe before saying so', async () => {
    assert.match((await owner.post('/api/v1/billing/portal')).url, /^https:\/\/billing\.stripe\.com\//);
    await owner.post('/api/v1/billing/auto-renew', { enabled: false });
    const stop = calls.filter((call) => call.path === '/v1/subscriptions/sub_1' && call.method === 'POST').at(-1);
    assert.equal(stop.params.get('cancel_at_period_end'), 'true');

    /* Turned back on in Stripe's own portal: KSF follows. */
    await deliver(signed({ id: 'evt_resumed', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', cancel_at_period_end: false } } }));
    assert.equal((await owner.get('/api/v1/billing/entitlements')).autoRenew, true);
  });

  it('stops renewing at Stripe once the third and last month of Monthly is paid', async () => {
    /* One checkout and one renewal were refunded away above: two more months make three. */
    await deliver(signed(invoiceEvent('evt_month_2', 'invoice.paid', { id: 'in_month_2', billing_reason: 'subscription_cycle', amount_paid: MONTHLY })));
    let state = await owner.get('/api/v1/billing/entitlements');
    assert.deepEqual(state.cycles, { used: 2, max: 3, period: 'month' });
    assert.equal(state.autoRenew, true);

    const before = calls.length;
    await deliver(signed(invoiceEvent('evt_month_3', 'invoice.paid', { id: 'in_month_3', billing_reason: 'subscription_cycle', amount_paid: MONTHLY })));
    state = await owner.get('/api/v1/billing/entitlements');
    assert.deepEqual(state.cycles, { used: 3, max: 3, period: 'month' });
    assert.equal(state.autoRenew, false);
    assert.equal(state.status, 'active');
    const stop = calls.slice(before).find((call) => call.path === '/v1/subscriptions/sub_1' && call.method === 'POST');
    assert.equal(stop?.params.get('cancel_at_period_end'), 'true');

    /* Monthly cannot be had again, or switched back on. */
    const again = await owner.call('POST', '/api/v1/billing/plan', { planKey: 'monthly' });
    assert.equal(again.status, 400);
    assert.match(again.body.message, /first 3 months.*Diamond Annual/);
    assert.equal((await owner.call('POST', '/api/v1/billing/checkout', { planKey: 'monthly' })).status, 400);
    assert.equal((await owner.call('POST', '/api/v1/billing/auto-renew', { enabled: true })).status, 400);
    const offers = (await owner.get('/api/v1/billing')).plans;
    assert.equal(offers.find((plan) => plan.key === 'monthly').available, false);
    assert.equal(offers.find((plan) => plan.key === 'yearly').available, true);
  });

  it('moves to Yearly when its payment clears, and stops the monthly card subscription at once', async () => {
    const endOfMonthly = (await owner.get('/api/v1/billing/entitlements')).periodEnd;
    await owner.post('/api/v1/billing/plan', { planKey: 'yearly' });
    const checkout = await owner.post('/api/v1/billing/checkout', {});
    const created = calls.filter((call) => call.path === '/v1/checkout/sessions').at(-1);
    assert.equal(created.params.get('line_items[0][price_data][unit_amount]'), String(YEARLY));
    assert.equal(created.params.get('line_items[0][price_data][recurring][interval]'), 'year');
    assert.equal(checkout.plan.key, 'yearly');

    session.paid = true;
    await owner.call('GET', `/api/v1/payments/return/stripe?ref=${session.reference}`);
    const state = await owner.get('/api/v1/billing/entitlements');
    assert.equal(state.plan, 'yearly');
    assert.equal(state.pricePaisa, YEARLY);
    assert.equal(state.cycles, null);
    /* The year starts where the paid month ends. */
    assert.ok(new Date(state.periodEnd).getTime() - new Date(endOfMonthly).getTime() > 364 * 86_400_000);
    assert.ok(calls.some((call) => call.path === '/v1/subscriptions/sub_1' && call.method === 'DELETE'));
    /* A renewal for the stopped subscription now finds nothing to renew. */
    const late = await deliver(signed(invoiceEvent('evt_late', 'invoice.paid', { id: 'in_late', billing_reason: 'subscription_cycle', amount_paid: MONTHLY })));
    assert.equal(late.body.status, 'ignored');
  });
});
