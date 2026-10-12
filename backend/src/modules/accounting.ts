/* ==========================================================================
   Accounts
   --------------------------------------------------------------------------
   What the pharmacy earned, what it spent, and what is left:

     Profit and loss   sales (net of GST) and other income, less the cost of
                       the medicines sold, salaries, running expenses and
                       stock written off
     Cash flow         money that actually came in and went out in the
                       period — including payments to suppliers, which buy
                       stock rather than cost money, and udhaar repayments
     Position          what customers owe, what is owed to suppliers, and
                       the stock on the shelf at cost, as of now

   Sales, expenses, purchases and write-offs are read from where they are
   recorded. This module stores only what has no other home: other income,
   and salary payments. Every figure is computed on request and never cached,
   so the accounts cannot disagree with the screens they are built from.
   ========================================================================== */

import type { Document, Filter } from 'mongodb';
import { col } from '../db/mongo.js';
import type { IncomeEntry, SalaryPayment } from '../db/types.js';
import { bad, conflict, missing } from '../core/errors.js';
import { auditLog, logActivity } from '../core/trails.js';
import { contains, escapeRegex, nowIso, startOfMonth, today, toInt, toStr, uid } from '../core/util.js';
import { lookupField } from '../db/pipeline.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { pageResult, paging } from './shared.js';

const rupees = (paisa: number): string => `Rs ${(paisa / 100).toLocaleString('en-PK')}`;
const n = (row: Document | undefined, key: string): number => Number(row?.[key] ?? 0);
const margin = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export const INCOME_CATEGORIES = [
  'Supplier bonus or rebate', 'Shelf and display rent', 'Delivery charges', 'Consultation and testing fees',
  'Commission', 'Bank profit', 'Sale of fixtures or equipment', 'Other income'
];

/** Ways money moves outside the till. 'credit' is not one: it is a balance. */
export const MONEY_METHODS = ['cash', 'bank-transfer', 'cheque', 'card', 'easypaisa', 'jazzcash'];

const SALARY_KINDS: Record<SalaryPayment['kind'], string> = { salary: 'Salary', advance: 'Advance', bonus: 'Bonus' };

/** The expense category that the Expenses screen uses for wages. */
const SALARIES_CATEGORY = 'Salaries';

/* ------------------------------------------------------------------ input */

const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const endOf = (day: string): string => `${day}T23:59:59.999Z`;

/** The period a request asks about: ?from&to, defaulting to this month so far. */
export function period(ctx: PharmacyCtx): { from: string; to: string } {
  const from = toStr(ctx.query.get('from'), 10);
  const to = toStr(ctx.query.get('to'), 10);
  const range = { from: isDay(from) ? from : startOfMonth(0), to: isDay(to) ? to : today() };
  if (range.from > range.to) bad('The start of the period is after its end.', 'from');
  return range;
}

/** A date on a money record: given, valid, and not in the future. */
function moneyDate(value: unknown, field: string, fallback?: string): string {
  const day = toStr(value, 10) || fallback || today();
  if (!isDay(day)) bad('Give the date as YYYY-MM-DD.', field);
  if (day > today()) bad('A payment cannot be dated in the future.', field);
  return day;
}

function moneyMethod(value: unknown, fallback = 'cash'): string {
  const method = toStr(value, 20) || fallback;
  if (!MONEY_METHODS.includes(method)) bad('Choose how the money was paid.', 'paymentMethod');
  return method;
}

/** A non-negative whole number of paisa. */
function paisa(value: unknown, field: string, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  const amount = toInt(value, -1);
  if (amount < 0) bad('Amounts cannot be negative.', field);
  return amount;
}

/* ============================== THE FIGURES =============================== */

/**
 * Profit and loss for a period. Sales are completed invoices; a refunded one
 * is reported on its own line and not counted, the same rule as Reports.
 * GST collected belongs to the government, so income is shown without it.
 */
