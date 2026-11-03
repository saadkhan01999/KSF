/* Who may reach what — every registered route, as every kind of person.

   The route table is read from the server itself, so a route added tomorrow
   is tested tomorrow without anybody remembering to. For each route:

     - nobody signed in              → 401 (public routes aside)
     - a pharmacy role lacking the
       route's permission            → 403, before the handler runs
     - each built-in role             → every screen it is allowed opens
                                        (no 403, and never a 500)
     - a pharmacy person, on a
       platform route                → 403
     - a KSF team member, on a
       platform route not in their
       role                          → 403
     - the platform, on a pharmacy
       route outside support mode    → 400 pharmacy_required
     - one pharmacy, with another
       pharmacy's record ids         → 404 for a read, refused for a write */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, TEST_PASSWORD, addStaff, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;

const fill = (path, value = 'NOT-A-REAL-ID') => path.replace(/:\w+/g, value);
const hasParams = (path) => path.includes(':');

describe('access to every route', { skip }, () => {
  let server;
  let routes;
  let platformAllows;
  let admin;
  let owner;
  let pharmacyId;
  let other;
  let nobody;
  let desk;
  const staff = {};
  const ids = {};

  /** Call and return only the status — the body matters less than who got in. */
  const status = async (client, method, path, body) => (await client.call(method, path, method === 'GET' ? undefined : body ?? {})).status;

  before(async () => {
    server = await startServer();
    ({ routes } = await import('../backend/src/http/router.ts'));
    ({ platformAllows } = await import('../backend/src/domain/platform.ts'));
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);

    ({ client: owner, pharmacyId } = await registerPharmacy(server.base, 'Access', 'access@pharmacy.test'));
    const { client: rival, pharmacyId: rivalId } = await registerPharmacy(server.base, 'Rival', 'rival@pharmacy.test');
    other = rival;
    /* Every feature on, so a plan never answers in place of a permission. */
    for (const id of [pharmacyId, rivalId]) await admin.post(`/api/v1/platform/pharmacies/${id}/subscription`, { planKey: 'yearly' });

    for (const roleKey of ['regional-manager', 'manager', 'pharmacist', 'cashier']) {
      staff[roleKey] = await addStaff(server.base, owner, { name: `Staff ${roleKey}`, email: `${roleKey}@access.test`, roleKey });
    }
    /* A role holding a single harmless permission: everything else must be refused. */
    const bare = (await owner.post('/api/v1/roles', { name: 'Bare', permissions: ['support.raise'] }, 201)).data;
    await owner.post('/api/v1/staff', { fullName: 'Nobody Special', email: 'nobody@access.test', roleId: bare.id, password: TEST_PASSWORD }, 201);
    nobody = new Client(server.base);
    await nobody.signIn('nobody@access.test', TEST_PASSWORD);
    ids.role = bare.id;

    const deskRole = (await admin.post('/api/v1/platform/team/roles', { name: 'Desk only', permissions: ['platform.support'] }, 201)).data;
    await admin.post('/api/v1/platform/team', { fullName: 'Desk Person', email: 'desk@ksf.test', roleId: deskRole.id, password: TEST_PASSWORD }, 201);
    desk = new Client(server.base);
    await desk.signIn('desk@ksf.test', TEST_PASSWORD);
  });
  after(async () => { await server?.stop(); });

  it('reads the whole route table', () => {
    assert.ok(routes.length > 200, `only ${routes.length} routes registered`);
  });

  it('turns away anybody who is not signed in', async () => {
    const anonymous = new Client(server.base);
    const leaks = [];
    for (const route of routes.filter((row) => row.access !== 'public')) {
      const code = await status(anonymous, route.method, fill(route.path));
      if (code !== 401) leaks.push(`${route.method} ${route.path} → ${code}`);
    }
    assert.deepEqual(leaks, []);
  });

  it('refuses a pharmacy role every route whose permission it does not hold', async () => {
    const leaks = [];
    for (const route of routes.filter((row) => row.access === 'pharmacy' && row.permission && row.permission !== 'support.raise')) {
      const code = await status(nobody, route.method, fill(route.path));
      if (code !== 403) leaks.push(`${route.method} ${route.path} (${route.permission}) → ${code}`);
    }
    assert.deepEqual(leaks, []);
  });

  it('opens every screen each built-in role is allowed, and refuses the rest', async () => {
    const roles = (await owner.get('/api/v1/roles')).data;
    const people = { admin: owner, ...Object.fromEntries(Object.entries(staff).map(([key, value]) => [key, value.client])) };
    const problems = [];
    for (const [key, client] of Object.entries(people)) {
      const permissions = new Set(roles.find((role) => role.key === key).permissions);
      assert.equal((await client.get('/api/v1/bootstrap')).platform, false);
      for (const route of routes.filter((row) => row.access === 'pharmacy' && row.method === 'GET' && !hasParams(row.path))) {
        const allowed = !route.permission || permissions.has(route.permission);
        const code = await status(client, 'GET', route.path);
        if (code >= 500) problems.push(`${key}: GET ${route.path} → ${code}`);
        else if (allowed && (code === 401 || code === 403)) problems.push(`${key}: GET ${route.path} refused (${code}) though the role holds ${route.permission}`);
        else if (!allowed && code !== 403) problems.push(`${key}: GET ${route.path} → ${code} without ${route.permission}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('keeps the platform console from pharmacies, and each team member to their role', async () => {
    const leaks = [];
    const deskWho = { isPlatformAdmin: false, isPlatformStaff: true, platformPermissions: new Set(['platform.support']) };
    for (const route of routes.filter((row) => row.access === 'platform')) {
      const path = fill(route.path);
      const fromPharmacy = await status(owner, route.method, path);
      if (fromPharmacy !== 403) leaks.push(`pharmacy: ${route.method} ${route.path} → ${fromPharmacy}`);
      if (!platformAllows(deskWho, route.platform)) {
        const fromDesk = await status(desk, route.method, path);
        if (fromDesk !== 403) leaks.push(`desk: ${route.method} ${route.path} → ${fromDesk}`);
      }
      if (route.method === 'GET' && !hasParams(route.path)) {
        const fromSuper = await status(admin, 'GET', route.path);
        if (fromSuper === 401 || fromSuper === 403 || fromSuper >= 500) leaks.push(`super admin: GET ${route.path} → ${fromSuper}`);
      }
    }
    assert.deepEqual(leaks, []);
  });

  it("sends the platform to a pharmacy's routes only through support mode", async () => {
    const wrong = [];
    for (const route of routes.filter((row) => row.access === 'pharmacy')) {
      const reply = await admin.call(route.method, fill(route.path), route.method === 'GET' ? undefined : {});
      if (reply.status !== 400 || reply.body.code !== 'pharmacy_required') wrong.push(`${route.method} ${route.path} → ${reply.status}`);
    }
    assert.deepEqual(wrong, []);
  });

  it("never lets one pharmacy read or change another pharmacy's records", async () => {
    /* One of everything in the first pharmacy. */
    ids.category = (await owner.post('/api/v1/categories', { name: 'Isolation' }, 201)).data.id;
    ids.medicine = (await owner.post('/api/v1/medicines', { name: 'Isolamol', pricePaisa: 1000, costPaisa: 500, categoryId: ids.category }, 201)).data.id;
    ids.supplier = (await owner.post('/api/v1/suppliers', { name: 'Isolated Supplies' }, 201)).data.id;
    ids.purchase = (await owner.post('/api/v1/purchases', {
      supplierId: ids.supplier, receiveNow: true,
      items: [{ medicineId: ids.medicine, quantity: 50, costPaisa: 500, pricePaisa: 1000, batchNo: 'ISO-1', expiryDate: '2031-01-31' }]
    }, 201)).data.id;
    ids.batch = (await owner.get('/api/v1/inventory/batches')).data[0].id;
    ids.customer = (await owner.post('/api/v1/customers', { name: 'Isolated Customer', phone: '0300 1112223' }, 201)).data.id;
    ids.sale = (await owner.post('/api/v1/sales', { items: [{ medicineId: ids.medicine, quantity: 2 }], paymentMethod: 'credit', customerId: ids.customer }, 201)).data.id;
    ids.receipt = (await owner.post(`/api/v1/customers/${ids.customer}/payments`, { amountPaisa: 500 }, 201)).data.id;
    ids.expense = (await owner.post('/api/v1/expenses', { category: 'Rent', description: 'Isolated rent', amountPaisa: 1000 }, 201)).data.id;
    ids.income = (await owner.post('/api/v1/accounting/income', { category: 'Other income', description: 'Isolated', amountPaisa: 1000 }, 201)).data.id;
    ids.salary = (await owner.post('/api/v1/accounting/salaries', { staffName: 'Isolated Person', period: new Date().toISOString().slice(0, 7), basicPaisa: 1000 }, 201)).data.id;
    ids.prescription = (await owner.post('/api/v1/prescriptions', { patientName: 'Isolated Patient', doctorName: 'Dr Iso', items: [{ medicineId: ids.medicine, medicineText: 'Isolamol', quantity: 1 }] }, [200, 201])).data.id;
    ids.dayClose = (await owner.post('/api/v1/day-close', { countedCashPaisa: 0 }, 201)).data.id;
    ids.staff = staff.cashier.id;
    ids.branch = (await owner.get('/api/v1/branches')).data[0].id;
    ids.ticket = (await owner.post('/api/v1/support/tickets', { subject: 'Isolated question', body: 'Please help with isolation.', category: 'other' }, 201)).data.id;
    const thread = (await owner.post('/api/v1/messages/conversations', { subject: 'Isolated', body: 'Private.', userIds: [staff.cashier.id] }, 201)).data;
    ids.conversation = thread.id;
    ids.message = (await owner.get(`/api/v1/messages/conversations/${thread.id}`)).data.messages[0].id;
    ids.notification = (await owner.get('/api/v1/notifications')).data[0]?.id;
    await admin.post(`/api/v1/platform/pharmacies/${pharmacyId}/payments`, { amountPaisa: 390_000, method: 'cash', reference: 'ISO-RCPT' }, 201);
    ids.invoice = (await owner.get('/api/v1/billing/invoices')).data[0].id;

    /* Which record a path is about, by the start of its address. */
    const RESOURCES = [
      [/^\/api\/v1\/medicines\//, 'medicine'], [/^\/api\/v1\/categories\//, 'category'], [/^\/api\/v1\/suppliers\//, 'supplier'],
      [/^\/api\/v1\/purchases\//, 'purchase'], [/^\/api\/v1\/expiry\//, 'batch'], [/^\/api\/v1\/customers\//, 'customer'],
      [/^\/api\/v1\/customer-payments\//, 'receipt'], [/^\/api\/v1\/sales\//, 'sale'], [/^\/api\/v1\/prescriptions\//, 'prescription'],
      [/^\/api\/v1\/expenses\//, 'expense'], [/^\/api\/v1\/accounting\/income\//, 'income'], [/^\/api\/v1\/accounting\/salaries\//, 'salary'],
      [/^\/api\/v1\/day-close\//, 'dayClose'], [/^\/api\/v1\/staff\//, 'staff'], [/^\/api\/v1\/roles\//, 'role'], [/^\/api\/v1\/branches\//, 'branch'],
      [/^\/api\/v1\/support\/tickets\//, 'ticket'], [/^\/api\/v1\/messages\/conversations\//, 'conversation'], [/^\/api\/v1\/messages\/messages\//, 'message'],
      [/^\/api\/v1\/notifications\//, 'notification'], [/^\/api\/v1\/billing\/invoices\//, 'invoice']
    ];
    const leaks = [];
    let checked = 0;
    for (const route of routes.filter((row) => row.access === 'pharmacy' && hasParams(row.path) && (row.path.match(/:\w+/g) ?? []).length === 1)) {
      const key = RESOURCES.find(([pattern]) => pattern.test(route.path))?.[1];
      if (!key || !ids[key]) continue;
      checked += 1;
      const code = await status(other, route.method, fill(route.path, ids[key]));
      if (route.method === 'GET' ? code !== 404 : code < 400 || code >= 500) leaks.push(`${route.method} ${route.path} with the other pharmacy's ${key} → ${code}`);
    }
    assert.ok(checked > 40, `only ${checked} routes checked`);
    assert.deepEqual(leaks, []);
    /* And nothing of the first pharmacy changed. */
    assert.equal((await owner.get(`/api/v1/medicines/${ids.medicine}`)).data.name, 'Isolamol');
    assert.equal((await owner.get(`/api/v1/sales/${ids.sale}`)).data.status, 'completed');
  });
});
