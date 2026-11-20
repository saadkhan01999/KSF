/* Every screen's data, for every kind of person (2.11.0), over real HTTP
   against a real MongoDB.

   Each GET route the server registers is called by: nobody signed in; the
   pharmacy Admin, a Regional Manager, a Branch Manager, a Pharmacist, a
   Cashier and an Accountant (a role the Admin made); the Super Admin; and a
   member of each of the Super Admin's team roles. For every call:

     - the server never fails (no 5xx);
     - somebody whose role allows the route is let in (not 401 or 403);
     - somebody whose role does not is kept out (never a 2xx).

   Routes that take an id are called with a real one where there is one, so
   the sweep reaches each handler's real work. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, TEST_PASSWORD, addStaff, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;

/* Streams never finish; the maintenance route wants its own secret. */
const SKIP = [/\/events$/, /\/stream/, /\/live/, /\/cron\//];

describe('every screen, for every kind of person', { skip }, () => {
  let server;
  const people = {};
  const pharmacyPerms = {};
  const teamPerms = {};
  const ids = {};

  before(async () => {
    server = await startServer();
    const { col } = await import('../backend/src/db/mongo.ts');
    const khan = await registerPharmacy(server.base, 'Imran', 'owner@sweep.test');
    const owner = khan.client;
    await owner.patch('/api/v1/settings', { pharmacy: { name: 'Khan Pharmacy', city: 'Karachi' } });
    await col.pharmacies().updateMany({}, { $set: { device_limit_desktop: 0, device_limit_mobile: 0 } });
    people['pharmacy:admin'] = owner;

    /* Something on every screen: stock, a sale on loan, an expense, a request to KSF. */
    ids.medicine = (await owner.post('/api/v1/medicines', { name: 'Panadol 500mg', pricePaisa: 3_500, costPaisa: 2_800 }, 201)).data.id;
    ids.supplier = (await owner.post('/api/v1/suppliers', { name: 'Premier Sales', phone: '0300 7654321' }, 201)).data.id;
    const order = (await owner.post('/api/v1/purchases', { supplierId: ids.supplier, items: [{ medicineId: ids.medicine, quantity: 50, costPaisa: 2_800, pricePaisa: 3_500, batchNo: 'B-1', expiryDate: '2030-06-30' }] }, 201)).data;
    ids.purchase = order.id;
    await owner.post(`/api/v1/purchases/${order.id}/receive`, {});
    ids.customer = (await owner.post('/api/v1/customers', { name: 'Imran Ali', phone: '0301 2345678', creditLimitPaisa: 5_000_000 }, 201)).data.id;
    ids.sale = (await owner.post('/api/v1/sales', { items: [{ medicineId: ids.medicine, quantity: 2 }], paymentMethod: 'credit', customerId: ids.customer }, 201)).data.id;
    ids.expense = (await owner.post('/api/v1/expenses', { category: 'Rent', description: 'Shop rent', amountPaisa: 50_000 }, 201)).data.id;
    ids.ticket = (await owner.post('/api/v1/support/tickets', { subject: 'Receipt printer', body: 'How do I print on an 80 mm roll?', category: 'technical' }, 201)).data.id;

    for (const roleKey of ['regional-manager', 'manager', 'pharmacist', 'cashier']) {
      people[`pharmacy:${roleKey}`] = (await addStaff(server.base, owner, { name: `${roleKey} person`, email: `${roleKey}@sweep.test`, roleKey })).client;
    }
    const accountant = (await owner.post('/api/v1/roles', {
      name: 'Accountant',
      permissions: ['dashboard.view', 'accounting.view', 'accounting.manage', 'expenses.read', 'expenses.write', 'reports.view', 'sales.read', 'purchases.read', 'suppliers.read', 'customers.read', 'support.raise']
    }, 201)).data;
    await owner.post('/api/v1/staff', { fullName: 'Asad Accountant', email: 'accountant@sweep.test', roleId: accountant.id, password: TEST_PASSWORD }, 201);
    people['pharmacy:accountant'] = new Client(server.base);
    await people['pharmacy:accountant'].signIn('accountant@sweep.test', TEST_PASSWORD);

    const roles = (await owner.get('/api/v1/roles')).data;
    const staff = (await owner.get('/api/v1/staff')).data;
    for (const key of Object.keys(people)) {
      const email = key === 'pharmacy:admin' ? 'owner@sweep.test' : `${key.slice('pharmacy:'.length)}@sweep.test`;
      const person = staff.find((row) => row.email === email);
      pharmacyPerms[key] = new Set(roles.find((row) => row.id === person?.role_id)?.permissions ?? []);
    }
    ids.staff = staff[0].id;
    ids.role = roles[0].id;

    const admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    people['platform:super-admin'] = admin;
    const team = await admin.get('/api/v1/platform/team');
    for (const template of team.templates) {
      const role = (await admin.post('/api/v1/platform/team/roles', { name: template.name, permissions: template.permissions }, 201)).data;
      await admin.post('/api/v1/platform/team', { fullName: `${template.name} Member`, email: `${template.key}@sweep-team.test`, roleId: role.id, password: TEST_PASSWORD }, 201);
      const member = new Client(server.base);
      await member.signIn(`${template.key}@sweep-team.test`, TEST_PASSWORD);
      people[`platform:${template.key}`] = member;
      teamPerms[`platform:${template.key}`] = new Set(template.permissions);
    }
    people.anonymous = new Client(server.base);
    ids.pharmacy = khan.pharmacyId;
    ids.directory = (await admin.get('/api/v1/medicine-directory')).data?.[0]?.id ?? 'none';
    ids.code = (await owner.get('/api/v1/billing')).referrals.code;
  });
  after(async () => { await server?.stop(); });

  it('answers every GET route for everybody without failing, lets in whom it should and keeps out whom it should', async () => {
    await import('../backend/src/modules/index.ts');
    const { routes } = await import('../backend/src/http/router.ts');
    const { platformAllows } = await import('../backend/src/domain/platform.ts');
    const fill = (path) => path
      .replace('/platform/pharmacies/:id', `/platform/pharmacies/${ids.pharmacy}`)
      .replace('/platform/support/tickets/:id', `/platform/support/tickets/${ids.ticket}`)
      .replace('/medicine-directory/:id', `/medicine-directory/${ids.directory}`)
      .replace('/medicines/:id', `/medicines/${ids.medicine}`)
      .replace('/sales/:id', `/sales/${ids.sale}`)
      .replace('/customers/:id', `/customers/${ids.customer}`)
      .replace('/suppliers/:id', `/suppliers/${ids.supplier}`)
      .replace('/purchases/:id', `/purchases/${ids.purchase}`)
      .replace('/support/tickets/:id', `/support/tickets/${ids.ticket}`)
      .replace('/expenses/:id', `/expenses/${ids.expense}`)
      .replace('/staff/:id', `/staff/${ids.staff}`)
      .replace('/roles/:id', `/roles/${ids.role}`)
      .replace('/public/referral/:code', `/public/referral/${ids.code}`)
      .replace(/:[a-zA-Z]+/g, 'does-not-exist');
    const gets = routes.filter((route) => route.method === 'GET' && !SKIP.some((re) => re.test(route.path)));
    assert.ok(gets.length > 100, `${gets.length} GET routes`);

    const problems = [];
    let calls = 0;
    for (const route of gets) {
      const path = fill(route.path);
      for (const [who, client] of Object.entries(people)) {
        const { status } = await client.call('GET', path);
        calls += 1;
        let allowed;
        if (route.access === 'public') allowed = true;
        else if (who === 'anonymous') allowed = false;
        else if (route.access === 'account') allowed = true;
        else if (route.access === 'pharmacy') allowed = who.startsWith('pharmacy:') && (!route.permission || who === 'pharmacy:admin' || pharmacyPerms[who].has(route.permission));
        else allowed = who === 'platform:super-admin' || (who.startsWith('platform:') && platformAllows({ isPlatformAdmin: false, isPlatformStaff: true, platformPermissions: teamPerms[who] }, route.platform));
        const needs = route.permission ?? JSON.stringify(route.platform) ?? route.access;
        if (status >= 500) problems.push(`GET ${route.path} as ${who}: ${status}`);
        else if (allowed && (status === 401 || status === 403)) problems.push(`GET ${route.path} as ${who}: ${status}, but the role allows it (${needs})`);
        else if (!allowed && status >= 200 && status < 300) problems.push(`GET ${route.path} as ${who}: ${status}, but the role does not allow it (${needs})`);
      }
    }
    assert.deepEqual(problems, [], `${problems.length} of ${calls} calls went wrong`);
  });
});
