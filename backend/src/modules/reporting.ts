/* The dashboard and the reporting screens.

   Everything here is read-only aggregation over the same collections the
   rest of the system writes to, so a number on a report can always be traced
   back to an invoice, a batch or an expense. Date boundaries are worked out
   here and compared against the stored ISO timestamps, never computed inside
   the database. */

import type { Document } from 'mongodb';
import { col } from '../db/mongo.js';
import { forbid } from '../core/errors.js';
import { addDays, startOfMonth, today, toStr } from '../core/util.js';
import { dayOf, monthOf } from '../db/pipeline.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { DISCOUNT_REASONS, plural, salesScope, scopeMatch, stockStages, type SalesScope } from './shared.js';

const n = (row: Document | undefined, key: string): number => Number(row?.[key] ?? 0);
const endOf = (day: string): string => `${day}T23:59:59.999Z`;
const between = (from: string, to: string): Document => ({ $gte: from, $lte: endOf(to) });

/** The sales a scope may see, plus anything extra. */
const salesFor = (ctx: PharmacyCtx, scope: SalesScope, extra: Document = {}): Document =>
  ({ pharmacy_id: ctx.pharmacyId, ...scopeMatch(scope), ...extra });

const change = (current: number, previous: number): number | null =>
  (previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null);

/* ================================ DASHBOARD ================================ */

