/* The cash book: money that arrives after the sale, and the count at the end
   of the day.

   A credit sale (udhaar) puts the amount on the customer's account, and the
   repayment is cash in the drawer today against an invoice from last week —
   which is why the drawer never balances against "today's sales" alone. So
   the day close works from money, not from invoices:

     opening float
       + cash taken at the till
       + cash taken against old accounts
       − cash refunded to customers
       − cash spent out of the drawer
       = what should be in the drawer

   The difference from the count is recorded, never hidden and never quietly
   corrected: a second count supersedes the first, and both stay on record.
   Card, wallet and bank totals are reported for checking against the
   provider's statement — this system cannot see whether money arrived. */

import type { Document, Filter } from 'mongodb';
import { col, s, tx } from '../db/mongo.js';
import type { CustomerPayment, DayClosing } from '../db/types.js';
import { bad, conflict, missing } from '../core/errors.js';
import { logActivity, nextNumber, notify } from '../core/trails.js';
import { nowIso, today, toInt, toStr, uid } from '../core/util.js';
import { lookupField } from '../db/pipeline.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { pageResult, paging } from './shared.js';

const rupees = (paisa: number): string => (paisa / 100).toLocaleString('en-PK');

/* Methods a repayment can arrive by. 'credit' is absent on purpose: paying
   off an account with more credit is not a payment. */
const METHODS = ['cash', 'card', 'easypaisa', 'jazzcash', 'bank-transfer'];

/* =========================== UDHAAR REPAYMENTS =========================== */

route('POST', '/api/v1/customers/:id/payments', 'pos.operate', async (ctx) => {
  const customer = await col.customers().findOne({ _id: toStr(ctx.params.id, 40), pharmacy_id: ctx.pharmacyId });
  if (!customer) return missing('That customer record could not be found.');

  const amount = toInt(ctx.body.amountPaisa, 0);
  if (amount <= 0) bad('Enter how much the customer has paid.', 'amountPaisa');
  if (customer.balance_paisa <= 0) bad(`${customer.name} does not owe anything at the moment.`, 'amountPaisa');
  /* Overpaying would turn the balance negative and read as credit the
     pharmacy owes back, which nothing else understands. */
  if (amount > customer.balance_paisa) {
    bad(`${customer.name} owes Rs ${rupees(customer.balance_paisa)}. Take that much, or record the extra separately.`, 'amountPaisa');
  }
  const method = toStr(ctx.body.paymentMethod, 20) || 'cash';
  if (!METHODS.includes(method)) bad('Choose how the money was received.', 'paymentMethod');

  const saleId = toStr(ctx.body.saleId, 40) || null;
  if (saleId && !await col.sales().findOne({ _id: saleId, pharmacy_id: ctx.pharmacyId, customer_id: customer.id }, { projection: { _id: 1 } })) {
    bad('That invoice does not belong to this customer.', 'saleId');
  }

  const id = uid('CPY');
  const at = nowIso();
  const receiptNo = await nextNumber(ctx.pharmacyId, 'receipt', 'KSF-RC');
  const payment = await tx(async () => {
    /* Conditional, like every balance change: another till may have taken a
       payment from the same customer while this one was being typed. */
    const before = await col.customers().findOneAndUpdate(
      { _id: customer.id, balance_paisa: { $gte: amount } },
      { $inc: { balance_paisa: -amount }, $set: { updated_at: at } },
      { returnDocument: 'before', ...s() }
    );
    if (!before) {
      const now = await col.customers().findOne({ _id: customer.id }, { projection: { balance_paisa: 1 }, ...s() });
      conflict(`${customer.name}'s balance changed while this was being entered — it is now Rs ${rupees(now?.balance_paisa ?? 0)}. `
        + 'Nothing has been recorded; check it and enter the payment again.');
    }
    const row: CustomerPayment = {
      _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: ctx.user.branch_id, customer_id: customer.id, sale_id: saleId,
      receipt_no: receiptNo, amount_paisa: amount, payment_method: method, reference: toStr(ctx.body.reference, 80) || null,
      note: toStr(ctx.body.note, 200) || null, balance_before_paisa: before!.balance_paisa, balance_after_paisa: before!.balance_paisa - amount,
      received_by: ctx.user.id, received_by_name: ctx.user.full_name, received_at: at, reversed_at: null, reversed_by: null,
      reversal_reason: null, created_at: at
    };
    await col.customerPayments().insertOne(row, s());
    return row;
  });

  await logActivity(ctx, {
    action: 'customer.payment-received', entity: 'customer', entityId: customer.id,
    summary: `Rs ${rupees(amount)} received from ${customer.name} by ${method} (receipt ${receiptNo})`,
    meta: { receiptNo, amountPaisa: amount, method, saleId }
  });
  const fresh = await col.customers().findOne({ _id: customer.id }, { projection: { name: 1, balance_paisa: 1, loyalty_points: 1 } });
  return { data: payment, customer: fresh ? { ...fresh, id: fresh._id } : null, receiptNo, __status: 201 };
});

