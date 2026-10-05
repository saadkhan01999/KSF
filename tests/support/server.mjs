/* Starts the real API inside the test process, on a free port, against a
   database of its own — and drops that database afterwards. No test-only
   endpoint exists: the server under test is the server that ships. */

export async function startServer() {
  const { connect, disconnect, db } = await import('../../backend/src/db/mongo.ts');
  const { bootstrap } = await import('../../backend/src/db/bootstrap.ts');
  await import('../../backend/src/modules/index.ts');
  const { createApp } = await import('../../backend/src/http/app.ts');

  await connect();
  await bootstrap({ silent: true });
  const server = await new Promise((resolve) => { const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await db().dropDatabase();
      await disconnect();
    }
  };
}

/** A browser stand-in: its own cookie jar, its own access token, optionally a pharmacy to support. */
export class Client {
  constructor(base) { this.base = base; this.jar = new Map(); this.token = ''; this.pharmacyId = ''; }

  async call(method, path, body) {
    const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:5180' };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([key, value]) => `${key}=${value}`).join('; ');
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.pharmacyId) headers['X-Pharmacy-Id'] = this.pharmacyId;
    const response = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const at = pair.indexOf('=');
      const value = pair.slice(at + 1);
      if (value) this.jar.set(pair.slice(0, at), value); else this.jar.delete(pair.slice(0, at));
    }
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  /** Call and insist on the status; returns the body. */
  async expect(status, method, path, body) {
    const reply = await this.call(method, path, body);
    const wanted = Array.isArray(status) ? status : [status];
    if (!wanted.includes(reply.status)) {
      throw new Error(`${method} ${path} answered ${reply.status}, expected ${wanted.join(' or ')}: ${JSON.stringify(reply.body).slice(0, 400)}`);
    }
    return reply.body;
  }

  get(path, status = 200) { return this.expect(status, 'GET', path); }
  post(path, body = {}, status = [200, 201]) { return this.expect(status, 'POST', path, body); }
  patch(path, body = {}, status = 200) { return this.expect(status, 'PATCH', path, body); }
  delete(path, body = {}, status = 200) { return this.expect(status, 'DELETE', path, body); }

  async signIn(email, password) {
    const reply = await this.post('/api/v1/auth/login', { email, password }, 200);
    this.token = reply.accessToken;
    return reply;
  }
}

/** The six-digit code in the latest e-mail to an address, waiting for it to be written. */
export async function codeFor(client, address) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const outbox = await client.get('/api/v1/dev/outbox');
    const mail = outbox.data?.find((entry) => entry.to?.includes(address));
    const code = /\b(\d{6})\b/.exec(mail?.text ?? '')?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No code arrived for ${address}.`);
}