export async function profitAndLoss(pharmacyId: string, from: string, to: string) {
  const days = { $gte: from, $lte: to };
  const [[sales], [refunds], otherIncome, expenses, [salaries], [writeOffs]] = await Promise.all([
    col.sales().aggregate([
      { $match: { pharmacy_id: pharmacyId, status: 'completed', sold_at: { $gte: from, $lte: endOf(to) } } },
      {
        $group: {
          _id: null, invoices: { $sum: 1 }, gross: { $sum: '$total_paisa' }, gst: { $sum: '$gst_paisa' },
          discount: { $sum: '$discount_paisa' }, cost: { $sum: '$cost_paisa' }
        }
      }
    ]).toArray(),
    col.sales().aggregate([
      { $match: { pharmacy_id: pharmacyId, status: 'refunded', sold_at: { $gte: from, $lte: endOf(to) } } },
      { $group: { _id: null, amount: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } }
    ]).toArray(),
    col.incomeEntries().aggregate<{ category: string; amount: number; entries: number }>([
      { $match: { pharmacy_id: pharmacyId, received_on: days } },
      { $group: { _id: '$category', amount: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } },
      { $project: { _id: 0, category: '$_id', amount: 1, entries: 1 } },
      { $sort: { amount: -1 } }
    ]).toArray(),
    col.expenses().aggregate<{ category: string; amount: number; entries: number }>([
      { $match: { pharmacy_id: pharmacyId, expense_date: days, status: { $ne: 'rejected' } } },
      { $group: { _id: '$category', amount: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } },
      { $project: { _id: 0, category: '$_id', amount: 1, entries: 1 } },
      { $sort: { amount: -1 } }
    ]).toArray(),
    col.salaryPayments().aggregate([
      { $match: { pharmacy_id: pharmacyId, paid_on: days } },
      {
        $group: {
          _id: null, total: { $sum: '$net_paisa' }, payments: { $sum: 1 },
          salary: { $sum: { $cond: [{ $eq: ['$kind', 'salary'] }, '$net_paisa', 0] } },
          advance: { $sum: { $cond: [{ $eq: ['$kind', 'advance'] }, '$net_paisa', 0] } },
          bonus: { $sum: { $cond: [{ $eq: ['$kind', 'bonus'] }, '$net_paisa', 0] } }
        }
      }
    ]).toArray(),
    col.stockMovements().aggregate([
      { $match: { pharmacy_id: pharmacyId, type: 'write-off', created_at: { $gte: from, $lte: endOf(to) } } },
      { $lookup: { from: 'batches', localField: 'batch_id', foreignField: '_id', as: '__b', pipeline: [{ $project: { cost_paisa: 1 } }] } },
      { $group: { _id: null, value: { $sum: { $multiply: [{ $abs: '$quantity_delta' }, { $ifNull: [{ $first: '$__b.cost_paisa' }, 0] }] } }, events: { $sum: 1 } } }
    ]).toArray()
  ]);

  const netSales = n(sales, 'gross') - n(sales, 'gst');
  const otherIncomeTotal = otherIncome.reduce((sum, row) => sum + row.amount, 0);
  const totalIncome = netSales + otherIncomeTotal;
  const costOfSales = n(sales, 'cost');
  const grossProfit = totalIncome - costOfSales;

  /* Wages are wages whichever screen they were typed on: the Salaries tab
     here, or an expense filed under "Salaries" before it existed. */
  const wagesAsExpenses = expenses.find((row) => row.category === SALARIES_CATEGORY)?.amount ?? 0;
  const operating = expenses.filter((row) => row.category !== SALARIES_CATEGORY);
  const operatingTotal = operating.reduce((sum, row) => sum + row.amount, 0);
  const salaryTotal = n(salaries, 'total') + wagesAsExpenses;
  const writeOffValue = n(writeOffs, 'value');
  const totalCosts = salaryTotal + operatingTotal + writeOffValue;
  const netProfit = grossProfit - totalCosts;

  return {
    income: {
      grossSalesPaisa: n(sales, 'gross'), gstPaisa: n(sales, 'gst'), salesPaisa: netSales, discountsPaisa: n(sales, 'discount'),
      invoices: n(sales, 'invoices'), otherIncomePaisa: otherIncomeTotal, otherIncome, totalPaisa: totalIncome
    },
    costOfSalesPaisa: costOfSales,
    grossProfitPaisa: grossProfit,
    grossMargin: margin(grossProfit, totalIncome),
    costs: {
      salariesPaisa: salaryTotal,
      salaries: {
        salaryPaisa: n(salaries, 'salary'), advancePaisa: n(salaries, 'advance'), bonusPaisa: n(salaries, 'bonus'),
        recordedAsExpensesPaisa: wagesAsExpenses, payments: n(salaries, 'payments')
      },
      operatingPaisa: operatingTotal, operating, writeOffsPaisa: writeOffValue, totalPaisa: totalCosts
    },
    netProfitPaisa: netProfit,
    netMargin: margin(netProfit, totalIncome),
    refunds: { amountPaisa: n(refunds, 'amount'), invoices: n(refunds, 'invoices') }
  };
}

