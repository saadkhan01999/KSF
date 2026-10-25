/* Barcode scanning at the till, over real HTTP against a real MongoDB.

   A pack's plain barcode and its GS1 DataMatrix both find the medicine; an
   unknown barcode is saved on the right medicine in one step (and nothing
   else about it changes); a cashier can scan but not change the catalogue;
   and two medicines can never share a barcode. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addStaff, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;
const GS = '\u001d';
const scan = (client, code, status) => client.get(`/api/v1/medicines-scan?code=${encodeURIComponent(code)}`, status);

describe('barcode scanning', { skip }, () => {
  let server;
  let owner;
  let cashier;
  const ids = {};

  before(async () => {
    server = await startServer();
    ({ client: owner } = await registerPharmacy(server.base, 'Sadia', 'sadia@scanning.test'));
    cashier = (await addStaff(server.base, owner, { name: 'Ali Cashier', email: 'ali@scanning.test', roleKey: 'cashier' })).client;
    ids.panadol = (await owner.post('/api/v1/medicines', { name: 'Panadol 500mg', barcode: '8964000111222', pricePaisa: 3500, costPaisa: 2800 }, 201)).data.id;
    ids.brufen = (await owner.post('/api/v1/medicines', { name: 'Brufen 400mg', pricePaisa: 4500, costPaisa: 3600, minStock: 15 }, 201)).data.id;
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
});
