/* ==========================================================================
   The platform console — the Super Admin's view of every pharmacy
   --------------------------------------------------------------------------
   One account runs the whole service. From here it sees all pharmacies
   combined and each one on its own: what they sell, what they pay, who is
   stuck, and what they have asked for help with. It can change a pharmacy's
   plan, extend it, record an offline payment, confirm a bank transfer,
   refund, suspend or reactivate — and for anything inside a pharmacy (a
   locked cashier, a wrong price, a role that needs a permission) it opens
   that pharmacy in support mode, with every action logged as "Super Admin
   (support)".

   Every route here is platformRoute: refused for anybody who is not the
   Super Admin or a member of their team holding the permission the route
   names, whatever the browser sends.
   ========================================================================== */

import type { Document, Filter } from 'mongodb';
import { col } from '../db/mongo.js';
import type { Pharmacy, Plan, SubscriptionPayment } from '../db/types.js';
import { bad, missing } from '../core/errors.js';
import { auditLog, logActivity, notify } from '../core/trails.js';
import { asRead, platformNotices, unreadPlatformNotices } from '../core/platform-notices.js';
import { addDays, contains, nowIso, slugify, startOfMonth, today, toInt, toStr } from '../core/util.js';
import { lookupField, monthOf } from '../db/pipeline.js';
import { platformRoute, type SignedInCtx } from '../http/router.js';
import { forgetPharmacyStatus } from '../http/authenticate.js';
import { FEATURE_KEYS, FEATURES } from '../domain/plans.js';
import { revokeAllSessions } from '../security/sessions.js';
import { changePlan, currentSubscription, getPlan, planView, recordPayment, subscriptionState } from '../services/subscriptions.js';
import { applyRefund, attemptsFor, listProviders, reconcile, requestRefund, verifyManualPayment, type PaymentActor } from '../services/payments/index.js';
import { helpItems } from './people.js';
import { pageResult, paging, stockStages } from './shared.js';

const rupees = (paisa: number): string => `Rs ${(paisa / 100).toLocaleString('en-PK')}`;
const n = (row: Document | undefined, key: string): number => Number(row?.[key] ?? 0);

/** Trails written into a pharmacy's own logs, by the platform. */
const trailFor = (ctx: SignedInCtx, pharmacyId: string) => ({ pharmacyId, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent });
const actorOf = (ctx: SignedInCtx): PaymentActor => ({
  id: ctx.user.id, full_name: ctx.user.full_name, role_name: ctx.isPlatformStaff ? `KSF team: ${ctx.user.role_name}` : 'Super Admin', ip: ctx.ip, userAgent: ctx.userAgent
});
const reader = (ctx: SignedInCtx) => ({ userId: ctx.user.id, isPlatformAdmin: ctx.isPlatformAdmin, platformPermissions: ctx.platformPermissions });

async function pharmacyOr404(id: unknown): Promise<Pharmacy> {
  const pharmacy = await col.pharmacies().findOne({ _id: toStr(id, 60) });
  if (!pharmacy) return missing('That pharmacy could not be found.');
  return pharmacy;
}

/** Money the platform received: succeeded payments less what was refunded. */
const incomeGroup = (): Document => ({
  _id: null, gross: { $sum: '$amount_paisa' }, refunded: { $sum: { $ifNull: ['$refunded_paisa', 0] } }, payments: { $sum: 1 }
});
const PAID: Filter<SubscriptionPayment> = { status: { $in: ['succeeded', 'refunded'] } };

