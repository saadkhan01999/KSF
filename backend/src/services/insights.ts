/* ==========================================================================
   Platform insights: who visits the website, who uses KSF, and what plans
   the pharmacies are on
   --------------------------------------------------------------------------
   What the Super Admin's Analytics page is made from.

   Website visitors. The public website (never the signed-in app) sends one
   small beacon per page: a random number the browser keeps in its own
   storage, and the page's path. No cookie is set, no IP address is stored,
   and the number is kept only as a keyed hash, so a visitor is counted once
   a day without being identified. Known crawlers are not counted, and one
   address can send at most a minute's worth of pages.

   Active users. Each signed-in person who uses KSF on a day is noted once
   for that day (one write per person per day, remembered in memory so an
   ordinary request costs nothing). Before that existed, sign-in sessions
   say who was about, so a range that reaches back still has an answer.

   Days are Pakistan days (UTC+5, no daylight saving): "visitors on
   8 November" is the 8th as a pharmacy in Lahore lived it.
   ========================================================================== */

import { createHmac } from 'node:crypto';
import type { Document } from 'mongodb';
import { env } from '../config/env.js';
import { col } from '../db/mongo.js';
import type { Plan } from '../db/types.js';
import { bad } from '../core/errors.js';
import { isEntitled } from './subscriptions.js';

/* ------------------------------------------------------------------- days */

const PK_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;
/** How long visits and daily-use rows are kept: a little over a year. */
const KEEP_MS = 400 * DAY_MS;

/** The Pakistan date of a moment, as YYYY-MM-DD. */
export const pkDay = (ms = Date.now()): string => new Date(ms + PK_OFFSET_MS).toISOString().slice(0, 10);
/** The moment a Pakistan day starts, as an ISO string (UTC). */
export const dayStartIso = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - PK_OFFSET_MS).toISOString();
const shiftDay = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

export interface Range { from: string; to: string; days: string[]; startIso: string; endIso: string }

/**
 * The period a screen asked for: ?from=2026-10-10&to=2026-11-08, both
 * included. Without one, the last 30 days. At most 366 days.
 */
export function rangeOf(query: URLSearchParams, defaultDays = 30): Range {
  const isDay = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  const today = pkDay();
  const to = isDay(query.get('to')) ? query.get('to')! : today;
  const from = isDay(query.get('from')) ? query.get('from')! : shiftDay(to, -(defaultDays - 1));
  if (from > to) bad('The start of the period is after its end.', 'from');
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (span > 366) bad('Choose a period of a year or less.', 'from');
  const days = Array.from({ length: span }, (_, index) => shiftDay(from, index));
  return { from, to, days, startIso: dayStartIso(from), endIso: dayStartIso(shiftDay(to, 1)) };
}

/* --------------------------------------------------------- website visits */

/* The public website's pages. Anything else is counted as "other", so the
   counts cannot be filled with made-up addresses. */
export const SITE_PATHS = [
  '/', '/product', '/features', '/pricing', '/about', '/subscription', '/register', '/login', '/forgot-password',
  '/reset-password', '/privacy', '/terms', '/refunds', '/support', '/directory'
] as const;

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|preview/i;

/** The page, as one of SITE_PATHS: "/directory/panadol" counts as "/directory". */
export function sitePath(raw: unknown): string {
  const path = String(raw ?? '').split(/[?#]/)[0].toLowerCase();
  if (path === '' || path === '/') return '/';
  const first = `/${path.split('/').filter(Boolean)[0] ?? ''}`;
  return (SITE_PATHS as readonly string[]).includes(first) ? first : '/other';
}

/** Where the visitor came from, as a bare host name, or null for this site or none. */
export function referrerHost(raw: unknown, ownHost: string | undefined): string | null {
  try {
    const host = new URL(String(raw ?? '')).hostname.toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]{1,100}$/.test(host)) return null;
    if (ownHost && host === ownHost.toLowerCase().replace(/^www\./, '').split(':')[0]) return null;
    return host;
  } catch {
    return null;
  }
}

