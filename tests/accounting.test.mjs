/* The accounts, over real HTTP against a real MongoDB.

   One pharmacy buys stock and pays for it, sells, pays rent and wages and
   receives a supplier's bonus; the accounts must add up to the rupee, refuse
   a month's salary paid twice, keep their downloads to plans that include
   them, and show nothing of one pharmacy to another. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, addStaff, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe('accounts', { skip }, () => {
  let server;
  let owner;
  let pharmacyId;
  let cashier;
  let manager;
  const state = {};

  before(async () => {
    server = await startServer();
    ({ client: owner, pharmacyId } = await registerPharmacy(server.base, 'Hina', 'hina@accounts.test'));
    cashier = await addStaff(server.base, owner, { name: 'Usman Cashier', email: 'usman@accounts.test', roleKey: 'cashier' });
    manager = await addStaff(server.base, owner, { name: 'Sara Regional', email: 'sara@accounts.test', roleKey: 'regional-manager' });
  });
  after(async () => { await server?.stop(); });

  it('records a supplier payment in the ledger when stock is received and paid for', async () => {
    const medicine = (await owner.post('/api/v1/medicines', { name: 'Brufen 400mg', pricePaisa: 3500, costPaisa: 2800 }, 201)).data.id;
    const supplier = (await owner.post('/api/v1/suppliers', { name: 'Premier Distributors' }, 201)).data.id;
    await owner.post('/api/v1/purchases', {
      supplierId: supplier, receiveNow: true, markPaid: true, paymentMethod: 'bank-transfer', paymentReference: 'IBFT-77',
      items: [{ medicineId: medicine, quantity: 100, costPaisa: 2800, pricePaisa: 3500, batchNo: 'BR-1', expiryDate: '2031-01-31' }]
    }, 201);
    await owner.post('/api/v1/sales', { items: [{ medicineId: medicine, quantity: 10 }], paymentMethod: 'cash', paidPaisa: 35_000 }, 201);
  });

  it('keeps other income with a category, a date and a method', async () => {
    await owner.post('/api/v1/accounting/income', { category: 'Not a category', description: 'x', amountPaisa: 100 }, 400);
    await owner.post('/api/v1/accounting/income', { category: 'Other income', description: 'Tomorrow', amountPaisa: 100, receivedOn: tomorrow }, 400);
    await owner.post('/api/v1/accounting/income', { category: 'Other income', description: 'Minus', amountPaisa: -5 }, 400);
    const created = await owner.post('/api/v1/accounting/income', {
      category: 'Supplier bonus or rebate', description: 'Quarterly volume bonus', amountPaisa: 10_000, payer: 'Premier Distributors', paymentMethod: 'cheque'
    }, 201);
    state.income = created.data.id;
    assert.equal(created.data.created_by_name, 'Hina Test');
    const edited = await owner.patch(`/api/v1/accounting/income/${state.income}`, { amountPaisa: 15_000 });
    assert.equal(edited.data.amount_paisa, 15_000);
    assert.equal(edited.data.description, 'Quarterly volume bonus');
    const list = await owner.get('/api/v1/accounting/income');
    assert.equal(list.summary.totalPaisa, 15_000);
    assert.ok(list.categories.includes('Shelf and display rent'));
  });

  it('pays a salary once a month, and takes advances and bonuses as what they are', async () => {
    const payees = await owner.get('/api/v1/accounting/salaries/payees');
    assert.ok(payees.data.some((row) => row.id === cashier.id && row.role === 'Cashier'));
    const salary = await owner.post('/api/v1/accounting/salaries', {
      staffId: cashier.id, period: month, basicPaisa: 100_000, allowancesPaisa: 10_000, deductionsPaisa: 5_000
    }, 201);
    assert.equal(salary.data.net_paisa, 105_000);
    assert.equal(salary.data.staff_name, 'Usman Cashier');
    const twice = await owner.call('POST', '/api/v1/accounting/salaries', { staffId: cashier.id, period: month, basicPaisa: 100_000 });
    assert.equal(twice.status, 409);
    state.advance = (await owner.post('/api/v1/accounting/salaries', { staffId: cashier.id, kind: 'advance', period: month, basicPaisa: 20_000 }, 201)).data.id;
    await owner.post('/api/v1/accounting/salaries', { staffName: 'Rafiq (cleaner)', period: month, basicPaisa: 0, deductionsPaisa: 10 }, 400);
    await owner.post('/api/v1/accounting/salaries', { staffName: 'Rafiq (cleaner)', period: '2026-13', basicPaisa: 5_000 }, 400);
    await owner.post('/api/v1/accounting/salaries', { staffId: 'USR-NOT-MINE', period: month, basicPaisa: 5_000 }, 400);
    const list = await owner.get(`/api/v1/accounting/salaries?period=${month}`);
    assert.equal(list.summary.totalPaisa, 125_000);
    assert.equal(list.summary.people, 1);
  });

  it('adds up profit and loss, and cash in and out, to the rupee', async () => {
    await owner.post('/api/v1/expenses', { category: 'Rent', description: 'Shop rent', amountPaisa: 50_000 }, 201);
    await owner.post('/api/v1/expenses', { category: 'Salaries', description: 'Wages typed as an expense', amountPaisa: 20_000 }, 201);

    const { profitAndLoss: pnl, cashFlow: cash, position, trend, range } = await owner.get('/api/v1/accounting/summary');
    assert.equal(range.to, today);
    assert.equal(pnl.income.salesPaisa, 35_000);
    assert.equal(pnl.income.otherIncomePaisa, 15_000);
    assert.equal(pnl.income.totalPaisa, 50_000);
    assert.equal(pnl.costOfSalesPaisa, 28_000);
    assert.equal(pnl.grossProfitPaisa, 22_000);
    assert.equal(pnl.costs.salariesPaisa, 145_000);
    assert.equal(pnl.costs.salaries.recordedAsExpensesPaisa, 20_000);
    assert.equal(pnl.costs.operatingPaisa, 50_000);
    assert.equal(pnl.netProfitPaisa, 22_000 - 145_000 - 50_000);

    assert.equal(cash.in.salesPaisa, 35_000);
    assert.equal(cash.in.totalPaisa, 50_000);
    assert.equal(cash.out.suppliersPaisa, 280_000);
    assert.equal(cash.out.totalPaisa, 280_000 + 145_000 + 50_000);
    assert.equal(cash.netPaisa, 50_000 - 475_000);

    assert.equal(position.stockAtCostPaisa, 90 * 2800);
    assert.equal(position.payablePaisa, 0);
    assert.equal(trend.length, 12);
    assert.equal(trend.at(-1).period, month);
    assert.equal(trend.at(-1).profit, pnl.netProfitPaisa + pnl.costs.writeOffsPaisa);
  });

  it('lists every movement in one ledger, filtered by direction', async () => {
    const all = await owner.get('/api/v1/accounting/transactions');
    assert.deepEqual([...new Set(all.data.map((row) => row.source))].sort(), ['expense', 'income', 'salary', 'sales', 'supplier']);
    assert.equal(all.totals.inPaisa, 50_000);
    assert.equal(all.totals.outPaisa, 475_000);
    const supplier = all.data.find((row) => row.source === 'supplier');
    assert.match(supplier.description, /Premier Distributors/);
    assert.equal(supplier.reference, 'IBFT-77');
    const out = await owner.get('/api/v1/accounting/transactions?direction=out&q=rent');
    assert.equal(out.total, 1);
  });

  it('keeps the downloads to plans that include exports', async () => {
    const locked = await owner.call('GET', '/api/v1/accounting/export?kind=profit-and-loss');
    assert.equal(locked.status, 402);
    assert.equal(locked.body.code, 'feature_locked');
    assert.ok(locked.body.plans.some((plan) => plan.key === 'monthly'));

    const admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    await admin.post(`/api/v1/platform/pharmacies/${pharmacyId}/subscription`, { planKey: 'monthly' });
    const pnl = await owner.get('/api/v1/accounting/export?kind=profit-and-loss');
    assert.equal(pnl.data.find((row) => row.Section === 'Net profit')['Amount (Rs)'], -1730);
    const salaries = await owner.get('/api/v1/accounting/export?kind=salaries');
    assert.equal(salaries.data.length, 2);
    await owner.get('/api/v1/accounting/export?kind=nonsense', 400);
  });

  it('opens the accounts only to roles that hold them', async () => {
    await cashier.client.get('/api/v1/accounting/summary', 403);
    await cashier.client.post('/api/v1/accounting/income', { category: 'Other income', description: 'x', amountPaisa: 1 }, 403);
    await manager.client.get('/api/v1/accounting/summary');
    await manager.client.post('/api/v1/accounting/income', { category: 'Other income', description: 'x', amountPaisa: 1 }, 403);
  });

  it('shows one pharmacy nothing of another', async () => {
    const { client: other } = await registerPharmacy(server.base, 'Zara', 'zara@accounts.test');
    await other.patch(`/api/v1/accounting/income/${state.income}`, { amountPaisa: 1 }, 404);
    await other.delete(`/api/v1/accounting/salaries/${state.advance}`, {}, 404);
    const summary = await other.get('/api/v1/accounting/summary');
    assert.equal(summary.profitAndLoss.income.totalPaisa, 0);
    assert.equal((await other.get('/api/v1/accounting/transactions')).total, 0);
  });

  it('deletes a payment and writes it into the audit trail', async () => {
    await owner.delete(`/api/v1/accounting/salaries/${state.advance}`);
    const audit = await owner.get('/api/v1/account/audit');
    assert.ok(audit.data.some((row) => row.action === 'salary.deleted'));
    assert.equal((await owner.get(`/api/v1/accounting/salaries?period=${month}`)).summary.totalPaisa, 105_000);
  });
});