/** Money that actually moved in the period, by where it came from and went. */
export async function cashFlow(pharmacyId: string, from: string, to: string) {
  const days = { $gte: from, $lte: to };
  const moments = { $gte: from, $lte: endOf(to) };
  const [byMethod, [repayments], [otherIncome], [suppliers], [salaries], [wages], [expenses], [refunds]] = await Promise.all([
    /* A refunded invoice still brought its money in on the day it was sold;
       the refund is the money going back out, on the day it went. */
    col.sales().aggregate<{ method: string; amount: number }>([
      { $match: { pharmacy_id: pharmacyId, status: { $in: ['completed', 'refunded'] }, payment_method: { $ne: 'credit' }, sold_at: moments } },
      { $group: { _id: '$payment_method', amount: { $sum: '$total_paisa' } } },
      { $project: { _id: 0, method: '$_id', amount: 1 } },
      { $sort: { amount: -1 } }
    ]).toArray(),
    col.customerPayments().aggregate([
      { $match: { pharmacy_id: pharmacyId, reversed_at: null, received_at: moments } },
      { $group: { _id: null, amount: { $sum: '$amount_paisa' } } }
    ]).toArray(),
    col.incomeEntries().aggregate([{ $match: { pharmacy_id: pharmacyId, received_on: days } }, { $group: { _id: null, amount: { $sum: '$amount_paisa' } } }]).toArray(),
    col.supplierPayments().aggregate([{ $match: { pharmacy_id: pharmacyId, paid_on: days } }, { $group: { _id: null, amount: { $sum: '$amount_paisa' } } }]).toArray(),
    col.salaryPayments().aggregate([{ $match: { pharmacy_id: pharmacyId, paid_on: days } }, { $group: { _id: null, amount: { $sum: '$net_paisa' } } }]).toArray(),
    col.expenses().aggregate([
      { $match: { pharmacy_id: pharmacyId, expense_date: days, status: { $ne: 'rejected' }, category: SALARIES_CATEGORY } },
      { $group: { _id: null, amount: { $sum: '$amount_paisa' } } }
    ]).toArray(),
    col.expenses().aggregate([
      { $match: { pharmacy_id: pharmacyId, expense_date: days, status: { $ne: 'rejected' }, category: { $ne: SALARIES_CATEGORY } } },
      { $group: { _id: null, amount: { $sum: '$amount_paisa' } } }
    ]).toArray(),
    col.sales().aggregate([
      { $match: { pharmacy_id: pharmacyId, status: 'refunded', payment_method: { $ne: 'credit' }, refunded_at: moments } },
      { $group: { _id: null, amount: { $sum: '$total_paisa' } } }
    ]).toArray()
  ]);

  const salesIn = byMethod.reduce((sum, row) => sum + row.amount, 0);
  const totalIn = salesIn + n(repayments, 'amount') + n(otherIncome, 'amount');
  const totalOut = n(suppliers, 'amount') + n(salaries, 'amount') + n(wages, 'amount') + n(expenses, 'amount') + n(refunds, 'amount');
  return {
    in: { salesPaisa: salesIn, byMethod, repaymentsPaisa: n(repayments, 'amount'), otherIncomePaisa: n(otherIncome, 'amount'), totalPaisa: totalIn },
    out: {
      suppliersPaisa: n(suppliers, 'amount'), salariesPaisa: n(salaries, 'amount') + n(wages, 'amount'),
      expensesPaisa: n(expenses, 'amount'), refundsPaisa: n(refunds, 'amount'), totalPaisa: totalOut
    },
    netPaisa: totalIn - totalOut
  };
}

/** What is owed each way and what is on the shelf, as of this moment. */
async function position(pharmacyId: string) {
  const day = today();
  const [[receivable], [payable], [opening], [stock]] = await Promise.all([
    col.customers().aggregate([
      { $match: { pharmacy_id: pharmacyId, balance_paisa: { $gt: 0 } } },
      { $group: { _id: null, amount: { $sum: '$balance_paisa' }, customers: { $sum: 1 } } }
    ]).toArray(),
    col.purchases().aggregate([
      { $match: { pharmacy_id: pharmacyId, status: 'received', payment_status: { $ne: 'paid' } } },
      { $group: { _id: null, amount: { $sum: { $subtract: ['$total_paisa', '$paid_paisa'] } }, orders: { $sum: 1 } } }
    ]).toArray(),
    col.suppliers().aggregate([
      { $match: { pharmacy_id: pharmacyId, opening_balance_paisa: { $gt: 0 } } },
      { $group: { _id: null, amount: { $sum: '$opening_balance_paisa' } } }
    ]).toArray(),
    col.batches().aggregate([
      { $match: { pharmacy_id: pharmacyId, status: 'active', quantity: { $gt: 0 }, expiry_date: { $gt: day } } },
      { $group: { _id: null, cost: { $sum: { $multiply: ['$quantity', '$cost_paisa'] } } } }
    ]).toArray()
  ]);
  return {
    receivablePaisa: n(receivable, 'amount'), customersOwing: n(receivable, 'customers'),
    payablePaisa: n(payable, 'amount') + n(opening, 'amount'), unpaidOrders: n(payable, 'orders'),
    stockAtCostPaisa: n(stock, 'cost')
  };
}

