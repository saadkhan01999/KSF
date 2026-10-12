/* The medicine directory, over real HTTP against a real MongoDB.

   Every pharmacy can search it; only the KSF team member whose role keeps it
   can change it; "verified" always describes what is on the screen; and a
   reference can only ever be a secure web address. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, TEST_PASSWORD, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;

const entry = (overrides = {}) => ({
  name: 'Testamol', category: 'Pain and fever', prescription: 'otc', uses: ['Test pain'], precautions: ['Test caution'],
  sideEffects: ['Test effect'], brands: [{ name: 'Testa', manufacturer: 'Test Labs' }],
  references: [{ source: 'DailyMed', title: 'Testamol', url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=testamol' }],
  ...overrides
});

describe('the medicine directory', { skip }, () => {
  let server;
  let admin;
  let pharmacy;
  let clinician;
  let helpDesk;
  const state = {};

  before(async () => {
    server = await startServer();
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    ({ client: pharmacy } = await registerPharmacy(server.base, 'Directory', 'directory@pharmacy.test'));

    /* Two team members: one who keeps the directory, one who does not. */
    const clinical = (await admin.post('/api/v1/platform/team/roles', { name: 'Clinical', permissions: ['platform.medicines.manage'] }, 201)).data.id;
    const desk = (await admin.post('/api/v1/platform/team/roles', { name: 'Desk', permissions: ['platform.support'] }, 201)).data.id;
    const join = async (name, email, roleId) => {
      await admin.post('/api/v1/platform/team', { fullName: name, email, roleId, password: TEST_PASSWORD }, 201);
      const client = new Client(server.base);
      await client.signIn(email, TEST_PASSWORD);
      return client;
    };
    clinician = await join('Dr Amna', 'amna@ksf.test', clinical);
    helpDesk = await join('Bilal Desk', 'bilal@ksf.test', desk);
  });
  after(async () => { await server?.stop(); });

  it('comes with the starter set, unverified, with secure references', async () => {
    const all = await pharmacy.get('/api/v1/medicine-directory?size=100');
    assert.equal(all.total, 34);
    assert.equal(all.canManage, false);
    assert.ok(all.data.every((row) => row.verified_at === null));
    assert.ok(all.categories.some((row) => row.category === 'Antibiotics' && row.count >= 5));
    const detail = (await pharmacy.get(`/api/v1/medicine-directory/${all.data[0].id}`)).data;
    assert.ok(detail.references.length >= 2 && detail.references.every((ref) => ref.url.startsWith('https://')));
  });

  it('finds a medicine by the start of its name, another name, a brand or a category', async () => {
    assert.equal((await pharmacy.get('/api/v1/medicine-directory?q=para')).data[0].name, 'Paracetamol');
    assert.equal((await pharmacy.get('/api/v1/medicine-directory?q=acetaminophen')).data[0].name, 'Paracetamol');
    assert.equal((await pharmacy.get('/api/v1/medicine-directory?q=augmentin')).data[0].name, 'Co-amoxiclav');
    const antibiotics = await pharmacy.get('/api/v1/medicine-directory?category=Antibiotics');
    assert.ok(antibiotics.data.every((row) => row.category === 'Antibiotics'));
    const m = await pharmacy.get('/api/v1/medicine-directory?letter=m');
    assert.ok(m.data.length > 0 && m.data.every((row) => row.name.toLowerCase().startsWith('m')));
  });

  it('is kept only by the team members whose role includes it', async () => {
    await pharmacy.post('/api/v1/platform/medicine-directory', entry(), 403);
    await helpDesk.post('/api/v1/platform/medicine-directory', entry(), 403);
    state.id = (await clinician.post('/api/v1/platform/medicine-directory', entry(), 201)).data.id;
    await clinician.post('/api/v1/platform/medicine-directory', entry({ name: '  testamol ' }), 409);
    assert.equal((await helpDesk.get(`/api/v1/medicine-directory/${state.id}`)).data.name, 'Testamol');
  });

  it('refuses a reference that is not a secure web address, and an entry that says nothing', async () => {
    const bad = (url) => entry({ name: `Bad ${url.length}`, references: [{ source: 'X', url }] });
    await clinician.post('/api/v1/platform/medicine-directory', bad('javascript:alert(1)'), 400);
    await clinician.post('/api/v1/platform/medicine-directory', bad('http://example.com/plain'), 400);
    await clinician.post('/api/v1/platform/medicine-directory', entry({ name: 'Empty', uses: [] }), 400);
  });

  it('verifies against references, and forgets the verification when the words change', async () => {
    const verified = (await clinician.post(`/api/v1/platform/medicine-directory/${state.id}/verify`)).data;
    assert.equal(verified.verified_by_name, 'Dr Amna');
    /* A new category does not change what the entry says. */
    assert.equal((await clinician.patch(`/api/v1/platform/medicine-directory/${state.id}`, { category: 'Allergy' })).unverified, false);
    const changed = await clinician.patch(`/api/v1/platform/medicine-directory/${state.id}`, { sideEffects: ['Test effect', 'Drowsiness'] });
    assert.equal(changed.unverified, true);
    assert.equal(changed.data.verified_at, null);

    await clinician.patch(`/api/v1/platform/medicine-directory/${state.id}`, { references: [] });
    await clinician.post(`/api/v1/platform/medicine-directory/${state.id}/verify`, {}, 400);
  });

  it('keeps drafts and archived entries away from pharmacies', async () => {
    await clinician.patch(`/api/v1/platform/medicine-directory/${state.id}`, { status: 'draft' });
    await pharmacy.get(`/api/v1/medicine-directory/${state.id}`, 404);
    assert.equal((await pharmacy.get('/api/v1/medicine-directory?q=testamol&status=draft')).total, 0);
    assert.equal((await clinician.get('/api/v1/medicine-directory?q=testamol&status=draft')).total, 1);
    await clinician.patch(`/api/v1/platform/medicine-directory/${state.id}`, { status: 'published' });
    await pharmacy.get(`/api/v1/medicine-directory/${state.id}`);
    await clinician.delete(`/api/v1/platform/medicine-directory/${state.id}`);
    await pharmacy.get(`/api/v1/medicine-directory/${state.id}`, 404);
  });

  it('imports rows one by one and says which were refused and why', async () => {
    const result = await clinician.post('/api/v1/platform/medicine-directory/import', {
      rows: [entry({ name: 'Importamol' }), entry({ name: 'Nameless', uses: [] }), entry({ name: 'Paracetamol', synonyms: ['Acetaminophen', 'APAP'] })]
    });
    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);
    assert.deepEqual(result.refused.map((row) => row.name), ['Nameless']);
    const again = await admin.post('/api/v1/platform/medicine-directory/import', { starter: true });
    assert.equal(again.added + again.updated, 34);
  });
});
