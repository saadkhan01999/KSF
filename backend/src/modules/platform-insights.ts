/* ==========================================================================
   The Super Admin's Analytics page (services/insights.ts does the counting)
   --------------------------------------------------------------------------
   Website visitors, active users, new registrations, referrals, pharmacies
   and paid subscriptions for a period, in one answer. The public website's
   visit beacon lives here too: it is the one public route, and all it can
   do is add one to a count. A referral held for checking is decided here,
   and the Super Admin issues a pharmacy's referral code (KHAN-239) and sees
   who registered with it.
   ========================================================================== */

import { col } from '../db/mongo.js';
import type { Referral } from '../db/types.js';
import { bad, missing } from '../core/errors.js';
import { auditLog, notify } from '../core/trails.js';
import { nowIso, toStr } from '../core/util.js';
import { hit } from '../security/throttle.js';
import { platformRoute, publicRoute, type SignedInCtx } from '../http/router.js';
import { analyticsInsights, rangeOf, recordVisit } from '../services/insights.js';
import { rewardDays } from '../services/referrals.js';
import { issueReferralCode, pharmacyReferrals, referralCodeBoard } from '../services/referral-codes.js';

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

/* ------------------------------------------------------------ analytics */

platformRoute('GET', '/api/v1/platform/analytics', 'platform.overview', async (ctx) => analyticsInsights(rangeOf(ctx.query)));

/* ------------------------------------------------------------ referrals */

/* Every pharmacy's referral codes and how many pharmacies registered with them. */
platformRoute('GET', '/api/v1/platform/referral-codes', 'platform.pharmacies.view', async (ctx) => referralCodeBoard(toStr(ctx.query.get('q'), 60)));

/* One pharmacy: its codes, the pharmacies that registered with them, and whose code it came through. */
platformRoute('GET', '/api/v1/platform/pharmacies/:id/referrals', 'platform.pharmacies.view', async (ctx) => pharmacyReferrals(toStr(ctx.params.id, 60)));

/* Give a pharmacy a referral code people can remember: KHAN-239 from its name, or one typed. */
platformRoute('POST', '/api/v1/platform/pharmacies/:id/referral-code', 'platform.pharmacies.manage', async (ctx) => {
  const pharmacyId = toStr(ctx.params.id, 60);
  const issued = await issueReferralCode({ pharmacyId, code: ctx.body.code, byUserId: ctx.user.id });
  const earlier = issued.previous.length ? ` (${issued.previous.join(', ')} still works)` : '';
  await auditLog(trailFor(ctx, pharmacyId), { action: 'platform.referral-code-issued', entity: 'referral_code', entityId: issued.code, summary: `Referral code ${issued.code} issued by the platform${earlier}` });
  await notify(pharmacyId, {
    type: 'billing', severity: 'info', title: `Your referral code is now ${issued.code}`,
    body: `Share it with pharmacies you know: each one that registers with it earns you ${rewardDays()} days of full access.${issued.previous.length ? ' Your earlier code keeps working.' : ''}`,
    link: '/subscription-plans?tab=referrals'
  });
  return { data: issued, message: `${issued.code} is now this pharmacy's referral code.${earlier}` };
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