/** Income, costs and profit for each month of the twelve that end with `to`. */
async function monthlyTrend(pharmacyId: string, to: string) {
  const first = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() - 11);
  const from = first.toISOString().slice(0, 10);
  const month = (field: string): Document => ({ $substrBytes: [`$${field}`, 0, 7] });
  const byMonth = (field: string, amount: Document | string): Document[] => [
    { $group: { _id: month(field), amount: { $sum: amount } } },
    { $project: { _id: 0, period: '$_id', amount: 1 } }
  ];
  const days = { $gte: from, $lte: to };

  const [sales, cost, income, expenses, salaries] = await Promise.all([
    col.sales().aggregate([{ $match: { pharmacy_id: pharmacyId, status: 'completed', sold_at: { $gte: from, $lte: endOf(to) } } }, ...byMonth('sold_at', { $subtract: ['$total_paisa', '$gst_paisa'] })]).toArray(),
    col.sales().aggregate([{ $match: { pharmacy_id: pharmacyId, status: 'completed', sold_at: { $gte: from, $lte: endOf(to) } } }, ...byMonth('sold_at', '$cost_paisa')]).toArray(),
    col.incomeEntries().aggregate([{ $match: { pharmacy_id: pharmacyId, received_on: days } }, ...byMonth('received_on', '$amount_paisa')]).toArray(),
    col.expenses().aggregate([{ $match: { pharmacy_id: pharmacyId, expense_date: days, status: { $ne: 'rejected' } } }, ...byMonth('expense_date', '$amount_paisa')]).toArray(),
    col.salaryPayments().aggregate([{ $match: { pharmacy_id: pharmacyId, paid_on: days } }, ...byMonth('paid_on', '$net_paisa')]).toArray()
  ]);

  const lookup = (rows: Document[]) => new Map(rows.map((row) => [String(row.period), Number(row.amount)]));
  const [salesBy, costBy, incomeBy, expensesBy, salariesBy] = [sales, cost, income, expenses, salaries].map(lookup);
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    const at = new Date(first);
    at.setUTCMonth(first.getUTCMonth() + i);
    const key = at.toISOString().slice(0, 7);
    const incomeTotal = (salesBy.get(key) ?? 0) + (incomeBy.get(key) ?? 0);
    const costs = (costBy.get(key) ?? 0) + (expensesBy.get(key) ?? 0) + (salariesBy.get(key) ?? 0);
    rows.push({ period: key, income: incomeTotal, costs, profit: incomeTotal - costs });
  }
  return rows;
}

route('GET', '/api/v1/accounting/summary', 'accounting.view', async (ctx) => {
  const range = period(ctx);
  const [pnl, cash, now, trend] = await Promise.all([
    profitAndLoss(ctx.pharmacyId, range.from, range.to),
    cashFlow(ctx.pharmacyId, range.from, range.to),
    position(ctx.pharmacyId),
    monthlyTrend(ctx.pharmacyId, range.to)
  ]);
  return { range, profitAndLoss: pnl, cashFlow: cash, position: now, trend };
});

/* ============================ MONEY IN AND OUT ============================
   One list of every movement the accounts are built from, newest first:
   the till's takings day by day, other income, expenses, salaries and
   supplier payments. Each row says where it came from, so the screen can
   link back to the record. */

function ledgerPipeline(pharmacyId: string, from: string, to: string): Document[] {
  const days = { $gte: from, $lte: to };
  return [
    { $match: { pharmacy_id: pharmacyId, status: 'completed', sold_at: { $gte: from, $lte: endOf(to) } } },
    { $group: { _id: { $substrBytes: ['$sold_at', 0, 10] }, amount: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } },
    {
      $project: {
        _id: 0, id: { $concat: ['sales-', '$_id'] }, date: '$_id', at: { $concat: ['$_id', 'T23:59:59.999Z'] },
        direction: 'in', source: 'sales', category: 'Sales', amount_paisa: '$amount', payment_method: null, reference: null,
        description: { $concat: ['Takings at the till — ', { $toString: '$invoices' }, { $cond: [{ $eq: ['$invoices', 1] }, ' invoice', ' invoices'] }] }
      }
    },
    {
      $unionWith: {
        coll: 'income_entries',
        pipeline: [
          { $match: { pharmacy_id: pharmacyId, received_on: days } },
          {
            $project: {
              _id: 0, id: 1, date: '$received_on', at: '$created_at', direction: 'in', source: 'income', category: 1,
              amount_paisa: 1, payment_method: 1, reference: 1, description: 1
            }
          }
        ]
      }
    },
    {
      $unionWith: {
        coll: 'expenses',
        pipeline: [
          { $match: { pharmacy_id: pharmacyId, expense_date: days, status: { $ne: 'rejected' } } },
          {
            $project: {
              _id: 0, id: 1, date: '$expense_date', at: '$created_at', direction: 'out', source: 'expense', category: 1,
              amount_paisa: 1, payment_method: 1, reference: 1, description: 1
            }
          }
        ]
      }
    },
    {
      $unionWith: {
        coll: 'salary_payments',
        pipeline: [
          { $match: { pharmacy_id: pharmacyId, paid_on: days } },
          {
            $project: {
              _id: 0, id: 1, date: '$paid_on', at: '$created_at', direction: 'out', source: 'salary', category: SALARIES_CATEGORY,
              amount_paisa: '$net_paisa', payment_method: 1, reference: 1,
              description: { $concat: [{ $switch: { branches: Object.entries(SALARY_KINDS).map(([kind, label]) => ({ case: { $eq: ['$kind', kind] }, then: label })), default: 'Salary' } }, ' for ', '$period', ' — ', '$staff_name'] }
            }
          }
        ]
      }
    },
    {
      $unionWith: {
        coll: 'supplier_payments',
        pipeline: [
          { $match: { pharmacy_id: pharmacyId, paid_on: days } },
          { $lookup: { from: 'suppliers', localField: 'supplier_id', foreignField: '_id', as: '__s', pipeline: [{ $project: { name: 1 } }] } },
          { $lookup: { from: 'purchases', localField: 'purchase_id', foreignField: '_id', as: '__p', pipeline: [{ $project: { reference: 1 } }] } },
          {
            $project: {
              _id: 0, id: 1, date: '$paid_on', at: '$created_at', direction: 'out', source: 'supplier', category: 'Paid to suppliers',
              amount_paisa: 1, payment_method: 1,
              reference: { $ifNull: ['$reference', { $first: '$__p.reference' }] },
              description: { $concat: ['Payment to ', { $ifNull: [{ $first: '$__s.name' }, 'a supplier'] }, ' for ', { $ifNull: [{ $first: '$__p.reference' }, 'an order'] }] }
            }
          }
        ]
      }
    }
  ];
}