route('GET', '/api/v1/dashboard', 'dashboard.view', async (ctx) => {
  /* Every person's dashboard is their own figures. Somebody with
     reports.everyone sees the whole pharmacy, one person (?staff=<id>) or a
     role combined (?staff=role:<id>). Stock figures stay shared — the shelf
     belongs to everybody. Profit and expenses are not sent to anyone who
     cannot open the reports: hiding a card in the browser is not a control. */
  const scope = await salesScope(ctx);
  const canSeeMoney = ctx.can('reports.view');
  const now = today();
  const yesterday = addDays(-1);
  const monthStart = startOfMonth(0);
  const lastMonthStart = startOfMonth(-1);
  const in30 = addDays(30);
  const in90 = addDays(90);
  const last30 = addDays(-30);
  const completed = salesFor(ctx, scope, { status: 'completed' });

  const totals = (match: Document) => [
    { $match: match },
    { $group: { _id: null, invoices: { $sum: 1 }, revenue: { $sum: '$total_paisa' }, profit: { $sum: { $subtract: ['$total_paisa', '$cost_paisa'] } }, discount: { $sum: '$discount_paisa' } } }
  ];

  const [[sales], stockRows, [expiry], topSellers, attention, recentSales, expensesMonth, pendingRx] = await Promise.all([
    col.sales().aggregate([
      { $match: { ...completed, sold_at: { $gte: startOfMonth(-11) } } },
      {
        $facet: {
          today: totals({ sold_at: between(now, now) }),
          yesterday: totals({ sold_at: between(yesterday, yesterday) }),
          month: totals({ sold_at: { $gte: monthStart } }),
          lastMonth: totals({ sold_at: { $gte: lastMonthStart, $lt: monthStart } }),
          trend: [
            { $group: { _id: monthOf('sold_at'), revenue: { $sum: '$total_paisa' }, profit: { $sum: { $subtract: ['$total_paisa', '$cost_paisa'] } }, invoices: { $sum: 1 } } },
            { $project: { _id: 0, period: '$_id', revenue: 1, profit: 1, invoices: 1 } },
            { $sort: { period: 1 } }
          ],
          daily: [
            { $match: { sold_at: { $gte: addDays(-13) } } },
            { $group: { _id: dayOf('sold_at'), revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } },
            { $project: { _id: 0, day: '$_id', revenue: 1, invoices: 1 } },
            { $sort: { day: 1 } }
          ],
          paymentMix: [
            { $match: { sold_at: { $gte: last30 } } },
            { $group: { _id: '$payment_method', invoices: { $sum: 1 }, revenue: { $sum: '$total_paisa' } } },
            { $project: { _id: 0, payment_method: '$_id', invoices: 1, revenue: 1 } },
            { $sort: { revenue: -1 } }
          ]
        }
      }
    ]).toArray(),
    col.medicines().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, status: 'active' } },
      { $project: { min_stock: 1, cost_paisa: 1 } },
      ...stockStages(),
      {
        $group: {
          _id: null, tracked: { $sum: 1 },
          out_of_stock: { $sum: { $cond: [{ $lte: ['$on_hand', 0] }, 1, 0] } },
          low_stock: { $sum: { $cond: [{ $and: [{ $gt: ['$on_hand', 0] }, { $lte: ['$on_hand', '$min_stock'] }] }, 1, 0] } },
          stock_value: { $sum: { $multiply: ['$on_hand', '$cost_paisa'] } }
        }
      }
    ]).toArray(),
    col.batches().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, quantity: { $gt: 0 }, status: { $ne: 'written-off' } } },
      {
        $group: {
          _id: null,
          expired: { $sum: { $cond: [{ $lte: ['$expiry_date', now] }, 1, 0] } },
          critical: { $sum: { $cond: [{ $and: [{ $gt: ['$expiry_date', now] }, { $lte: ['$expiry_date', in30] }] }, 1, 0] } },
          soon: { $sum: { $cond: [{ $and: [{ $gt: ['$expiry_date', in30] }, { $lte: ['$expiry_date', in90] }] }, 1, 0] } },
          at_risk_value: { $sum: { $cond: [{ $lte: ['$expiry_date', in90] }, { $multiply: ['$quantity', '$cost_paisa'] }, 0] } }
        }
      }
    ]).toArray(),
    col.sales().aggregate([
      { $match: { ...completed, sold_at: { $gte: last30 } } },
      { $unwind: '$items' },
      { $group: { _id: { id: '$items.medicine_id', name: '$items.medicine_name' }, units: { $sum: '$items.quantity' }, revenue: { $sum: '$items.line_total_paisa' } } },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, medicine_id: '$_id.id', medicine_name: '$_id.name', units: 1, revenue: 1 } }
    ]).toArray(),
    col.medicines().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, status: 'active' } },
      { $project: { _id: 1, id: 1, name: 1, min_stock: 1, form: 1, strength: 1 } },
      ...stockStages(),
      { $match: { $expr: { $lte: ['$on_hand', '$min_stock'] } } },
      { $sort: { on_hand: 1, name: 1 } },
      { $limit: 8 }
    ]).toArray(),
    col.sales().find(salesFor(ctx, scope), {
      projection: { _id: 1, id: 1, invoice_no: 1, customer_name: 1, sold_at: 1, total_paisa: 1, payment_method: 1, served_by_name: 1, status: 1 }
    }).sort({ sold_at: -1 }).limit(8).toArray(),
    /* Expenses belong to the whole pharmacy, not to one person's till. */
    canSeeMoney && scope.pharmacyWide
      ? col.expenses().aggregate([{ $match: { pharmacy_id: ctx.pharmacyId, expense_date: { $gte: monthStart }, status: { $ne: 'rejected' } } }, { $group: { _id: null, total: { $sum: '$amount_paisa' } } }]).toArray()
      : Promise.resolve([]),
    col.prescriptions().countDocuments({ pharmacy_id: ctx.pharmacyId, status: 'pending' })
  ]);

  const [today0] = sales?.today ?? [];
  const [yesterday0] = sales?.yesterday ?? [];
  const [month0] = sales?.month ?? [];
  const [lastMonth0] = sales?.lastMonth ?? [];
  const [stock] = stockRows;
  const expensesTotal = n(expensesMonth[0], 'total');
  const trend = (sales?.trend ?? []) as Document[];

  return {
    today: {
      invoices: n(today0, 'invoices'), revenuePaisa: n(today0, 'revenue'), profitPaisa: canSeeMoney ? n(today0, 'profit') : 0,
      discountPaisa: n(today0, 'discount'), revenueChange: change(n(today0, 'revenue'), n(yesterday0, 'revenue')),
      invoiceChange: change(n(today0, 'invoices'), n(yesterday0, 'invoices'))
    },
    month: {
      invoices: n(month0, 'invoices'), revenuePaisa: n(month0, 'revenue'), profitPaisa: canSeeMoney ? n(month0, 'profit') : 0,
      discountPaisa: n(month0, 'discount'), expensesPaisa: expensesTotal, netPaisa: canSeeMoney ? n(month0, 'profit') - expensesTotal : 0,
      revenueChange: change(n(month0, 'revenue'), n(lastMonth0, 'revenue'))
    },
    stock: { tracked: n(stock, 'tracked'), outOfStock: n(stock, 'out_of_stock'), lowStock: n(stock, 'low_stock'), stockValuePaisa: n(stock, 'stock_value') },
    expiry: { expired: n(expiry, 'expired'), critical: n(expiry, 'critical'), soon: n(expiry, 'soon'), atRiskValuePaisa: n(expiry, 'at_risk_value') },
    prescriptionsPending: pendingRx,
    trend: canSeeMoney ? trend : trend.map((row) => ({ ...row, profit: 0 })),
    daily: sales?.daily ?? [], topSellers, attention, recentSales, paymentMix: sales?.paymentMix ?? [],
    scopedToMe: scope.userId === ctx.user.id,
    viewing: scope.person,
    pharmacyWide: scope.pharmacyWide
  };
});

