/* KSF's own accounts, and the payment-method check, over real HTTP against a
   real MongoDB.

   Two pharmacies pay by hand with the same slip number (each its own receipt
   book), one payment is partly refunded, and the platform records a setup fee,
   a server bill and a salary. The accounts must add up to the rupee, belong to
   the platform's finance roles only, and the payment methods must say what
   each provider still needs. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, TEST_PASSWORD, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe('platform accounts', { skip }, () => {
  let server;
  let admin;
  let pharmacyAdmin;
  let viewer;
  const pharmacies = {};
  const state = {};

  before(async () => {
    server = await startServer();
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    const first = await registerPharmacy(server.base, 'Amna', 'amna@platform-accounts.test');
    const second = await registerPharmacy(server.base, 'Bilal', 'bilal@platform-accounts.test');
    pharmacies.first = first.pharmacyId;
    pharmacies.second = second.pharmacyId;
    pharmacyAdmin = first.client;
    for (const id of Object.values(pharmacies)) await admin.post(`/api/v1/platform/pharmacies/${id}/subscription`, { planKey: 'monthly' });

    const role = (await admin.post('/api/v1/platform/team/roles', { name: 'Books only', permissions: ['platform.finance.view'] }, 201)).data;
    await admin.post('/api/v1/platform/team', { fullName: 'Fiza Finance', email: 'fiza@ksf.test', roleId: role.id, password: TEST_PASSWORD }, 201);
    viewer = new Client(server.base);
    await viewer.signIn('fiza@ksf.test', TEST_PASSWORD);
  });
  after(async () => { await server?.stop(); });

  it('takes the same slip number for two pharmacies, but never twice for one', async () => {
    const body = { amountPaisa: 390_000, method: 'cash', reference: '123456789' };
    state.payment = (await admin.post(`/api/v1/platform/pharmacies/${pharmacies.first}/payments`, body, 201)).data;
    await admin.post(`/api/v1/platform/pharmacies/${pharmacies.second}/payments`, body, 201);
    const again = await admin.call('POST', `/api/v1/platform/pharmacies/${pharmacies.first}/payments`, body);
    assert.equal(again.status, 400);
    assert.equal(again.body.field, 'reference');
    assert.match(again.body.message, /already has Rs 3,900 recorded on \d{4}-\d{2}-\d{2} under reference 123456789/);
  });

  it('refuses an entry that is not income or an expense of a known kind', async () => {
    const entry = { kind: 'expense', category: 'Servers and hosting', description: 'Hosting', amountPaisa: 100 };
    await admin.post('/api/v1/platform/accounts/entries', { ...entry, kind: 'gift' }, 400);
    await admin.post('/api/v1/platform/accounts/entries', { ...entry, kind: 'income' }, 400);
    await admin.post('/api/v1/platform/accounts/entries', { ...entry, entryDate: tomorrow }, 400);
    await admin.post('/api/v1/platform/accounts/entries', { ...entry, amountPaisa: -5 }, 400);
    await admin.post('/api/v1/platform/accounts/entries', { ...entry, description: '' }, 400);
  });

  it('adds up subscriptions, refunds, other income and costs to the rupee', async () => {
    await admin.post('/api/v1/auth/verify-identity', { password: SUPER_ADMIN.password });
    const refund = await admin.post(`/api/v1/platform/payments/${state.payment.id}/refund`, { amountPaisa: 90_000, reason: 'Paid for a branch they closed' });
    await admin.post(`/api/v1/platform/refunds/${refund.refundId}/complete`, { reference: 'CASH-BACK-1' });

    await admin.post('/api/v1/platform/accounts/entries', {
      kind: 'income', category: 'Setup and training fees', description: 'Staff training at a new pharmacy', amountPaisa: 20_000, party: 'Amna Pharmacy'
    }, 201);
    const server = await admin.post('/api/v1/platform/accounts/entries', {
      kind: 'expense', category: 'Servers and hosting', description: 'Vercel and Atlas', amountPaisa: 40_000, paymentMethod: 'card'
    }, 201);
    assert.equal(server.data.created_by_name, (await admin.get('/api/v1/auth/session')).user.fullName);
    state.server = server.data.id;
    const edited = await admin.patch(`/api/v1/platform/accounts/entries/${state.server}`, { amountPaisa: 50_000 });
    assert.equal(edited.data.amount_paisa, 50_000);
    assert.equal(edited.data.description, 'Vercel and Atlas');
    await admin.post('/api/v1/platform/accounts/entries', {
      kind: 'expense', category: 'Team salaries', description: 'October salary', amountPaisa: 100_000, party: 'Fiza Finance'
    }, 201);

    const { profitAndLoss: pnl, position, trend } = await admin.get('/api/v1/platform/accounts/summary');
    assert.equal(pnl.income.subscriptionsPaisa, 780_000);
    assert.equal(pnl.income.payments, 2);
    assert.equal(pnl.income.refundsPaisa, 90_000);
    assert.equal(pnl.income.otherIncomePaisa, 20_000);
    assert.equal(pnl.income.totalPaisa, 710_000);
    assert.deepEqual(pnl.costs.expenses.map((row) => [row.category, row.amount]), [['Team salaries', 100_000], ['Servers and hosting', 50_000]]);
    assert.equal(pnl.costs.totalPaisa, 150_000);
    assert.equal(pnl.netProfitPaisa, 560_000);
    assert.equal(position.payingPharmacies, 2);
    assert.equal(trend.length, 12);
    assert.equal(trend.at(-1).profit, 560_000);
  });

  it('lists every movement in one ledger, filtered by direction and search', async () => {
    const all = await admin.get('/api/v1/platform/accounts/transactions');
    assert.equal(all.total, 6);
    assert.deepEqual(all.totals, { inPaisa: 800_000, outPaisa: 240_000, netPaisa: 560_000 });
    const out = await admin.get('/api/v1/platform/accounts/transactions?direction=out');
    assert.deepEqual(out.data.map((row) => row.source).sort(), ['expense', 'expense', 'refund']);
    const found = await admin.get('/api/v1/platform/accounts/transactions?q=Vercel');
    assert.equal(found.data[0].description, 'Vercel and Atlas');
    const subscription = all.data.find((row) => row.source === 'subscription');
    assert.match(subscription.reference, /^KSF-INV-/);

    const expenses = await admin.get('/api/v1/platform/accounts/entries?kind=expense');
    assert.equal(expenses.total, 2);
    assert.equal(expenses.summary.expensesPaisa, 150_000);
    assert.ok(expenses.team.includes('Fiza Finance'));
    assert.ok(expenses.categories.expense.includes('Team salaries'));
  });

  it('downloads the statement, the ledger and the entries', async () => {
    const pnl = await admin.get('/api/v1/platform/accounts/export?kind=profit-and-loss');
    assert.equal(pnl.data.find((row) => row.Line === 'Total income')['Amount (Rs)'], 7100);
    assert.equal(pnl.data.find((row) => row.Line === 'Refunds')['Amount (Rs)'], -900);
    assert.equal((await admin.get('/api/v1/platform/accounts/export?kind=transactions')).data.length, 6);
    assert.equal((await admin.get('/api/v1/platform/accounts/export?kind=entries')).data.length, 3);
    await admin.get('/api/v1/platform/accounts/export?kind=everything', 400);
  });

  it('opens the books to finance roles only, and lets a read-only role read', async () => {
    await pharmacyAdmin.get('/api/v1/platform/accounts/summary', 403);
    await pharmacyAdmin.get('/api/v1/platform/payments/providers', 403);
    await viewer.get('/api/v1/platform/accounts/summary');
    await viewer.get('/api/v1/platform/accounts/transactions');
    await viewer.post('/api/v1/platform/accounts/entries', { kind: 'expense', category: 'Travel', description: 'Taxi', amountPaisa: 500 }, 403);
    await viewer.delete(`/api/v1/platform/accounts/entries/${state.server}`, {}, 403);
  });

  it('deletes an entry, which leaves the books and the activity log keeps', async () => {
    await admin.delete(`/api/v1/platform/accounts/entries/${state.server}`);
    await admin.delete(`/api/v1/platform/accounts/entries/${state.server}`, {}, 404);
    assert.equal((await admin.get('/api/v1/platform/accounts/summary')).profitAndLoss.costs.totalPaisa, 100_000);
    const log = await admin.get('/api/v1/platform/activity');
    assert.ok(log.data.some((row) => row.action === 'platform.expense-deleted'));
  });

  it('says which ways to pay are on, what each still needs, and where its webhook goes', async () => {
    const reply = await admin.get('/api/v1/platform/payments/providers');
    const stripe = reply.data.find((row) => row.key === 'stripe');
    assert.equal(stripe.configured, false);
    assert.deepEqual(stripe.missing, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
    assert.match(stripe.webhookUrl, /\/api\/v1\/payments\/webhook\/stripe$/);
    const bank = reply.data.find((row) => row.key === 'bank-transfer');
    assert.equal(bank.webhookUrl, null);
    for (const row of reply.data) assert.equal(row.configured, row.missing.length === 0);
    /* Names only: no setting's value is ever in the reply. */
    assert.doesNotMatch(JSON.stringify(reply), /sk_(test|live)_|whsec_/);
  });
});