/**
 * Undo a repayment entered wrongly. The receipt is marked reversed, not
 * deleted, and the balance goes back up — so the paper the customer holds
 * still explains itself. Needs the same right as refunding a sale.
 */
route('POST', '/api/v1/customer-payments/:id/reverse', 'sales.refund', async (ctx) => {
  const payment = await col.customerPayments().findOne({ _id: toStr(ctx.params.id, 40), pharmacy_id: ctx.pharmacyId });
  if (!payment) return missing('That receipt could not be found.');
  if (payment.reversed_at) bad('That receipt has already been reversed.');
  const reason = toStr(ctx.body.reason, 200);
  if (!reason) bad('A reason is required to reverse a receipt.', 'reason');

  const at = nowIso();
  await tx(async () => {
    const marked = await col.customerPayments().updateOne(
      { _id: payment.id, reversed_at: null },
      { $set: { reversed_at: at, reversed_by: ctx.user.id, reversal_reason: reason } }, s()
    );
    /* If another manager reversed it at the same moment, the balance must not
       be credited twice. */
    if (marked.modifiedCount !== 1) conflict('That receipt has just been reversed by someone else.');
    await col.customers().updateOne({ _id: payment.customer_id }, { $inc: { balance_paisa: payment.amount_paisa }, $set: { updated_at: at } }, s());
  });

  await logActivity(ctx, {
    action: 'customer.payment-reversed', entity: 'customer', entityId: payment.customer_id, severity: 'warn',
    summary: `Receipt ${payment.receipt_no} (Rs ${rupees(payment.amount_paisa)}) reversed — ${reason}`
  });
  const fresh = await col.customers().findOne({ _id: payment.customer_id }, { projection: { name: 1, balance_paisa: 1 } });
  return { ok: true, customer: fresh ? { ...fresh, id: fresh._id } : null, message: 'The receipt is marked reversed and the amount is back on the account.' };
});

/* The receipt ledger, filtered by customer, by date, or neither. */
route('GET', '/api/v1/customer-payments', 'customers.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const match: Filter<CustomerPayment> = { pharmacy_id: ctx.pharmacyId };
  const customerId = toStr(ctx.query.get('customer'), 40);
  if (customerId) match.customer_id = customerId;
  const from = toStr(ctx.query.get('from'), 10);
  const to = toStr(ctx.query.get('to'), 10);
  if (from || to) match.received_at = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: `${to}T23:59:59.999Z` } : {}) };

  const [rows, total, [totals]] = await Promise.all([
    col.customerPayments().aggregate([
      { $match: match },
      { $sort: { received_at: -1 } },
      { $skip: skip },
      { $limit: size },
      { $lookup: { from: 'customers', localField: 'customer_id', foreignField: '_id', as: '__c', pipeline: [{ $project: { name: 1, phone: 1 } }] } },
      { $set: { customer_name: { $first: '$__c.name' }, customer_phone: { $first: '$__c.phone' } } },
      ...lookupField('sales', 'sale_id', 'invoice_no', 'invoice_no'),
      { $unset: '__c' }
    ]).toArray(),
    col.customerPayments().countDocuments(match),
    col.customerPayments().aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          received: { $sum: { $cond: [{ $eq: ['$reversed_at', null] }, '$amount_paisa', 0] } },
          reversed: { $sum: { $cond: [{ $ne: ['$reversed_at', null] }, '$amount_paisa', 0] } }
        }
      },
      { $project: { _id: 0 } }
    ]).toArray()
  ]);
  return { ...pageResult(rows, total, { page, size }), totals: totals ?? { received: 0, reversed: 0 } };
});