const visitorKey = (): string => `${env.JWT_ACCESS_SECRET}:site-visitors`;

/** The browser's random number, kept only as a keyed hash. */
export const visitorHash = (visitor: string): string => createHmac('sha256', visitorKey()).update(visitor).digest('hex').slice(0, 32);

/**
 * One page of the public website was opened. The visitor is counted once a
 * day; the page view every time. Returns false when it was not counted (a
 * crawler, or a visitor number that is not one of ours).
 */
export async function recordVisit(input: { visitor: unknown; path: unknown; referrer: unknown; userAgent: string; host?: string }): Promise<boolean> {
  const visitor = String(input.visitor ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visitor)) return false;
  if (!input.userAgent || BOT.test(input.userAgent)) return false;
  const day = pkDay();
  const path = sitePath(input.path);
  const expires = new Date(Date.now() + KEEP_MS);
  const hash = visitorHash(visitor.toLowerCase());
  await Promise.all([
    col.siteVisits().updateOne(
      { _id: `${day}:${hash}` },
      { $setOnInsert: { day, visitor: hash, path, referrer: referrerHost(input.referrer, input.host), created_at: new Date().toISOString(), expires_at: expires } },
      { upsert: true }
    ),
    col.sitePages().updateOne({ _id: `${day}:${path}` }, { $inc: { views: 1 }, $setOnInsert: { day, path, expires_at: expires } }, { upsert: true })
  ]);
  return true;
}

/* -------------------------------------------------------------- daily use */

/* Who has been noted today on this server, so most requests write nothing. */
const notedToday = new Map<string, string>();

/** Somebody signed in is using KSF: note them once for today. Never throws. */
export function noteActiveDay(userId: string, pharmacyId: string | null): void {
  const day = pkDay();
  if (notedToday.get(userId) === day) return;
  if (notedToday.size > 50_000) notedToday.clear();
  notedToday.set(userId, day);
  col.activeDays().updateOne(
    { _id: `${day}:${userId}` },
    { $setOnInsert: { day, user_id: userId, pharmacy_id: pharmacyId, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + KEEP_MS) } },
    { upsert: true }
  ).catch(() => { notedToday.delete(userId); });
}

/** Pharmacy staff who used KSF in the period (the KSF team is not counted). */
export async function activeUsers(range: Range): Promise<number> {
  const [noted, sessionUsers] = await Promise.all([
    col.activeDays().distinct('user_id', { day: { $gte: range.from, $lte: range.to }, pharmacy_id: { $ne: null } }),
    col.sessions().distinct('user_id', { last_seen_at: { $gte: range.startIso }, created_at: { $lt: range.endIso } })
  ]);
  const fromSessions = sessionUsers.length
    ? await col.users().distinct('_id', { _id: { $in: sessionUsers }, pharmacy_id: { $ne: null } })
    : [];
  return new Set<string>([...noted, ...fromSessions].map(String)).size;
}

/* ---------------------------------------------------- plans, by category */

export type PlanCategory = 'demo' | 'referral' | 'pro' | 'annual' | 'other';
export const CATEGORY_ORDER: PlanCategory[] = ['demo', 'referral', 'pro', 'annual', 'other'];

/** One pharmacy's plan today, as the platform screens describe it. */
export interface CurrentPlan {
  pharmacyId: string; subscriptionId: string; planKey: string; planName: string; category: PlanCategory; label: string;
  status: string; entitled: boolean; paid: boolean; pricePaisa: number; periodEnd: string | null; daysLeft: number | null;
  autoRenew: boolean; provider: string | null; bonusDays: number;
}

