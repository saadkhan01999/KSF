/* ==========================================================================
   Referral codes the Super Admin issues
   --------------------------------------------------------------------------
   Every pharmacy has a code from the day it registers (REF-X82K9Q). The
   Super Admin can give it a code people can say and remember, made from its
   name — Khan Pharmacy gets KHAN-239 — or type one of their own. The new
   code becomes the one the pharmacy sees and shares; the codes it had
   before keep working ("legacy"), so a link already sent never breaks.

   The Super Admin then sees, for every pharmacy, how many pharmacies
   registered with its codes, and which ones: name, city, owner, when, how
   far they got and the plan they are on.
   ========================================================================== */

import { randomInt } from 'node:crypto';
import { env } from '../config/env.js';
import { col, tx } from '../db/mongo.js';
import type { ReferralCode } from '../db/types.js';
import { HttpError } from '../core/errors.js';
import { contains, nowIso, randomUUID, toStr } from '../core/util.js';
import { currentPlans } from './insights.js';
import { codeFor, referralLink, rewardDays } from './referrals.js';

/** Codes that still bring pharmacies in: the one shared now, and the ones before it. */
export const LIVE_CODE = ['active', 'legacy'];

/* Words that say what a pharmacy is, not which one: skipped when a code is made from a name. */
const GENERIC = new Set([
  'PHARMACY', 'PHARMACIES', 'PHARMA', 'PHARMACEUTICAL', 'PHARMACEUTICALS', 'MEDICAL', 'MEDICALS', 'MEDICOS', 'MEDICINE', 'MEDICINES',
  'STORE', 'STORES', 'CHEMIST', 'CHEMISTS', 'DRUG', 'DRUGS', 'CLINIC', 'HEALTH', 'CARE', 'CENTRE', 'CENTER', 'HOUSE', 'MART',
  'THE', 'AND', 'AL', 'EL', 'PVT', 'LTD', 'CO', 'NEW', 'MY'
]);

/* Never a code on their own, even when every other word is generic. */
const ARTICLES = new Set(['THE', 'AND', 'AL', 'EL', 'PVT', 'LTD', 'CO', 'NEW', 'MY']);

/** "Khan Pharmacy" → KHAN; "Al-Shifa Medical Store" → SHIFA; nothing usable → KSF. */
export function codeStem(name: string): string {
  const words = String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(Boolean);
  const stem = (words.find((word) => !GENERIC.has(word)) ?? words.find((word) => !ARTICLES.has(word)) ?? '').slice(0, 10);
  return stem.length >= 2 ? stem : 'KSF';
}

/** A code typed by the Super Admin, tidied: " khan-239 " → KHAN-239. */
export const tidyCode = (raw: unknown): string => toStr(raw, 24).trim().toUpperCase().replace(/\s+/g, '-');

const CODE_SHAPE = /^[A-Z0-9]{2,12}-[0-9]{2,6}$/;

/**
 * Give a pharmacy a new code: KHAN-239 from its name, or the one typed. It
 * becomes the code the pharmacy shares; its earlier codes keep working.
 */
export async function issueReferralCode(input: { pharmacyId: string; code?: unknown; byUserId: string }): Promise<{ code: string; link: string; previous: string[] }> {
  const pharmacy = await col.pharmacies().findOne({ _id: input.pharmacyId }, { projection: { name: 1 } });
  if (!pharmacy) throw new HttpError(404, 'That pharmacy could not be found.');
  const wanted = input.code === undefined || input.code === null || input.code === '' ? null : tidyCode(input.code);
  if (wanted !== null && !CODE_SHAPE.test(wanted)) {
    throw new HttpError(400, 'A referral code is letters, a dash and numbers — like KHAN-239.');
  }

  /* The pharmacy's first code is made the usual way if it never had one, so it is kept as a legacy code too. */
  await codeFor(input.pharmacyId);
  const stem = codeStem(pharmacy.name);
  let code = wanted;
  if (code) {
    if (await col.referralCodes().findOne({ code })) throw new HttpError(409, `${code} is already taken. Choose another.`);
  } else {
    for (let attempt = 0; attempt < 40 && !code; attempt += 1) {
      const candidate = `${stem}-${attempt < 25 ? randomInt(100, 1000) : randomInt(1000, 10000)}`;
      if (!await col.referralCodes().findOne({ code: candidate })) code = candidate;
    }
    if (!code) throw new HttpError(409, 'Could not find a free code just now. Try again.');
  }

  const at = nowIso();
  const previous = await tx(async () => {
    const before = await col.referralCodes().find({ pharmacy_id: input.pharmacyId, status: 'active' }, { projection: { code: 1 } }).toArray();
    await col.referralCodes().updateMany({ pharmacy_id: input.pharmacyId, status: 'active' }, { $set: { status: 'legacy', updated_at: at } });
    const id = randomUUID();
    const doc: ReferralCode = {
      _id: id, id, code: code!, pharmacy_id: input.pharmacyId, user_id: null, uses: 0, successful: 0,
      max_uses: env.REFERRAL_MAX_USES, status: 'active', created_at: at, updated_at: at, issued_by: input.byUserId
    };
    try {
      await col.referralCodes().insertOne(doc);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, `${code} was taken a moment ago. Try again.`);
      throw error;
    }
    return before.map((row) => row.code);
  });
  return { code: code!, link: referralLink(code!), previous };
}