/* ============================== DAY CLOSING ============================== */

/** The branch the person works at. A pharmacy with no branches closes once. */
const branchOf = (ctx: PharmacyCtx): string | null => ctx.user.branch_id ?? null;

const onDay = (field: string, day: string): Document => ({ [field]: { $gte: day, $lt: `${day}T99` } });

/**
 * What the drawer should hold, from the money that moved. Nothing is stored
 * here and nothing returned came from the caller beyond the date and float.
 */
async function dayFigures(ctx: PharmacyCtx, businessDate: string, openingFloatPaisa: unknown) {
  const branchId = branchOf(ctx);
  const scope: Document = { pharmacy_id: ctx.pharmacyId, branch_id: branchId };

  const [[sales], [refunds], [repayments], [reversals], [expenses]] = await Promise.all([
    col.sales().aggregate([
      { $match: { ...scope, status: { $in: ['completed', 'refunded'] }, ...onDay('sold_at', businessDate) } },
      {
        $group: {
          _id: null, invoices: { $sum: 1 }, total: { $sum: '$total_paisa' },
          cash: { $sum: { $cond: [{ $eq: ['$payment_method', 'cash'] }, { $subtract: ['$paid_paisa', '$change_paisa'] }, 0] } },
          card: { $sum: { $cond: [{ $eq: ['$payment_method', 'card'] }, '$total_paisa', 0] } },
          wallet: { $sum: { $cond: [{ $in: ['$payment_method', ['easypaisa', 'jazzcash']] }, '$total_paisa', 0] } },
          bank: { $sum: { $cond: [{ $eq: ['$payment_method', 'bank-transfer'] }, '$total_paisa', 0] } },
          credit: { $sum: { $cond: [{ $eq: ['$payment_method', 'credit'] }, '$total_paisa', 0] } },
          discount: { $sum: '$discount_paisa' }, gst: { $sum: '$gst_paisa' }
        }
      }
    ]).toArray(),
    /* Cash that went back out today, including for earlier invoices — so this
       is keyed on refunded_at, not sold_at. */
    col.sales().aggregate([
      { $match: { ...scope, status: 'refunded', ...onDay('refunded_at', businessDate) } },
      { $group: { _id: null, total: { $sum: '$total_paisa' }, cash: { $sum: { $cond: [{ $eq: ['$payment_method', 'cash'] }, '$total_paisa', 0] } } } }
    ]).toArray(),
    col.customerPayments().aggregate([
      { $match: { ...scope, reversed_at: null, ...onDay('received_at', businessDate) } },
      { $group: { _id: null, total: { $sum: '$amount_paisa' }, cash: { $sum: { $cond: [{ $eq: ['$payment_method', 'cash'] }, '$amount_paisa', 0] } }, receipts: { $sum: 1 } } }
    ]).toArray(),
    /* Reversed receipts are reported, not subtracted: a reversal corrects a
       receipt that was entered wrongly, and the receipt itself is already
       left out of the repayments above — no cash moved either way. */
    col.customerPayments().aggregate([
      { $match: { ...scope, reversed_at: { $ne: null }, ...onDay('reversed_at', businessDate) } },
      { $group: { _id: null, cash: { $sum: { $cond: [{ $eq: ['$payment_method', 'cash'] }, '$amount_paisa', 0] } } } }
    ]).toArray(),
    col.expenses().aggregate([
      { $match: { ...scope, expense_date: businessDate, status: { $ne: 'rejected' } } },
      { $group: { _id: null, total: { $sum: '$amount_paisa' }, cash: { $sum: { $cond: [{ $eq: ['$payment_method', 'cash'] }, '$amount_paisa', 0] } }, entries: { $sum: 1 } } }
    ]).toArray()
  ]);

  const n = (row: Document | undefined, key: string): number => Number(row?.[key] ?? 0);
  const float = Math.max(0, toInt(openingFloatPaisa, 0));
  const cashIn = n(sales, 'cash') + n(repayments, 'cash');
  const cashOut = n(refunds, 'cash') + n(expenses, 'cash');

  return {
    businessDate, branchId, openingFloatPaisa: float, expectedCashPaisa: float + cashIn - cashOut,
    cash: {
      salesPaisa: n(sales, 'cash'), repaymentsPaisa: n(repayments, 'cash'), refundsPaisa: n(refunds, 'cash'),
      reversalsPaisa: n(reversals, 'cash'), expensesPaisa: n(expenses, 'cash')
    },
    nonCash: {
      cardPaisa: n(sales, 'card'), walletPaisa: n(sales, 'wallet'), bankPaisa: n(sales, 'bank'), creditPaisa: n(sales, 'credit'),
      note: 'Check these against the provider or bank statement. The system records what was entered at the till, not what reached the account.'
    },
    sales: { invoices: n(sales, 'invoices'), totalPaisa: n(sales, 'total'), discountPaisa: n(sales, 'discount'), gstPaisa: n(sales, 'gst') },
    refundsPaisa: n(refunds, 'total'),
    repaymentsPaisa: n(repayments, 'total'),
    repaymentReceipts: n(repayments, 'receipts'),
    expensesPaisa: n(expenses, 'total'),
    expenseEntries: n(expenses, 'entries')
  };
}

