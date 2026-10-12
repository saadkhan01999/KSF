/* Live plans, prices and subscriptions, over real HTTP against a real MongoDB.

   A visitor's pricing page and a pharmacy's screens hear about a price change
   as it happens; a pharmacy hears about its own subscription and nobody
   else's; a reconnecting browser is replayed what it missed; and what a plan
   includes is enforced by the server the moment the plan changes. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;

/** Read a Server-Sent Events stream into a list as it arrives. */
async function openFeed(base, path, token, lastEventId) {
  const controller = new AbortController();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (lastEventId) headers['Last-Event-ID'] = lastEventId;
  const response = await fetch(base + path, { headers, signal: controller.signal });
  const events = [];
  let wake = () => {};
  void (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const field = (name) => block.split('\n').find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
          if (field('event')) { events.push({ type: field('event'), id: field('id'), data: JSON.parse(field('data') ?? '{}') }); wake(); }
        }
      }
    } catch { /* closed by the test */ }
  })();

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    events,
    /** The first event of `type` (after `from`), or a failure after `ms`. */
    next(type, ms = 4000, from = 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No ${type} event within ${ms}ms; saw ${events.map((e) => e.type).join(', ')}`)), ms);
        const check = () => {
          const found = events.slice(from).find((event) => event.type === type);
          if (found) { clearTimeout(timer); resolve(found); }
        };
        wake = check;
        check();
      });
    },
    close() { controller.abort(); }
  };
}

describe('live plans and subscriptions', { skip }, () => {
  let server;
  let admin;
  let shifa;
  let other;

  before(async () => {
    server = await startServer();
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    shifa = await registerPharmacy(server.base, 'Shifa', 'shifa@live.test');
    other = await registerPharmacy(server.base, 'Other', 'other@live.test');
  });
  after(async () => { await server?.stop(); });

  it('tells a visitor the moment the Super Admin changes a price', async () => {
    const feed = await openFeed(server.base, '/api/v1/public/events');
    assert.equal(feed.status, 200);
    assert.match(feed.contentType, /text\/event-stream/);
    await feed.next('ready');
    await admin.patch('/api/v1/platform/plans/monthly', { pricePaisa: 450_000 });
    await feed.next('plans.changed');
    const plans = await new Client(server.base).get('/api/v1/public/plans');
    assert.equal(plans.data.find((plan) => plan.key === 'monthly').pricePaisa, 450_000);
    feed.close();
  });

  it("tells a pharmacy about its own subscription, and no other pharmacy's", async () => {
    const mine = await openFeed(server.base, '/api/v1/events', shifa.client.token);
    const theirs = await openFeed(server.base, '/api/v1/events', other.client.token);
    const platformFeed = await openFeed(server.base, '/api/v1/events', admin.token);
    await Promise.all([mine.next('ready'), theirs.next('ready'), platformFeed.next('ready')]);

    await admin.post(`/api/v1/platform/pharmacies/${shifa.pharmacyId}/subscription`, { planKey: 'monthly' });
    const event = await mine.next('subscription.changed');
    assert.equal(event.data.pharmacyId, shifa.pharmacyId);
    assert.equal((await platformFeed.next('subscription.changed')).data.pharmacyId, shifa.pharmacyId);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(theirs.events.some((e) => e.type === 'subscription.changed'), false);
    assert.equal((await shifa.client.get('/api/v1/billing/entitlements')).plan, 'monthly');
    for (const feed of [mine, theirs, platformFeed]) feed.close();
  });

  it('refuses the private feed to a visitor', async () => {
    assert.equal((await new Client(server.base).call('GET', '/api/v1/events')).status, 401);
  });

  it('replays what a reconnecting browser missed, and asks a stranger to resync', async () => {
    const first = await openFeed(server.base, '/api/v1/public/events');
    const ready = await first.next('ready');
    first.close();
    await admin.patch('/api/v1/platform/plans/weekly', { tagline: 'Pay as the week goes — now with exports' });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const again = await openFeed(server.base, '/api/v1/public/events', '', ready.id);
    assert.equal((await again.next('plans.changed')).type, 'plans.changed');
    again.close();

    const stranger = await openFeed(server.base, '/api/v1/public/events', '', 'deadbeef:12');
    await stranger.next('resync');
    stranger.close();
  });

  it('locks and unlocks a feature on the server the moment the plan changes', async () => {
    await shifa.client.get('/api/v1/reports/top-medicines');
    await admin.patch('/api/v1/platform/plans/monthly', { features: ['pos.core', 'inventory.batches', 'reports.core', 'messaging.internal'] });
    const locked = await shifa.client.call('GET', '/api/v1/reports/top-medicines');
    assert.equal(locked.status, 402);
    assert.equal(locked.body.feature, 'reports.advanced');
    assert.deepEqual(locked.body.plans.map((plan) => plan.key), ['weekly', 'annual']);
    /* The platform team in support mode is there to help, whatever the plan. */
    admin.pharmacyId = shifa.pharmacyId;
    await admin.get('/api/v1/reports/top-medicines');
    admin.pharmacyId = '';
    await admin.patch('/api/v1/platform/plans/monthly', { features: ['pos.core', 'inventory.batches', 'reports.core', 'reports.advanced', 'messaging.internal'] });
    await shifa.client.get('/api/v1/reports/top-medicines');
  });
});