/* ================================= REPORTS ================================= */

function range(ctx: PharmacyCtx): { from: string; to: string } {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const from = toStr(ctx.query.get('from'), 10);
  const to = toStr(ctx.query.get('to'), 10);
  return { from: valid(from) ? from : addDays(-29), to: valid(to) ? to : today() };
}

route('GET', '/api/v1/reports/overview', 'reports.view', async (ctx) => {
  const { from, to } = range(ctx);
  const scope = await salesScope(ctx);
  const { pharmacyWide } = scope;
  const period = salesFor(ctx, scope, { sold_at: between(from, to) });

  /* Revenue, cost, profit, invoices and basket come from completed invoices
     only — the same rule as every other figure. Refunds are reported on their
     own line. */
  const [[sales], [units], expenses, purchases, writeOffs, customers] = await Promise.all([
    col.sales().aggregate([
      { $match: { ...period, status: { $in: ['completed', 'refunded'] } } },
      {
        $group: {
          _id: null,
          invoices: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$total_paisa', 0] } },
          cost: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$cost_paisa', 0] } },
          discount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$discount_paisa', 0] } },
          discounted: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $gt: ['$discount_paisa', 0] }] }, 1, 0] } },
          basket: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, '$total_paisa', null] } },
          refunds: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, '$total_paisa', 0] } }
        }
      }
    ]).toArray(),
    col.sales().aggregate([
      { $match: { ...period, status: 'completed' } },
      { $unwind: '$items' },
      { $group: { _id: null, units: { $sum: '$items.quantity' }, lines: { $addToSet: '$items.medicine_id' } } },
      { $project: { units: 1, distinct_lines: { $size: '$lines' } } }
    ]).toArray(),
    /* Expenses, purchases and write-offs belong to the whole pharmacy. */
    pharmacyWide
      ? col.expenses().aggregate([{ $match: { pharmacy_id: ctx.pharmacyId, expense_date: { $gte: from, $lte: to }, status: { $ne: 'rejected' } } }, { $group: { _id: null, total: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } }]).toArray()
      : Promise.resolve([]),
    pharmacyWide
      ? col.purchases().aggregate([{ $match: { pharmacy_id: ctx.pharmacyId, status: 'received', purchase_date: { $gte: from, $lte: to } } }, { $group: { _id: null, total: { $sum: '$total_paisa' }, orders: { $sum: 1 } } }]).toArray()
      : Promise.resolve([]),
    pharmacyWide
      ? col.stockMovements().aggregate([
        { $match: { pharmacy_id: ctx.pharmacyId, type: 'write-off', created_at: between(from, to) } },
        { $lookup: { from: 'batches', localField: 'batch_id', foreignField: '_id', as: '__b', pipeline: [{ $project: { cost_paisa: 1 } }] } },
        { $group: { _id: null, value: { $sum: { $multiply: [{ $abs: '$quantity_delta' }, { $ifNull: [{ $first: '$__b.cost_paisa' }, 0] }] } }, events: { $sum: 1 } } }
      ]).toArray()
      : Promise.resolve([]),
    col.sales().distinct('customer_id', { ...period, status: 'completed', customer_id: { $ne: null } })
  ]);

  const revenue = n(sales, 'revenue');
  const grossProfit = revenue - n(sales, 'cost');
  const expenseTotal = n(expenses[0], 'total');
  const writeOffValue = n(writeOffs[0], 'value');
  return {
    range: { from, to },
    scope: { everyone: scope.everyone, person: scope.person, pharmacyWide },
    revenuePaisa: revenue, costPaisa: n(sales, 'cost'), grossProfitPaisa: grossProfit,
    grossMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
    expensesPaisa: expenseTotal, writeOffPaisa: writeOffValue, netProfitPaisa: grossProfit - expenseTotal - writeOffValue,
    invoices: n(sales, 'invoices'), unitsSold: n(units, 'units'), distinctMedicines: n(units, 'distinct_lines'),
    averageBasketPaisa: Math.round(n(sales, 'basket')), discountPaisa: n(sales, 'discount'), discountedInvoices: n(sales, 'discounted'),
    refundsPaisa: n(sales, 'refunds'), purchasesPaisa: n(purchases[0], 'total'), purchaseOrders: n(purchases[0], 'orders'),
    customersServed: customers.length, expenseEntries: n(expenses[0], 'entries')
  };
});

