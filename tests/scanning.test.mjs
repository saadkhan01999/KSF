/* Barcode scanning at the till, over real HTTP against a real MongoDB.

   A pack's plain barcode, its GS1 DataMatrix and a GS1 Digital Link QR all
   find the medicine; an unknown barcode is saved on the right medicine in
   one step (and nothing else about it changes); a cashier can scan but not
   change the catalogue; and two medicines can never share a barcode.

   A new medicine is filled in from its barcode: from what another KSF
   pharmacy saved (never its price, stock or shelf), from the open product
   databases — answered here by a stand-in, asked once per barcode — and
   from the medicine directory. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addStaff, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;
/* Read by the server when startServer() first loads it. */
process.env.BARCODE_LOOKUP_ONLINE = 'true';

/* ----------------------------------- a stand-in for the product databases */
const realFetch = globalThis.fetch;
const asked = [];
const ONLINE = {
  'api.upcitemdb.com/0300450444049': { code: 'OK', total: 1, items: [{ title: 'Panadol Extra 500mg Tablets 20s', brand: 'Panadol' }] }
};
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!/(openproductsfacts|openbeautyfacts|openfoodfacts|upcitemdb)\./.test(url.hostname)) return realFetch(input, init);
  const code = url.searchParams.get('upc') ?? url.pathname.match(/product\/([^/.]+)\.json$/)?.[1];
  asked.push(`${url.hostname}/${code}`);
  const known = ONLINE[`${url.hostname}/${code}`];
  if (known) return Response.json(known);
  return url.hostname.includes('upcitemdb')
    ? Response.json({ code: 'OK', total: 0, items: [] })
    : Response.json({ status: 0, status_verbose: 'product not found' }, { status: 404 });
};
const GS = '\u001d';
const scan = (client, code, status) => client.get(`/api/v1/medicines-scan?code=${encodeURIComponent(code)}`, status);
const info = (client, code, status) => client.get(`/api/v1/medicines-barcode-info?code=${encodeURIComponent(code)}`, status);

