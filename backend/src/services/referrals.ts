/* ==========================================================================
   Referrals and the referral trial
   --------------------------------------------------------------------------
   Every pharmacy gets a code (REF-X82K9Q) and a link (/register?ref=…). A
   pharmacy that registers through it gets a premium trial, starting when its
   e-mail is verified — not when the link is clicked, which is what stops a
   script minting trials by loading a URL.

   Abuse protection, in order: the code must be active and not used up; no
   self-referral; one trial per account ever; one referral per address per
   code (unique index); a daily cap per referrer; a daily cap per signup IP
   (which marks the referral for review rather than refusing the account);
   nothing credited until the address is verified.
   ========================================================================== */

import { env } from '../config/env.js';
import { col } from '../db/mongo.js';
import type { ReferralCode } from '../db/types.js';
import { maskEmail, nowIso, randomUUID, toStr } from '../core/util.js';
import { shortReference } from '../security/crypto.js';
import { startTrial } from './subscriptions.js';

export const referralLink = (code: string): string => `${env.PUBLIC_APP_URL}/register?ref=${code}`;

/** The pharmacy's code, created the first time it is asked for. */
export async function codeFor(pharmacyId: string, userId: string | null = null): Promise<ReferralCode> {
  const existing = await col.referralCodes().findOne({ pharmacy_id: pharmacyId, status: 'active' });
  if (existing) return existing;
  const at = nowIso();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomUUID();
    const doc: ReferralCode = {
      _id: id, id, code: shortReference('REF', 6), pharmacy_id: pharmacyId, user_id: userId, uses: 0, successful: 0,
      max_uses: env.REFERRAL_MAX_USES, status: 'active', created_at: at, updated_at: at
    };
    try {
      await col.referralCodes().insertOne(doc);
      return doc;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  throw new Error('Could not create a referral code.');
}

/** Is this code usable? Reveals nothing about the referrer beyond its name. */
export async function validateCode(rawCode: unknown): Promise<{ valid: boolean; code?: string; pharmacyName?: string; trialDays?: number; reason?: string }> {
  const code = toStr(rawCode, 32).toUpperCase();
  if (!code) return { valid: false, reason: 'Enter a referral code.' };
  const row = await col.referralCodes().findOne({ code, status: 'active' });
  if (!row) return { valid: false, reason: 'That referral code was not recognised.' };
  if (row.max_uses > 0 && row.uses >= row.max_uses) return { valid: false, reason: 'That referral code has been used the maximum number of times.' };
  const pharmacy = await col.pharmacies().findOne({ _id: row.pharmacy_id }, { projection: { name: 1 } });
  return { valid: true, code: row.code, pharmacyName: pharmacy?.name ?? 'a KSF pharmacy', trialDays: env.REFERRAL_TRIAL_DAYS };
}

/** Attach a referral to a registration under way. Nothing is credited yet. */
export async function claimReferral(input: { code: string; email: string; ip: string | null }): Promise<{ ok: boolean; referralId?: string; reason?: string; review?: boolean }> {
  const check = await validateCode(input.code);
  if (!check.valid || !check.code) return { ok: false, reason: check.reason };
  const address = String(input.email || '').toLowerCase();
  const row = await col.referralCodes().findOne({ code: check.code });
  if (!row) return { ok: false, reason: 'That referral code was not recognised.' };

  const referrer = row.user_id ? await col.users().findOne({ _id: row.user_id }, { projection: { email: 1 } }) : null;
  if (referrer && referrer.email.toLowerCase() === address) return { ok: false, reason: 'You cannot use your own referral code.' };
  if (await col.users().findOne({ email: address, pharmacy_id: row.pharmacy_id })) {
    return { ok: false, reason: 'That code belongs to a pharmacy this address already works at.' };
  }
  if (await col.referrals().findOne({ code: check.code, referred_email: address })) return { ok: false, reason: 'That code has already been used with this e-mail address.' };
  if (await col.referrals().findOne({ referred_email: address, status: { $in: ['verified', 'converted'] } })) {
    return { ok: false, reason: 'This e-mail address has already had a referral trial.' };
  }

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  if (await col.referrals().countDocuments({ code: check.code, created_at: { $gt: dayAgo } }) >= env.REFERRAL_MAX_PER_DAY) {
    return { ok: false, reason: 'That code has been used too many times today. Please try again tomorrow.' };
  }
  const review = input.ip
    ? (await col.referrals().countDocuments({ signup_ip: input.ip, created_at: { $gt: dayAgo } })) >= env.REFERRAL_MAX_PER_IP_PER_DAY
    : false;

  const at = nowIso();
  const id = randomUUID();
  await col.referrals().insertOne({
    _id: id, id, code: check.code, referral_code_id: row.id, referrer_pharmacy_id: row.pharmacy_id, referrer_user_id: row.user_id,
    referred_pharmacy_id: null, referred_user_id: null, referred_email: address, trial_id: null,
    status: review ? 'review' : 'pending', reject_reason: null, signup_ip: input.ip ?? null, registered_at: at,
    verified_at: null, converted_at: null, created_at: at, updated_at: at
  });
  await col.referralCodes().updateOne({ _id: row.id }, { $inc: { uses: 1 }, $set: { updated_at: at } });
  return { ok: true, referralId: id, review };
}

/** The e-mail is verified and the pharmacy exists: honour the referral. */
export async function completeReferral(input: { referralId: string; pharmacyId: string; userId: string }): Promise<{ ok: boolean; trial?: { expires_at: string }; reason?: string }> {
  const referral = await col.referrals().findOne({ _id: input.referralId });
  if (!referral) return { ok: false, reason: 'That referral could not be found.' };
  if (referral.status === 'converted') return { ok: false, reason: 'That referral has already been honoured.' };
  const at = nowIso();
  if (referral.status === 'review') {
    await col.referrals().updateOne({ _id: referral.id }, { $set: { referred_pharmacy_id: input.pharmacyId, referred_user_id: input.userId, verified_at: at, updated_at: at } });
    return { ok: false, reason: 'This referral is being checked. The account is active on the Basic plan in the meantime.' };
  }
  if (referral.referrer_pharmacy_id === input.pharmacyId) {
    await col.referrals().updateOne({ _id: referral.id }, { $set: { status: 'rejected', reject_reason: 'self-referral', updated_at: at } });
    return { ok: false, reason: 'A pharmacy cannot refer itself.' };
  }
  const trial = await startTrial({ pharmacyId: input.pharmacyId, days: env.REFERRAL_TRIAL_DAYS, source: 'referral', referralId: referral.id });
  if (!trial.ok) {
    await col.referrals().updateOne({ _id: referral.id }, { $set: { status: 'rejected', reject_reason: toStr(trial.reason, 200), updated_at: at } });
    return { ok: false, reason: trial.reason };
  }
  const granted = trial.trial as { id: string; expires_at: string };
  await col.referrals().updateOne({ _id: referral.id }, {
    $set: { referred_pharmacy_id: input.pharmacyId, referred_user_id: input.userId, trial_id: granted.id, status: 'converted', verified_at: at, converted_at: at, updated_at: at }
  });
  await col.referralCodes().updateOne({ code: referral.code }, { $inc: { successful: 1 }, $set: { updated_at: at } });
  return { ok: true, trial: granted };
}

/** The referral panel under Settings › Billing and Subscription. */
export async function referralSummary(pharmacyId: string, userId: string | null = null) {
  const row = await codeFor(pharmacyId, userId);
  const rows = await col.referrals().aggregate([
    { $match: { referrer_pharmacy_id: pharmacyId } }, { $sort: { created_at: -1 } }, { $limit: 50 },
    { $lookup: { from: 'pharmacies', localField: 'referred_pharmacy_id', foreignField: '_id', as: 'pharmacy' } },
    { $set: { pharmacy_name: { $first: '$pharmacy.name' } } }
  ]).toArray();
  const counts: Record<string, number> = {};
  for (const item of rows) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return {
    code: row.code, link: referralLink(row.code), trialDays: env.REFERRAL_TRIAL_DAYS, uses: row.uses, successful: row.successful,
    maxUses: row.max_uses, counts,
    referrals: rows.map((item) => ({
      id: item.id, email: maskEmail(item.referred_email), pharmacyName: item.pharmacy_name ?? null, status: item.status,
      registeredAt: item.registered_at, convertedAt: item.converted_at
    }))
  };
}
