/* ==========================================================================
   The Super Admin's view of growth: website traffic, registrations,
   subscriptions and referrals (services/insights.ts does the counting)
   --------------------------------------------------------------------------
   The public website's visit beacon lives here too: it is the one public
   route, and all it can do is add one to a count.
   ========================================================================== */

import type { Document, Filter } from 'mongodb';
import { col } from '../db/mongo.js';
import type { Pharmacy, Referral } from '../db/types.js';
import { bad, missing } from '../core/errors.js';
import { auditLog, notify } from '../core/trails.js';
import { contains, nowIso, toStr } from '../core/util.js';
import { hit } from '../security/throttle.js';
import { platformRoute, publicRoute, type SignedInCtx } from '../http/router.js';
import { currentPlans, overviewInsights, planMix, rangeOf, recordVisit, trafficInsights, type PlanCategory } from '../services/insights.js';
import { rewardDays } from '../services/referrals.js';
import { pageResult, paging } from './shared.js';

const trailFor = (ctx: SignedInCtx, pharmacyId: string) => ({ pharmacyId, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent });

/* ---------------------------------------------------------- the beacon */

/* One page of the public website was opened. Always answers the same, so
   it tells a caller nothing; a minute's worth of pages per address. */
publicRoute('POST', '/api/v1/public/visit', async (ctx) => {
  const limit = await hit(`visit:${ctx.ip}`, 60, 60_000);
  if (limit.ok) {
    await recordVisit({
      visitor: ctx.body.visitor, path: ctx.body.path, referrer: ctx.body.referrer,
      userAgent: ctx.userAgent, host: String(ctx.headers.host ?? '')
    });
  }
  return { ok: true };
});

/* ---------------------------------------------------- overview and traffic */

platformRoute('GET', '/api/v1/platform/insights', 'platform.overview', async (ctx) => overviewInsights(rangeOf(ctx.query)));

platformRoute('GET', '/api/v1/platform/traffic', 'platform.overview', async (ctx) => trafficInsights(rangeOf(ctx.query)));

/* ---------------------------------------------------------- registrations */

/** Pharmacies that registered in the period, newest first, with their plan today and where they came from. */
platformRoute('GET', '/api/v1/platform/registrations', 'platform.pharmacies.view', async (ctx) => {
  const range = rangeOf(ctx.query);
  const page = paging(ctx, 25);
  const filter: Filter<Pharmacy> = { created_at: { $gte: range.startIso, $lt: range.endIso } };
  const search = toStr(ctx.query.get('q'), 80);
  if (search) filter.$or = [{ name: contains(search) }, { city: contains(search) }, { email: contains(search) }];
  const source = toStr(ctx.query.get('source'), 20);
  if (source === 'referral') filter.referred_by_code = { $ne: null };
  if (source === 'direct') filter.referred_by_code = null;

  const [rows, total, referred, plans] = await Promise.all([
    col.pharmacies().aggregate<Document>([
      { $match: filter }, { $sort: { created_at: -1 } }, { $skip: page.skip }, { $limit: page.size },
      { $lookup: { from: 'users', localField: 'owner_user_id', foreignField: '_id', as: '__o', pipeline: [{ $project: { full_name: 1, email: 1, phone: 1 } }] } },
      { $lookup: { from: 'referrals', localField: '_id', foreignField: 'referred_pharmacy_id', as: '__r', pipeline: [{ $match: { status: 'converted' } }, { $sort: { converted_at: 1 } }, { $limit: 1 }, { $project: { referrer_pharmacy_id: 1 } }] } },
      { $lookup: { from: 'pharmacies', localField: '__r.referrer_pharmacy_id', foreignField: '_id', as: '__rp', pipeline: [{ $project: { name: 1 } }] } }
    ]).toArray(),
    col.pharmacies().countDocuments(filter),
    col.pharmacies().countDocuments({ created_at: { $gte: range.startIso, $lt: range.endIso }, referred_by_code: { $ne: null } }),
    currentPlans()
  ]);
  const all = await col.pharmacies().countDocuments({ created_at: { $gte: range.startIso, $lt: range.endIso } });
  const planOf = new Map(plans.rows.map((row) => [row.pharmacyId, row]));
  return {
    range: { from: range.from, to: range.to, days: range.days.length },
    counts: { total: all, referral: referred, direct: all - referred },
    ...pageResult(rows.map((row) => {
      const plan = planOf.get(row._id);
      const owner = row.__o?.[0];
      return {
        id: row._id, name: row.name, city: row.city ?? null, status: row.status, registeredAt: row.created_at,
        owner: owner ? { name: owner.full_name, email: owner.email, phone: owner.phone ?? null } : null,
        plan: plan ? { category: plan.category, label: plan.label, status: plan.status, entitled: plan.entitled } : null,
        source: row.referred_by_code ? 'Referral' : 'Direct',
        referredBy: row.__rp?.[0]?.name ?? null
      };
    }), total, page)
  };
});