/** The closings recorded for a date and branch, newest attempt first. */
const closingsFor = (ctx: PharmacyCtx, businessDate: string) =>
  col.dayClosings().find({ pharmacy_id: ctx.pharmacyId, branch_id: branchOf(ctx), business_date: businessDate }).sort({ attempt_no: -1 }).toArray();

const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/* What the drawer should hold right now, before anybody counts it. */
route('GET', '/api/v1/day-close/preview', 'day-close.manage', async (ctx) => {
  const businessDate = toStr(ctx.query.get('date'), 10) || today();
  if (!validDate(businessDate)) bad('Ask for a date as YYYY-MM-DD.', 'date');
  if (businessDate > today()) bad('That day has not happened yet.', 'date');
  const [figures, existing] = await Promise.all([
    dayFigures(ctx, businessDate, ctx.query.get('float')),
    closingsFor(ctx, businessDate)
  ]);
  return {
    data: figures, closings: existing, closed: existing.some((row) => !row.superseded_at),
    hint: 'Count the drawer, then record what is actually in it. The difference is kept, not corrected.'
  };
});

route('GET', '/api/v1/day-close', 'day-close.manage', async (ctx) => {
  const { page, size, skip } = paging(ctx, 30);
  const [rows, total, [variance]] = await Promise.all([
    col.dayClosings().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId } },
      { $sort: { business_date: -1, attempt_no: -1 } },
      { $skip: skip },
      { $limit: size },
      ...lookupField('branches', 'branch_id', 'name', 'branch_name'),
      { $project: { breakdown: 0 } }
    ]).toArray(),
    col.dayClosings().countDocuments({ pharmacy_id: ctx.pharmacyId }),
    col.dayClosings().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, superseded_at: null } },
      {
        $group: {
          _id: null, net: { $sum: '$variance_paisa' },
          shortfalls: { $sum: { $cond: [{ $lt: ['$variance_paisa', 0] }, '$variance_paisa', 0] } }, closings: { $sum: 1 }
        }
      },
      { $project: { _id: 0 } }
    ]).toArray()
  ]);
  return { ...pageResult(rows, total, { page, size }), variance: variance ?? { net: 0, shortfalls: 0, closings: 0 } };
});

/**
 * Record the count. The expected figure is recomputed from the database; the
 * request supplies the float and what was counted, nothing else. A second
 * count for the same day supersedes the first, and both rows stay.
 */
