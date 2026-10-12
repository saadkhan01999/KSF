/* ==========================================================================
   Platform accounts — KSF's own books, for the Super Admin and Finance
   --------------------------------------------------------------------------
   What the platform earned, what it spent, and what is left:

     Income    subscription payments (by the day they were paid), less the
               refunds completed in the period, plus other income such as
               setup or training fees
     Costs     payment-provider fees, and the platform's expenses — team
               salaries, servers, software, marketing, rent and the rest
     Net       income less costs

   Subscriptions and refunds are read from where they are recorded. This
   module stores only what has no other home: the platform's other income and
   its expenses, one row each, in `platform_entries`. A pharmacy's own
   accounts live in modules/accounting.ts and never mix with these.
   ========================================================================== */

import type { Document, Filter } from 'mongodb';
import { col } from '../db/mongo.js';
import type { PlatformEntry } from '../db/types.js';
import { bad, missing } from '../core/errors.js';
import { logActivity } from '../core/trails.js';
import { contains, nowIso, toStr, uid } from '../core/util.js';
import { lookupField } from '../db/pipeline.js';
import { platformRoute, type SignedInCtx } from '../http/router.js';
import { endOf, MONEY_METHODS, moneyDate, moneyMethod, paisa, period, rs } from './accounting.js';
import { pageResult, paging } from './shared.js';

const VIEW = 'platform.finance.view';
const MANAGE = 'platform.finance.manage';

export const PLATFORM_INCOME_CATEGORIES = [
  'Setup and training fees', 'Custom work and consulting', 'Partnership or referral income', 'Bank profit', 'Other income'
];
export const PLATFORM_EXPENSE_CATEGORIES = [
  'Team salaries', 'Servers and hosting', 'Software and subscriptions', 'Payment and bank charges', 'Marketing and advertising',
  'Office rent', 'Utilities and internet', 'Travel', 'Taxes and government fees', 'Other expenses'
];
const CATEGORIES: Record<PlatformEntry['kind'], string[]> = { income: PLATFORM_INCOME_CATEGORIES, expense: PLATFORM_EXPENSE_CATEGORIES };

/** Subscription payments that brought money in (a refund is its own row). */
const PAID = { $in: ['succeeded', 'refunded'] };
const rupees = (amount: number): string => `Rs ${(amount / 100).toLocaleString('en-PK')}`;
const n = (row: Document | undefined, key: string): number => Number(row?.[key] ?? 0);
const margin = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const trail = (ctx: SignedInCtx) => ({ pharmacyId: null, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent });
const planName: Document = { $ifNull: ['$plan_name', '$plan_key', 'Subscription'] };

/* ============================== THE FIGURES =============================== */

export async function platformProfitAndLoss(from: string, to: string) {
  const moments = { $gte: from, $lte: endOf(to) };
  const [byPlan, [refunds], [fees], entries] = await Promise.all([
    col.subscriptionPayments().aggregate<{ plan: string; amount: number; payments: number }>([
      { $match: { status: PAID, paid_at: moments } },
      { $group: { _id: planName, amount: { $sum: '$amount_paisa' }, payments: { $sum: 1 } } },
      { $project: { _id: 0, plan: '$_id', amount: 1, payments: 1 } },
      { $sort: { amount: -1 } }
    ]).toArray(),
    col.paymentRefunds().aggregate([
      { $match: { status: 'completed', completed_at: moments } },
      { $group: { _id: null, amount: { $sum: '$amount_paisa' }, refunds: { $sum: 1 } } }
    ]).toArray(),
    col.subscriptionPayments().aggregate([
      { $match: { status: PAID, paid_at: moments, fee_paisa: { $gt: 0 } } },
      { $group: { _id: null, amount: { $sum: '$fee_paisa' } } }
    ]).toArray(),
    col.platformEntries().aggregate<{ kind: PlatformEntry['kind']; category: string; amount: number; entries: number }>([
      { $match: { entry_date: { $gte: from, $lte: to } } },
      { $group: { _id: { kind: '$kind', category: '$category' }, amount: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } },
      { $project: { _id: 0, kind: '$_id.kind', category: '$_id.category', amount: 1, entries: 1 } },
      { $sort: { amount: -1 } }
    ]).toArray()
  ]);

  const sum = (rows: Array<{ amount: number }>): number => rows.reduce((total, row) => total + row.amount, 0);
  const strip = ({ category, amount, entries: count }: { category: string; amount: number; entries: number }) => ({ category, amount, entries: count });
  const otherIncome = entries.filter((row) => row.kind === 'income').map(strip);
  const expenses = entries.filter((row) => row.kind === 'expense').map(strip);

  const subscriptions = sum(byPlan);
  const netSubscriptions = subscriptions - n(refunds, 'amount');
  const totalIncome = netSubscriptions + sum(otherIncome);
  const totalCosts = n(fees, 'amount') + sum(expenses);
  const netProfit = totalIncome - totalCosts;

  return {
    income: {
      subscriptionsPaisa: subscriptions, payments: byPlan.reduce((total, row) => total + row.payments, 0), byPlan,
      refundsPaisa: n(refunds, 'amount'), refunds: n(refunds, 'refunds'), netSubscriptionsPaisa: netSubscriptions,
      otherIncome, otherIncomePaisa: sum(otherIncome), totalPaisa: totalIncome
    },
    costs: { feesPaisa: n(fees, 'amount'), expenses, expensesPaisa: sum(expenses), totalPaisa: totalCosts },
    netProfitPaisa: netProfit,
    netMargin: margin(netProfit, totalIncome)
  };
}