/* ================================ OVERVIEW ================================ */
platformRoute('GET', '/api/v1/platform/overview', 'platform.overview', async () => {
  const now = today();
  const monthStart = startOfMonth(0);
  const lastMonthStart = startOfMonth(-1);
  const since30 = addDays(-30);

  const [pharmacyCounts, staff, [income], subscriptions, [sales], topPharmacies, tickets, recentSignups, recentPayments, trials] = await Promise.all([
    col.pharmacies().aggregate<{ _id: string; n: number; new30: number }>([
      { $group: { _id: '$status', n: { $sum: 1 }, new30: { $sum: { $cond: [{ $gte: ['$created_at', since30] }, 1, 0] } } } }
    ]).toArray(),
    col.users().countDocuments({ pharmacy_id: { $ne: null }, status: 'active' }),
    col.subscriptionPayments().aggregate([
      { $match: PAID },
      {
        $facet: {
          allTime: [{ $group: incomeGroup() }],
          month: [{ $match: { paid_at: { $gte: monthStart } } }, { $group: incomeGroup() }],
          lastMonth: [{ $match: { paid_at: { $gte: lastMonthStart, $lt: monthStart } } }, { $group: incomeGroup() }],
          trend: [
            { $match: { paid_at: { $gte: startOfMonth(-11) } } },
            { $group: { _id: monthOf('paid_at'), gross: { $sum: '$amount_paisa' }, refunded: { $sum: { $ifNull: ['$refunded_paisa', 0] } }, payments: { $sum: 1 } } },
            { $project: { _id: 0, period: '$_id', gross: 1, refunded: 1, net: { $subtract: ['$gross', '$refunded'] }, payments: 1 } },
            { $sort: { period: 1 } }
          ]
        }
      }
    ]).toArray(),
    col.subscriptions().aggregate<{ _id: { plan: string; status: string }; n: number; price: number }>([
      { $sort: { created_at: -1 } },
      { $group: { _id: '$pharmacy_id', doc: { $first: '$$ROOT' } } },
      { $replaceWith: '$doc' },
      { $lookup: { from: 'subscription_plans', localField: 'plan_id', foreignField: '_id', as: '__p', pipeline: [{ $project: { period: 1, period_days: 1 } }] } },
      {
        $group: {
          _id: { plan: '$plan_key', status: '$status' }, n: { $sum: 1 },
          /* Monthly recurring revenue: each paid plan's price, brought to a month. */
          price: {
            $sum: {
              $cond: [{ $in: ['$status', ['active', 'past_due', 'grace']] }, {
                $switch: {
                  branches: [
                    { case: { $eq: [{ $first: '$__p.period' }, 'week'] }, then: { $multiply: ['$price_paisa', 52 / 12] } },
                    { case: { $eq: [{ $first: '$__p.period' }, 'year'] }, then: { $divide: ['$price_paisa', 12] } },
                    { case: { $eq: [{ $first: '$__p.period' }, 'perpetual'] }, then: 0 }
                  ],
                  default: '$price_paisa'
                }
              }, 0]
            }
          }
        }
      }
    ]).toArray(),
    /* Everything every pharmacy sold — the platform's view of its customers' business. */
    col.sales().aggregate([
      { $match: { status: 'completed', sold_at: { $gte: lastMonthStart } } },
      {
        $facet: {
          today: [{ $match: { sold_at: { $gte: now } } }, { $group: { _id: null, revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } }],
          month: [{ $match: { sold_at: { $gte: monthStart } } }, { $group: { _id: null, revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 }, profit: { $sum: { $subtract: ['$total_paisa', '$cost_paisa'] } } } }],
          lastMonth: [{ $match: { sold_at: { $lt: monthStart } } }, { $group: { _id: null, revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } }]
        }
      }
    ]).toArray(),
    col.sales().aggregate([
      { $match: { status: 'completed', sold_at: { $gte: monthStart } } },
      { $group: { _id: '$pharmacy_id', revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
      ...lookupField('pharmacies', '_id', 'name', 'name'),
      { $project: { _id: 0, pharmacy_id: '$_id', name: 1, revenue: 1, invoices: 1 } }
    ]).toArray(),
    col.supportTickets().aggregate<{ _id: string; n: number; urgent: number; unread: number }>([
      { $group: { _id: '$status', n: { $sum: 1 }, urgent: { $sum: { $cond: [{ $in: ['$priority', ['high', 'urgent']] }, 1, 0] } }, unread: { $sum: '$unread_by_platform' } } }
    ]).toArray(),
    col.pharmacies().find({}, { projection: { _id: 0, id: 1, name: 1, city: 1, plan_key: 1, status: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(6).toArray(),
    col.subscriptionPayments().aggregate([
      { $match: PAID }, { $sort: { paid_at: -1 } }, { $limit: 6 },
      ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name'),
      { $project: { _id: 0, id: 1, pharmacy_id: 1, pharmacy_name: 1, amount_paisa: 1, provider: 1, method: 1, kind: 1, paid_at: 1, status: 1 } }
    ]).toArray(),
    col.trials().countDocuments({ status: 'active' })
  ]);

  const count = (status: string) => pharmacyCounts.find((row) => row._id === status)?.n ?? 0;
  const open = tickets.filter((row) => ['open', 'in_progress', 'waiting'].includes(row._id));
  const net = (row: Document | undefined) => n(row, 'gross') - n(row, 'refunded');
  const byPlan = new Map<string, { plan: string; pharmacies: number; paying: number }>();
  const byStatus: Record<string, number> = {};
  let mrr = 0;
  for (const row of subscriptions) {
    const entry = byPlan.get(row._id.plan) ?? { plan: row._id.plan, pharmacies: 0, paying: 0 };
    entry.pharmacies += row.n;
    if (row.price > 0) entry.paying += row.n;
    byPlan.set(row._id.plan, entry);
    byStatus[row._id.status] = (byStatus[row._id.status] ?? 0) + row.n;
    mrr += row.price;
  }

  return {
    pharmacies: {
      total: pharmacyCounts.reduce((sum, row) => sum + row.n, 0), active: count('active'), suspended: count('suspended'), closed: count('closed'),
      new30: pharmacyCounts.reduce((sum, row) => sum + row.new30, 0), staff
    },
    income: {
      monthPaisa: net(income?.month?.[0]), lastMonthPaisa: net(income?.lastMonth?.[0]), allTimePaisa: net(income?.allTime?.[0]),
      refundedPaisa: n(income?.allTime?.[0], 'refunded'), payments: n(income?.allTime?.[0], 'payments'),
      mrrPaisa: Math.round(mrr), trend: income?.trend ?? []
    },
    subscriptions: { byPlan: [...byPlan.values()].sort((a, b) => b.pharmacies - a.pharmacies), byStatus, trialsActive: trials },
    sales: {
      todayPaisa: n(sales?.today?.[0], 'revenue'), todayInvoices: n(sales?.today?.[0], 'invoices'),
      monthPaisa: n(sales?.month?.[0], 'revenue'), monthInvoices: n(sales?.month?.[0], 'invoices'), monthProfitPaisa: n(sales?.month?.[0], 'profit'),
      lastMonthPaisa: n(sales?.lastMonth?.[0], 'revenue'), topPharmacies
    },
    support: {
      open: open.reduce((sum, row) => sum + row.n, 0), urgent: open.reduce((sum, row) => sum + row.urgent, 0),
      unread: tickets.reduce((sum, row) => sum + row.unread, 0), resolved: tickets.find((row) => row._id === 'resolved')?.n ?? 0
    },
    recentSignups, recentPayments
  };
});

/* ================================ PHARMACIES ================================ */
platformRoute('GET', '/api/v1/platform/pharmacies', 'platform.pharmacies.view', async (ctx) => {
  const { page, size, skip } = paging(ctx, 25);
  const search = toStr(ctx.query.get('q'), 80);
  const status = toStr(ctx.query.get('status'), 20);
  const plan = toStr(ctx.query.get('plan'), 30);
  const match: Filter<Pharmacy> = {};
  if (status && status !== 'all') match.status = status as Pharmacy['status'];
  if (plan && plan !== 'all') match.plan_key = plan;
  if (search) {
    const pattern = contains(search);
    const owners = await col.users().distinct('pharmacy_id', { is_owner: 1, $or: [{ full_name: pattern }, { email: pattern }, { phone: pattern }] });
    match.$or = [{ name: pattern }, { city: pattern }, { email: pattern }, { phone: pattern }, { _id: { $in: owners.filter((id): id is string => !!id) } }];
  }
  const since30 = addDays(-30);
  const [rows, total] = await Promise.all([
    col.pharmacies().aggregate([
      { $match: match },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: size },
      {
        $lookup: {
          from: 'users', localField: '_id', foreignField: 'pharmacy_id', as: '__u',
          pipeline: [{ $match: { status: { $ne: 'archived' } } }, { $project: { full_name: 1, email: 1, phone: 1, is_owner: 1, last_login_at: 1, status: 1 } }]
        }
      },
      { $lookup: { from: 'subscriptions', localField: 'subscription_id', foreignField: '_id', as: '__s', pipeline: [{ $project: { status: 1, current_period_end: 1, price_paisa: 1 } }] } },
      {
        $lookup: {
          from: 'sales', localField: '_id', foreignField: 'pharmacy_id', as: '__sales',
          pipeline: [{ $match: { status: 'completed', sold_at: { $gte: since30 } } }, { $group: { _id: null, revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } }]
        }
      },
      { $lookup: { from: 'support_tickets', localField: '_id', foreignField: 'pharmacy_id', as: '__t', pipeline: [{ $match: { status: { $in: ['open', 'in_progress', 'waiting'] } } }, { $count: 'n' }] } },
      {
        $project: {
          _id: 0, id: 1, name: 1, city: 1, province: 1, phone: 1, email: 1, status: 1, plan_key: 1, pharmacy_type: 1, platform_note: 1, created_at: 1,
          owner: { $first: { $filter: { input: '$__u', cond: { $eq: ['$$this.is_owner', 1] } } } },
          staff_count: { $size: { $filter: { input: '$__u', cond: { $eq: ['$$this.status', 'active'] } } } },
          last_active_at: { $max: '$__u.last_login_at' },
          subscription_status: { $first: '$__s.status' }, period_end: { $first: '$__s.current_period_end' }, price_paisa: { $first: '$__s.price_paisa' },
          revenue_30d: { $ifNull: [{ $first: '$__sales.revenue' }, 0] }, invoices_30d: { $ifNull: [{ $first: '$__sales.invoices' }, 0] },
          open_tickets: { $ifNull: [{ $first: '$__t.n' }, 0] }
        }
      },
      { $set: { owner: { id: '$owner._id', name: '$owner.full_name', email: '$owner.email', phone: '$owner.phone' } } }
    ]).toArray(),
    col.pharmacies().countDocuments(match)
  ]);
  const plans = (await col.plans().find({}, { projection: { key: 1, name: 1 } }).sort({ sort_order: 1 }).toArray()).map((row) => ({ key: row.key, name: row.name }));
  return { ...pageResult(rows, total, { page, size }), plans };
});

platformRoute('GET', '/api/v1/platform/pharmacies/:id', 'platform.pharmacies.view', async (ctx) => {
  const pharmacy = await pharmacyOr404(ctx.params.id);
  const id = pharmacy.id;
  const monthStart = startOfMonth(0);
  const [subscription, staff, branches, [sales], stockRows, customers, payments, attempts, tickets, activity, help] = await Promise.all([
    subscriptionState(id),
    col.users().aggregate([
      { $match: { pharmacy_id: id, status: { $ne: 'archived' } } },
      ...lookupField('roles', 'role_id', 'name', 'role_name'),
      ...lookupField('branches', 'branch_id', 'name', 'branch_name'),
      { $project: { _id: 0, id: 1, full_name: 1, email: 1, phone: 1, status: 1, is_owner: 1, role_name: 1, branch_name: 1, last_login_at: 1, locked_until: 1, failed_attempts: 1, totp_enabled: 1 } },
      { $sort: { is_owner: -1, full_name: 1 } }
    ]).toArray(),
    col.branches().find({ pharmacy_id: id }, { projection: { _id: 0, id: 1, name: 1, code: 1, city: 1, is_main: 1, status: 1 } }).toArray(),
    col.sales().aggregate([
      { $match: { pharmacy_id: id, status: 'completed' } },
      {
        $facet: {
          today: [{ $match: { sold_at: { $gte: today() } } }, { $group: { _id: null, revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } }],
          month: [{ $match: { sold_at: { $gte: monthStart } } }, { $group: { _id: null, revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 }, profit: { $sum: { $subtract: ['$total_paisa', '$cost_paisa'] } } } }],
          allTime: [{ $group: { _id: null, revenue: { $sum: '$total_paisa' }, invoices: { $sum: 1 } } }]
        }
      }
    ]).toArray(),
    col.medicines().aggregate([
      { $match: { pharmacy_id: id, status: 'active' } },
      { $project: { min_stock: 1, cost_paisa: 1 } },
      ...stockStages(),
      { $group: { _id: null, medicines: { $sum: 1 }, low: { $sum: { $cond: [{ $lte: ['$on_hand', '$min_stock'] }, 1, 0] } }, value: { $sum: { $multiply: ['$on_hand', '$cost_paisa'] } } } }
    ]).toArray(),
    col.customers().countDocuments({ pharmacy_id: id, status: { $ne: 'archived' } }),
    col.subscriptionPayments().find({ pharmacy_id: id }).sort({ created_at: -1 }).limit(25).toArray(),
    attemptsFor(id, 20),
    col.supportTickets().find({ pharmacy_id: id }, { projection: { messages: 0 } }).sort({ last_activity_at: -1 }).limit(10).toArray(),
    col.activityLogs().find({ pharmacy_id: id }, { projection: { _id: 0, id: 1, actor_name: 1, actor_role: 1, action: 1, summary: 1, severity: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(25).toArray(),
    helpItems(id, { id: ctx.user.id, level: 10_000, top: true })
  ]);
  const [stock] = stockRows;
  return {
    data: pharmacy,
    owner: staff.find((person) => person.is_owner) ?? null,
    subscription, staff, branches, payments, attempts, tickets, activity, help,
    figures: {
      todayPaisa: n(sales?.today?.[0], 'revenue'), todayInvoices: n(sales?.today?.[0], 'invoices'),
      monthPaisa: n(sales?.month?.[0], 'revenue'), monthInvoices: n(sales?.month?.[0], 'invoices'), monthProfitPaisa: n(sales?.month?.[0], 'profit'),
      allTimePaisa: n(sales?.allTime?.[0], 'revenue'), allTimeInvoices: n(sales?.allTime?.[0], 'invoices'),
      medicines: n(stock, 'medicines'), lowStock: n(stock, 'low'), stockValuePaisa: n(stock, 'value'), customers
    }
  };
});

platformRoute('PATCH', '/api/v1/platform/pharmacies/:id', 'platform.pharmacies.manage', async (ctx) => {
  const pharmacy = await pharmacyOr404(ctx.params.id);
  const body = ctx.body;
  const set: Partial<Pharmacy> = { updated_at: nowIso() };
  const text = (key: string, max: number) => (body[key] === undefined ? undefined : toStr(body[key], max) || null);
  if (body.name !== undefined) {
    const name = toStr(body.name, 140);
    if (!name) bad('A pharmacy needs a name.', 'name');
    set.name = name;
    set.logo_initials = name.slice(0, 3).toUpperCase();
  }
  const fields: Array<[keyof Pharmacy, string, number]> = [
    ['legal_name', 'legalName', 140], ['email', 'email', 160], ['phone', 'phone', 40], ['address', 'address', 300], ['city', 'city', 80],
    ['province', 'province', 60], ['ntn', 'ntn', 40], ['drap_licence', 'drapLicence', 60], ['platform_note', 'platformNote', 1000]
  ];
  for (const [field, key, max] of fields) {
    const value = text(key, max);
    if (value !== undefined) (set as Record<string, unknown>)[field] = value;
  }
  for (const [field, key] of [['device_limit_desktop', 'deviceLimitDesktop'], ['device_limit_mobile', 'deviceLimitMobile']] as const) {
    if (body[key] === undefined) continue;
    const limit = body[key] === null || body[key] === '' ? null : toInt(body[key], -1);
    if (limit !== null && (limit < 1 || limit > 100)) bad('A device limit must be between 1 and 100, or empty for the plan default.', key);
    set[field] = limit;
  }
  const updated = await col.pharmacies().findOneAndUpdate({ _id: pharmacy.id }, { $set: set }, { returnDocument: 'after' });
  await auditLog(trailFor(ctx, pharmacy.id), { action: 'platform.pharmacy-updated', entity: 'pharmacy', entityId: pharmacy.id, summary: 'Pharmacy details changed by the platform', before: pharmacy, after: updated });
  return { data: updated };
});

/**
 * Suspend, reactivate or close a pharmacy. Suspending signs every one of its
 * people out at once; nothing is deleted, and reactivating brings everything
 * back exactly as it was.
 */
platformRoute('POST', '/api/v1/platform/pharmacies/:id/status', 'platform.pharmacies.manage', async (ctx) => {
  ctx.requireRecentVerification();
  const pharmacy = await pharmacyOr404(ctx.params.id);
  const status = toStr(ctx.body.status, 20) as Pharmacy['status'];
  if (!['active', 'suspended', 'closed'].includes(status)) bad('Choose active, suspended or closed.', 'status');
  if (status === pharmacy.status) bad(`${pharmacy.name} is already ${status}.`);
  const reason = toStr(ctx.body.reason, 500);
  if (status !== 'active' && !reason) bad('Write down why — the pharmacy will be told.', 'reason');

  await col.pharmacies().updateOne({ _id: pharmacy.id }, { $set: { status, platform_note: reason || pharmacy.platform_note || null, updated_at: nowIso() } });
  forgetPharmacyStatus(pharmacy.id);
  let signedOut = 0;
  if (status !== 'active') {
    for (const user of await col.users().find({ pharmacy_id: pharmacy.id }, { projection: { _id: 1 } }).toArray()) {
      signedOut += await revokeAllSessions(user._id, { reason: `pharmacy-${status}` });
    }
  }
  await auditLog(trailFor(ctx, pharmacy.id), { action: `platform.pharmacy-${status}`, entity: 'pharmacy', entityId: pharmacy.id, summary: `${pharmacy.name} ${status === 'active' ? 'reactivated' : status} by the platform${reason ? ` — ${reason}` : ''}` });
  await notify(pharmacy.id, {
    type: 'system', severity: status === 'active' ? 'success' : 'danger',
    title: status === 'active' ? 'Your pharmacy has been reactivated' : `Your pharmacy has been ${status}`,
    body: status === 'active' ? 'Everyone can sign in again. Nothing was removed.' : `${reason} Contact KSF support to resolve it. No records have been deleted.`, link: '/support'
  });
  return { ok: true, status, signedOut, message: status === 'active' ? `${pharmacy.name} is active again.` : `${pharmacy.name} is ${status}. ${signedOut} session(s) were ended.` };
});

/**
 * Change a pharmacy's plan without a payment (a complimentary or negotiated
 * plan), or extend the current period. Recorded in the pharmacy's audit
 * chain, so the pharmacy can see who changed its plan and why.
 */
platformRoute('POST', '/api/v1/platform/pharmacies/:id/subscription', 'platform.pharmacies.manage', async (ctx) => {
  const pharmacy = await pharmacyOr404(ctx.params.id);
  const note = toStr(ctx.body.note, 300);
  const planKey = toStr(ctx.body.planKey, 30);
  const extendDays = toInt(ctx.body.extendDays, 0);
  if (!planKey && !extendDays) bad('Choose a plan, or the number of days to extend by.');
  if (extendDays < 0 || extendDays > 3660) bad('Extend by between 1 and 3660 days.', 'extendDays');
  const before = await subscriptionState(pharmacy.id);

  if (planKey) {
    const plan = await getPlan(planKey);
    if (!plan || plan.status !== 'active') bad('That plan does not exist or is switched off.', 'planKey');
    const result = await changePlan({ pharmacyId: pharmacy.id, planKey, activate: true });
    if (!result.ok) bad(result.reason ?? 'The plan could not be changed.');
  }
  if (extendDays) {
    const subscription = await currentSubscription(pharmacy.id);
    if (!subscription) bad('This pharmacy has no subscription to extend.');
    const from = new Date(Math.max(Date.now(), new Date(subscription!.current_period_end).getTime()));
    const until = new Date(from.getTime() + extendDays * 86_400_000).toISOString();
    await col.subscriptions().updateOne({ _id: subscription!.id }, {
      $set: { current_period_end: until, renewal_at: subscription!.is_free ? null : until, status: 'active', grace_until: null, updated_at: nowIso() }
    });
  }
  const after = await subscriptionState(pharmacy.id);
  const summary = [planKey ? `plan set to ${after?.planName}` : null, extendDays ? `extended by ${extendDays} day(s) to ${String(after?.periodEnd).slice(0, 10)}` : null].filter(Boolean).join(', ');
  await auditLog(trailFor(ctx, pharmacy.id), {
    action: 'platform.subscription-changed', entity: 'subscription', entityId: after?.subscriptionId, summary: `Subscription ${summary} by the platform${note ? ` — ${note}` : ''}`,
    before: { plan: before?.plan, status: before?.status, periodEnd: before?.periodEnd }, after: { plan: after?.plan, status: after?.status, periodEnd: after?.periodEnd }
  });
  await notify(pharmacy.id, { type: 'billing', severity: 'success', title: 'Your subscription was updated', body: `KSF ${summary}.`, link: '/settings?tab=billing' });
  return { subscription: after, message: `${pharmacy.name}: ${summary}.` };
});

/** Money received outside a provider — cash at the office, a cheque — recorded against the subscription. */
platformRoute('POST', '/api/v1/platform/pharmacies/:id/payments', 'platform.finance.manage', async (ctx) => {
  const pharmacy = await pharmacyOr404(ctx.params.id);
  const subscription = await currentSubscription(pharmacy.id);
  if (!subscription) return bad('This pharmacy has no subscription to pay for.');
  const amount = toInt(ctx.body.amountPaisa, 0);
  if (amount <= 0) bad('Enter the amount received.', 'amountPaisa');
  const reference = toStr(ctx.body.reference, 120);
  if (!reference) bad('Record a reference — a receipt, cheque or slip number — so the payment can be traced.', 'reference');
  const method = toStr(ctx.body.method, 30) || 'cash';
  const result = await recordPayment({
    pharmacyId: pharmacy.id, subscriptionId: subscription.id, amountPaisa: amount, currency: subscription.currency, status: 'succeeded',
    kind: 'manual', provider: 'manual', providerReference: reference, method, verifiedBy: ctx.user.id
  });
  if (!result.ok) bad(result.reason ?? 'The payment could not be recorded.');
  if (result.duplicate) bad('A payment with that reference has already been recorded.', 'reference');
  await auditLog(trailFor(ctx, pharmacy.id), { action: 'platform.payment-recorded', entity: 'payment', entityId: result.payment?.id, summary: `${rupees(amount)} received by ${method} (${reference}) recorded by the platform` });
  await notify(pharmacy.id, { type: 'billing', severity: 'success', title: 'Payment received', body: `${rupees(amount)} has been recorded against your subscription. Thank you.`, link: '/settings?tab=billing' });
  return { data: result.payment, subscription: await subscriptionState(pharmacy.id), message: `${rupees(amount)} recorded for ${pharmacy.name}.`, __status: 201 };
});

/* ================================== INCOME ================================== */
platformRoute('GET', '/api/v1/platform/income', 'platform.finance.view', async (ctx) => {
  const { page, size, skip } = paging(ctx, 50);
  const from = toStr(ctx.query.get('from'), 10) || startOfMonth(-11).slice(0, 10);
  const to = toStr(ctx.query.get('to'), 10) || today();
  const pharmacyId = toStr(ctx.query.get('pharmacy'), 60);
  const status = toStr(ctx.query.get('status'), 20);
  const match: Filter<SubscriptionPayment> = { created_at: { $gte: from, $lte: `${to}T23:59:59.999Z` } };
  if (pharmacyId) match.pharmacy_id = pharmacyId;
  if (status && status !== 'all') match.status = status;
  const paid: Filter<SubscriptionPayment> = { ...match, ...PAID };

  const [[totals], byMonth, byPlan, byProvider, byPharmacy, rows, total, refunds] = await Promise.all([
    col.subscriptionPayments().aggregate([{ $match: paid }, { $group: incomeGroup() }]).toArray(),
    col.subscriptionPayments().aggregate([
      { $match: paid },
      { $group: { _id: monthOf('created_at'), gross: { $sum: '$amount_paisa' }, refunded: { $sum: { $ifNull: ['$refunded_paisa', 0] } }, payments: { $sum: 1 } } },
      { $project: { _id: 0, period: '$_id', gross: 1, refunded: 1, net: { $subtract: ['$gross', '$refunded'] }, payments: 1 } },
      { $sort: { period: 1 } }
    ]).toArray(),
    col.subscriptionPayments().aggregate([
      { $match: paid },
      { $lookup: { from: 'subscriptions', localField: 'subscription_id', foreignField: '_id', as: '__s', pipeline: [{ $project: { plan_key: 1 } }] } },
      { $group: { _id: { $ifNull: [{ $first: '$__s.plan_key' }, 'unknown'] }, net: { $sum: { $subtract: ['$amount_paisa', { $ifNull: ['$refunded_paisa', 0] }] } }, payments: { $sum: 1 } } },
      { $project: { _id: 0, plan: '$_id', net: 1, payments: 1 } }, { $sort: { net: -1 } }
    ]).toArray(),
    col.subscriptionPayments().aggregate([
      { $match: paid },
      { $group: { _id: { $ifNull: ['$provider', 'manual'] }, net: { $sum: { $subtract: ['$amount_paisa', { $ifNull: ['$refunded_paisa', 0] }] } }, payments: { $sum: 1 } } },
      { $project: { _id: 0, provider: '$_id', net: 1, payments: 1 } }, { $sort: { net: -1 } }
    ]).toArray(),
    col.subscriptionPayments().aggregate([
      { $match: paid },
      { $group: { _id: '$pharmacy_id', net: { $sum: { $subtract: ['$amount_paisa', { $ifNull: ['$refunded_paisa', 0] }] } }, payments: { $sum: 1 }, last: { $max: '$paid_at' } } },
      ...lookupField('pharmacies', '_id', 'name', 'name'),
      { $project: { _id: 0, pharmacy_id: '$_id', name: 1, net: 1, payments: 1, last: 1 } }, { $sort: { net: -1 } }, { $limit: 25 }
    ]).toArray(),
    col.subscriptionPayments().aggregate([
      { $match: match }, { $sort: { created_at: -1 } }, { $skip: skip }, { $limit: size },
      ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name'),
      { $lookup: { from: 'subscriptions', localField: 'subscription_id', foreignField: '_id', as: '__s', pipeline: [{ $project: { plan_key: 1 } }] } },
      { $set: { plan_key: { $first: '$__s.plan_key' } } }, { $unset: '__s' }
    ]).toArray(),
    col.subscriptionPayments().countDocuments(match),
    col.paymentRefunds().aggregate([
      { $sort: { requested_at: -1 } }, { $limit: 20 },
      ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name')
    ]).toArray()
  ]);
  return {
    range: { from, to },
    totals: { grossPaisa: n(totals, 'gross'), refundedPaisa: n(totals, 'refunded'), netPaisa: n(totals, 'gross') - n(totals, 'refunded'), payments: n(totals, 'payments') },
    byMonth, byPlan, byProvider, byPharmacy, refunds,
    ...pageResult(rows, total, { page, size })
  };
});

/* ================================ PAYMENTS ================================ */
platformRoute('GET', '/api/v1/platform/payments/attempts', 'platform.finance.view', async (ctx) => {
  const status = toStr(ctx.query.get('status'), 20) || 'open';
  const match: Document = status === 'open' ? { status: { $in: ['created', 'pending'] } } : status === 'all' ? {} : { status };
  const rows = await col.paymentAttempts().aggregate([
    { $match: match }, { $sort: { created_at: -1 } }, { $limit: 200 },
    ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name'),
    ...lookupField('users', 'created_by', 'full_name', 'created_by_name'),
    { $project: { request_payload: 0 } }
  ]).toArray();
  return { data: rows, providers: listProviders() };
});

/* A bank transfer is confirmed by the platform, which can see its own bank statement. */
platformRoute('POST', '/api/v1/platform/payments/attempts/:id/verify', 'platform.finance.manage', async (ctx) => {
  ctx.requireRecentVerification();
  const result = await verifyManualPayment({ attemptId: toStr(ctx.params.id, 60), statementReference: toStr(ctx.body.statementReference, 120), note: toStr(ctx.body.note, 200), actor: actorOf(ctx) });
  if (!result.ok) bad(result.reason ?? 'The transfer could not be confirmed.');
  if ('pharmacyId' in result && result.pharmacyId) {
    await notify(result.pharmacyId, { type: 'billing', severity: 'success', title: 'Your bank transfer has been confirmed', body: 'Your subscription is active. Thank you.', link: '/settings?tab=billing' });
  }
  return { ok: true, duplicate: !!result.duplicate, message: result.duplicate ? 'That transfer had already been confirmed.' : 'The transfer has been confirmed and the subscription is active.' };
});

platformRoute('POST', '/api/v1/platform/payments/:id/refund', 'platform.finance.manage', async (ctx) => {
  ctx.requireRecentVerification();
  const result = await requestRefund({ paymentId: toStr(ctx.params.id, 60), amountPaisa: toInt(ctx.body.amountPaisa, 0), reason: toStr(ctx.body.reason, 200), actor: actorOf(ctx) });
  if (!result.ok) return bad(result.reason ?? 'The refund could not be made.');
  return {
    ok: true, refundId: result.refundId, manual: !!result.manual, status: result.status,
    message: result.manual ? 'Recorded. This provider has no refund API — make the refund in their portal, then mark it complete here.' : 'The refund has been sent to the provider.'
  };
});

/* Mark a manual refund done once it has been made in the provider's portal. */
platformRoute('POST', '/api/v1/platform/refunds/:id/complete', 'platform.finance.manage', async (ctx) => {
  const refund = await col.paymentRefunds().findOneAndUpdate(
    { _id: toStr(ctx.params.id, 60), status: 'pending' },
    { $set: { status: 'completed', completed_at: nowIso(), provider_reference: toStr(ctx.body.reference, 120) || null } },
    { returnDocument: 'after' }
  );
  if (!refund) return bad('That refund is not waiting to be completed.');
  await applyRefund(refund.payment_id, refund.amount_paisa);
  await auditLog(trailFor(ctx, refund.pharmacy_id), { action: 'billing.refund-completed', entity: 'payment', entityId: refund.payment_id, summary: `${rupees(refund.amount_paisa)} refund marked complete by the platform` });
  return { data: refund };
});

platformRoute('POST', '/api/v1/platform/payments/reconcile', 'platform.finance.manage', async () => ({ ok: true, ...(await reconcile({ limit: 200 })) }));

/* ================================== PLANS ================================== */
const planOut = (row: Plan) => ({ ...planView(row), trialDays: row.trial_days });

platformRoute('GET', '/api/v1/platform/plans', 'any', async () => {
  const [plans, usage] = await Promise.all([
    col.plans().find({}).sort({ sort_order: 1 }).toArray(),
    col.pharmacies().aggregate<{ _id: string; n: number }>([{ $group: { _id: '$plan_key', n: { $sum: 1 } } }]).toArray()
  ]);
  return {
    data: plans.map((plan) => ({ ...planOut(plan), pharmacies: usage.find((row) => row._id === plan.key)?.n ?? 0 })),
    features: FEATURES.map(([key, name, group]) => ({ key, name, group }))
  };
});

function planChanges(body: Record<string, any>, existing: Plan | null): Partial<Plan> {
  const set: Partial<Plan> = {};
  const has = (key: string) => body[key] !== undefined;
  if (has('name')) { set.name = toStr(body.name, 60); if (!set.name) bad('A plan needs a name.', 'name'); }
  if (has('tagline')) set.tagline = toStr(body.tagline, 140) || null;
  if (has('description')) set.description = toStr(body.description, 600) || null;
  if (has('pricePaisa')) {
    set.price_paisa = toInt(body.pricePaisa, -1);
    if (set.price_paisa < 0) bad('The price cannot be negative.', 'pricePaisa');
    set.is_free = set.price_paisa === 0 ? 1 : 0;
  }
  if (has('graceDays')) set.grace_days = Math.min(60, Math.max(0, toInt(body.graceDays, existing?.grace_days ?? 7)));
  if (has('trialDays')) set.trial_days = Math.min(90, Math.max(0, toInt(body.trialDays, existing?.trial_days ?? 0)));
  const limits = body.limits ?? {};
  const limit = (key: string, field: keyof Plan, current: number | undefined) => {
    if (limits[key] === undefined) return;
    const value = toInt(limits[key], -1);
    if (value < 1 || value > 100_000) bad(`The ${key} limit must be between 1 and 100000.`, `limits.${key}`);
    (set as Record<string, unknown>)[field] = value ?? current;
  };
  limit('users', 'max_users', existing?.max_users);
  limit('branches', 'max_branches', existing?.max_branches);
  limit('medicines', 'max_medicines', existing?.max_medicines);
  limit('desktopDevices', 'max_desktop_devices', existing?.max_desktop_devices);
  limit('mobileDevices', 'max_mobile_devices', existing?.max_mobile_devices);
  if (has('features')) {
    if (!Array.isArray(body.features)) bad('Features must be a list.', 'features');
    const unknown = body.features.filter((key: unknown) => !FEATURE_KEYS.includes(String(key)));
    if (unknown.length) bad(`Unknown feature: ${unknown.join(', ')}.`, 'features');
    set.features = [...new Set<string>(body.features.map(String))];
  }
  if (has('status')) {
    set.status = toStr(body.status, 20);
    if (!['active', 'retired'].includes(set.status)) bad('Choose active or retired.', 'status');
  }
  if (has('isPublic')) set.is_public = body.isPublic ? 1 : 0;
  if (has('autoRenew')) set.auto_renew = body.autoRenew ? 1 : 0;
  if (has('sortOrder')) set.sort_order = toInt(body.sortOrder, existing?.sort_order ?? 10);
  return set;
}

platformRoute('POST', '/api/v1/platform/plans', 'platform.plans.manage', async (ctx) => {
  const key = slugify(toStr(ctx.body.key, 30) || toStr(ctx.body.name, 30));
  if (!key) bad('Give the plan a key, for example "clinic-annual".', 'key');
  if (await col.plans().findOne({ key })) bad('A plan with that key already exists.', 'key');
  const period = toStr(ctx.body.period, 10) || 'month';
  if (!['week', 'month', 'year', 'perpetual'].includes(period)) bad('Choose week, month, year or perpetual.', 'period');
  const changes = planChanges({ status: 'active', isPublic: true, autoRenew: true, features: ['pos.core', 'inventory.batches', 'reports.core'], ...ctx.body }, null);
  if (!changes.name) bad('A plan needs a name.', 'name');
  const at = nowIso();
  const id = `PLAN-${key.toUpperCase()}`;
  const plan: Plan = {
    _id: id, id, key, name: changes.name!, tagline: changes.tagline ?? null, description: changes.description ?? null, period,
    period_days: period === 'week' ? 7 : period === 'year' ? 365 : period === 'perpetual' ? 36500 : 30, price_paisa: changes.price_paisa ?? 0,
    currency: 'PKR', annual_discount_pct: 0, trial_days: changes.trial_days ?? 0, grace_days: changes.grace_days ?? 7,
    max_desktop_devices: changes.max_desktop_devices ?? 2, max_mobile_devices: changes.max_mobile_devices ?? 2, max_users: changes.max_users ?? 5,
    max_branches: changes.max_branches ?? 1, max_medicines: changes.max_medicines ?? 5000, features: changes.features ?? [], auto_renew: changes.auto_renew ?? 1,
    is_default: 0, is_public: changes.is_public ?? 1, is_free: (changes.price_paisa ?? 0) === 0 ? 1 : 0, sort_order: changes.sort_order ?? 50,
    status: changes.status ?? 'active', created_at: at, updated_at: at
  };
  await col.plans().insertOne(plan);
  await logActivity({ pharmacyId: null, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent }, { action: 'platform.plan-created', entity: 'plan', entityId: id, summary: `Plan ${plan.name} created at ${rupees(plan.price_paisa)}` });
  return { data: planOut(plan), __status: 201 };
});

/* A price change applies to new subscriptions and renewals; a pharmacy mid-period keeps what it paid for. */
platformRoute('PATCH', '/api/v1/platform/plans/:key', 'platform.plans.manage', async (ctx) => {
  const existing = await col.plans().findOne({ key: toStr(ctx.params.key, 30) });
  if (!existing) return missing('That plan could not be found.');
  const set = planChanges(ctx.body, existing);
  if (existing.is_default && (set.status === 'retired' || (set.price_paisa ?? 0) > 0)) bad('The default plan must stay free and active — it is where every pharmacy lands when a paid plan ends.');
  const updated = await col.plans().findOneAndUpdate({ _id: existing.id }, { $set: { ...set, updated_at: nowIso() } }, { returnDocument: 'after' });
  await logActivity({ pharmacyId: null, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent }, { action: 'platform.plan-updated', entity: 'plan', entityId: existing.id, summary: `Plan ${existing.name} updated`, meta: set });
  return { data: planOut(updated!) };
});

/* =================================== PEOPLE =================================== */
/* Find anybody on the platform — the usual first step when somebody phones. */
platformRoute('GET', '/api/v1/platform/users', ['platform.help', 'platform.support'], async (ctx) => {
  const search = toStr(ctx.query.get('q'), 80);
  if (search.length < 2) return { data: [] };
  const pattern = contains(search);
  const rows = await col.users().aggregate([
    { $match: { pharmacy_id: { $ne: null }, $or: [{ full_name: pattern }, { email: pattern }, { phone: pattern }, { cnic: pattern }] } },
    { $limit: 50 },
    ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name'),
    ...lookupField('roles', 'role_id', 'name', 'role_name'),
    { $project: { _id: 0, id: 1, full_name: 1, email: 1, phone: 1, status: 1, is_owner: 1, pharmacy_id: 1, pharmacy_name: 1, role_name: 1, last_login_at: 1, locked_until: 1 } }
  ]).toArray();
  return { data: rows };
});

/* Everybody stuck, in every pharmacy, in one queue. */
platformRoute('GET', '/api/v1/platform/help', 'platform.help', async (ctx) => {
  const pharmacies = await col.pharmacies().find({ status: 'active' }, { projection: { name: 1 } }).sort({ updated_at: -1 }).limit(500).toArray();
  const lists = await Promise.all(pharmacies.map(async (pharmacy) =>
    (await helpItems(pharmacy._id, { id: ctx.user.id, level: 10_000, top: true })).map((item) => ({ ...item, pharmacyName: pharmacy.name }))));
  const items = lists.flat().sort((a, b) => String((b as Record<string, unknown>).at).localeCompare(String((a as Record<string, unknown>).at)));
  return { data: items, checkedAt: nowIso() };
});

/* ================================ TRAILS ================================ */
platformRoute('GET', '/api/v1/platform/activity', 'platform.activity', async (ctx) => {
  const { page, size, skip } = paging(ctx, 50);
  const match: Document = {};
  const pharmacyId = toStr(ctx.query.get('pharmacy'), 60);
  if (pharmacyId) match.pharmacy_id = pharmacyId;
  if (ctx.query.get('platform') === 'true') match.actor_role = { $regex: '^(Super Admin|KSF team)' };
  const [rows, total] = await Promise.all([
    col.activityLogs().aggregate([{ $match: match }, { $sort: { created_at: -1 } }, { $skip: skip }, { $limit: size }, ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name')]).toArray(),
    col.activityLogs().countDocuments(match)
  ]);
  return pageResult(rows, total, { page, size });
});

platformRoute('GET', '/api/v1/platform/security', 'platform.activity', async (ctx) => {
  const { page, size, skip } = paging(ctx, 50);
  const match: Document = { severity: { $in: ['warn', 'danger'] } };
  if (ctx.query.get('all') === 'true') delete match.severity;
  const [rows, total] = await Promise.all([
    col.securityEvents().aggregate([{ $match: match }, { $sort: { created_at: -1 } }, { $skip: skip }, { $limit: size }, ...lookupField('pharmacies', 'pharmacy_id', 'name', 'pharmacy_name')]).toArray(),
    col.securityEvents().countDocuments(match)
  ]);
  return pageResult(rows, total, { page, size });
});

/* ============================ PLATFORM NOTIFICATIONS ============================ */
/* Each person sees the notices meant for them and reads their own copy. */
platformRoute('GET', '/api/v1/platform/notifications', 'any', async (ctx) => {
  const [rows, unread] = await Promise.all([
    col.notifications().find(platformNotices(reader(ctx))).sort({ created_at: -1 }).limit(100).toArray(),
    col.notifications().countDocuments(unreadPlatformNotices(reader(ctx)))
  ]);
  const data = rows.map((row) => asRead(row, ctx.user.id)).sort((a, b) => a.is_read - b.is_read);
  return { data, counts: { total: data.length, unread } };
});

platformRoute('POST', '/api/v1/platform/notifications/:id/read', 'any', async (ctx) => {
  await col.notifications().updateOne({ $and: [platformNotices(reader(ctx)), { _id: toStr(ctx.params.id, 60) }] }, { $addToSet: { read_by: ctx.user.id } });
  return { ok: true };
});

platformRoute('POST', '/api/v1/platform/notifications/read-all', 'any', async (ctx) => {
  const result = await col.notifications().updateMany(unreadPlatformNotices(reader(ctx)), { $addToSet: { read_by: ctx.user.id } });
  return { ok: true, marked: result.modifiedCount };
});

