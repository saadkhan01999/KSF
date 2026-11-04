/* GST and loans (udhaar) at the till, over real HTTP against a real MongoDB.

   GST is the cashier's choice on each sale (off unless Settings › Till
   turns it on by default). When it is added, a medicine's own rate wins and
   every other line takes the pharmacy's default rate, on what the customer
   pays after the discount — the figure the till showed, or the sale is
   refused rather than charged differently.

   A loan needs a customer. They may pay part of it at the till: that part
   is a cash repayment the day close counts, only the rest goes on their
   account (and against their credit limit), and a refund hands the cash
   part back. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;

describe('GST and loans at the till', { skip }, () => {
  let server;
  let owner;
  const ids = {};
  const sell = (body, status = 201) => owner.post('/api/v1/sales', body, status);
  const onHand = async (id) => (await owner.get('/api/v1/inventory')).data.find((row) => row.id === id).on_hand;
  const preview = async () => (await owner.get('/api/v1/day-close/preview?float=0')).data;
  const pharmacyRate = (gstPercent, extra = {}) => owner.patch('/api/v1/settings', { pharmacy: { name: 'Hina Pharmacy', gstPercent, ...extra } });

  before(async () => {
    server = await startServer();
    ({ client: owner } = await registerPharmacy(server.base, 'Hina', 'hina@gst-loan.test'));
    ids.panadol = (await owner.post('/api/v1/medicines', { name: 'Panadol 500mg', pricePaisa: 3_500, costPaisa: 2_800 }, 201)).data.id;
    ids.syrup = (await owner.post('/api/v1/medicines', { name: 'Hydryllin Syrup', pricePaisa: 25_000, costPaisa: 20_000, gstPercent: 5 }, 201)).data.id;
    const supplier = (await owner.post('/api/v1/suppliers', { name: 'Premier Sales', phone: '0300 7654321' }, 201)).data.id;
    const order = (await owner.post('/api/v1/purchases', {
      supplierId: supplier, items: [
        { medicineId: ids.panadol, quantity: 200, costPaisa: 2_800, pricePaisa: 3_500, batchNo: 'PN-9', expiryDate: '2030-06-30' },
        { medicineId: ids.syrup, quantity: 50, costPaisa: 20_000, pricePaisa: 25_000, batchNo: 'HY-9', expiryDate: '2030-06-30' }
      ]
    }, 201)).data;
    await owner.post(`/api/v1/purchases/${order.id}/receive`, {});
  });
  after(async () => { await server?.stop(); });

  describe('GST', () => {
    it("gives the till each medicine's own GST rate, so it can show the figure the server charges", async () => {
      const rows = (await owner.get('/api/v1/medicines-lookup?q=Hydryllin')).data;
      assert.equal(rows[0].gst_percent, 5);
    });

    it('adds no GST unless the cashier asks for it', async () => {
      const sale = (await sell({ items: [{ medicineId: ids.panadol, quantity: 2 }], paymentMethod: 'cash' })).data;
      assert.equal(sale.gst_paisa, 0);
      assert.equal(sale.total_paisa, 7_000);
      assert.equal(sale.gst_applied, 0);
    });

    it('refuses to add GST when there is no rate to charge', async () => {
      await pharmacyRate(0);
      const refused = await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'cash', applyGst: true }, 400);
      assert.equal(refused.field, 'applyGst');
    });

    it('keeps a rate between 0 and 100%', async () => {
      await pharmacyRate(250);
      assert.equal((await owner.get('/api/v1/settings')).pharmacy.gst_percent, 100);
      await pharmacyRate(-5);
      assert.equal((await owner.get('/api/v1/settings')).pharmacy.gst_percent, 0);
    });

    it("charges the pharmacy's rate and each medicine's own, on the amount after the discount", async () => {
      await pharmacyRate(18, { strn: '32-77-8761-123-45' });
      /* Rs 350 of Panadol and Rs 250 of syrup, Rs 60 off: the discount is
         shared Rs 35 / Rs 25, then 18% on Rs 315 and 5% on Rs 225. */
      const sale = (await sell({
        items: [{ medicineId: ids.panadol, quantity: 10 }, { medicineId: ids.syrup, quantity: 1 }],
        paymentMethod: 'cash', discountPaisa: 6_000, discountReason: 'regular', applyGst: true, expectedTotalPaisa: 60_795
      })).data;
      assert.equal(sale.subtotal_paisa, 60_000);
      assert.equal(sale.discount_paisa, 6_000);
      assert.equal(sale.gst_paisa, 5_670 + 1_125);
      assert.equal(sale.total_paisa, 60_795);
      assert.equal(sale.paid_paisa, 60_795);
      assert.equal(sale.gst_applied, 1);
      assert.equal(sale.gst_rate_percent, null, 'two rates: the receipt says just "GST"');
      assert.deepEqual(sale.items.map((item) => item.gst_paisa).sort((a, b) => a - b), [1_125, 5_670]);
      /* The receipt carries the sales tax registration number. */
      const detail = (await owner.get(`/api/v1/sales/${sale.id}`)).data;
      assert.equal(detail.pharmacy.strn, '32-77-8761-123-45');
      assert.equal(detail.gst_paisa, 6_795);
    });

    it('names the rate when every taxed line shares it', async () => {
      const sale = (await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'cash', applyGst: true })).data;
      assert.equal(sale.gst_paisa, 630);
      assert.equal(sale.gst_rate_percent, 18);
    });

    it('never charges a total the cashier did not see, and sells nothing when it would', async () => {
      const before = await onHand(ids.panadol);
      const refused = await sell({
        items: [{ medicineId: ids.panadol, quantity: 2 }], paymentMethod: 'cash', applyGst: true, expectedTotalPaisa: 7_000
      }, 409);
      assert.equal(refused.code, 'total_changed');
      assert.equal(refused.totals.totalPaisa, 8_260);
      assert.equal(refused.totals.gstPaisa, 1_260);
      assert.equal(await onHand(ids.panadol), before);
    });

    it('follows the till setting when the cashier says nothing, and the cashier can still turn it off', async () => {
      await owner.patch('/api/v1/settings', { settings: { 'pos.gst_default': 'true' } });
      assert.equal((await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'cash' })).data.gst_paisa, 630);
      assert.equal((await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'cash', applyGst: false })).data.gst_paisa, 0);
      await owner.patch('/api/v1/settings', { settings: { 'pos.gst_default': 'false' } });
      assert.equal((await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'cash' })).data.gst_paisa, 0);
    });

    it('takes no payment method the till does not offer', async () => {
      const refused = await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'cheque' }, 400);
      assert.equal(refused.field, 'paymentMethod');
    });
  });

  describe('loans (udhaar)', () => {
    before(async () => {
      ids.imran = (await owner.post('/api/v1/customers', { name: 'Imran Ali', phone: '0301 2345678' }, 201)).data.id;
      ids.sana = (await owner.post('/api/v1/customers', { name: 'Sana Khan', phone: '0302 3456789', creditLimitPaisa: 5_000 }, 201)).data.id;
    });

    it('needs a customer', async () => {
      const refused = await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'credit' }, 400);
      assert.equal(refused.field, 'customerId');
    });

    it('is not a loan when the customer pays it all', async () => {
      const refused = await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'credit', customerId: ids.imran, paidPaisa: 3_500 }, 400);
      assert.equal(refused.field, 'paidPaisa');
      await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'credit', customerId: ids.imran, paidPaisa: -100 }, 400);
    });

    it('puts only what is left on the account, and records what was paid at the till as a repayment', async () => {
      const cashBefore = (await preview()).cash;
      const sale = (await sell({
        items: [{ medicineId: ids.panadol, quantity: 4 }], paymentMethod: 'credit', customerId: ids.imran, paidPaisa: 4_000, expectedTotalPaisa: 14_000
      })).data;
      ids.loanSale = sale.id;
      assert.equal(sale.total_paisa, 14_000);
      assert.equal(sale.paid_now_paisa, 4_000);
      assert.equal(sale.loan_paisa, 10_000);
      assert.equal(sale.balance_after_paisa, 10_000);
      assert.equal(sale.paid_paisa, 0);
      assert.match(sale.loan_receipt_no, /^KSF-RC/);

      const customer = (await owner.get(`/api/v1/customers/${ids.imran}`)).data;
      assert.equal(customer.balance_paisa, 10_000);
      const payment = customer.payments.find((row) => row.sale_id === sale.id);
      assert.equal(payment.amount_paisa, 4_000);
      assert.equal(payment.payment_method, 'cash');
      assert.equal(payment.receipt_no, sale.loan_receipt_no);
      assert.equal(payment.balance_before_paisa, 14_000);
      assert.equal(payment.balance_after_paisa, 10_000);

      /* The day close counts the Rs 40 as cash in the drawer, once. */
      const cashAfter = (await preview()).cash;
      assert.equal(cashAfter.repaymentsPaisa - cashBefore.repaymentsPaisa, 4_000);
      assert.equal(cashAfter.salesPaisa, cashBefore.salesPaisa);
    });

    it('a whole loan, with nothing paid now, goes on the account as before', async () => {
      const sale = (await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'credit', customerId: ids.imran })).data;
      assert.equal(sale.loan_paisa, 3_500);
      assert.equal(sale.paid_now_paisa, 0);
      assert.equal(sale.loan_receipt_no, null);
      assert.equal((await owner.get(`/api/v1/customers/${ids.imran}`)).data.balance_paisa, 13_500);
    });

    it('checks the credit limit against what is left on loan, not the whole bill', async () => {
      /* Rs 70 with Rs 20 paid now: Rs 50 on loan, exactly Sana's limit. */
      const sale = (await sell({ items: [{ medicineId: ids.panadol, quantity: 2 }], paymentMethod: 'credit', customerId: ids.sana, paidPaisa: 2_000 })).data;
      assert.equal(sale.loan_paisa, 5_000);
      const refused = await sell({ items: [{ medicineId: ids.panadol, quantity: 1 }], paymentMethod: 'credit', customerId: ids.sana }, 400);
      assert.match(refused.message, /credit limit/);
    });

    it('hands back the cash part when the loan is refunded, and takes the rest off the account', async () => {
      const before = await preview();
      const refund = await owner.post(`/api/v1/sales/${ids.loanSale}/refund`, { reason: 'Customer returned it unopened' });
      assert.equal(refund.cashBackPaisa, 4_000);
      assert.match(refund.message, /Give back Rs 40/);
      assert.equal(refund.data.refund_cash_paisa, 4_000);
      assert.equal((await owner.get(`/api/v1/customers/${ids.imran}`)).data.balance_paisa, 3_500);
      const after = await preview();
      assert.equal(after.cash.refundsPaisa - before.cash.refundsPaisa, 4_000);
      assert.equal(before.expectedCashPaisa - after.expectedCashPaisa, 4_000);
    });

    it('a refunded loan with nothing paid at the till hands back no cash', async () => {
      const sale = (await sell({ items: [{ medicineId: ids.syrup, quantity: 1 }], paymentMethod: 'credit', customerId: ids.imran })).data;
      const refund = await owner.post(`/api/v1/sales/${sale.id}/refund`, { reason: 'Wrong strength' });
      assert.equal(refund.cashBackPaisa, 0);
      assert.equal((await owner.get(`/api/v1/customers/${ids.imran}`)).data.balance_paisa, 3_500);
    });
  });
});