/** Which stage a referral is at, in the words the Super Admin's screens use. */
export const STAGE_LABEL: Record<string, string> = { pending: 'Signing up', review: 'Being checked', converted: 'Registered', rejected: 'Not accepted' };

/**
 * Every pharmacy and its referral codes, with how many pharmacies registered
 * with them: the most successful first. `q` finds a pharmacy by name, city
 * or any of its codes.
 */
export async function referralCodeBoard(search: string) {
  const term = toStr(search, 60);
  const pattern = term ? contains(term) : null;
  const byCode = pattern ? await col.referralCodes().distinct('pharmacy_id', { code: pattern }) : [];
  const pharmacies = await col.pharmacies()
    .find(pattern ? { $or: [{ name: pattern }, { city: pattern }, { _id: { $in: byCode } }] } : {}, { projection: { name: 1, city: 1, status: 1, created_at: 1 } })
    .sort({ created_at: -1 }).limit(500).toArray();
  const ids = pharmacies.map((pharmacy) => pharmacy._id);
  const [codes, stats, totals] = await Promise.all([
    col.referralCodes().find({ pharmacy_id: { $in: ids }, status: { $in: LIVE_CODE } }).sort({ created_at: -1 }).toArray(),
    col.referrals().aggregate<{ _id: string; registered: number; signingUp: number; review: number; rejected: number; last: string | null }>([
      { $match: { referrer_pharmacy_id: { $in: ids } } },
      {
        $group: {
          _id: '$referrer_pharmacy_id',
          registered: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          signingUp: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          review: { $sum: { $cond: [{ $eq: ['$status', 'review'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          last: { $max: '$converted_at' }
        }
      }
    ]).toArray(),
    Promise.all([
      col.referralCodes().countDocuments({ status: 'active', issued_by: { $type: 'string' } }),
      col.referrals().countDocuments({ status: 'converted' })
    ])
  ]);
  const codesOf = new Map<string, ReferralCode[]>();
  for (const row of codes) codesOf.set(row.pharmacy_id, [...(codesOf.get(row.pharmacy_id) ?? []), row]);
  const statsOf = new Map(stats.map((row) => [row._id, row]));
  const rows = pharmacies.map((pharmacy) => {
    const own = codesOf.get(pharmacy._id) ?? [];
    const active = own.find((row) => row.status === 'active') ?? null;
    const counts = statsOf.get(pharmacy._id);
    return {
      pharmacyId: pharmacy._id, name: pharmacy.name, city: pharmacy.city ?? null, status: pharmacy.status,
      code: active?.code ?? null, issued: !!active?.issued_by, otherCodes: own.filter((row) => row !== active).map((row) => row.code),
      registered: counts?.registered ?? 0, signingUp: counts?.signingUp ?? 0, review: counts?.review ?? 0, rejected: counts?.rejected ?? 0,
      lastRegisteredAt: counts?.last ?? null
    };
  });
  rows.sort((a, b) => b.registered - a.registered || (b.signingUp + b.review) - (a.signingUp + a.review) || a.name.localeCompare(b.name));
  return { data: rows, totals: { pharmacies: rows.length, issuedCodes: totals[0], registrations: totals[1] }, daysPerReferral: rewardDays() };
}

/**
 * One pharmacy's referrals: its codes, every pharmacy that registered (or
 * started to) with them, and the pharmacy whose code it registered with.
 */
export async function pharmacyReferrals(pharmacyId: string) {
  const pharmacy = await col.pharmacies().findOne({ _id: pharmacyId }, { projection: { name: 1, referred_by_code: 1 } });
  if (!pharmacy) throw new HttpError(404, 'That pharmacy could not be found.');
  await codeFor(pharmacyId);
  const [codes, rows, plans, came] = await Promise.all([
    col.referralCodes().find({ pharmacy_id: pharmacyId }).sort({ status: 1, created_at: -1 }).toArray(),
    col.referrals().aggregate<{
      _id: string; code: string; status: string; referred_email: string; referred_name?: string | null; referred_pharmacy_id: string | null;
      created_at: string; converted_at: string | null; reject_reason: string | null; reward_days?: number | null; reward_claimed_at?: string | null;
      __p?: { name: string; city?: string | null; status: string; created_at: string; owner_user_id?: string | null }[];
      __o?: { full_name: string; email: string; phone?: string | null }[];
    }>([
      { $match: { referrer_pharmacy_id: pharmacyId } }, { $sort: { created_at: -1 } }, { $limit: 500 },
      { $lookup: { from: 'pharmacies', localField: 'referred_pharmacy_id', foreignField: '_id', as: '__p', pipeline: [{ $project: { name: 1, city: 1, status: 1, created_at: 1, owner_user_id: 1 } }] } },
      { $lookup: { from: 'users', localField: '__p.owner_user_id', foreignField: '_id', as: '__o', pipeline: [{ $project: { full_name: 1, email: 1, phone: 1 } }] } }
    ]).toArray(),
    currentPlans(),
    pharmacy.referred_by_code ? col.referralCodes().findOne({ code: pharmacy.referred_by_code }) : Promise.resolve(null)
  ]);
  const referrer = came ? await col.pharmacies().findOne({ _id: came.pharmacy_id }, { projection: { name: 1, city: 1 } }) : null;
  const planOf = new Map(plans.rows.map((row) => [row.pharmacyId, row]));
  return {
    pharmacy: { id: pharmacyId, name: pharmacy.name },
    codes: codes.map((row) => ({
      code: row.code, status: row.status, issued: !!row.issued_by, uses: row.uses, registered: row.successful,
      createdAt: row.created_at, link: referralLink(row.code)
    })),
    cameThrough: pharmacy.referred_by_code
      ? { code: pharmacy.referred_by_code, pharmacyId: referrer?._id ?? null, pharmacyName: referrer?.name ?? null, city: referrer?.city ?? null }
      : null,
    counts: {
      registered: rows.filter((row) => row.status === 'converted').length,
      signingUp: rows.filter((row) => row.status === 'pending').length,
      review: rows.filter((row) => row.status === 'review').length,
      rejected: rows.filter((row) => row.status === 'rejected').length
    },
    daysPerReferral: rewardDays(),
    referred: rows.map((row) => {
      const joined = row.__p?.[0] ?? null;
      const plan = row.referred_pharmacy_id ? planOf.get(row.referred_pharmacy_id) : undefined;
      return {
        id: row._id, code: row.code, status: row.status, stage: STAGE_LABEL[row.status] ?? row.status, rejectReason: row.reject_reason ?? null,
        pharmacyId: row.referred_pharmacy_id, pharmacyName: joined?.name ?? null, city: joined?.city ?? null, pharmacyStatus: joined?.status ?? null,
        owner: row.__o?.[0] ? { name: row.__o[0].full_name, email: row.__o[0].email, phone: row.__o[0].phone ?? null } : null,
        name: row.referred_name ?? null, email: row.referred_email,
        startedAt: row.created_at, registeredAt: row.converted_at ?? joined?.created_at ?? null,
        plan: plan ? { category: plan.category, label: plan.label, entitled: plan.entitled } : null,
        rewardDays: row.reward_days ?? null, rewardClaimedAt: row.reward_claimed_at ?? null
      };
    })
  };
}