/* ---------------------------------------------------------- subscriptions */

/** Every pharmacy's plan today, filterable by category and state, with the mix on top. */
platformRoute('GET', '/api/v1/platform/subscriptions', 'platform.pharmacies.view', async (ctx) => {
  const page = paging(ctx, 25);
  const { rows, labels } = await currentPlans();
  const category = toStr(ctx.query.get('plan'), 20) as PlanCategory | '';
  const state = toStr(ctx.query.get('state'), 20);
  const search = toStr(ctx.query.get('q'), 80).toLowerCase();
  const pharmacies = await col.pharmacies().find({}, { projection: { _id: 1, name: 1, city: 1, status: 1 } }).toArray();
  const named = new Map(pharmacies.map((pharmacy) => [pharmacy._id, pharmacy]));

  const chosen = rows
    .filter((row) => named.has(row.pharmacyId))
    .filter((row) => !category || row.category === category)
    .filter((row) => !state || (state === 'running' ? row.entitled : state === 'ended' ? !row.entitled : state === 'paid' ? row.paid : row.status === state))
    .filter((row) => !search || `${named.get(row.pharmacyId)?.name ?? ''} ${named.get(row.pharmacyId)?.city ?? ''}`.toLowerCase().includes(search))
    .sort((a, b) => (a.entitled === b.entitled ? (a.periodEnd ?? '').localeCompare(b.periodEnd ?? '') : a.entitled ? -1 : 1));
  const slice = chosen.slice(page.skip, page.skip + page.size).map((row) => {
    const pharmacy = named.get(row.pharmacyId)!;
    return { ...row, pharmacyName: pharmacy.name, city: pharmacy.city ?? null, pharmacyStatus: pharmacy.status };
  });
  return {
    mix: planMix(rows, labels), labels,
    ...pageResult(slice, chosen.length, page)
  };
});

/* -------------------------------------------------------------- referrals */

const REFERRAL_STAGE: Record<string, string> = { pending: 'Invited', review: 'Being checked', converted: 'Registered', rejected: 'Not accepted' };

/** Every referral on the platform: who shared the link, who came, and the days it earned. */
platformRoute('GET', '/api/v1/platform/referrals', 'platform.pharmacies.view', async (ctx) => {
  const page = paging(ctx, 25);
  const filter: Filter<Referral> = {};
  const status = toStr(ctx.query.get('status'), 20);
  if (status === 'ready') Object.assign(filter, { status: 'converted', $or: [{ reward_claimed_at: null }, { reward_claimed_at: { $exists: false } }] });
  else if (status === 'claimed') filter.reward_claimed_at = { $type: 'string' };
  else if (status) filter.status = status;
  const search = toStr(ctx.query.get('q'), 80);
  if (search) {
    const pattern = contains(search);
    const pharmacyIds = await col.pharmacies().distinct('_id', { name: pattern });
    filter.$and = [{ $or: [{ code: pattern }, { referred_email: pattern }, { referred_name: pattern }, { referrer_pharmacy_id: { $in: pharmacyIds } }, { referred_pharmacy_id: { $in: pharmacyIds } }] }];
  }
  const [rows, total, [counts]] = await Promise.all([
    col.referrals().aggregate<Document>([
      { $match: filter }, { $sort: { created_at: -1 } }, { $skip: page.skip }, { $limit: page.size },
      { $lookup: { from: 'pharmacies', localField: 'referrer_pharmacy_id', foreignField: '_id', as: '__a', pipeline: [{ $project: { name: 1 } }] } },
      { $lookup: { from: 'pharmacies', localField: 'referred_pharmacy_id', foreignField: '_id', as: '__b', pipeline: [{ $project: { name: 1 } }] } }
    ]).toArray(),
    col.referrals().countDocuments(filter),
    col.referrals().aggregate<Document>([
      {
        $group: {
          _id: null, all: { $sum: 1 },
          invited: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          review: { $sum: { $cond: [{ $eq: ['$status', 'review'] }, 1, 0] } },
          registered: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          ready: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'converted'] }, { $not: [{ $ifNull: ['$reward_claimed_at', false] }] }] }, 1, 0] } },
          claimedDays: { $sum: { $cond: [{ $ifNull: ['$reward_claimed_at', false] }, { $ifNull: ['$reward_days', 0] }, 0] } }
        }
      }
    ]).toArray()
  ]);
  const perReferral = rewardDays();
  return {
    counts: {
      all: counts?.all ?? 0, invited: counts?.invited ?? 0, review: counts?.review ?? 0, registered: counts?.registered ?? 0,
      rejected: counts?.rejected ?? 0, readyDays: (counts?.ready ?? 0) * perReferral, claimedDays: counts?.claimedDays ?? 0
    },
    daysPerReferral: perReferral,
    ...pageResult(rows.map((row) => ({
      id: row._id, code: row.code, status: row.status, stage: REFERRAL_STAGE[row.status] ?? row.status, rejectReason: row.reject_reason ?? null,
      referrer: row.referrer_pharmacy_id ? { id: row.referrer_pharmacy_id, name: row.__a?.[0]?.name ?? '—' } : null,
      referred: { pharmacyId: row.referred_pharmacy_id ?? null, pharmacyName: row.__b?.[0]?.name ?? null, name: row.referred_name ?? null, email: row.referred_email },
      createdAt: row.created_at, convertedAt: row.converted_at ?? null,
      rewardDays: row.reward_days ?? null, rewardClaimedAt: row.reward_claimed_at ?? null
    })), total, page)
  };
});