route('GET', '/api/v1/accounting/transactions', 'accounting.view', async (ctx) => {
  const range = period(ctx);
  const { page, size, skip } = paging(ctx, 50);
  const direction = toStr(ctx.query.get('direction'), 4);
  const search = toStr(ctx.query.get('q'), 80);
  const filter: Document = {};
  if (direction === 'in' || direction === 'out') filter.direction = direction;
  if (search) filter.$or = [{ description: contains(search) }, { category: contains(search) }, { reference: contains(search) }];

  const [result] = await col.sales().aggregate([
    ...ledgerPipeline(ctx.pharmacyId, range.from, range.to),
    { $match: filter },
    {
      $facet: {
        rows: [{ $sort: { date: -1, at: -1 } }, { $skip: skip }, { $limit: size }],
        count: [{ $count: 'n' }],
        totals: [{ $group: { _id: '$direction', amount: { $sum: '$amount_paisa' } } }]
      }
    }
  ]).toArray();

  const totals = { inPaisa: 0, outPaisa: 0 };
  for (const row of (result?.totals ?? []) as Document[]) {
    if (row._id === 'in') totals.inPaisa = Number(row.amount);
    if (row._id === 'out') totals.outPaisa = Number(row.amount);
  }
  return { ...pageResult(result?.rows ?? [], n(result?.count?.[0], 'n'), { page, size }), totals: { ...totals, netPaisa: totals.inPaisa - totals.outPaisa }, range };
});

/* ============================== OTHER INCOME ============================== */

const incomeOut = async (id: string) => (await col.incomeEntries().aggregate([
  { $match: { _id: id } },
  ...lookupField('users', 'created_by', 'full_name', 'created_by_name')
]).toArray())[0];

function readIncome(ctx: PharmacyCtx, existing?: IncomeEntry) {
  const category = toStr(ctx.body.category, 60) || existing?.category || '';
  if (!INCOME_CATEGORIES.includes(category)) bad('Choose what kind of income this is.', 'category');
  const description = toStr(ctx.body.description, 300) || existing?.description || '';
  if (!description) bad('Describe where the money came from.', 'description');
  const amount = ctx.body.amountPaisa === undefined && existing ? existing.amount_paisa : paisa(ctx.body.amountPaisa, 'amountPaisa');
  if (amount <= 0) bad('Enter an amount above zero.', 'amountPaisa');
  return {
    category, description, amount_paisa: amount,
    received_on: moneyDate(ctx.body.receivedOn, 'receivedOn', existing?.received_on),
    payment_method: moneyMethod(ctx.body.paymentMethod, existing?.payment_method),
    reference: ctx.body.reference === undefined ? existing?.reference ?? null : toStr(ctx.body.reference, 80) || null,
    payer: ctx.body.payer === undefined ? existing?.payer ?? null : toStr(ctx.body.payer, 120) || null
  };
}

route('GET', '/api/v1/accounting/income', 'accounting.view', async (ctx) => {
  const range = period(ctx);
  const { page, size, skip } = paging(ctx, 25);
  const filter: Filter<IncomeEntry> = { pharmacy_id: ctx.pharmacyId, received_on: { $gte: range.from, $lte: range.to } };
  const category = toStr(ctx.query.get('category'), 60);
  if (category) filter.category = category;
  const search = toStr(ctx.query.get('q'), 80);
  if (search) filter.$or = [{ description: contains(search) }, { payer: contains(search) }, { reference: contains(search) }];

  const [rows, total, [summary]] = await Promise.all([
    col.incomeEntries().aggregate([
      { $match: filter }, { $sort: { received_on: -1, created_at: -1 } }, { $skip: skip }, { $limit: size },
      ...lookupField('users', 'created_by', 'full_name', 'created_by_name')
    ]).toArray(),
    col.incomeEntries().countDocuments(filter),
    col.incomeEntries().aggregate([{ $match: filter }, { $group: { _id: null, totalPaisa: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } }, { $project: { _id: 0 } }]).toArray()
  ]);
  return { ...pageResult(rows, total, { page, size }), summary: summary ?? { totalPaisa: 0, entries: 0 }, categories: INCOME_CATEGORIES, methods: MONEY_METHODS, range };
});

route('POST', '/api/v1/accounting/income', 'accounting.manage', async (ctx) => {
  const fields = readIncome(ctx);
  const id = uid('INC');
  const at = nowIso();
  await col.incomeEntries().insertOne({
    _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: ctx.user.branch_id, ...fields, created_by: ctx.user.id, created_at: at, updated_at: at
  });
  await logActivity(ctx, { action: 'income.recorded', entity: 'income', entityId: id, summary: `Income recorded: ${fields.category} — ${rupees(fields.amount_paisa)} (${fields.description})` });
  await auditLog(ctx, { action: 'income.recorded', entity: 'income', entityId: id, summary: `${rupees(fields.amount_paisa)} income recorded`, after: fields });
  return { data: await incomeOut(id), __status: 201 };
});