/** Where things stand today: what recurs, what is waiting, what is owed back. */
async function platformPosition() {
  const [[paying], [waiting], [owed]] = await Promise.all([
    col.subscriptions().aggregate([
      { $match: { status: { $in: ['active', 'past_due', 'grace'] }, price_paisa: { $gt: 0 } } },
      { $group: { _id: null, pharmacies: { $addToSet: '$pharmacy_id' } } },
      { $project: { _id: 0, pharmacies: { $size: '$pharmacies' } } }
    ]).toArray(),
    col.paymentAttempts().aggregate([
      { $match: { status: { $in: ['created', 'pending'] } } },
      { $group: { _id: null, amount: { $sum: '$amount_paisa' }, attempts: { $sum: 1 } } }
    ]).toArray(),
    col.paymentRefunds().aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, amount: { $sum: '$amount_paisa' }, refunds: { $sum: 1 } } }
    ]).toArray()
  ]);
  return {
    payingPharmacies: n(paying, 'pharmacies'),
    awaitingPaisa: n(waiting, 'amount'), awaitingPayments: n(waiting, 'attempts'),
    refundsOwedPaisa: n(owed, 'amount'), refundsOwed: n(owed, 'refunds')
  };
}

/** Income, costs and profit for each of the twelve months that end with `to`. */
async function platformTrend(to: string) {
  const first = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() - 11);
  const from = first.toISOString().slice(0, 10);
  const moments = { $gte: from, $lte: endOf(to) };
  const byMonth = (field: string, amount: Document | string): Document[] => [
    { $group: { _id: { $substrBytes: [`$${field}`, 0, 7] }, amount: { $sum: amount } } },
    { $project: { _id: 0, period: '$_id', amount: 1 } }
  ];

  const [paid, refunded, fees, income, expenses] = await Promise.all([
    col.subscriptionPayments().aggregate([{ $match: { status: PAID, paid_at: moments } }, ...byMonth('paid_at', '$amount_paisa')]).toArray(),
    col.paymentRefunds().aggregate([{ $match: { status: 'completed', completed_at: moments } }, ...byMonth('completed_at', '$amount_paisa')]).toArray(),
    col.subscriptionPayments().aggregate([{ $match: { status: PAID, paid_at: moments, fee_paisa: { $gt: 0 } } }, ...byMonth('paid_at', '$fee_paisa')]).toArray(),
    col.platformEntries().aggregate([{ $match: { kind: 'income', entry_date: { $gte: from, $lte: to } } }, ...byMonth('entry_date', '$amount_paisa')]).toArray(),
    col.platformEntries().aggregate([{ $match: { kind: 'expense', entry_date: { $gte: from, $lte: to } } }, ...byMonth('entry_date', '$amount_paisa')]).toArray()
  ]);

  const lookup = (rows: Document[]) => new Map(rows.map((row) => [String(row.period), Number(row.amount)]));
  const [paidBy, refundedBy, feesBy, incomeBy, expensesBy] = [paid, refunded, fees, income, expenses].map(lookup);
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    const at = new Date(first);
    at.setUTCMonth(first.getUTCMonth() + i);
    const key = at.toISOString().slice(0, 7);
    const incomeTotal = (paidBy.get(key) ?? 0) - (refundedBy.get(key) ?? 0) + (incomeBy.get(key) ?? 0);
    const costs = (feesBy.get(key) ?? 0) + (expensesBy.get(key) ?? 0);
    rows.push({ period: key, income: incomeTotal, costs, profit: incomeTotal - costs });
  }
  return rows;
}