describe('barcode scanning', { skip }, () => {
  let server;
  let owner;
  let cashier;
  let other;
  let ownerPharmacy;
  const ids = {};

  before(async () => {
    server = await startServer();
    ({ client: owner, pharmacyId: ownerPharmacy } = await registerPharmacy(server.base, 'Sadia', 'sadia@scanning.test'));
    cashier = (await addStaff(server.base, owner, { name: 'Ali Cashier', email: 'ali@scanning.test', roleKey: 'cashier' })).client;
    ids.panadol = (await owner.post('/api/v1/medicines', { name: 'Panadol 500mg', barcode: '8964000111222', pricePaisa: 3500, costPaisa: 2800 }, 201)).data.id;
    ids.brufen = (await owner.post('/api/v1/medicines', { name: 'Brufen 400mg', pricePaisa: 4500, costPaisa: 3600, minStock: 15 }, 201)).data.id;
    ({ client: other } = await registerPharmacy(server.base, 'Bilal', 'bilal@scanning.test'));
  });
  after(async () => { await server?.stop(); });

  it('finds a medicine by the barcode on the box, with or without its leading zero', async () => {
    assert.deepEqual((await scan(owner, '8964000111222')).data.map((row) => row.id), [ids.panadol]);
    assert.deepEqual((await scan(owner, '08964000111222')).data.map((row) => row.id), [ids.panadol]);
  });

  it('reads the GS1 DataMatrix on the pack: product, expiry and batch', async () => {
    const reply = await scan(owner, `]d201089640001112221727123110PB-77${GS}21SN0042`);
    assert.deepEqual(reply.data.map((row) => row.id), [ids.panadol]);
    assert.equal(reply.barcode, '8964000111222');
    assert.deepEqual(reply.gs1, { gtin: '08964000111222', expiry: '2027-12-31', batch: 'PB-77', serial: 'SN0042' });
  });

  it('says plainly when a barcode is not in the catalogue', async () => {
    const reply = await scan(owner, '(01)05012345678900');
    assert.deepEqual(reply.data, []);
    assert.equal(reply.barcode, '5012345678900');
  });

  it('saves an unknown barcode on the medicine it belongs to, and changes nothing else', async () => {
    await owner.patch(`/api/v1/medicines/${ids.brufen}`, { barcode: '5012345678900' });
    const brufen = (await scan(owner, '5012345678900')).data[0];
    assert.equal(brufen.id, ids.brufen);
    assert.equal(brufen.price_paisa, 4500);
    assert.equal(brufen.min_stock, 15);
    assert.equal(brufen.name, 'Brufen 400mg');
  });

  it('lets a cashier scan, but not change the catalogue', async () => {
    assert.equal((await scan(cashier, '5012345678900')).data[0].id, ids.brufen);
    await cashier.patch(`/api/v1/medicines/${ids.panadol}`, { barcode: '4006381333931' }, 403);
  });

  it('never lets two medicines share a barcode', async () => {
    const reply = await owner.call('PATCH', `/api/v1/medicines/${ids.panadol}`, { barcode: '5012345678900' });
    assert.equal(reply.status, 400);
    assert.equal(reply.body.field, 'barcode');
    await scan(owner, '', 400);
  });

  it('reads a GS1 Digital Link from a QR code, and keeps a typed GS1 code as the barcode on the box', async () => {
    const reply = await scan(owner, 'https://id.gs1.org/01/08964000111222/10/B1?17=271231');
    assert.deepEqual(reply.data.map((row) => row.id), [ids.panadol]);
    assert.deepEqual(reply.gs1, { gtin: '08964000111222', expiry: '2027-12-31', batch: 'B1', serial: null });
    const saved = await owner.post('/api/v1/medicines', { name: 'Ventolin Inhaler', barcode: '(01)05012345000017(17)271231' }, 201);
    assert.equal(saved.data.barcode, '5012345000017');
  });

  it('fills in a new medicine from what another KSF pharmacy saved, but never its price, stock or shelf', async () => {
    await owner.post('/api/v1/medicines', {
      name: 'Augmentin 625mg Tablets', genericName: 'Amoxicillin + Clavulanic acid', manufacturer: 'GSK Pakistan', form: 'Tablet',
      strength: '625mg', packSize: '6 tablets', barcode: '8961100223344', drapRegNo: 'DRAP-012345', requiresPrescription: true,
      pricePaisa: 52_000, costPaisa: 45_000, shelfLocation: 'Rack B-2', storageNote: 'Keep below 25C'
    }, 201);
    const reply = await info(other, '8961100223344');
    assert.equal(reply.found, true);
    assert.equal(reply.existing, null);
    assert.deepEqual(reply.source, { kind: 'ksf', label: 'KSF pharmacies' });
    assert.deepEqual(
      { ...reply.fields, categoryId: undefined, categoryName: undefined },
      {
        name: 'Augmentin 625mg Tablets', genericName: 'Amoxicillin + Clavulanic acid', manufacturer: 'GSK Pakistan', form: 'Tablet',
        strength: '625mg', packSize: '6 tablets', drapRegNo: 'DRAP-012345', requiresPrescription: true, isControlled: false,
        categoryId: undefined, categoryName: undefined
      }
    );
    const said = JSON.stringify(reply);
    for (const secret of ['52000', '45000', 'Rack B-2', 'Keep below 25C', 'Sadia', ownerPharmacy, 'learned_from']) assert.ok(!said.includes(secret), secret);
    /* The pharmacy that has it is told so. */
    assert.equal((await info(owner, '8961100223344')).existing.name, 'Augmentin 625mg Tablets');
  });

  it('keeps the first pharmacy\'s details: a later one only fills in what was missing', async () => {
    const theirs = (await other.post('/api/v1/categories', { name: 'Antibiotics' })).data.id;
    await other.post('/api/v1/medicines', { name: 'Augmentin (cheap)', barcode: '8961100223344', categoryId: theirs, manufacturer: 'Somebody else' }, 201);
    const ours = (await owner.post('/api/v1/categories', { name: 'antibiotics' })).data.id;
    const reply = await info(owner, '08961100223344');
    assert.equal(reply.fields.name, 'Augmentin 625mg Tablets');
    assert.equal(reply.fields.manufacturer, 'GSK Pakistan');
    assert.equal(reply.fields.categoryName, 'Antibiotics');
    assert.equal(reply.fields.categoryId, ours, 'matched to this pharmacy\'s own category by name');
    /* The pharmacy that set it can still correct its own typo. */
    const augmentin = (await owner.get('/api/v1/medicines?q=Augmentin')).data[0];
    await owner.patch(`/api/v1/medicines/${augmentin.id}`, { packSize: '6 film-coated tablets' });
    const corrected = await info(other, '8961100223344');
    assert.equal(corrected.fields.packSize, '6 film-coated tablets');
    assert.equal(corrected.fields.categoryName, 'Antibiotics', 'what another pharmacy filled in stays');
  });

  it('asks the open product databases once per barcode, and fills in the rest from the medicine directory', async () => {
    const reply = await info(other, '0300450444049');
    assert.equal(reply.found, true);
    assert.deepEqual(reply.source, { kind: 'online', label: 'UPCitemdb' });
    assert.equal(reply.directory.name, 'Paracetamol');
    assert.deepEqual(reply.fields, {
      name: 'Panadol Extra 500mg Tablets 20s', genericName: 'Paracetamol', manufacturer: 'Haleon (formerly GSK)', form: 'Tablet',
      strength: '500mg', packSize: '20 tablets', drapRegNo: null, categoryId: null, categoryName: 'Pain and fever',
      requiresPrescription: false, isControlled: false
    });
    assert.equal(asked.length, 4, 'Open Products, Beauty and Food Facts, and UPCitemdb');
    await info(owner, '0300450444049');
    assert.equal(asked.length, 4, 'remembered, not asked again');

    const unknown = await info(other, '4006381333931');
    assert.equal(unknown.found, false);
    assert.equal(unknown.fields, null);
    assert.equal(unknown.barcode, '4006381333931');
    await info(other, '4006381333931');
    assert.equal(asked.length, 8, '"not found" is remembered too');
    /* Text from a QR code that is not a product number never leaves KSF. */
    assert.equal((await info(other, 'KSF:SHELF-C3')).found, false);
    assert.equal(asked.length, 8);
  });

  it('lets only staff who can add medicines use the lookup', async () => {
    await info(cashier, '8961100223344', 403);
    await info(owner, '', 400);
  });
});