route('GET', '/api/v1/reports/sales-trend', 'reports.view', async (ctx) => {
  const { from, to } = range(ctx);
  const scope = await salesScope(ctx);
  const grain = toStr(ctx.query.get('grain'), 10) === 'month' ? monthOf('sold_at') : dayOf('sold_at');
  const rows = await col.sales().aggregate([
    { $match: salesFor(ctx, scope, { status: 'completed', sold_at: between(from, to) }) },
    {
      $group: {
        _id: grain, revenue: { $sum: '$total_paisa' }, profit: { $sum: { $subtract: ['$total_paisa', '$cost_paisa'] } },
        invoices: { $sum: 1 }, discount: { $sum: '$discount_paisa' }
      }
    },
    { $project: { _id: 0, period: '$_id', revenue: 1, profit: 1, invoices: 1, discount: 1 } },
    { $sort: { period: 1 } }
  ]).toArray();
  return { data: rows, range: { from, to } };
});

/** Sale lines in the period, one per document. */
const itemStages = (ctx: PharmacyCtx, scope: SalesScope, from: string, to: string): Document[] => [
  { $match: salesFor(ctx, scope, { status: 'completed', sold_at: between(from, to) }) },
  { $unwind: '$items' }
];

route('GET', '/api/v1/reports/top-medicines', 'reports.view', async (ctx) => {
  const { from, to } = range(ctx);
  const scope = await salesScope(ctx);
  const rows = await col.sales().aggregate([
    ...itemStages(ctx, scope, from, to),
    {
      $group: {
        _id: { id: '$items.medicine_id', name: '$items.medicine_name' }, units: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.line_total_paisa' }, cost: { $sum: { $multiply: ['$items.unit_cost_paisa', '$items.quantity'] } },
        invoices: { $addToSet: '$_id' }
      }
    },
    { $project: { _id: 0, medicine_id: '$_id.id', medicine_name: '$_id.name', units: 1, revenue: 1, cost: 1, profit: { $subtract: ['$revenue', '$cost'] }, invoices: { $size: '$invoices' } } },
    { $sort: { revenue: -1 } },
    { $limit: 25 }
  ]).toArray();
  return { data: rows, range: { from, to } };
}, { feature: 'reports.advanced' });

route('GET', '/api/v1/reports/category-mix', 'reports.view', async (ctx) => {
  const { from, to } = range(ctx);
  const scope = await salesScope(ctx);
  const rows = await col.sales().aggregate([
    ...itemStages(ctx, scope, from, to),
    { $lookup: { from: 'medicines', localField: 'items.medicine_id', foreignField: '_id', as: '__m', pipeline: [{ $project: { category_id: 1 } }] } },
    { $lookup: { from: 'categories', localField: '__m.category_id', foreignField: '_id', as: '__c', pipeline: [{ $project: { name: 1, colour: 1 } }] } },
    {
      $group: {
        _id: { category: { $ifNull: [{ $first: '$__c.name' }, 'Uncategorised'] }, colour: { $ifNull: [{ $first: '$__c.colour' }, null] } },
        units: { $sum: '$items.quantity' }, revenue: { $sum: '$items.line_total_paisa' },
        profit: { $sum: { $subtract: ['$items.line_total_paisa', { $multiply: ['$items.unit_cost_paisa', '$items.quantity'] }] } }
      }
    },
    { $project: { _id: 0, category: '$_id.category', colour: '$_id.colour', units: 1, revenue: 1, profit: 1 } },
    { $sort: { revenue: -1 } }
  ]).toArray();
  return { data: rows, range: { from, to } };
}, { feature: 'reports.advanced' });