platformRoute('GET', '/api/v1/platform/accounts/summary', VIEW, async (ctx) => {
  const range = period(ctx);
  const [pnl, position, trend] = await Promise.all([platformProfitAndLoss(range.from, range.to), platformPosition(), platformTrend(range.to)]);
  return { range, profitAndLoss: pnl, position, trend };
});

/* ============================ MONEY IN AND OUT ============================
   Every movement in one list, newest first: subscription payments, refunds,
   and the platform's own income and expenses. */

function ledgerPipeline(from: string, to: string): Document[] {
  const moments = { $gte: from, $lte: endOf(to) };
  return [
    { $match: { status: PAID, paid_at: moments } },
    ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name'),
    {
      $project: {
        _id: 0, id: 1, date: { $substrBytes: ['$paid_at', 0, 10] }, at: '$paid_at', direction: 'in', source: 'subscription',
        category: 'Subscriptions', amount_paisa: 1, payment_method: '$method', reference: { $ifNull: ['$invoice_no', '$provider_reference'] },
        pharmacy_id: 1, description: { $concat: [planName, ' plan — ', { $ifNull: ['$pharmacy_name', 'a pharmacy'] }] }
      }
    },
    {
      $unionWith: {
        coll: 'payment_refunds',
        pipeline: [
          { $match: { status: 'completed', completed_at: moments } },
          ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name'),
          {
            $project: {
              _id: 0, id: 1, date: { $substrBytes: ['$completed_at', 0, 10] }, at: '$completed_at', direction: 'out', source: 'refund',
              category: 'Refunds', amount_paisa: 1, payment_method: '$provider', reference: '$provider_reference', pharmacy_id: 1,
              description: { $concat: ['Refund to ', { $ifNull: ['$pharmacy_name', 'a pharmacy'] }] }
            }
          }
        ]
      }
    },
    {
      $unionWith: {
        coll: 'platform_entries',
        pipeline: [
          { $match: { entry_date: { $gte: from, $lte: to } } },
          {
            $project: {
              _id: 0, id: 1, date: '$entry_date', at: '$created_at', direction: { $cond: [{ $eq: ['$kind', 'income'] }, 'in', 'out'] },
              source: '$kind', category: 1, amount_paisa: 1, payment_method: 1, reference: 1, pharmacy_id: null,
              description: { $cond: [{ $ifNull: ['$party', false] }, { $concat: ['$description', ' — ', '$party'] }, '$description'] }
            }
          }
        ]
      }
    }
  ];
}