route('PATCH', '/api/v1/accounting/income/:id', 'accounting.manage', async (ctx) => {
  const entry = await col.incomeEntries().findOne({ _id: toStr(ctx.params.id, 40), pharmacy_id: ctx.pharmacyId });
  if (!entry) return missing('That income entry could not be found.');
  const fields = readIncome(ctx, entry);
  await col.incomeEntries().updateOne({ _id: entry.id }, { $set: { ...fields, updated_at: nowIso() } });
  await logActivity(ctx, { action: 'income.updated', entity: 'income', entityId: entry.id, summary: `Income entry changed: ${fields.description}` });
  await auditLog(ctx, {
    action: 'income.updated', entity: 'income', entityId: entry.id, summary: `Income entry changed (${rupees(entry.amount_paisa)} → ${rupees(fields.amount_paisa)})`,
    before: { amount_paisa: entry.amount_paisa, received_on: entry.received_on, category: entry.category }, after: fields
  });
  return { data: await incomeOut(entry.id) };
});

route('DELETE', '/api/v1/accounting/income/:id', 'accounting.manage', async (ctx) => {
  const entry = await col.incomeEntries().findOne({ _id: toStr(ctx.params.id, 40), pharmacy_id: ctx.pharmacyId });
  if (!entry) return missing('That income entry could not be found.');
  await col.incomeEntries().deleteOne({ _id: entry.id });
  await logActivity(ctx, { action: 'income.deleted', entity: 'income', entityId: entry.id, severity: 'warn', summary: `Income entry deleted: ${entry.description} (${rupees(entry.amount_paisa)})` });
  await auditLog(ctx, { action: 'income.deleted', entity: 'income', entityId: entry.id, summary: `Income entry of ${rupees(entry.amount_paisa)} deleted`, before: entry });
  return { ok: true };
});

/* ================================ SALARIES ================================
   One row per payment. A month's salary is paid once per person: paying it
   twice is almost always a mistake, so the second attempt is refused and an
   advance or a bonus is recorded as what it is. */

const salaryOut = async (id: string) => (await col.salaryPayments().aggregate([
  { $match: { _id: id } },
  ...lookupField('users', 'created_by', 'full_name', 'created_by_name')
]).toArray())[0];

async function readSalary(ctx: PharmacyCtx, existing?: SalaryPayment) {
  const body = ctx.body;
  let staffId = existing?.staff_id ?? null;
  let staffName = existing?.staff_name ?? '';
  if (body.staffId !== undefined) {
    staffId = toStr(body.staffId, 40) || null;
    if (staffId) {
      const person = await col.users().findOne({ _id: staffId, pharmacy_id: ctx.pharmacyId }, { projection: { full_name: 1 } });
      if (!person) bad('That person does not work at this pharmacy.', 'staffId');
      staffName = person!.full_name;
    }
  }
  /* Someone paid who has no KSF account — a cleaner, a delivery rider. */
  if (!staffId) staffName = toStr(body.staffName, 120) || staffName;
  if (!staffName) bad('Choose who was paid, or type their name.', 'staffName');

  const kind = (toStr(body.kind, 10) || existing?.kind || 'salary') as SalaryPayment['kind'];
  if (!(kind in SALARY_KINDS)) bad('Choose salary, advance or bonus.', 'kind');
  const month = toStr(body.period, 7) || existing?.period || today().slice(0, 7);
  if (!isMonth(month)) bad('Give the month the payment is for as YYYY-MM.', 'period');

  const basic = paisa(body.basicPaisa, 'basicPaisa', existing?.basic_paisa ?? 0);
  const allowances = paisa(body.allowancesPaisa, 'allowancesPaisa', existing?.allowances_paisa ?? 0);
  const deductions = paisa(body.deductionsPaisa, 'deductionsPaisa', existing?.deductions_paisa ?? 0);
  const net = basic + allowances - deductions;
  if (net <= 0) bad('What is paid has to be above zero once deductions are taken off.', 'basicPaisa');

  return {
    staff_id: staffId, staff_name: staffName, kind, period: month, basic_paisa: basic, allowances_paisa: allowances,
    deductions_paisa: deductions, net_paisa: net, paid_on: moneyDate(body.paidOn, 'paidOn', existing?.paid_on),
    payment_method: moneyMethod(body.paymentMethod, existing?.payment_method),
    reference: body.reference === undefined ? existing?.reference ?? null : toStr(body.reference, 80) || null,
    note: body.note === undefined ? existing?.note ?? null : toStr(body.note, 300) || null
  };
}