route('GET', '/api/v1/reports/staff-performance', 'reports.view', async (ctx) => {
  const { from, to } = range(ctx);
  const scope = await salesScope(ctx);
  /* With each person's profit and role, so the Admin sees what each person,
     and each role, earns the pharmacy. */
  const rows = await col.sales().aggregate([
    { $match: salesFor(ctx, scope, { status: 'completed', sold_at: between(from, to) }) },
    {
      $group: {
        _id: '$served_by', name: { $last: '$served_by_name' }, invoices: { $sum: 1 }, revenue: { $sum: '$total_paisa' },
        profit: { $sum: { $subtract: ['$total_paisa', '$cost_paisa'] } }, discount: { $sum: '$discount_paisa' },
        discounted: { $sum: { $cond: [{ $gt: ['$discount_paisa', 0] }, 1, 0] } }, average_basket: { $avg: '$total_paisa' }
      }
    },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: '__u', pipeline: [{ $project: { role_id: 1 } }] } },
    { $lookup: { from: 'roles', localField: '__u.role_id', foreignField: '_id', as: '__r', pipeline: [{ $project: { name: 1 } }] } },
    { $project: { _id: 0, user_id: '$_id', name: 1, role: { $ifNull: [{ $first: '$__r.name' }, null] }, invoices: 1, revenue: 1, profit: 1, discount: 1, discounted: 1, average_basket: 1 } },
    { $sort: { revenue: -1 } }
  ]).toArray();
  return { data: rows, range: { from, to } };
}, { feature: 'reports.advanced' });

/* Every discount in the period: who gave it, how much, and why. */
route('GET', '/api/v1/reports/discounts', 'reports.view', async (ctx) => {
  const { from, to } = range(ctx);
  const scope = await salesScope(ctx);
  const rows = await col.sales().find(salesFor(ctx, scope, { discount_paisa: { $gt: 0 }, sold_at: between(from, to) }), {
    projection: {
      _id: 1, id: 1, invoice_no: 1, sold_at: 1, served_by: 1, served_by_name: 1, customer_name: 1, subtotal_paisa: 1,
      discount_paisa: 1, total_paisa: 1, discount_reason: 1, discount_note: 1, status: 1
    }
  }).sort({ sold_at: -1 }).limit(500).toArray();
  return {
    data: rows.map(({ served_by, served_by_name, ...row }) => ({
      ...row, user_id: served_by, staff_name: served_by_name,
      percent: row.subtotal_paisa > 0 ? Math.round((row.discount_paisa / row.subtotal_paisa) * 1000) / 10 : 0,
      reason_label: row.discount_reason ? DISCOUNT_REASONS[row.discount_reason] ?? row.discount_reason : 'Not recorded'
    })),
    range: { from, to }
  };
}, { feature: 'reports.advanced' });

/* The people whose figures can be opened one by one, and the roles that can
   be opened combined ("all the cashiers"). */
route('GET', '/api/v1/reports/people', 'reports.everyone', async (ctx) => {
  const rows = await col.users().aggregate<{ id: string; name: string; role_id: string | null; role: string | null; role_level: number | null; status: string }>([
    { $match: { pharmacy_id: ctx.pharmacyId, status: { $ne: 'archived' } } },
    { $lookup: { from: 'roles', localField: 'role_id', foreignField: '_id', as: '__r', pipeline: [{ $project: { name: 1, level: 1 } }] } },
    { $project: { _id: 0, id: '$_id', name: '$full_name', role_id: 1, role: { $first: '$__r.name' }, role_level: { $first: '$__r.level' }, status: 1 } },
    { $sort: { role_level: -1, name: 1 } }
  ]).toArray();
  const roles: { id: string; name: string; plural: string; level: number; people: number }[] = [];
  for (const row of rows) {
    if (!row.role_id || !row.role) continue;
    const known = roles.find((role) => role.id === row.role_id);
    if (known) known.people += 1;
    else roles.push({ id: row.role_id, name: row.role, plural: `All ${plural(row.role)}`, level: row.role_level ?? 0, people: 1 });
  }
  return { data: rows, roles };
});

