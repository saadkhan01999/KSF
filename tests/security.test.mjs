/* Security: the request checks, forged and stale tokens, two-step sign-in,
   headers and origins, shared throttling — and every registered route fed
   input it does not expect.

   The hostile-input sweep reads the route table from the server, like
   access.test.mjs, so a route added tomorrow is attacked tomorrow. It sends
   wrong types, oversized strings, arrays where objects belong, odd ids and
   odd query strings, as someone allowed to use the route, and requires a
   4xx (or a success) — never a server error, and never a stack trace. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Client, SUPER_ADMIN, TEST_PASSWORD, codeFor, registerPharmacy, startServer } from './support/server.mjs';

const { unsafeKey, isSafeRedirect, bodyLimitFor } = await import('../backend/src/http/safety.ts');
const { internalPath } = await import('../frontend/src/utils/format.ts');
const { totpAt, totpStep, TOTP_STEP_SECONDS } = await import('../backend/src/security/totp.ts');

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;

describe('request safety', () => {
  it('refuses MongoDB operators and prototype keys anywhere in a body', () => {
    assert.equal(unsafeKey({ email: 'a@b.pk', password: 'x' }), null);
    assert.equal(unsafeKey({ email: { $ne: null } }), '$ne');
    assert.equal(unsafeKey({ items: [{ ok: 1 }, { filter: { $where: 'sleep(1)' } }] }), '$where');
    assert.equal(unsafeKey(JSON.parse('{"__proto__":{"admin":true}}')), '__proto__');
    assert.equal(unsafeKey({ a: { constructor: { prototype: { x: 1 } } } }), 'constructor');
    assert.equal(unsafeKey({ note: 'costs $5', 'price ($)': 1 }), null, 'a dollar inside a value or a key is fine');
    let deep = {};
    const root = deep;
    for (let level = 0; level < 40; level += 1) { deep.next = {}; deep = deep.next; }
    assert.equal(unsafeKey(root), '(nested too deeply)');
  });

  it('allows large bodies only on the two file imports', () => {
    assert.equal(bodyLimitFor('/api/v1/migration/jobs'), '12mb');
    assert.equal(bodyLimitFor('/api/v1/platform/medicine-directory/import'), '12mb');
    assert.equal(bodyLimitFor('/api/v1/sales'), '2mb');
    assert.equal(bodyLimitFor('/api/v1/migration/jobs/abc/import'), '2mb');
  });

  it('redirects only inside the application', () => {
    const app = 'https://ksf.example.pk';
    for (const good of ['/settings?tab=billing&payment=paid', 'https://ksf.example.pk/settings', '/']) assert.equal(isSafeRedirect(good, app), true, good);
    for (const bad of [
      'https://ksf.example.pk.evil.com/settings', 'https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com',
      'javascript:alert(1)', 'data:text/html,hi', 'http://ksf.example.pk:8443/', 'settings', ''
    ]) assert.equal(isSafeRedirect(bad, app), false, JSON.stringify(bad));
  });

  it('keeps a notification link inside the web app', () => {
    assert.equal(internalPath('/sales/123'), '/sales/123');
    for (const bad of ['//evil.com', '/\\evil.com', '/\t/evil.com', 'https://evil.com', 'javascript:alert(1)', '']) {
      assert.equal(internalPath(bad), '/dashboard', JSON.stringify(bad));
    }
  });

  it('knows which time step an authenticator code belongs to', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const at = Date.UTC(2026, 10, 4, 12, 0, 0);
    const step = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
    assert.equal(totpStep(secret, totpAt(secret, step), { at }), step);
    assert.equal(totpStep(secret, totpAt(secret, step + 1), { at }), step + 1, 'one step of clock drift is allowed');
    assert.equal(totpStep(secret, totpAt(secret, step + 2), { at }), null);
    assert.equal(totpStep(secret, '12345', { at }), null);
  });
});

describe('security over HTTP', { skip }, () => {
  let server;
  let owner;
  let email;
  let col;

  const raw = (path, init = {}) => fetch(server.base + path, { redirect: 'manual', ...init });
  const json = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

  before(async () => {
    server = await startServer();
    ({ col } = await import('../backend/src/db/mongo.ts'));
    email = 'security@pharmacy.test';
    ({ client: owner } = await registerPharmacy(server.base, 'Secure', email));
  });
  after(async () => { await server?.stop(); });

  it('turns an operator or a prototype key into a 400, before any handler runs', async () => {
    const injected = await raw('/api/v1/auth/login', json(JSON.stringify({ email: { $ne: null }, password: { $ne: null } })));
    assert.equal(injected.status, 400);
    assert.equal((await injected.json()).code, 'invalid_field');

    const polluted = await raw('/api/v1/auth/login', json('{"email":"a@b.pk","password":"x","__proto__":{"isPlatformAdmin":true}}'));
    assert.equal(polluted.status, 400);
    assert.equal({}.isPlatformAdmin, undefined, 'Object.prototype is untouched');
  });

  it('answers a body it cannot read with a 4xx and no stack trace', async () => {
    const broken = await raw('/api/v1/auth/login', json('{"email": "a@b.pk", '));
    assert.equal(broken.status, 400);
    assert.doesNotMatch(await broken.text(), /\bat .+:\d+:\d+/);

    /* JSON is read as UTF-8/16/32 only; other charsets and unknown encodings are the request's fault, not a 500. */
    const charset = await raw('/api/v1/auth/login', json('{}', { 'Content-Type': 'application/json; charset=latin1' }));
    assert.equal(charset.status, 415);
    const encoding = await raw('/api/v1/auth/login', json('{}', { 'Content-Encoding': 'made-up' }));
    assert.equal(encoding.status, 415);

    const huge = await raw('/api/v1/auth/login', json(JSON.stringify({ email: 'a@b.pk', password: 'x'.repeat(2.2 * 1024 * 1024) })));
    assert.equal(huge.status, 413);
  });

  it('refuses forged, stale and misused tokens', async () => {
    const real = owner.token;
    const claims = jwt.decode(real);
    const accessSecret = process.env.JWT_ACCESS_SECRET;
    const { iat: _iat, exp: _exp, aud, iss, ...rest } = claims;
    /* Everything right but the one thing each case gets wrong. */
    const reissue = (payload, secret = accessSecret, options = {}) => jwt.sign(payload, secret, { algorithm: 'HS256', issuer: iss, audience: aud, ...options });
    const base64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

    const forged = {
      'no signature (alg none)': `${base64({ alg: 'none', typ: 'JWT' })}.${base64(claims)}.`,
      'signed with another secret': reissue(rest, 'not-the-servers-secret-0123456789abcdef'),
      'expired': reissue({ ...rest, exp: Math.floor(Date.now() / 1000) - 60 }),
      'a refresh token': reissue({ ...rest, typ: 'refresh', jti: 'x' }, process.env.JWT_REFRESH_SECRET),
      'another pharmacy written into it': `${real.split('.')[0]}.${base64({ ...claims, pid: 'PHA-SOMEONE-ELSE' })}.${real.split('.')[2]}`,
      'wrong audience': reissue({ ...rest }, accessSecret, { audience: 'someone-else' }),
      'wrong issuer': reissue({ ...rest }, accessSecret, { issuer: 'someone-else' })
    };
    for (const [what, token] of Object.entries(forged)) {
      const reply = await raw('/api/v1/auth/session', { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(reply.status, 401, what);
    }
    assert.equal((await raw('/api/v1/auth/session', { headers: { Authorization: `Bearer ${real}` } })).status, 200, 'the real token still works');
  });

  it('sends the security headers and no framework banner', async () => {
    const reply = await raw('/api/v1/health');
    assert.match(reply.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.match(reply.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.equal(reply.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(reply.headers.get('referrer-policy'), 'same-origin');
    assert.equal(reply.headers.get('x-powered-by'), null);
  });

  it('shares credentials only with its own origins, and takes sign-ins from no other site', async () => {
    const own = await raw('/api/v1/health', { headers: { Origin: 'http://localhost:5180' } });
    assert.equal(own.headers.get('access-control-allow-origin'), 'http://localhost:5180');
    const other = await raw('/api/v1/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    const signIn = await raw('/api/v1/auth/login', json(JSON.stringify({ email, password: TEST_PASSWORD }), { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }));
    assert.equal(signIn.status, 403);
  });

  it('counts failed sign-ins in the database, and clears them on success', async () => {
    const client = new Client(server.base);
    await client.call('POST', '/api/v1/auth/login', { email, password: 'Wrong#Password2026' });
    const counter = await col.rateLimits().findOne({ _id: `login:${email}` });
    assert.equal(counter?.count, 1, 'every server instance sees the same count');
    assert.ok(counter.expires_at > new Date(), 'and it expires by itself');
    await client.signIn(email, TEST_PASSWORD);
    assert.equal(await col.rateLimits().findOne({ _id: `login:${email}` }), null);
  });

  it('runs two-step sign-in on shared tickets, and takes each code once', async () => {
    const at = Date.now();
    const step = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
    await owner.post('/api/v1/auth/verify-identity', { password: TEST_PASSWORD }, 200);
    const { secret } = await owner.post('/api/v1/account/2fa/start', {}, 200);
    await owner.post('/api/v1/account/2fa/enable', { code: totpAt(secret, step) }, 200);

    const phone = new Client(server.base);
    const first = await phone.post('/api/v1/auth/login', { email, password: TEST_PASSWORD }, 200);
    assert.equal(first.twoFactorRequired, true);
    const stored = await col.authTickets().findOne({ _id: createHash('sha256').update(`ticket:${first.challenge}`).digest('hex') });
    assert.equal(stored?.kind, 'two-factor', 'the ticket is in the database, by its hash');
    assert.equal(await col.authTickets().findOne({ _id: first.challenge }), null, 'never by the ticket itself');

    const reused = await phone.call('POST', '/api/v1/auth/two-factor', { challenge: first.challenge, code: totpAt(secret, step) });
    assert.equal(reused.status, 401);
    assert.match(reused.body.message, /already been used/);

    const signedIn = await phone.post('/api/v1/auth/two-factor', { challenge: first.challenge, code: totpAt(secret, step + 1) }, 200);
    assert.ok(signedIn.accessToken);
    assert.equal(await col.authTickets().countDocuments({ _id: stored._id }), 0, 'a used ticket is gone');

    const second = await phone.post('/api/v1/auth/login', { email, password: TEST_PASSWORD }, 200);
    assert.equal((await phone.call('POST', '/api/v1/auth/two-factor', { challenge: second.challenge, code: totpAt(secret, step + 1) })).status, 401, 'the same code cannot sign in twice');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await phone.call('POST', '/api/v1/auth/two-factor', { challenge: second.challenge, code: '000000' })).status, 401);
    }
    assert.equal((await phone.call('POST', '/api/v1/auth/two-factor', { challenge: second.challenge, code: '000000' })).status, 429, 'five tries, then sign in again');
    assert.equal((await phone.call('POST', '/api/v1/auth/two-factor', { challenge: second.challenge, code: totpAt(secret, step + 1) })).status, 401, 'the ticket is spent');
  });
});

describe('account security flows', { skip }, () => {
  let server;
  let laptop;
  let phone;
  const email = 'flows@pharmacy.test';
  const NEW_PASSWORD = 'Another#Pass2027y';

  /* Three devices at most, so the same three browsers are used throughout. */
  before(async () => {
    server = await startServer();
    await registerPharmacy(server.base, 'Flows', email);
    laptop = new Client(server.base);
    phone = new Client(server.base);
  });
  after(async () => { await server?.stop(); });

  const session = (token) => fetch(`${server.base}/api/v1/auth/session`, { headers: { Authorization: `Bearer ${token}` } }).then((reply) => reply.status);

  it('ends a session for good on sign-out: its access token and its refresh cookie', async () => {
    await laptop.signIn(email, TEST_PASSWORD);
    const token = laptop.token;
    const cookies = new Map(laptop.jar);
    await laptop.post('/api/v1/auth/logout', {}, 200);
    assert.equal(await session(token), 401);
    const stale = new Client(server.base);
    stale.jar = cookies;
    /* "Is anyone signed in?" is asked on every page load, so the answer is 200 — with nobody, and no new token. */
    const refreshed = await stale.call('POST', '/api/v1/auth/refresh', {});
    assert.equal(refreshed.body.user, null);
    assert.equal(refreshed.body.accessToken, undefined);
  });

  it('resets a password only with the e-mailed code, and signs every session out', async () => {
    await laptop.signIn(email, TEST_PASSWORD);
    const before = laptop.token;
    const anyone = new Client(server.base);
    const known = await anyone.post('/api/v1/auth/forgot-password', { email }, 200);
    const unknown = await anyone.post('/api/v1/auth/forgot-password', { email: 'nobody-here@pharmacy.test' }, 200);
    assert.equal(known.message, unknown.message, 'the answer does not tell whether an account exists');

    assert.equal((await anyone.call('POST', '/api/v1/auth/reset-password', { email, code: '000000', password: NEW_PASSWORD })).status, 400);
    await anyone.post('/api/v1/auth/reset-password', { email, code: await codeFor(anyone, email), password: NEW_PASSWORD }, 200);

    assert.equal(await session(before), 401, 'sessions started with the old password are over');
    assert.equal((await laptop.call('POST', '/api/v1/auth/login', { email, password: TEST_PASSWORD })).status, 401);
    await laptop.signIn(email, NEW_PASSWORD);
  });

  it('signs out every other session, and keeps the one that asked', async () => {
    await phone.signIn(email, NEW_PASSWORD);
    await laptop.signIn(email, NEW_PASSWORD);
    const reply = await laptop.post('/api/v1/account/sessions/logout-all', {}, 200);
    assert.ok(reply.ended >= 1);
    assert.equal(await session(phone.token), 401);
    assert.equal(await session(laptop.token), 200);
  });

  it('takes each recovery code once, and asks for the password again before two-step sign-in is turned off', async () => {
    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    await laptop.post('/api/v1/auth/verify-identity', { password: NEW_PASSWORD }, 200);
    const { secret } = await laptop.post('/api/v1/account/2fa/start', {}, 200);
    const { recoveryCodes } = await laptop.post('/api/v1/account/2fa/enable', { code: totpAt(secret, step) }, 200);
    assert.equal(recoveryCodes.length, 10);

    const first = await phone.post('/api/v1/auth/login', { email, password: NEW_PASSWORD }, 200);
    const signedIn = await phone.post('/api/v1/auth/two-factor', { challenge: first.challenge, recoveryCode: recoveryCodes[0] }, 200);
    phone.token = signedIn.accessToken;
    const again = await phone.post('/api/v1/auth/login', { email, password: NEW_PASSWORD }, 200);
    assert.equal((await phone.call('POST', '/api/v1/auth/two-factor', { challenge: again.challenge, recoveryCode: recoveryCodes[0] })).status, 401);

    const refused = await phone.call('POST', '/api/v1/account/2fa/disable', {});
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'step_up_required');
    await phone.post('/api/v1/auth/verify-identity', { password: NEW_PASSWORD, code: totpAt(secret, step + 1) }, 200);
    await phone.post('/api/v1/account/2fa/disable', {}, 200);
    const plain = await new Client(server.base).call('POST', '/api/v1/auth/login', { email, password: NEW_PASSWORD });
    assert.notEqual(plain.body.twoFactorRequired, true);
  });
});