/** The same person's salary for the same month, other than `exceptId`. */
function sameMonthSalary(pharmacyId: string, fields: { staff_id: string | null; staff_name: string; period: string }, exceptId?: string) {
  const who: Filter<SalaryPayment> = fields.staff_id
    ? { staff_id: fields.staff_id }
    : { staff_id: null, staff_name: new RegExp(`^${escapeRegex(fields.staff_name)}$`, 'i') };
  return col.salaryPayments().findOne({ pharmacy_id: pharmacyId, kind: 'salary', period: fields.period, ...who, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
}

route('GET', '/api/v1/accounting/salaries', 'accounting.view', async (ctx) => {
  const { page, size, skip } = paging(ctx, 25);
  const filter: Filter<SalaryPayment> = { pharmacy_id: ctx.pharmacyId };
  const month = toStr(ctx.query.get('period'), 7);
  if (month) {
    if (!isMonth(month)) bad('Ask for a month as YYYY-MM.', 'period');
    filter.period = month;
  } else {
    const range = period(ctx);
    filter.paid_on = { $gte: range.from, $lte: range.to };
  }
  const staff = toStr(ctx.query.get('staff'), 40);
  if (staff) filter.staff_id = staff;
  const search = toStr(ctx.query.get('q'), 80);
  if (search) filter.$or = [{ staff_name: contains(search) }, { reference: contains(search) }, { note: contains(search) }];

  const [rows, total, [summary]] = await Promise.all([
    col.salaryPayments().aggregate([
      { $match: filter }, { $sort: { paid_on: -1, created_at: -1 } }, { $skip: skip }, { $limit: size },
      ...lookupField('users', 'created_by', 'full_name', 'created_by_name')
    ]).toArray(),
    col.salaryPayments().countDocuments(filter),
    col.salaryPayments().aggregate([
      { $match: filter },
      {
        $group: {
          _id: null, totalPaisa: { $sum: '$net_paisa' }, payments: { $sum: 1 }, people: { $addToSet: '$staff_name' },
          deductionsPaisa: { $sum: '$deductions_paisa' }
        }
      },
      { $project: { _id: 0, totalPaisa: 1, payments: 1, deductionsPaisa: 1, people: { $size: '$people' } } }
    ]).toArray()
  ]);
  return {
    ...pageResult(rows, total, { page, size }),
    summary: summary ?? { totalPaisa: 0, payments: 0, people: 0, deductionsPaisa: 0 },
    kinds: Object.entries(SALARY_KINDS).map(([value, label]) => ({ value, label })), methods: MONEY_METHODS
  };
});

/* Who can be paid: the pharmacy's people, with their role, for the form. */
route('GET', '/api/v1/accounting/salaries/payees', 'accounting.manage', async (ctx) => {
  const rows = await col.users().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId, status: { $in: ['active', 'suspended'] } } },
    { $lookup: { from: 'roles', localField: 'role_id', foreignField: '_id', as: '__r', pipeline: [{ $project: { name: 1 } }] } },
    { $project: { _id: 0, id: '$_id', name: '$full_name', role: { $first: '$__r.name' }, status: 1 } },
    { $sort: { name: 1 } }
  ]).toArray();
  return { data: rows };
});

route('POST', '/api/v1/accounting/salaries', 'accounting.manage', async (ctx) => {
  const fields = await readSalary(ctx);
  if (fields.kind === 'salary') {
    const paid = await sameMonthSalary(ctx.pharmacyId, fields);
    if (paid) conflict(`${fields.staff_name}'s salary for ${fields.period} was already recorded on ${paid.paid_on} (${rupees(paid.net_paisa)}). Record an advance or a bonus instead, or edit that payment.`);
  }
  const id = uid('SAL');
  const at = nowIso();
  await col.salaryPayments().insertOne({
    _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: ctx.user.branch_id, ...fields, created_by: ctx.user.id, created_at: at, updated_at: at
  });
  const what = `${SALARY_KINDS[fields.kind]} for ${fields.period} paid to ${fields.staff_name} — ${rupees(fields.net_paisa)}`;
  await logActivity(ctx, { action: 'salary.paid', entity: 'salary', entityId: id, summary: what });
  await auditLog(ctx, { action: 'salary.paid', entity: 'salary', entityId: id, summary: what, after: fields });
  return { data: await salaryOut(id), __status: 201 };
});

route('PATCH', '/api/v1/accounting/salaries/:id', 'accounting.manage', async (ctx) => {
  const payment = await col.salaryPayments().findOne({ _id: toStr(ctx.params.id, 40), pharmacy_id: ctx.pharmacyId });
  if (!payment) return missing('That salary payment could not be found.');
  const fields = await readSalary(ctx, payment);
  if (fields.kind === 'salary') {
    const paid = await sameMonthSalary(ctx.pharmacyId, fields, payment.id);
    if (paid) conflict(`${fields.staff_name}'s salary for ${fields.period} is already recorded on ${paid.paid_on}.`);
  }
  await col.salaryPayments().updateOne({ _id: payment.id }, { $set: { ...fields, updated_at: nowIso() } });
  await logActivity(ctx, { action: 'salary.updated', entity: 'salary', entityId: payment.id, summary: `Salary payment to ${fields.staff_name} changed` });
  await auditLog(ctx, {
    action: 'salary.updated', entity: 'salary', entityId: payment.id, summary: `Salary payment changed (${rupees(payment.net_paisa)} → ${rupees(fields.net_paisa)})`,
    before: { net_paisa: payment.net_paisa, period: payment.period, paid_on: payment.paid_on }, after: fields
  });
  return { data: await salaryOut(payment.id) };
});