route('GET', '/api/v1/reports/expenses', 'reports.view', async (ctx) => {
  const { from, to } = range(ctx);
  /* Running costs belong to the whole pharmacy; one person's or one role's
     figures get an empty breakdown, not the pharmacy's bills. */
  const scope = await salesScope(ctx);
  if (!scope.pharmacyWide) return { byCategory: [], byMonth: [], range: { from, to } };
  const match = { pharmacy_id: ctx.pharmacyId, expense_date: { $gte: from, $lte: to }, status: { $ne: 'rejected' } };
  const [byCategory, byMonth] = await Promise.all([
    col.expenses().aggregate([
      { $match: match },
      { $group: { _id: '$category', amount: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } },
      { $project: { _id: 0, category: '$_id', amount: 1, entries: 1 } },
      { $sort: { amount: -1 } }
    ]).toArray(),
    col.expenses().aggregate([
      { $match: match },
      { $group: { _id: { $substrBytes: ['$expense_date', 0, 7] }, amount: { $sum: '$amount_paisa' } } },
      { $project: { _id: 0, period: '$_id', amount: 1 } },
      { $sort: { period: 1 } }
    ]).toArray()
  ]);
  return { byCategory, byMonth, range: { from, to } };
});

route('GET', '/api/v1/reports/stock-valuation', 'reports.view', async (ctx) => {
  const day = today();
  const rows = await col.medicines().aggregate<{ category: string; medicines: number; units: number; cost_value: number; retail_value: number }>([
    { $match: { pharmacy_id: ctx.pharmacyId, status: 'active' } },
    {
      $lookup: {
        from: 'batches', localField: '_id', foreignField: 'medicine_id', as: '__b',
        pipeline: [
          { $match: { status: 'active', expiry_date: { $gt: day } } },
          { $group: { _id: null, units: { $sum: '$quantity' }, cost: { $sum: { $multiply: ['$quantity', '$cost_paisa'] } }, retail: { $sum: { $multiply: ['$quantity', '$price_paisa'] } } } }
        ]
      }
    },
    { $lookup: { from: 'categories', localField: 'category_id', foreignField: '_id', as: '__c', pipeline: [{ $project: { name: 1 } }] } },
    {
      $group: {
        _id: { $ifNull: [{ $first: '$__c.name' }, 'Uncategorised'] }, medicines: { $sum: 1 },
        units: { $sum: { $ifNull: [{ $first: '$__b.units' }, 0] } }, cost_value: { $sum: { $ifNull: [{ $first: '$__b.cost' }, 0] } },
        retail_value: { $sum: { $ifNull: [{ $first: '$__b.retail' }, 0] } }
      }
    },
    { $project: { _id: 0, category: '$_id', medicines: 1, units: 1, cost_value: 1, retail_value: 1 } },
    { $sort: { cost_value: -1 } }
  ]).toArray();
  const totals = rows.reduce(
    (acc, row) => ({ units: acc.units + row.units, costValue: acc.costValue + row.cost_value, retailValue: acc.retailValue + row.retail_value }),
    { units: 0, costValue: 0, retailValue: 0 }
  );
  return { data: rows, totals };
}, { feature: 'reports.advanced' });

/* Export rows. Sent as JSON so the download logic (filename, encoding, CSV
   escaping) lives in one place on the client. */
