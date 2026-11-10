/* The Subscription wallet (2.9.0) and the Super Admin's Analytics page
   (2.10.0), over real HTTP against a real MongoDB.

   A pharmacy's referral link earns it 15 days for every pharmacy that
   registers through it: invited, then registered, then ready to claim; a
   claim adds the days to the end of the trial (or brings a locked account
   back), once, even when two claims race.

   The public website counts its visitors once a day from a random number
   the browser keeps — never a crawler, never a made-up page — and the
   Super Admin's Analytics page is made from it and from the pharmacies' own
   data: visitors, active users, registrations, pharmacies, referrals and
   paid subscriptions. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, SUPER_ADMIN, TEST_PASSWORD, codeFor, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;
const DAY = 86_400_000;
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('the Subscription wallet and the platform analytics', { skip }, () => {
  let server;
  let mongo;
  let admin;
  let referrer;
  let invited;
  const visit = (body, userAgent = BROWSER) => fetch(`${server.base}/api/v1/public/visit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent, Origin: 'http://localhost:5180' }, body: JSON.stringify(body)
  });

  before(async () => {
    server = await startServer();
    mongo = await import('../backend/src/db/mongo.ts');
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    referrer = await registerPharmacy(server.base, 'Medina', 'medina@wallet.test');
  });
  after(async () => { await server?.stop(); });

  describe('referral days', () => {
    it('shows the plans by their new names, and an empty Referrals tab', async () => {
      const billing = await referrer.client.get('/api/v1/billing');
      assert.deepEqual(billing.plans.map((plan) => [plan.name, plan.pricePaisa]), [['Demo', 0], ['Pro', 140_000], ['Diamond Annual', 1_200_000]]);
      assert.equal(billing.subscription.isTrial, true);
      assert.match(billing.referrals.link, /\/register\?ref=REF-/);
      assert.deepEqual(billing.referrals.rewards, { daysPerReferral: 15, invitations: 0, completed: 0, readyCount: 0, readyDays: 0, claimedDays: 0 });
      assert.ok(billing.sales.phone, 'a number to call about the annual plan');
    });

    it('counts a pharmacy that starts registering through the link as invited, and one that finishes as ready to claim', async () => {
      const { code } = (await referrer.client.get('/api/v1/billing')).referrals;
      const starter = new Client(server.base);
      await starter.post('/api/v1/register/start', { firstName: 'Shifa', lastName: 'Ahmed', email: 'shifa@wallet.test', password: TEST_PASSWORD, mobile: '0300 1234567', referralCode: code });
      let mine = (await referrer.client.get('/api/v1/billing')).referrals;
      assert.equal(mine.rewards.invitations, 1);
      assert.equal(mine.rewards.completed, 0);
      assert.equal(mine.referrals[0].name, 'Shifa Ahmed');
      assert.deepEqual([mine.referrals[0].registration, mine.referrals[0].extension], ['Invited', 'waiting']);

      const reply = await starter.post('/api/v1/register/verify-email', { code: await codeFor(starter, 'shifa@wallet.test') }, 201);
      starter.token = reply.accessToken;
      invited = { client: starter, pharmacyId: reply.data.pharmacyId };
      mine = (await referrer.client.get('/api/v1/billing')).referrals;
      assert.deepEqual([mine.rewards.invitations, mine.rewards.completed, mine.rewards.readyDays], [1, 1, 15]);
      assert.deepEqual([mine.referrals[0].registration, mine.referrals[0].extensionLabel], ['Registered', 'Ready to claim']);
      const notices = await referrer.client.get('/api/v1/notifications');
      assert.ok(notices.data.some((note) => /15 referral days are ready to claim/.test(note.title)));
    });

    it('adds the days to the end of the trial when they are claimed, once', async () => {
      const before = (await referrer.client.get('/api/v1/billing')).subscription;
      const claimed = await referrer.client.post('/api/v1/billing/referral-rewards/claim', {});
      assert.equal(claimed.claimed.days, 15);
      assert.equal(claimed.claimed.restarted, false);
      assert.equal(Date.parse(claimed.subscription.periodEnd) - Date.parse(before.periodEnd), 15 * DAY);
      assert.equal(claimed.subscription.daysLeft, before.daysLeft + 15);
      assert.equal(claimed.subscription.trial.daysLeft, before.trial.daysLeft + 15);
      assert.deepEqual([claimed.referrals.rewards.readyDays, claimed.referrals.rewards.claimedDays], [0, 15]);
      assert.equal(claimed.referrals.referrals[0].extensionLabel, 'Claimed +15 days');
      const again = await referrer.client.call('POST', '/api/v1/billing/referral-rewards/claim', {});
      assert.equal(again.status, 409);
      assert.equal(again.body.code, 'nothing_to_claim');
    });

    it('lets only one of two claims at the same moment through', async () => {
      const second = await registerPharmacy(server.base, 'Aman', 'aman@wallet.test');
      await mongo.col.referrals().insertOne({
        _id: randomUUID(), id: randomUUID(), code: 'REF-TEST01', referral_code_id: null, referrer_pharmacy_id: referrer.pharmacyId, referrer_user_id: null,
        referred_pharmacy_id: second.pharmacyId, referred_user_id: null, referred_email: 'aman@wallet.test', trial_id: null, status: 'converted',
        reject_reason: null, signup_ip: null, registered_at: new Date().toISOString(), verified_at: new Date().toISOString(),
        converted_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });
      const before = (await referrer.client.get('/api/v1/billing')).subscription;
      const replies = await Promise.all([1, 2].map(() => referrer.client.call('POST', '/api/v1/billing/referral-rewards/claim', {})));
      assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
      const after = (await referrer.client.get('/api/v1/billing')).subscription;
      assert.equal(Date.parse(after.periodEnd) - Date.parse(before.periodEnd), 15 * DAY, 'the days were added once');
    });

    it('brings a pharmacy whose trial has ended back for the days it earned', async () => {
      const lapsed = await registerPharmacy(server.base, 'Lapsed', 'lapsed@wallet.test');
      const subscription = await mongo.col.subscriptions().findOne({ pharmacy_id: lapsed.pharmacyId });
      await mongo.col.subscriptions().updateOne({ _id: subscription._id }, { $set: { current_period_end: new Date(Date.now() - DAY).toISOString() } });
      await mongo.col.referrals().insertOne({
        _id: 'REFERRAL-LAPSED', id: 'REFERRAL-LAPSED', code: 'REF-TEST02', referral_code_id: null, referrer_pharmacy_id: lapsed.pharmacyId, referrer_user_id: null,
        referred_pharmacy_id: 'PH-ELSEWHERE', referred_user_id: null, referred_email: 'someone@wallet.test', trial_id: null, status: 'converted',
        reject_reason: null, signup_ip: null, registered_at: new Date().toISOString(), verified_at: null, converted_at: new Date().toISOString(),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });
      assert.equal((await lapsed.client.get('/api/v1/billing')).subscription.locked, true);
      const claimed = await lapsed.client.post('/api/v1/billing/referral-rewards/claim', {});
      assert.equal(claimed.claimed.restarted, true);
      assert.equal(claimed.subscription.locked, false);
      assert.equal(claimed.subscription.daysLeft, 15);
    });

    it('lets only the Admin claim', async () => {
      const staff = await mongo.col.users().findOne({ pharmacy_id: referrer.pharmacyId });
      assert.ok(staff);
      const outsider = await new Client(server.base).call('POST', '/api/v1/billing/referral-rewards/claim', {});
      assert.equal(outsider.status, 401);
    });
  });

  describe('website visitors', () => {
    it('counts a visitor once a day and every page they open', async () => {
      const visitor = randomUUID();
      for (const path of ['/', '/pricing', '/pricing?plan=pro']) {
        const reply = await visit({ visitor, path, referrer: 'https://www.google.com/search?q=ksf' });
        assert.equal(reply.status, 200);
        assert.equal(reply.headers.get('set-cookie'), null, 'no cookie is set');
      }
      await visit({ visitor: randomUUID(), path: '/directory/panadol' });
      const analytics = await admin.get('/api/v1/platform/analytics');
      assert.equal(analytics.kpis.visitors, 2);
      assert.equal(analytics.website.views, 4);
      assert.deepEqual(analytics.website.pages.find((row) => row.path === '/pricing'), { path: '/pricing', views: 2 });
      assert.ok(analytics.website.pages.some((row) => row.path === '/directory'));
      assert.deepEqual(analytics.website.referrers, [{ host: 'google.com', visitors: 1 }]);
      assert.equal(analytics.days.length, 30);
      assert.equal(analytics.days.at(-1).visitors, 2);
      assert.equal(analytics.days.at(-1).views, 4);
      assert.deepEqual(analytics.website.busiestDay, { day: analytics.days.at(-1).day, visitors: 2 });
    });

    it('does not count a crawler, a made-up visitor or a made-up page', async () => {
      await visit({ visitor: randomUUID(), path: '/' }, 'Googlebot/2.1 (+http://www.google.com/bot.html)');
      await visit({ visitor: 'not-a-visitor', path: '/' });
      await visit({ visitor: randomUUID(), path: '/wp-admin/install.php' });
      const analytics = await admin.get('/api/v1/platform/analytics');
      assert.equal(analytics.kpis.visitors, 3, 'only the one with a real visitor number and browser');
      assert.ok(analytics.website.pages.some((row) => row.path === '/other'));
      assert.ok(!analytics.website.pages.some((row) => row.path.includes('wp-admin')));
      const stored = await mongo.col.siteVisits().findOne({});
      assert.match(stored.visitor, /^[0-9a-f]{32}$/, 'kept only as a hash');
      assert.equal(JSON.stringify(stored).includes('127.0.0.1'), false, 'no address is stored');
    });
  });

  describe('the Super Admin', () => {
    it('sees the analytics: visitors, active users, registrations, pharmacies, referrals and paid plans', async () => {
      const analytics = await admin.get('/api/v1/platform/analytics');
      assert.equal(analytics.range.days, 30);
      assert.equal(analytics.kpis.visitors, 3);
      assert.ok(analytics.kpis.activeUsers >= 3, 'the pharmacy owners who used KSF');
      const today = analytics.days.at(-1).activeUsers;
      assert.ok(today >= 1 && today <= analytics.kpis.activeUsers, 'people who used KSF today, counted once each');
      assert.equal(analytics.kpis.registrations, 4);
      assert.equal(analytics.kpis.pharmacies, 4);
      assert.equal(analytics.kpis.referrals, 3, 'Shifa, and the two honoured referrals the tests above added');
      assert.equal(analytics.kpis.paidSubscriptions, 0);
      assert.deepEqual(analytics.registrations, { total: 4, referral: 1, direct: 3 });
      assert.deepEqual(analytics.pharmacies, { total: 4, active: 4, suspended: 0, closed: 0, paid: 0, onTrial: 4, ended: 0 });
      assert.equal(analytics.referrals.registered, 3);
      assert.equal(analytics.referrals.daysPerReferral, 15);
      assert.ok(analytics.referrals.invited >= 3);
      assert.ok(analytics.referrals.claimedDays >= 15, 'the days claimed in the tests above');
      assert.equal(analytics.recent.length, 4);
      assert.equal(analytics.recent.find((row) => row.name.includes('Shifa')).source, 'Referral');
      const mix = Object.fromEntries(analytics.mix.items.map((item) => [item.key, item.count]));
      assert.equal(analytics.mix.total, 4);
      assert.equal(mix.referral, 3, 'Shifa came through a referral; Medina and Lapsed claimed referral days');
      assert.equal(mix.demo, 1);
      assert.deepEqual(analytics.mix.items.map((item) => item.label), ['Demo trial', 'Standard Referral', 'Pro monthly', 'Diamond Annual']);
      assert.equal(analytics.mix.items.reduce((sum, item) => sum + item.percent, 0) <= 101, true);
    });

    it('counts a pharmacy that pays as a paid subscription', async () => {
      await admin.post('/api/v1/auth/verify-identity', { password: SUPER_ADMIN.password });
      const aman = await mongo.col.pharmacies().findOne({ name: /Aman/ });
      await admin.post(`/api/v1/platform/pharmacies/${aman._id}/subscription`, { planKey: 'monthly' });
      const analytics = await admin.get('/api/v1/platform/analytics');
      assert.equal(analytics.kpis.paidSubscriptions, 1);
      assert.equal(analytics.mix.items.find((item) => item.key === 'pro').count, 1);
      assert.equal(analytics.mix.paid, 1);
      assert.equal(analytics.pharmacies.paid, 1);
      assert.equal(analytics.pharmacies.onTrial, 3);
    });

    it('shows a referral held for a check, and decides it', async () => {
      const id = randomUUID();
      await mongo.col.referrals().insertOne({
        _id: id, id, code: 'REF-TEST03', referral_code_id: null, referrer_pharmacy_id: referrer.pharmacyId, referrer_user_id: null,
        referred_pharmacy_id: invited.pharmacyId, referred_user_id: null, referred_email: 'review@wallet.test', trial_id: null, status: 'review',
        reject_reason: null, signup_ip: null, registered_at: new Date().toISOString(), verified_at: null, converted_at: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });
      const before = await admin.get('/api/v1/platform/analytics');
      assert.equal(before.referrals.review, 1);
      const held = before.referrals.held.find((row) => row.id === id);
      assert.equal(held.code, 'REF-TEST03');
      assert.equal(held.referrer, (await mongo.col.pharmacies().findOne({ _id: referrer.pharmacyId })).name);
      assert.equal(held.referred.email, 'review@wallet.test');
      await admin.post(`/api/v1/platform/referrals/${id}/approve`, {});
      assert.equal((await mongo.col.referrals().findOne({ _id: id })).status, 'converted');
      assert.equal((await referrer.client.get('/api/v1/billing')).referrals.rewards.readyDays, 15, 'its days are ready for the referrer');
      const afterwards = await admin.get('/api/v1/platform/analytics');
      assert.equal(afterwards.referrals.review, 0);
      assert.equal(afterwards.referrals.held.length, 0);
      assert.equal(afterwards.referrals.readyDays, 15);
      await admin.call('POST', `/api/v1/platform/referrals/${id}/approve`, {}).then((reply) => assert.equal(reply.status, 400));
      const other = await admin.call('POST', '/api/v1/platform/referrals/REFERRAL-LAPSED/reject', { reason: 'test' });
      assert.equal(other.status, 400, 'a referral already honoured cannot be turned down');
    });

    it('takes a period, refuses one that is backwards or longer than a year, and keeps it all from a pharmacy', async () => {
      const week = await admin.get('/api/v1/platform/analytics?from=2026-01-01&to=2026-01-07');
      assert.equal(week.days.length, 7);
      assert.equal(week.kpis.visitors, 0);
      assert.equal(week.kpis.registrations, 0);
      assert.equal(week.kpis.pharmacies, 4, 'pharmacies are counted as of today');
      assert.equal((await admin.call('GET', '/api/v1/platform/analytics?from=2026-02-01&to=2026-01-01')).status, 400);
      assert.equal((await admin.call('GET', '/api/v1/platform/analytics?from=2024-01-01&to=2026-01-01')).status, 400);
      assert.equal((await referrer.client.call('GET', '/api/v1/platform/analytics')).status, 403);
      assert.equal((await referrer.client.call('POST', '/api/v1/platform/referrals/REFERRAL-LAPSED/approve', {})).status, 403);
    });
  });
});