describe('hostile input on every route', { skip }, () => {
  let server;
  let routes;
  let admin;
  let owner;
  let pharmacyId;
  let ownerEmail;

  /* Wrong types for the field names handlers read, oversized text, and a
     few values that are well-known trouble. */
  const GARBAGE = {
    name: ['an', 'array'], fullName: { nested: true }, firstName: 42, lastName: null, email: 12345, password: ['x'],
    code: { six: 6 }, phone: [], mobile: true, quantity: 'many', qty: -1e9, amountPaisa: 'NaN', pricePaisa: '1e400', costPaisa: [],
    items: 'not-a-list', lines: [null, 1, 'x', { quantity: 'x' }], id: { a: 1 }, ids: 'x', medicineId: 123, roleId: [], branchId: true,
    supplierId: {}, customerId: [], date: 'not-a-date', from: '9999-99-99', to: [], status: { s: 1 }, page: -5, limit: 1e12, q: 'x'.repeat(5000),
    note: 'x'.repeat(20000), description: '\u0000‮', image: 'data:image/png;base64,AAAA', content: 12, mapping: [], values: 'x',
    planKey: { k: 1 }, provider: '../../etc/passwd', reference: '<script>alert(1)</script>', reason: 'x'.repeat(10000), barcode: "'; DROP TABLE x; --"
  };
  const ODD_IDS = ['..%2F..%2Fetc%2Fpasswd', '%24gt', 'A'.repeat(400)];
  const ODD_QUERY = '?q=%24where&page=-1&limit=999999999&from=bad&to=bad&sort=__proto__&status[]=x&branchId=%00';

  const problem = (who, method, path, status, text) => {
    if (status >= 500) return `${who}: ${method} ${path} → ${status} ${text.slice(0, 160)}`;
    if (/\bat .+\.(ts|js|mjs):\d+:\d+/.test(text)) return `${who}: ${method} ${path} → ${status} leaked a stack trace`;
    return null;
  };

  async function attack(client, who, route, signBackIn) {
    const found = [];
    const paths = route.path.includes(':') ? ODD_IDS.map((id) => route.path.replace(/:\w+/g, id)) : [route.path];
    for (const path of paths) {
      const bodies = route.method === 'GET' ? [undefined] : [GARBAGE, [GARBAGE], {}];
      for (const body of bodies) {
        const target = route.method === 'GET' ? path + ODD_QUERY : path;
        const reply = await fetch(server.base + target, {
          method: route.method,
          headers: { 'Content-Type': 'application/json', ...(client?.token ? { Authorization: `Bearer ${client.token}` } : {}), Origin: 'http://localhost:5180' },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual'
        });
        const text = await reply.text();
        const issue = problem(who, route.method, target, reply.status, text);
        if (issue) found.push(issue);
        /* A route that signs out (or changes the password) ends the session: sign back in for the next one. */
        if (reply.status === 401 && signBackIn) await signBackIn();
      }
    }
    return found;
  }

  before(async () => {
    server = await startServer();
    ({ routes } = await import('../backend/src/http/router.ts'));
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    ownerEmail = 'hostile@pharmacy.test';
    ({ client: owner, pharmacyId } = await registerPharmacy(server.base, 'Hostile', ownerEmail));
    await admin.post(`/api/v1/platform/pharmacies/${pharmacyId}/subscription`, { planKey: 'yearly' });
  });
  after(async () => { await server?.stop(); });

  it('never answers a pharmacy route with a server error', async () => {
    const found = [];
    const resign = async () => { await owner.signIn(ownerEmail, TEST_PASSWORD); };
    for (const route of routes.filter((row) => row.access === 'pharmacy')) found.push(...await attack(owner, 'pharmacy admin', route, resign));
    assert.deepEqual(found, []);
  });

  it('never answers a platform route with a server error', async () => {
    const found = [];
    const resign = async () => { await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password); };
    for (const route of routes.filter((row) => row.access === 'platform')) found.push(...await attack(admin, 'super admin', route, resign));
    assert.deepEqual(found, []);
  });

  it('never answers a public or account route with a server error', async () => {
    const found = [];
    const resign = async () => { await owner.signIn(ownerEmail, TEST_PASSWORD); };
    for (const route of routes.filter((row) => row.access === 'public')) found.push(...await attack(null, 'anonymous', route));
    for (const route of routes.filter((row) => row.access === 'account')) found.push(...await attack(owner, 'signed in', route, resign));
    assert.deepEqual(found, []);
  });
});