route('GET', '/api/v1/reports/export', 'reports.export', async (ctx) => {
  const { from, to } = range(ctx);
  const kind = toStr(ctx.query.get('kind'), 30) || 'sales';
  /* Sales and items follow the screens: your own invoices, or anyone's for
     somebody with reports.everyone. Expenses and the audit trail are
     pharmacy-wide, so only they may export them. */
  const scope = await salesScope(ctx);
  if ((kind === 'expenses' || kind === 'audit') && !scope.everyone) {
    forbid("Only someone who can see every staff member's figures can export pharmacy-wide expenses or the audit trail.");
  }
  const rs = (paisa: unknown): number => Math.round(Number(paisa ?? 0)) / 100;
  const day = today();

  const datasets: Record<string, () => Promise<Record<string, unknown>[]>> = {
    sales: async () => (await col.sales().find(salesFor(ctx, scope, { sold_at: between(from, to) }), { projection: { items: 0 } }).sort({ sold_at: -1 }).toArray())
      .map((sale) => ({
        Invoice: sale.invoice_no, Date: sale.sold_at.slice(0, 10), Time: sale.sold_at.slice(11, 19), Customer: sale.customer_name,
        'Served by': sale.served_by_name, Payment: sale.payment_method, Status: sale.status, 'Subtotal (Rs)': rs(sale.subtotal_paisa),
        'Discount (Rs)': rs(sale.discount_paisa), 'Discount reason': sale.discount_reason ? DISCOUNT_REASONS[sale.discount_reason] ?? '' : '',
        'Discount note': sale.discount_note ?? '', 'Total (Rs)': rs(sale.total_paisa), 'Profit (Rs)': rs(sale.total_paisa - sale.cost_paisa)
      })),
    items: async () => (await col.sales().aggregate([...itemStages(ctx, scope, from, to), { $sort: { sold_at: -1 } }]).toArray())
      .map((row) => ({
        Invoice: row.invoice_no, Date: String(row.sold_at).slice(0, 10), Medicine: row.items.medicine_name, Batch: row.items.batch_no,
        Expiry: row.items.expiry_date, Qty: row.items.quantity, 'Unit price (Rs)': rs(row.items.unit_price_paisa), 'Line total (Rs)': rs(row.items.line_total_paisa)
      })),
    inventory: async () => (await col.medicines().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, status: 'active' } },
      ...stockStages(),
      { $lookup: { from: 'categories', localField: 'category_id', foreignField: '_id', as: '__c', pipeline: [{ $project: { name: 1 } }] } },
      { $sort: { name: 1 } }
    ]).toArray()).map((m) => ({
      Medicine: m.name, Generic: m.generic_name, Category: m.__c[0]?.name ?? null, Form: m.form, Strength: m.strength, Shelf: m.shelf_location,
      'On hand': m.on_hand, Minimum: m.min_stock, 'Cost (Rs)': rs(m.cost_paisa), 'Price (Rs)': rs(m.price_paisa)
    })),
    expiry: async () => (await col.batches().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, quantity: { $gt: 0 } } },
      { $lookup: { from: 'medicines', localField: 'medicine_id', foreignField: '_id', as: '__m', pipeline: [{ $project: { name: 1 } }] } },
      { $lookup: { from: 'suppliers', localField: 'supplier_id', foreignField: '_id', as: '__s', pipeline: [{ $project: { name: 1 } }] } },
      { $sort: { expiry_date: 1 } }
    ]).toArray()).map((b) => ({
      Medicine: b.__m[0]?.name ?? '', Batch: b.batch_no, Expiry: b.expiry_date, Units: b.quantity, Status: b.expiry_date <= day && b.status === 'active' ? 'expired' : b.status,
      'Value at cost (Rs)': rs(b.quantity * b.cost_paisa), Supplier: b.__s[0]?.name ?? null
    })),
    expenses: async () => (await col.expenses().find({ pharmacy_id: ctx.pharmacyId, expense_date: { $gte: from, $lte: to } }).sort({ expense_date: -1 }).toArray())
      .map((e) => ({ Date: e.expense_date, Category: e.category, Description: e.description, Vendor: e.vendor, 'Paid by': e.payment_method, Status: e.status, 'Amount (Rs)': rs(e.amount_paisa) })),
    audit: async () => (await col.activityLogs().find({ pharmacy_id: ctx.pharmacyId, created_at: between(from, to) }).sort({ created_at: -1 }).limit(5000).toArray())
      .map((log) => ({ When: log.created_at, Who: log.actor_name, Role: log.actor_role, Action: log.action, Record: log.entity, Detail: log.summary, IP: log.ip }))
  };

  const build = datasets[kind];
  return { data: build ? await build() : [], kind, range: { from, to } };
}, { feature: 'reports.export' });