/** What each category is called on screen, from the plans' own names: "Demo trial", "Pro monthly", "Diamond Annual". */
export function categoryLabels(plans: Pick<Plan, 'key' | 'name' | 'period' | 'is_trial' | 'status' | 'is_public'>[]): Record<PlanCategory, string> {
  const live = plans.filter((plan) => plan.status === 'active');
  const trial = live.find((plan) => plan.is_trial) ?? plans.find((plan) => plan.is_trial);
  const month = live.find((plan) => plan.period === 'month' && !plan.is_trial);
  const year = live.find((plan) => plan.period === 'year');
  const monthly = (name: string) => (/month/i.test(name) ? name : `${name} monthly`);
  return {
    demo: trial ? (/trial/i.test(trial.name) ? trial.name : `${trial.name} trial`) : 'Demo trial',
    referral: 'Standard Referral',
    pro: month ? monthly(month.name) : 'Pro monthly',
    annual: year ? year.name : 'Diamond Annual',
    other: 'Other plans'
  };
}

/**
 * Every pharmacy's current subscription, put in one of the four categories
 * of the Subscription mix. A trial counts as Standard Referral when the
 * pharmacy registered through a referral or has added referral days to it.
 */
export async function currentPlans(): Promise<{ rows: CurrentPlan[]; labels: Record<PlanCategory, string> }> {
  const [subscriptions, plans, trials] = await Promise.all([
    col.subscriptions().aggregate<Document>([
      { $sort: { created_at: -1 } },
      { $group: { _id: '$pharmacy_id', doc: { $first: '$$ROOT' } } },
      { $replaceWith: '$doc' }
    ]).toArray(),
    col.plans().find({}, { projection: { key: 1, name: 1, period: 1, is_trial: 1, is_free: 1, status: 1, is_public: 1 } }).toArray(),
    col.trials().find({ status: 'active' }, { projection: { pharmacy_id: 1, source: 1, bonus_days: 1 } }).toArray()
  ]);
  const byKey = new Map(plans.map((plan) => [plan.key, plan]));
  const trialOf = new Map(trials.map((trial) => [trial.pharmacy_id, trial]));
  const labels = categoryLabels(plans);
  const now = Date.now();
  const rows = subscriptions.map((sub): CurrentPlan => {
    const plan = byKey.get(sub.plan_key);
    const trial = trialOf.get(sub.pharmacy_id);
    const onTrial = !!plan?.is_trial || sub.status === 'trial';
    const bonusDays = Number(trial?.bonus_days ?? 0);
    const category: PlanCategory = onTrial
      ? (trial && (['referral', 'referral-reward'].includes(trial.source) || bonusDays > 0) ? 'referral' : 'demo')
      : plan?.period === 'month' ? 'pro' : plan?.period === 'year' ? 'annual' : 'other';
    const entitled = isEntitled({ status: sub.status, current_period_end: sub.current_period_end }, now);
    const ends = sub.status === 'grace' && sub.grace_until ? sub.grace_until : sub.current_period_end;
    return {
      pharmacyId: sub.pharmacy_id, subscriptionId: sub._id, planKey: sub.plan_key, planName: plan?.name ?? sub.plan_key,
      category, label: category === 'other' ? (plan?.name ?? sub.plan_key) : labels[category],
      status: !entitled && sub.status === 'trial' ? 'expired' : sub.status, entitled,
      paid: entitled && !onTrial && Number(sub.price_paisa) > 0 && !plan?.is_free,
      pricePaisa: Number(sub.price_paisa ?? 0), periodEnd: ends ?? null,
      daysLeft: entitled && ends ? Math.max(0, Math.ceil((Date.parse(ends) - now) / DAY_MS)) : 0,
      autoRenew: !!sub.auto_renew, provider: sub.provider ?? null, bonusDays
    };
  });
  return { rows, labels };
}

/** The Subscription mix: plans that are running today, by category. */
export function planMix(rows: CurrentPlan[], labels: Record<PlanCategory, string>) {
  const running = rows.filter((row) => row.entitled);
  const total = running.length;
  const items = CATEGORY_ORDER
    .map((key) => {
      const count = running.filter((row) => row.category === key).length;
      return { key, label: labels[key], count, percent: total ? Math.round((count / total) * 100) : 0 };
    })
    .filter((item) => item.key !== 'other' || item.count > 0);
  const paid = running.filter((row) => row.paid).length;
  return { total, paid, trialOrReferral: running.filter((row) => row.category === 'demo' || row.category === 'referral').length, items };
}

