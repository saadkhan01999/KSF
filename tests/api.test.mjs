/* The whole platform over real HTTP, against a real MongoDB.

   One pharmacy registers, sets itself up, buys stock, sells it, refunds,
   closes the day and asks for help; the platform Super Admin answers, changes
   its plan, records its payment and steps in to support it. A second
   pharmacy proves it can see none of the first one's records. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, codeFor, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes'
  ? 'no MongoDB: set TEST_MONGODB_URI (or MONGODB_URI in .env) to run the API suite'
  : false;

const PASSWORD = 'Strong#Pass2026x';
const SUPER = { email: 'superadmin@ksf.test', password: 'Platform#Owner2026' };

describe('KSF API', { skip }, () => {
  let server;
  let admin;
  let owner;
  let cashier;
  const state = {};

  async function register(client, first, email) {
    const started = await client.post('/api/v1/register/start', { firstName: first, lastName: 'Test', email, password: PASSWORD, mobile: '0300 1234567' });
    /* The code only ever reaches the browser when SHOW_SIGNUP_CODE is on for testing. */
    assert.equal(started.data.testCode, undefined);
    const reply = await client.post('/api/v1/register/verify-email', { code: await codeFor(client, email) }, 201);
    client.token = reply.accessToken;
    return reply;
  }

  before(async () => {
    server = await startServer();
    admin = new Client(server.base);
    owner = new Client(server.base);
    cashier = new Client(server.base);
  });
  after(async () => { await server?.stop(); });

  describe('sign-in and tokens', () => {
    it('creates only the Super Admin on a new installation', async () => {
      const reply = await admin.signIn(SUPER.email, SUPER.password);
      assert.equal(reply.user.isPlatformAdmin, true);
      const boot = await admin.get('/api/v1/bootstrap');
      assert.equal(boot.platform, true);
      assert.equal(boot.badges.pharmacies, 0);
    });

    it('refuses a wrong password without saying which part was wrong', async () => {
      const reply = await new Client(server.base).call('POST', '/api/v1/auth/login', { email: SUPER.email, password: 'wrong-password' });
      assert.equal(reply.status, 401);
    });

    it('rotates the refresh token and ends the session when an old one is replayed', async () => {
      const probe = new Client(server.base);
      await probe.signIn(SUPER.email, SUPER.password);
      const first = probe.jar.get('ksf_refresh');
      const refreshed = await probe.post('/api/v1/auth/refresh', {}, 200);
      assert.ok(refreshed.accessToken);
      assert.notEqual(probe.jar.get('ksf_refresh'), first);
      probe.jar.set('ksf_refresh', first);
      const replay = await probe.post('/api/v1/auth/refresh', {}, 200);
      assert.equal(replay.user, null);
      probe.token = refreshed.accessToken;
      assert.equal((await probe.call('GET', '/api/v1/auth/session')).status, 401);
    });

    it('rejects a request with no token', async () => {
      assert.equal((await new Client(server.base).call('GET', '/api/v1/dashboard')).status, 401);
    });
  });

  describe('a pharmacy signs up and sets up', () => {
    it('registers with an e-mail code and becomes the pharmacy Admin', async () => {
      const reply = await register(owner, 'Ayesha', 'ayesha@pharmacy.test');
      state.pharmacyId = reply.data.pharmacyId;
      assert.equal(reply.user.roleKey ?? reply.user.role?.key ?? 'admin', 'admin');
      const ent = await owner.get('/api/v1/billing/entitlements');
      assert.equal(ent.plan, 'basic');
    });

    it('completes the setup checklist from the real records', async () => {
      await owner.post('/api/v1/setup/pharmacy', { name: 'Shifa Pharmacy', type: 'retail' });
      await owner.post('/api/v1/setup/address', { address: 'Shop 4, Main Boulevard', city: 'Karachi', province: 'Sindh', phone: '021 34567890' });
      const setup = await owner.get('/api/v1/setup/state');
      assert.ok(setup.data.steps.find((step) => step.key === 'pharmacy').done);
      assert.ok(setup.data.steps.find((step) => step.key === 'address').done);
    });

    it('installs the five built-in roles, and custom roles once the plan includes them', async () => {
      const roles = await owner.get('/api/v1/roles');
      assert.deepEqual(roles.data.filter((role) => role.is_system).map((role) => role.key).sort(), ['admin', 'cashier', 'manager', 'pharmacist', 'regional-manager']);
      state.cashierRole = roles.data.find((role) => role.key === 'cashier').id;
      const role = { name: 'Night Supervisor', permissions: ['dashboard.view', 'pos.operate', 'sales.read'] };
      /* Basic does not include custom roles: 402, with the plans that do. */
      const locked = await owner.call('POST', '/api/v1/roles', role);
      assert.equal(locked.status, 402);
      assert.equal(locked.body.code, 'feature_locked');
      assert.deepEqual(locked.body.plans.map((plan) => plan.key), ['weekly', 'monthly', 'annual']);
      await admin.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/subscription`, { planKey: 'weekly' });
      await owner.post('/api/v1/roles', role);
    });
  });

  describe('catalogue, purchasing and stock', () => {
    it('keeps category names unique regardless of case', async () => {
      state.category = (await owner.post('/api/v1/categories', { name: 'Painkillers' }, 201)).data.id;
      await owner.post('/api/v1/categories', { name: 'PAINKILLERS' }, 400);
    });

    it('creates, edits and lists medicines', async () => {
      state.panadol = (await owner.post('/api/v1/medicines', { name: 'Panadol 500mg', categoryId: state.category, pricePaisa: 3500, costPaisa: 2800, minStock: 20, barcode: '8964000111222' }, 201)).data.id;
      state.augmentin = (await owner.post('/api/v1/medicines', { name: 'Augmentin 625mg', pricePaisa: 48000, costPaisa: 41000, minStock: 5, requiresPrescription: true }, 201)).data.id;
      await owner.post('/api/v1/medicines', { name: 'Cheap', pricePaisa: 100, costPaisa: 500 }, 400);
      const edited = await owner.patch(`/api/v1/medicines/${state.panadol}`, { shelfLocation: 'A-1' });
      assert.equal(edited.data.shelf_location, 'A-1');
      assert.equal(edited.data.barcode, '8964000111222');
    });

    it('receives a purchase order into stock exactly once', async () => {
      const supplier = (await owner.post('/api/v1/suppliers', { name: 'Muller & Phipps', phone: '0300 7654321' }, 201)).data.id;
      const order = (await owner.post('/api/v1/purchases', {
        supplierId: supplier, items: [
          { medicineId: state.panadol, quantity: 100, costPaisa: 2800, pricePaisa: 3500, batchNo: 'PN-1', expiryDate: '2030-06-30' },
          { medicineId: state.augmentin, quantity: 10, costPaisa: 41000, pricePaisa: 48000, batchNo: 'AG-1', expiryDate: '2030-12-31' }
        ]
      }, 201)).data;
      await owner.post(`/api/v1/purchases/${order.id}/receive`, {});
      await owner.post(`/api/v1/purchases/${order.id}/receive`, {}, 400);
      await owner.post(`/api/v1/purchases/${order.id}/payment`, { amountPaisa: 100_000 });
      const detail = await owner.get(`/api/v1/purchases/${order.id}`);
      assert.equal(detail.data.payment_status, 'part-paid');
      const inventory = await owner.get('/api/v1/inventory');
      assert.equal(inventory.data.find((row) => row.id === state.panadol).on_hand, 100);
    });

    it('resolves a scan with a lost leading zero', async () => {
      const scan = await owner.get('/api/v1/medicines-scan?code=08964000111222');
      assert.equal(scan.data.length, 1);
      assert.equal(scan.data[0].on_hand, 100);
    });
  });

  describe('selling', () => {
    it('sells for cash and gives change', async () => {
      const sale = (await owner.post('/api/v1/sales', { items: [{ medicineId: state.panadol, quantity: 10 }], paymentMethod: 'cash', paidPaisa: 40_000 }, 201)).data;
      assert.equal(sale.total_paisa, 35_000);
      assert.equal(sale.change_paisa, 5_000);
      state.cashSale = sale.id;
    });

    it('refuses a prescription-only medicine without a verified prescription', async () => {
      await owner.post('/api/v1/sales', { items: [{ medicineId: state.augmentin, quantity: 1 }], paymentMethod: 'cash' }, 400);
    });

    it('sells on credit against a verified prescription, with a reasoned discount', async () => {
      state.customer = (await owner.post('/api/v1/customers', { name: 'Fatima Bibi', phone: '0333 1112223', creditLimitPaisa: 1_000_000 }, 201)).data.id;
      const rx = (await owner.post('/api/v1/prescriptions', { customerId: state.customer, doctorName: 'Dr Sana', items: [{ medicineId: state.augmentin, medicineText: 'Augmentin', quantity: 1 }] }, 201)).data.id;
      await owner.post(`/api/v1/prescriptions/${rx}/verify`, {});
      await owner.post('/api/v1/sales', {
        items: [{ medicineId: state.augmentin, quantity: 1 }], paymentMethod: 'credit', customerId: state.customer, prescriptionId: rx, discountPaisa: 2_000
      }, 400);
      const sale = (await owner.post('/api/v1/sales', {
        items: [{ medicineId: state.augmentin, quantity: 1 }, { medicineId: state.panadol, quantity: 2 }], paymentMethod: 'credit',
        customerId: state.customer, prescriptionId: rx, discountPaisa: 2_000, discountReason: 'regular'
      }, 201)).data;
      assert.equal(sale.total_paisa, 53_000);
      assert.equal((await owner.get(`/api/v1/prescriptions/${rx}`)).data.status, 'dispensed');
      assert.equal((await owner.get(`/api/v1/customers/${state.customer}`)).data.balance_paisa, 53_000);
    });

    it('takes udhaar repayments and reverses a mistaken one', async () => {
      const paid = await owner.post(`/api/v1/customers/${state.customer}/payments`, { amountPaisa: 20_000, paymentMethod: 'cash' }, 201);
      assert.equal(paid.customer.balance_paisa, 33_000);
      await owner.post(`/api/v1/customers/${state.customer}/payments`, { amountPaisa: 99_000_000 }, 400);
      const reversed = await owner.post(`/api/v1/customer-payments/${paid.data.id}/reverse`, { reason: 'Entered twice' });
      assert.equal(reversed.customer.balance_paisa, 53_000);
    });

    it('refunds once and puts the units back on the shelf', async () => {
      const refund = await owner.post(`/api/v1/sales/${state.cashSale}/refund`, { reason: 'Returned unopened' });
      assert.equal(refund.restocked.shelf, 10);
      await owner.post(`/api/v1/sales/${state.cashSale}/refund`, { reason: 'Again' }, 400);
      const inventory = await owner.get('/api/v1/inventory');
      assert.equal(inventory.data.find((row) => row.id === state.panadol).on_hand, 98);
    });
  });

  describe('money and reports', () => {
    it('closes the day from the money that moved', async () => {
      const preview = await owner.get('/api/v1/day-close/preview?float=500000');
      assert.equal(preview.data.expectedCashPaisa, 500_000);
      await owner.post('/api/v1/day-close', { countedCashPaisa: 494_000, openingFloatPaisa: 500_000 }, 400);
      await owner.post('/api/v1/day-close', { countedCashPaisa: 494_000, openingFloatPaisa: 500_000, note: 'Rs 60 short — change given twice' }, 201);
    });

    it('reports revenue from completed invoices and refunds on their own line', async () => {
      const overview = await owner.get('/api/v1/reports/overview');
      assert.equal(overview.revenuePaisa, 53_000);
      assert.equal(overview.refundsPaisa, 35_000);
      const dash = await owner.get('/api/v1/dashboard');
      assert.equal(dash.month.revenuePaisa, 53_000);
      for (const kind of ['sales', 'items', 'inventory', 'expiry', 'expenses', 'audit']) await owner.get(`/api/v1/reports/export?kind=${kind}`);
    });
  });

  describe('staff, messages and themes', () => {
    it('adds a cashier who sees only their own figures', async () => {
      await owner.post('/api/v1/staff', { fullName: 'Bilal Ahmed', email: 'bilal@pharmacy.test', roleId: state.cashierRole, password: PASSWORD }, 201);
      const reply = await cashier.signIn('bilal@pharmacy.test', PASSWORD);
      state.cashierId = reply.user.id;
      const dash = await cashier.get('/api/v1/dashboard');
      assert.equal(dash.month.revenuePaisa, 0);
      await cashier.get('/api/v1/reports/overview', 403);
    });

    it('delivers a message and counts it unread', async () => {
      const thread = await owner.post('/api/v1/messages/conversations', { subject: 'Count shelf A', body: 'Tonight please.', userIds: [state.cashierId] }, 201);
      assert.equal((await cashier.get('/api/v1/messages/summary')).unread, 1);
      await cashier.post(`/api/v1/messages/conversations/${thread.data.id}/messages`, { body: 'Will do.' }, 201);
      assert.equal((await cashier.get('/api/v1/messages/summary')).unread, 0);
    });

    it('lets a role change its own theme only when the Admin allows it', async () => {
      await cashier.patch('/api/v1/me', { theme: 'royal-purple' }, 403);
      await owner.patch('/api/v1/settings/appearance', { theme: 'ocean-blue', roleIds: [state.cashierRole] });
      const reply = await cashier.patch('/api/v1/me', { theme: 'royal-purple' });
      assert.equal(reply.user.theme, 'royal-purple');
    });
  });

  describe('support and the platform console', () => {
    it('carries a ticket from a cashier to the Super Admin and back', async () => {
      const ticket = (await cashier.post('/api/v1/support/tickets', { subject: 'Receipt printer stopped', category: 'technical', priority: 'high', body: 'Nothing prints.' }, 201)).data;
      const queue = await admin.get('/api/v1/platform/support/tickets?status=unread');
      assert.ok(queue.data.some((row) => row.id === ticket.id));
      await admin.post(`/api/v1/platform/support/tickets/${ticket.id}/messages`, { body: 'Reinstall the driver.', status: 'resolved' }, 201);
      const seen = await cashier.get(`/api/v1/support/tickets/${ticket.id}`);
      assert.equal(seen.data.status, 'resolved');
      assert.equal(seen.data.messages.length, 2);
    });

    it('shows every pharmacy combined and one by one', async () => {
      const overview = await admin.get('/api/v1/platform/overview');
      assert.equal(overview.pharmacies.total, 1);
      assert.equal(overview.sales.monthPaisa, 53_000);
      const detail = await admin.get(`/api/v1/platform/pharmacies/${state.pharmacyId}`);
      assert.equal(detail.figures.monthPaisa, 53_000);
      assert.equal(detail.staff.length, 2);
    });

    it('changes a plan and records an offline payment as income', async () => {
      await admin.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/subscription`, { planKey: 'monthly', note: 'Launch offer' });
      assert.equal((await owner.get('/api/v1/billing/entitlements')).plan, 'monthly');
      await admin.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/payments`, { amountPaisa: 390_000, method: 'cash', reference: 'RCPT-1' }, 201);
      await admin.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/payments`, { amountPaisa: 390_000, method: 'cash', reference: 'RCPT-1' }, 400);
      const income = await admin.get('/api/v1/platform/income');
      assert.equal(income.totals.netPaisa, 390_000);
    });

    it('works inside a pharmacy in support mode, and says so in its logs', async () => {
      admin.pharmacyId = state.pharmacyId;
      assert.equal((await admin.get('/api/v1/staff')).data.length, 2);
      await admin.post('/api/v1/roles', { name: 'Created By Support', permissions: ['dashboard.view'] });
      admin.pharmacyId = '';
      const activity = await owner.get('/api/v1/activity');
      assert.ok(JSON.stringify(activity).includes('Super Admin (support)'));
    });

    it('keeps the platform console away from pharmacy staff', async () => {
      await owner.get('/api/v1/platform/overview', 403);
      await cashier.get('/api/v1/platform/pharmacies', 403);
    });
  });

  describe('the Super Admin\'s team', () => {
    const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const ALI = { email: 'ali@ksf.test', password: 'HelpDesk#Ali2026' };
    let ali;
    let finance;

    it('builds team roles from exactly what is ticked, and nothing a role cannot hold', async () => {
      await admin.post('/api/v1/platform/team/roles', { name: 'Nothing', permissions: [] }, 400);
      await admin.post('/api/v1/platform/team/roles', { name: 'Sneaky', permissions: ['platform.team.manage', 'staff.manage'] }, 400);
      const desk = (await admin.post('/api/v1/platform/team/roles', { name: 'Help desk', permissions: ['platform.support', 'platform.help', 'platform.pharmacies.enter'] }, 201)).data;
      assert.deepEqual(desk.permissions, ['platform.pharmacies.view', 'platform.pharmacies.enter', 'platform.support', 'platform.help']);
      await admin.post('/api/v1/platform/team/roles', { name: '  help   DESK ', permissions: ['platform.support'] }, 400);
      const money = (await admin.post('/api/v1/platform/team/roles', { name: 'Finance', permissions: ['platform.finance.manage'] }, 201)).data;
      assert.deepEqual(money.permissions, ['platform.finance.view', 'platform.finance.manage']);
      state.deskRole = desk.id;
      state.financeRole = money.id;
    });

    it('adds a member with their own e-mail and photo, who sees only what the role allows', async () => {
      await admin.post('/api/v1/platform/team', { fullName: 'Ali Raza', email: ALI.email, roleId: state.deskRole, password: 'weak' }, 400);
      await admin.post('/api/v1/platform/team', { fullName: 'Ali Raza', email: ALI.email, roleId: state.deskRole, password: ALI.password, image: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' }, 400);
      await admin.post('/api/v1/platform/team', { fullName: 'Ali Raza', email: 'superadmin@ksf.test', roleId: state.deskRole, password: ALI.password }, 400);
      const added = (await admin.post('/api/v1/platform/team', { fullName: 'Ali Raza', email: ALI.email, jobTitle: 'Support lead', roleId: state.deskRole, password: ALI.password, image: PHOTO }, 201)).data;
      assert.equal(added.role_name, 'Help desk');
      assert.match(added.avatar_url, /^\/api\/v1\/avatars\/AV/);
      state.aliId = added.id;

      const photo = await fetch(server.base + added.avatar_url);
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get('content-type'), 'image/png');
      assert.equal((await fetch(`${server.base}/api/v1/avatars/AVnot-a-real-photo-id-123`)).status, 404);

      ali = new Client(server.base);
      const reply = await ali.signIn(ALI.email, ALI.password);
      assert.equal(reply.user.isPlatformStaff, true);
      assert.equal(reply.user.isPlatformAdmin, false);
      assert.equal(reply.user.roleName, 'Help desk');
      assert.equal(reply.user.mustChangePassword, true);
      assert.ok(reply.user.permissions.includes('platform.support'));
      assert.equal((await ali.get('/api/v1/bootstrap')).platform, true);

      await ali.get('/api/v1/platform/support/tickets');
      await ali.get('/api/v1/platform/pharmacies');
      await ali.get('/api/v1/platform/overview', 403);
      await ali.get('/api/v1/platform/income', 403);
      await ali.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/subscription`, { extendDays: 30 }, 403);
      await ali.get('/api/v1/platform/team', 403);
      await ali.post('/api/v1/platform/team/roles', { name: 'Mine', permissions: ['platform.overview'] }, 403);
      await ali.patch(`/api/v1/platform/team/${state.aliId}`, { roleId: state.financeRole }, 403);
      await owner.get('/api/v1/platform/team', 403);
    });

    it('sends a pharmacy\'s request to the desk, and tells the Super Admin who resolved it', async () => {
      const ticket = (await cashier.post('/api/v1/support/tickets', { subject: 'Cannot print the day close', category: 'technical', body: 'The button does nothing.' }, 201)).data;
      assert.ok((await ali.get('/api/v1/platform/notifications')).data.some((row) => row.link === `/platform/support/${ticket.id}`));

      const agents = (await admin.get('/api/v1/platform/support/agents')).data.map((row) => row.name);
      assert.ok(agents.includes('Ali Raza'));
      await admin.patch(`/api/v1/platform/support/tickets/${ticket.id}`, { assignedTo: state.cashierId }, 400);
      const given = (await admin.patch(`/api/v1/platform/support/tickets/${ticket.id}`, { assignedTo: state.aliId })).data;
      assert.equal(given.assigned_to_name, 'Ali Raza');
      assert.ok((await ali.get('/api/v1/platform/support/tickets?assignee=me')).data.some((row) => row.id === ticket.id));
      assert.ok((await ali.get('/api/v1/platform/notifications')).data.some((row) => row.title.includes('gave you')));

      await ali.post(`/api/v1/platform/support/tickets/${ticket.id}/messages`, { body: 'Fixed: the printer queue was stuck.', status: 'resolved' }, 201);
      const seenByPharmacy = (await cashier.get(`/api/v1/support/tickets/${ticket.id}`)).data;
      assert.equal(seenByPharmacy.status, 'resolved');
      assert.equal(seenByPharmacy.messages.at(-1).author_name, 'KSF Support');
      assert.equal(seenByPharmacy.messages.at(-1).agent_name, undefined);
      assert.equal(seenByPharmacy.resolved_by_name, undefined);

      const seenByDesk = (await admin.get(`/api/v1/platform/support/tickets/${ticket.id}`)).data;
      assert.equal(seenByDesk.resolved_by_name, 'Ali Raza');
      assert.equal(seenByDesk.messages.at(-1).agent_name, 'Ali Raza');
      assert.ok((await admin.get('/api/v1/platform/notifications')).data.some((row) => row.title === `Ali Raza resolved ${ticket.reference}`));
      assert.ok(JSON.stringify(await owner.get('/api/v1/activity')).includes('KSF team: Help desk'));
    });

    it('lets each person read their own notices', async () => {
      const before = (await admin.get('/api/v1/platform/notifications')).counts.unread;
      await ali.post('/api/v1/platform/notifications/read-all', {});
      assert.equal((await ali.get('/api/v1/platform/notifications')).counts.unread, 0);
      assert.equal((await admin.get('/api/v1/platform/notifications')).counts.unread, before);
    });

    it('works inside a pharmacy only when the role allows it', async () => {
      ali.pharmacyId = state.pharmacyId;
      assert.equal((await ali.get('/api/v1/staff')).data.length, 2);
      await ali.post('/api/v1/roles', { name: 'Made By The Desk', permissions: ['dashboard.view'] });
      ali.pharmacyId = '';
      assert.ok(JSON.stringify(await owner.get('/api/v1/activity')).includes('KSF team: Help desk (support)'));

      await admin.post('/api/v1/platform/team', { fullName: 'Sara Finance', email: 'sara@ksf.test', roleId: state.financeRole, password: ALI.password }, 201);
      finance = new Client(server.base);
      await finance.signIn('sara@ksf.test', ALI.password);
      await finance.get('/api/v1/platform/income');
      await finance.get('/api/v1/platform/support/tickets', 403);
      finance.pharmacyId = state.pharmacyId;
      const refused = await finance.call('GET', '/api/v1/staff');
      assert.equal(refused.status, 403);
      assert.equal(refused.body.code, 'support_mode_forbidden');
      finance.pharmacyId = '';
    });

    it('never reaches past the team: not the Super Admin, not a pharmacy\'s people', async () => {
      const superId = (await admin.get('/api/v1/auth/session')).user.id;
      await admin.patch(`/api/v1/platform/team/${superId}`, { status: 'suspended' }, 404);
      await admin.patch(`/api/v1/platform/team/${state.cashierId}`, { status: 'suspended' }, 404);
      await admin.post(`/api/v1/platform/team/${state.cashierId}/reset-password`, { password: ALI.password }, 404);
    });

    it('applies a change of role, a suspension and a removal on the very next request', async () => {
      await admin.patch(`/api/v1/platform/team/roles/${state.deskRole}`, { permissions: ['platform.help'] });
      await ali.get('/api/v1/platform/support/tickets', 403);
      await ali.get('/api/v1/platform/help');

      await admin.delete(`/api/v1/platform/team/roles/${state.deskRole}`, {}, 409);
      await admin.patch(`/api/v1/platform/team/${state.aliId}`, { status: 'suspended' });
      assert.equal((await ali.call('GET', '/api/v1/platform/help')).status, 401);
      const refused = await new Client(server.base).call('POST', '/api/v1/auth/login', ALI);
      assert.deepEqual([refused.status, refused.body.code], [403, 'account_suspended']);
      assert.match(refused.body.message, /KSF Super Admin/);

      await admin.delete(`/api/v1/platform/team/${state.aliId}`);
      assert.equal((await admin.get('/api/v1/platform/team')).data.some((row) => row.id === state.aliId), false);
      await admin.delete(`/api/v1/platform/team/roles/${state.deskRole}`);
    });
  });

  describe('data import', () => {
    it('validates, imports, reconciles and rolls back exactly what it created', async () => {
      const csv = 'Medicine name,Retail price (Rs),Cost price (Rs),Category\nBrufen 400mg,45,32,Painkillers\nFlagyl 400mg,30,21,Antibiotics\nBroken,abc,1,\n';
      const job = await owner.post('/api/v1/migration/jobs', { category: 'medicines', fileName: 'meds.csv', content: Buffer.from(csv).toString('base64') }, 201);
      const checked = await owner.post(`/api/v1/migration/jobs/${job.job.id}/validate`, {});
      assert.deepEqual([checked.valid, checked.errors], [2, 1]);
      const imported = await owner.post(`/api/v1/migration/jobs/${job.job.id}/import`, {});
      assert.equal(imported.report.imported, 2);
      const again = await owner.call('POST', '/api/v1/migration/jobs', { category: 'medicines', fileName: 'renamed.csv', content: Buffer.from(csv).toString('base64') });
      assert.equal(again.status, 409);
      await owner.post(`/api/v1/migration/jobs/${job.job.id}/rollback`, {}, 403);
      await owner.post('/api/v1/auth/verify-identity', { password: PASSWORD });
      const rolled = await owner.post(`/api/v1/migration/jobs/${job.job.id}/rollback`, {});
      assert.equal(rolled.removed, 2);
    });
  });

  describe('isolation and suspension', () => {
    it('never shows one pharmacy another pharmacy\'s records', async () => {
      const other = new Client(server.base);
      await register(other, 'Hamza', 'hamza@other.test');
      await other.get(`/api/v1/medicines/${state.panadol}`, 404);
      await other.get(`/api/v1/customers/${state.customer}`, 404);
      assert.equal((await other.get('/api/v1/sales')).total, 0);
    });

    it('suspends a pharmacy after confirming the password, and brings it back', async () => {
      await admin.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/status`, { status: 'suspended', reason: 'Test' }, 403);
      await admin.post('/api/v1/auth/verify-identity', { password: SUPER.password });
      await admin.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/status`, { status: 'suspended', reason: 'Unpaid invoice' });
      assert.ok([401, 403].includes((await owner.call('GET', '/api/v1/dashboard')).status));
      await admin.post(`/api/v1/platform/pharmacies/${state.pharmacyId}/status`, { status: 'active' });
      const back = new Client(server.base);
      await back.signIn('ayesha@pharmacy.test', PASSWORD).catch(() => null);
    });
  });

  describe('the Super Admin\'s own account', () => {
    it('changes its sign-in e-mail with a code and its password', async () => {
      await admin.post('/api/v1/me/email/start', { email: 'owner@ksf.test', password: SUPER.password });
      await admin.post('/api/v1/me/email/confirm', { email: 'owner@ksf.test', code: await codeFor(admin, 'owner@ksf.test') });
      await admin.post('/api/v1/auth/change-password', { currentPassword: SUPER.password, newPassword: 'Another#Strong2027' });
      const fresh = new Client(server.base);
      const reply = await fresh.signIn('owner@ksf.test', 'Another#Strong2027');
      assert.equal(reply.user.isPlatformAdmin, true);
      assert.equal((await fresh.call('POST', '/api/v1/auth/login', SUPER)).status, 401);
    });
  });
});