route('DELETE', '/api/v1/accounting/salaries/:id', 'accounting.manage', async (ctx) => {
  const payment = await col.salaryPayments().findOne({ _id: toStr(ctx.params.id, 40), pharmacy_id: ctx.pharmacyId });
  if (!payment) return missing('That salary payment could not be found.');
  await col.salaryPayments().deleteOne({ _id: payment.id });
  const what = `${SALARY_KINDS[payment.kind]} for ${payment.period} to ${payment.staff_name} (${rupees(payment.net_paisa)}) deleted`;
  await logActivity(ctx, { action: 'salary.deleted', entity: 'salary', entityId: payment.id, severity: 'warn', summary: what });
  await auditLog(ctx, { action: 'salary.deleted', entity: 'salary', entityId: payment.id, summary: what, before: payment });
  return { ok: true };
});

/* ================================= EXPORT =================================
   Rows as JSON, like every other export: the browser turns them into a CSV
   with one shared routine (filename, encoding, formula neutralising). */

const rs = (amount: number): number => Math.round(amount) / 100;

async function profitAndLossRows(pharmacyId: string, from: string, to: string) {
  const pnl = await profitAndLoss(pharmacyId, from, to);
  const line = (section: string, item: string, amount: number) => ({ Section: section, Line: item, 'Amount (Rs)': rs(amount) });
  return [
    line('Income', 'Sales (excluding GST)', pnl.income.salesPaisa),
    ...pnl.income.otherIncome.map((row) => line('Income', row.category, row.amount)),
    line('Income', 'Total income', pnl.income.totalPaisa),
    line('Cost of sales', 'Cost of medicines sold', pnl.costOfSalesPaisa),
    line('Gross profit', `Gross profit (${pnl.grossMargin}% of income)`, pnl.grossProfitPaisa),
    line('Costs', 'Salaries and wages', pnl.costs.salariesPaisa),
    ...pnl.costs.operating.map((row) => line('Costs', row.category, row.amount)),
    line('Costs', 'Stock written off', pnl.costs.writeOffsPaisa),
    line('Costs', 'Total costs', pnl.costs.totalPaisa),
    line('Net profit', `Net profit (${pnl.netMargin}% of income)`, pnl.netProfitPaisa),
    line('For reference', 'GST collected (owed to FBR)', pnl.income.gstPaisa),
    line('For reference', 'Discounts given', pnl.income.discountsPaisa),
    line('For reference', 'Refunded invoices (not counted)', pnl.refunds.amountPaisa)
  ];
}

route('GET', '/api/v1/accounting/export', 'accounting.view', async (ctx) => {
  const range = period(ctx);
  const kind = toStr(ctx.query.get('kind'), 30) || 'profit-and-loss';
  const label = (method: string | null): string => (method ? method.replace('-', ' ') : '');

  const datasets: Record<string, () => Promise<Record<string, unknown>[]>> = {
    'profit-and-loss': () => profitAndLossRows(ctx.pharmacyId, range.from, range.to),
    transactions: async () => (await col.sales().aggregate([...ledgerPipeline(ctx.pharmacyId, range.from, range.to), { $sort: { date: -1, at: -1 } }]).toArray())
      .map((row) => ({
        Date: row.date, Direction: row.direction === 'in' ? 'Money in' : 'Money out', Category: row.category, Description: row.description,
        'Paid by': label(row.payment_method), Reference: row.reference ?? '', 'Amount (Rs)': rs(row.direction === 'in' ? row.amount_paisa : -row.amount_paisa)
      })),
    income: async () => (await col.incomeEntries().find({ pharmacy_id: ctx.pharmacyId, received_on: { $gte: range.from, $lte: range.to } }).sort({ received_on: -1 }).toArray())
      .map((row) => ({
        Date: row.received_on, Category: row.category, Description: row.description, 'Received from': row.payer ?? '',
        'Paid by': label(row.payment_method), Reference: row.reference ?? '', 'Amount (Rs)': rs(row.amount_paisa)
      })),
    salaries: async () => (await col.salaryPayments().find({ pharmacy_id: ctx.pharmacyId, paid_on: { $gte: range.from, $lte: range.to } }).sort({ paid_on: -1 }).toArray())
      .map((row) => ({
        'Paid on': row.paid_on, Month: row.period, Person: row.staff_name, Type: SALARY_KINDS[row.kind], 'Basic (Rs)': rs(row.basic_paisa),
        'Allowances (Rs)': rs(row.allowances_paisa), 'Deductions (Rs)': rs(row.deductions_paisa), 'Paid (Rs)': rs(row.net_paisa),
        'Paid by': label(row.payment_method), Reference: row.reference ?? '', Note: row.note ?? ''
      }))
  };
  const build = datasets[kind];
  if (!build) bad(`Choose one of: ${Object.keys(datasets).join(', ')}.`, 'kind');
  return { data: await build(), kind, range };
}, { feature: 'reports.export' });