async function referralOr404(id: unknown): Promise<Referral> {
  const referral = await col.referrals().findOne({ _id: toStr(id, 60) });
  if (!referral) return missing('That referral could not be found.');
  return referral;
}

/* A referral held for review (many sign-ups from one address in a day): the
   KSF team looks and decides. Approving honours it — the referral price for
   the new pharmacy, and the referral days for the one that shared the link. */
platformRoute('POST', '/api/v1/platform/referrals/:id/approve', 'platform.pharmacies.manage', async (ctx) => {
  const referral = await referralOr404(ctx.params.id);
  if (referral.status !== 'review') bad('Only a referral that is being checked can be approved.');
  const at = nowIso();
  if (!referral.referred_pharmacy_id) {
    /* They have not finished registering: it goes on as an ordinary invitation. */
    await col.referrals().updateOne({ _id: referral.id, status: 'review' }, { $set: { status: 'pending', updated_at: at } });
  } else {
    const done = await col.referrals().updateOne({ _id: referral.id, status: 'review' }, { $set: { status: 'converted', converted_at: at, updated_at: at } });
    if (!done.modifiedCount) bad('This referral was decided a moment ago. Refresh to see it.');
    await col.referralCodes().updateOne({ code: referral.code }, { $inc: { successful: 1 }, $set: { updated_at: at } });
    if (referral.referrer_pharmacy_id && rewardDays() > 0) {
      await notify(referral.referrer_pharmacy_id, {
        type: 'billing', severity: 'info', title: `${rewardDays()} referral days are ready to claim`,
        body: 'A pharmacy you invited has registered. Claim the days under Subscription plans › Referrals.', link: '/subscription-plans?tab=referrals'
      });
    }
  }
  if (referral.referrer_pharmacy_id) {
    await auditLog(trailFor(ctx, referral.referrer_pharmacy_id), { action: 'platform.referral-approved', entity: 'referral', entityId: referral.id, summary: `Referral ${referral.code} approved by the platform` });
  }
  return { message: referral.referred_pharmacy_id ? 'Approved. The referral price and the referral days now apply.' : 'Approved. It counts once they finish registering.' };
});

platformRoute('POST', '/api/v1/platform/referrals/:id/reject', 'platform.pharmacies.manage', async (ctx) => {
  const referral = await referralOr404(ctx.params.id);
  if (!['review', 'pending'].includes(referral.status)) bad('Only a referral that is waiting or being checked can be turned down.');
  const reason = toStr(ctx.body.reason, 200) || 'turned down by the platform';
  const done = await col.referrals().updateOne({ _id: referral.id, status: referral.status }, { $set: { status: 'rejected', reject_reason: reason, updated_at: nowIso() } });
  if (!done.modifiedCount) bad('This referral was decided a moment ago. Refresh to see it.');
  if (referral.referrer_pharmacy_id) {
    await auditLog(trailFor(ctx, referral.referrer_pharmacy_id), { action: 'platform.referral-rejected', entity: 'referral', entityId: referral.id, summary: `Referral ${referral.code} turned down: ${reason}` });
  }
  return { message: 'The referral was turned down. It earns no price and no days.' };
});