route('POST', '/api/v1/day-close', 'day-close.manage', async (ctx) => {
  const businessDate = toStr(ctx.body.businessDate, 10) || today();
  if (!validDate(businessDate)) bad('Give the date as YYYY-MM-DD.', 'businessDate');
  if (businessDate > today()) bad('That day has not happened yet.', 'businessDate');
  const counted = toInt(ctx.body.countedCashPaisa, -1);
  if (counted < 0) bad('Enter the amount counted in the drawer.', 'countedCashPaisa');

  const existing = await closingsFor(ctx, businessDate);
  const open = existing.find((row) => !row.superseded_at);
  const amendReason = toStr(ctx.body.amendReason, 200);
  if (open && !amendReason) {
    bad(`${businessDate} has already been closed (counted Rs ${rupees(open.counted_cash_paisa)}). To record a corrected count, say why.`, 'amendReason');
  }

  const figures = await dayFigures(ctx, businessDate, ctx.body.openingFloatPaisa);
  const variance = counted - figures.expectedCashPaisa;
  const note = toStr(ctx.body.note, 500);
  /* A drawer that does not balance needs an explanation, whichever way it is
     out. Fifty rupees is small change, not a policy on theft. */
  if (Math.abs(variance) > 5000 && !note) {
    bad(`The drawer is ${variance < 0 ? 'short' : 'over'} by Rs ${rupees(Math.abs(variance))}. Write down what happened before closing.`, 'note');
  }

  const id = uid('DAY');
  const at = nowIso();
  const closing: DayClosing = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: figures.branchId, business_date: businessDate,
    opening_float_paisa: figures.openingFloatPaisa, expected_cash_paisa: figures.expectedCashPaisa, counted_cash_paisa: counted,
    variance_paisa: variance, cash_sales_paisa: figures.cash.salesPaisa, card_sales_paisa: figures.nonCash.cardPaisa,
    wallet_sales_paisa: figures.nonCash.walletPaisa, bank_sales_paisa: figures.nonCash.bankPaisa, credit_sales_paisa: figures.nonCash.creditPaisa,
    repayments_paisa: figures.repaymentsPaisa, cash_repayments_paisa: figures.cash.repaymentsPaisa, refunds_paisa: figures.refundsPaisa,
    cash_refunds_paisa: figures.cash.refundsPaisa, cash_expenses_paisa: figures.cash.expensesPaisa, invoice_count: figures.sales.invoices,
    breakdown: figures, note: open ? `${amendReason}${note ? ` — ${note}` : ''}` : note || null,
    closed_by: ctx.user.id, closed_by_name: ctx.user.full_name, closed_at: at,
    attempt_no: (existing[0]?.attempt_no ?? 0) + 1, superseded_at: null, created_at: at
  };
  await tx(async () => {
    if (open) {
      const superseded = await col.dayClosings().updateOne({ _id: open.id, superseded_at: null }, { $set: { superseded_at: at } }, s());
      if (!superseded.modifiedCount) conflict('Somebody else recorded a count for this day a moment ago. Refresh and check it.');
    }
    await col.dayClosings().insertOne(closing, s());
  });

  await logActivity(ctx, {
    action: open ? 'day.reclosed' : 'day.closed', entity: 'day-closing', entityId: id, severity: variance === 0 ? 'info' : 'warn',
    summary: `${businessDate} closed — expected Rs ${rupees(figures.expectedCashPaisa)}, counted Rs ${rupees(counted)}`
      + (variance === 0 ? ' (balanced)' : `, ${variance < 0 ? 'short' : 'over'} by Rs ${rupees(Math.abs(variance))}`),
    meta: { businessDate, expectedPaisa: figures.expectedCashPaisa, countedPaisa: counted, variancePaisa: variance, attemptNo: closing.attempt_no }
  });
  /* More than a hundred rupees out is something the Admin should see without
     having to look for it. */
  if (Math.abs(variance) > 10_000) {
    await notify(ctx.pharmacyId, {
      type: 'finance', severity: variance < 0 ? 'danger' : 'warn', title: `Drawer ${variance < 0 ? 'short' : 'over'} on ${businessDate}`,
      body: `Rs ${rupees(Math.abs(variance))} against an expected Rs ${rupees(figures.expectedCashPaisa)}. Closed by ${ctx.user.full_name}.`, link: '/day-close'
    });
  }
  return {
    data: closing, figures, variancePaisa: variance, amended: !!open,
    message: variance === 0 ? 'The drawer balances. The day is closed.'
      : `Closed with a ${variance < 0 ? 'shortfall' : 'surplus'} of Rs ${rupees(Math.abs(variance))} on the record.`,
    __status: 201
  };
});

route('GET', '/api/v1/day-close/:id', 'day-close.manage', async (ctx) => {
  const [row] = await col.dayClosings().aggregate([
    { $match: { _id: toStr(ctx.params.id, 40), pharmacy_id: ctx.pharmacyId } },
    ...lookupField('branches', 'branch_id', 'name', 'branch_name')
  ]).toArray();
  if (!row) return missing('That closing could not be found.');
  return { data: row };
});