/* ------------------------------------------------------ the analytics */

const countBy = <K extends string>(rows: { _id: K; n: number }[]): Map<K, number> => new Map(rows.map((row) => [row._id, row.n]));

/**
 * Everything on the Super Admin's Analytics page, for one period: the six
 * figures (website visitors, active users, new registrations, pharmacies,
 * referrals, paid subscriptions), the website day by day with its pages and
 * where visitors came from, active users day by day, registrations by
 * source, referrals by stage, pharmacies by state, the subscription mix and
 * the newest pharmacies. Plan, pharmacy and referral-stage totals are as of
 * now; the rest counts the period.
 */
export async function analyticsInsights(range: Range) {
  const inDays = { day: { $gte: range.from, $lte: range.to } };
  const inPeriod = { $gte: range.startIso, $lt: range.endIso };
  const [
    visitorRows, visitorsPerDay, viewsPerDay, pages, referrers, activeTotal, activePerDay,
    registered, referredRegistrations, pharmacyStates, referralStages, invited, converted, claimed, plans, recent, held
  ] = await Promise.all([
    col.siteVisits().aggregate<{ n: number }>([{ $match: inDays }, { $group: { _id: '$visitor' } }, { $count: 'n' }]).toArray(),
    col.siteVisits().aggregate<{ _id: string; n: number }>([{ $match: inDays }, { $group: { _id: '$day', n: { $sum: 1 } } }]).toArray(),
    col.sitePages().aggregate<{ _id: string; n: number }>([{ $match: inDays }, { $group: { _id: '$day', n: { $sum: '$views' } } }]).toArray(),
    col.sitePages().aggregate<{ _id: string; views: number }>([{ $match: inDays }, { $group: { _id: '$path', views: { $sum: '$views' } } }, { $sort: { views: -1 } }, { $limit: 12 }]).toArray(),
    col.siteVisits().aggregate<{ _id: string; visitors: number }>([
      { $match: { ...inDays, referrer: { $ne: null } } }, { $group: { _id: '$referrer', visitors: { $sum: 1 } } }, { $sort: { visitors: -1 } }, { $limit: 8 }
    ]).toArray(),
    activeUsers(range),
    col.activeDays().aggregate<{ _id: string; n: number }>([{ $match: { ...inDays, pharmacy_id: { $ne: null } } }, { $group: { _id: '$day', n: { $sum: 1 } } }]).toArray(),
    col.pharmacies().countDocuments({ created_at: inPeriod }),
    col.pharmacies().countDocuments({ created_at: inPeriod, referred_by_code: { $nin: [null, ''] } }),
    col.pharmacies().aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    col.referrals().aggregate<{ _id: string; n: number }>([{ $match: { status: { $in: ['pending', 'review'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    col.referrals().countDocuments({ created_at: inPeriod }),
    col.referrals().countDocuments({ status: 'converted', converted_at: inPeriod }),
    col.referrals().aggregate<{ ready: number; claimedDays: number }>([
      { $match: { status: 'converted' } },
      {
        $group: {
          _id: null,
          ready: { $sum: { $cond: [{ $ifNull: ['$reward_claimed_at', false] }, 0, 1] } },
          claimedDays: {
            $sum: {
              $cond: [
                { $and: [{ $gte: [{ $ifNull: ['$reward_claimed_at', ''] }, range.startIso] }, { $lt: [{ $ifNull: ['$reward_claimed_at', ''] }, range.endIso] }] },
                { $ifNull: ['$reward_days', 0] }, 0
              ]
            }
          }
        }
      }
    ]).toArray(),
    currentPlans(),
    col.pharmacies().find({}, { projection: { _id: 1, name: 1, city: 1, referred_by_code: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(8).toArray(),
    col.referrals().aggregate<Document>([
      { $match: { status: 'review' } }, { $sort: { created_at: -1 } }, { $limit: 10 },
      { $lookup: { from: 'pharmacies', localField: 'referrer_pharmacy_id', foreignField: '_id', as: '__a', pipeline: [{ $project: { name: 1 } }] } },
      { $lookup: { from: 'pharmacies', localField: 'referred_pharmacy_id', foreignField: '_id', as: '__b', pipeline: [{ $project: { name: 1 } }] } }
    ]).toArray()
  ]);

  const visitorsOn = countBy(visitorsPerDay);
  const viewsOn = countBy(viewsPerDay);
  const activeOn = countBy(activePerDay);
  const days = range.days.map((day) => ({ day, visitors: visitorsOn.get(day) ?? 0, views: viewsOn.get(day) ?? 0, activeUsers: activeOn.get(day) ?? 0 }));
  const busiest = days.reduce<{ day: string; visitors: number } | null>((best, row) => (!best || row.visitors > best.visitors ? row : best), null);
  const states = countBy(pharmacyStates);
  const stages = countBy(referralStages);
  const planOf = new Map(plans.rows.map((row) => [row.pharmacyId, row]));
  const mix = planMix(plans.rows, plans.labels);
  const pharmacies = [...states.values()].reduce((sum, n) => sum + n, 0);
  const perReferral = env.REFERRAL_REWARD_DAYS;

  return {
    range: { from: range.from, to: range.to, days: range.days.length },
    kpis: {
      visitors: visitorRows[0]?.n ?? 0, activeUsers: activeTotal, registrations: registered, pharmacies,
      referrals: converted, paidSubscriptions: mix.paid
    },
    days,
    website: {
      views: days.reduce((sum, row) => sum + row.views, 0),
      averageVisitorsPerDay: Math.round(days.reduce((sum, row) => sum + row.visitors, 0) / Math.max(1, days.length)),
      busiestDay: busiest && busiest.visitors > 0 ? { day: busiest.day, visitors: busiest.visitors } : null,
      pages: pages.map((row) => ({ path: row._id, views: row.views })),
      referrers: referrers.map((row) => ({ host: row._id, visitors: row.visitors }))
    },
    registrations: { total: registered, referral: referredRegistrations, direct: registered - referredRegistrations },
    referrals: {
      invited, registered: converted, waiting: stages.get('pending') ?? 0, review: stages.get('review') ?? 0,
      readyDays: (claimed[0]?.ready ?? 0) * perReferral, claimedDays: claimed[0]?.claimedDays ?? 0, daysPerReferral: perReferral,
      held: held.map((row) => ({
        id: String(row._id), code: row.code as string, createdAt: row.created_at as string,
        referrer: (row.__a?.[0]?.name as string | undefined) ?? null,
        referred: { name: (row.referred_name as string | null) ?? null, email: (row.referred_email as string | null) ?? null, pharmacy: (row.__b?.[0]?.name as string | undefined) ?? null }
      }))
    },
    pharmacies: {
      total: pharmacies, active: states.get('active') ?? 0, suspended: states.get('suspended') ?? 0, closed: states.get('closed') ?? 0,
      paid: mix.paid, onTrial: mix.trialOrReferral, ended: plans.rows.filter((row) => !row.entitled).length
    },
    mix,
    recent: recent.map((pharmacy) => {
      const plan = planOf.get(pharmacy._id);
      return {
        id: pharmacy._id, name: pharmacy.name, city: pharmacy.city ?? null,
        plan: plan ? { category: plan.category, label: plan.label, entitled: plan.entitled } : null,
        source: pharmacy.referred_by_code ? 'Referral' : 'Direct', registeredAt: pharmacy.created_at
      };
    }),
    asOf: new Date().toISOString()
  };
}