platformRoute('GET', '/api/v1/platform/accounts/transactions', VIEW, async (ctx) => {
  const range = period(ctx);
  const { page, size, skip } = paging(ctx, 50);
  const direction = toStr(ctx.query.get('direction'), 4);
  const search = toStr(ctx.query.get('q'), 80);
  const filter: Document = {};
  if (direction === 'in' || direction === 'out') filter.direction = direction;
  if (search) filter.$or = [{ description: contains(search) }, { category: contains(search) }, { reference: contains(search) }];

  const [result] = await col.subscriptionPayments().aggregate([
    ...ledgerPipeline(range.from, range.to),
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

/* ========================= OTHER INCOME AND EXPENSES ====================== */

const entryOut = async (id: string) => (await col.platformEntries().aggregate([
  { $match: { _id: id } },
  ...lookupField('users', 'created_by', 'full_name', 'created_by_name')
]).toArray())[0];

function readEntry(ctx: SignedInCtx, existing?: PlatformEntry) {
  const kind = (toStr(ctx.body.kind, 10) || existing?.kind || '') as PlatformEntry['kind'];
  if (!(kind in CATEGORIES)) bad('Choose income or expense.', 'kind');
  const category = toStr(ctx.body.category, 60) || existing?.category || '';
  if (!CATEGORIES[kind].includes(category)) bad(`Choose what kind of ${kind} this is.`, 'category');
  const description = toStr(ctx.body.description, 300) || existing?.description || '';
  if (!description) bad(kind === 'income' ? 'Describe where the money came from.' : 'Describe what the money was spent on.', 'description');
  const amount = ctx.body.amountPaisa === undefined && existing ? existing.amount_paisa : paisa(ctx.body.amountPaisa, 'amountPaisa');
  if (amount <= 0) bad('Enter an amount above zero.', 'amountPaisa');
  return {
    kind, category, description, amount_paisa: amount,
    entry_date: moneyDate(ctx.body.entryDate, 'entryDate', existing?.entry_date),
    payment_method: moneyMethod(ctx.body.paymentMethod, existing?.payment_method ?? 'bank-transfer'),
    reference: ctx.body.reference === undefined ? existing?.reference ?? null : toStr(ctx.body.reference, 80) || null,
    party: ctx.body.party === undefined ? existing?.party ?? null : toStr(ctx.body.party, 120) || null
  };
}

platformRoute('GET', '/api/v1/platform/accounts/entries', VIEW, async (ctx) => {
  const range = period(ctx);
  const { page, size, skip } = paging(ctx, 25);
  const filter: Filter<PlatformEntry> = { entry_date: { $gte: range.from, $lte: range.to } };
  const kind = toStr(ctx.query.get('kind'), 10);
  if (kind === 'income' || kind === 'expense') filter.kind = kind;
  const category = toStr(ctx.query.get('category'), 60);
  if (category) filter.category = category;
  const search = toStr(ctx.query.get('q'), 80);
  if (search) filter.$or = [{ description: contains(search) }, { party: contains(search) }, { reference: contains(search) }];

  const [rows, total, totals, team] = await Promise.all([
    col.platformEntries().aggregate([
      { $match: filter }, { $sort: { entry_date: -1, created_at: -1 } }, { $skip: skip }, { $limit: size },
      ...lookupField('users', 'created_by', 'full_name', 'created_by_name')
    ]).toArray(),
    col.platformEntries().countDocuments(filter),
    col.platformEntries().aggregate([{ $match: filter }, { $group: { _id: '$kind', amount: { $sum: '$amount_paisa' }, entries: { $sum: 1 } } }]).toArray(),
    /* Names for "Paid to": the Super Admin and the team, for salaries. */
    col.users().find(
      { status: 'active', $or: [{ is_platform_admin: 1 }, { is_platform_staff: 1 }] },
      { projection: { full_name: 1 } }
    ).sort({ full_name: 1 }).toArray()
  ]);
  const of = (which: string) => totals.find((row) => row._id === which);
  return {
    ...pageResult(rows, total, { page, size }),
    summary: {
      incomePaisa: n(of('income'), 'amount'), expensesPaisa: n(of('expense'), 'amount'),
      entries: n(of('income'), 'entries') + n(of('expense'), 'entries')
    },
    categories: CATEGORIES, methods: MONEY_METHODS, team: team.map((person) => person.full_name), range
  };
});

platformRoute('POST', '/api/v1/platform/accounts/entries', MANAGE, async (ctx) => {
  const fields = readEntry(ctx);
  const id = uid(fields.kind === 'income' ? 'PIN' : 'PEX');
  const at = nowIso();
  await col.platformEntries().insertOne({ _id: id, id, ...fields, created_by: ctx.user.id, created_at: at, updated_at: at });
  await logActivity(trail(ctx), {
    action: `platform.${fields.kind}-recorded`, entity: 'platform-entry', entityId: id,
    summary: `${fields.kind === 'income' ? 'Income' : 'Expense'} recorded: ${fields.category} — ${rupees(fields.amount_paisa)} (${fields.description})`
  });
  return { data: await entryOut(id), __status: 201 };
});

platformRoute('PATCH', '/api/v1/platform/accounts/entries/:id', MANAGE, async (ctx) => {
  const entry = await col.platformEntries().findOne({ _id: toStr(ctx.params.id, 40) });
  if (!entry) return missing('That entry could not be found.');
  const fields = readEntry(ctx, entry);
  await col.platformEntries().updateOne({ _id: entry.id }, { $set: { ...fields, updated_at: nowIso() } });
  await logActivity(trail(ctx), {
    action: `platform.${fields.kind}-updated`, entity: 'platform-entry', entityId: entry.id,
    summary: `${fields.description}: ${rupees(entry.amount_paisa)} → ${rupees(fields.amount_paisa)}`
  });
  return { data: await entryOut(entry.id) };
});

platformRoute('DELETE', '/api/v1/platform/accounts/entries/:id', MANAGE, async (ctx) => {
  const entry = await col.platformEntries().findOne({ _id: toStr(ctx.params.id, 40) });
  if (!entry) return missing('That entry could not be found.');
  await col.platformEntries().deleteOne({ _id: entry.id });
  await logActivity(trail(ctx), {
    action: `platform.${entry.kind}-deleted`, entity: 'platform-entry', entityId: entry.id, severity: 'warn',
    summary: `${entry.kind === 'income' ? 'Income' : 'Expense'} deleted: ${entry.description} (${rupees(entry.amount_paisa)})`, meta: entry
  });
  return { ok: true };
});

/* ================================= EXPORT ================================= */

async function profitAndLossRows(from: string, to: string) {
  const pnl = await platformProfitAndLoss(from, to);
  const line = (section: string, item: string, amount: number) => ({ Section: section, Line: item, 'Amount (Rs)': rs(amount) });
  return [
    ...pnl.income.byPlan.map((row) => line('Income', `${row.plan} plan (${row.payments} payment${row.payments === 1 ? '' : 's'})`, row.amount)),
    line('Income', 'Refunds', -pnl.income.refundsPaisa),
    ...pnl.income.otherIncome.map((row) => line('Income', row.category, row.amount)),
    line('Income', 'Total income', pnl.income.totalPaisa),
    line('Costs', 'Payment provider fees', pnl.costs.feesPaisa),
    ...pnl.costs.expenses.map((row) => line('Costs', row.category, row.amount)),
    line('Costs', 'Total costs', pnl.costs.totalPaisa),
    line('Net profit', `Net profit (${pnl.netMargin}% of income)`, pnl.netProfitPaisa)
  ];
}

platformRoute('GET', '/api/v1/platform/accounts/export', VIEW, async (ctx) => {
  const range = period(ctx);
  const kind = toStr(ctx.query.get('kind'), 30) || 'profit-and-loss';
  const label = (method: string | null): string => (method ? method.replace('-', ' ') : '');

  const datasets: Record<string, () => Promise<Record<string, unknown>[]>> = {
    'profit-and-loss': () => profitAndLossRows(range.from, range.to),
    transactions: async () => (await col.subscriptionPayments().aggregate([...ledgerPipeline(range.from, range.to), { $sort: { date: -1, at: -1 } }]).toArray())
      .map((row) => ({
        Date: row.date, Direction: row.direction === 'in' ? 'Money in' : 'Money out', Category: row.category, Description: row.description,
        'Paid by': label(row.payment_method), Reference: row.reference ?? '', 'Amount (Rs)': rs(row.direction === 'in' ? row.amount_paisa : -row.amount_paisa)
      })),
    entries: async () => (await col.platformEntries().find({ entry_date: { $gte: range.from, $lte: range.to } }).sort({ entry_date: -1 }).toArray())
      .map((row) => ({
        Date: row.entry_date, Type: row.kind === 'income' ? 'Income' : 'Expense', Category: row.category, Description: row.description,
        'Received from or paid to': row.party ?? '', 'Paid by': label(row.payment_method), Reference: row.reference ?? '',
        'Amount (Rs)': rs(row.kind === 'income' ? row.amount_paisa : -row.amount_paisa)
      }))
  };
  const build = datasets[kind];
  if (!build) bad(`Choose one of: ${Object.keys(datasets).join(', ')}.`, 'kind');
  return { data: await build(), kind, range };
});
