/* Referral codes the Super Admin issues (2.11.0), over real HTTP against a
   real MongoDB.

   The Super Admin gives Khan Pharmacy a code made from its name (KHAN-239)
   or one typed; Khan shares it; pharmacies register with it; the Super
   Admin sees, for Khan, how many registered and which ones — and, for each
   of them, that it came through Khan's code. Khan's first code keeps
   working, so a link already sent never breaks. */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, SUPER_ADMIN, TEST_PASSWORD, codeFor, registerPharmacy, startServer } from './support/server.mjs';

const skip = process.env.KSF_TEST_DATABASE !== 'yes' ? 'no MongoDB: set TEST_MONGODB_URI to run the API suites' : false;

describe('the names of referral codes', () => {
  it('makes the stem from the part of the name that says which pharmacy it is', async () => {
    const { codeStem, tidyCode } = await import('../backend/src/services/referral-codes.ts');
    assert.equal(codeStem('Khan Pharmacy'), 'KHAN');
    assert.equal(codeStem('Al-Shifa Medical Store'), 'SHIFA');
    assert.equal(codeStem('City Care Pharmacy'), 'CITY');
    assert.equal(codeStem('The Medicine House'), 'MEDICINE', 'every word generic: the first one');
    assert.equal(codeStem('ÄÖ'), 'AO');
    assert.equal(codeStem(''), 'KSF');
    assert.equal(codeStem('Muhammadiyah Brothers Pharmacy'), 'MUHAMMADIY', 'ten letters at most');
    assert.equal(tidyCode(' khan 777 '), 'KHAN-777');
  });
});

describe('referral codes issued by the Super Admin', { skip }, () => {
  let server;
  let admin;
  let khan;
  let firstCode;
  let issued;
  let noor;

  const registerWith = async (code, first, email) => {
    const client = new Client(server.base);
    await client.post('/api/v1/register/start', { firstName: first, lastName: 'Test', email, password: TEST_PASSWORD, mobile: '0300 1234567', referralCode: code });
    return client;
  };
  const finish = async (client, email, name, city) => {
    const reply = await client.post('/api/v1/register/verify-email', { code: await codeFor(client, email) }, 201);
    client.token = reply.accessToken;
    await client.patch('/api/v1/settings', { pharmacy: { name, city } });
    return { client, pharmacyId: reply.data.pharmacyId };
  };

  before(async () => {
    server = await startServer();
    admin = new Client(server.base);
    await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
    khan = await registerPharmacy(server.base, 'Imran', 'owner@khan-codes.test');
    await khan.client.patch('/api/v1/settings', { pharmacy: { name: 'Khan Pharmacy', city: 'Karachi' } });
    firstCode = (await khan.client.get('/api/v1/billing')).referrals.code;
  });
  after(async () => { await server?.stop(); });

  it('gives Khan Pharmacy a code made from its name, which Khan now shares', async () => {
    const reply = await admin.post(`/api/v1/platform/pharmacies/${khan.pharmacyId}/referral-code`, {});
    issued = reply.data.code;
    assert.match(issued, /^KHAN-\d{3,4}$/);
    assert.deepEqual(reply.data.previous, [firstCode]);
    assert.match(reply.message, new RegExp(`${firstCode} still works`));
    const mine = (await khan.client.get('/api/v1/billing')).referrals;
    assert.equal(mine.code, issued, 'the wallet shows the new code');
    assert.match(mine.link, new RegExp(`ref=${issued}$`));
    const notices = await khan.client.get('/api/v1/notifications');
    assert.ok(notices.data.some((note) => note.title === `Your referral code is now ${issued}`), 'Khan is told');
  });

  it('keeps the first code working, so a link already sent is honoured', async () => {
    const anonymous = new Client(server.base);
    const now = await anonymous.get(`/api/v1/public/referral/${issued.toLowerCase()}`);
    assert.equal(now.valid, true);
    assert.equal(now.pharmacyName, 'Khan Pharmacy');
    assert.equal((await anonymous.get(`/api/v1/public/referral/${firstCode}`)).valid, true);
  });

  it('counts the pharmacies that register with the code, under Khan', async () => {
    noor = await finish(await registerWith(issued, 'Noor', 'owner@noor-codes.test'), 'owner@noor-codes.test', 'Noor Pharmacy', 'Lahore');
    await finish(await registerWith(firstCode, 'Shifa', 'owner@shifa-codes.test'), 'owner@shifa-codes.test', 'Shifa Medical Store', 'Rawalpindi');
    await registerWith(issued, 'Bilal', 'owner@bilal-codes.test');
    await registerPharmacy(server.base, 'Usman', 'owner@direct-codes.test');

    const board = await admin.get('/api/v1/platform/referral-codes');
    const row = board.data.find((item) => item.pharmacyId === khan.pharmacyId);
    assert.equal(row.code, issued);
    assert.equal(row.issued, true);
    assert.deepEqual(row.otherCodes, [firstCode]);
    assert.deepEqual([row.registered, row.signingUp, row.review, row.rejected], [2, 1, 0, 0]);
    assert.ok(row.lastRegisteredAt);
    assert.equal(board.data[0].pharmacyId, khan.pharmacyId, 'the most successful first');
    assert.equal(board.totals.registrations, 2);
    assert.equal(board.totals.issuedCodes, 1);
    assert.equal(board.daysPerReferral, 15);
    const found = await admin.get(`/api/v1/platform/referral-codes?q=${issued.toLowerCase()}`);
    assert.deepEqual(found.data.map((item) => item.name), ['Khan Pharmacy'], 'found by its code');
  });

  it('lists every pharmacy that registered with Khan’s codes, and which code each used', async () => {
    const mine = await admin.get(`/api/v1/platform/pharmacies/${khan.pharmacyId}/referrals`);
    assert.equal(mine.pharmacy.name, 'Khan Pharmacy');
    assert.deepEqual(mine.codes.map((row) => [row.code, row.status, row.issued]), [[issued, 'active', true], [firstCode, 'legacy', false]]);
    assert.deepEqual(mine.counts, { registered: 2, signingUp: 1, review: 0, rejected: 0 });
    assert.equal(mine.cameThrough, null, 'Khan came on its own');
    const names = Object.fromEntries(mine.referred.map((row) => [row.pharmacyName ?? row.name, row]));
    assert.equal(names['Noor Pharmacy'].code, issued);
    assert.equal(names['Noor Pharmacy'].stage, 'Registered');
    assert.equal(names['Noor Pharmacy'].city, 'Lahore');
    assert.equal(names['Noor Pharmacy'].owner.email, 'owner@noor-codes.test');
    assert.equal(names['Noor Pharmacy'].plan.label, 'Standard Referral');
    assert.equal(names['Shifa Medical Store'].code, firstCode);
    assert.equal(names['Bilal Test'].stage, 'Signing up');
    assert.equal(names['Bilal Test'].pharmacyId, null);
  });

  it('shows, on a referred pharmacy, whose code it registered with', async () => {
    const theirs = await admin.get(`/api/v1/platform/pharmacies/${noor.pharmacyId}/referrals`);
    assert.deepEqual(theirs.cameThrough, { code: issued, pharmacyId: khan.pharmacyId, pharmacyName: 'Khan Pharmacy', city: 'Karachi' });
    assert.equal(theirs.referred.length, 0);
  });

  it('takes a code the Super Admin types, and refuses one that is taken or badly formed', async () => {
    const custom = await admin.post(`/api/v1/platform/pharmacies/${khan.pharmacyId}/referral-code`, { code: ' khan 777 ' });
    assert.equal(custom.data.code, 'KHAN-777');
    assert.deepEqual(custom.data.previous, [issued]);
    assert.equal((await khan.client.get('/api/v1/billing')).referrals.code, 'KHAN-777');
    assert.equal((await new Client(server.base).get(`/api/v1/public/referral/${issued}`)).valid, true, 'the one before still works');
    const taken = await admin.call('POST', `/api/v1/platform/pharmacies/${noor.pharmacyId}/referral-code`, { code: 'KHAN-777' });
    assert.equal(taken.status, 409);
    const shapeless = await admin.call('POST', `/api/v1/platform/pharmacies/${khan.pharmacyId}/referral-code`, { code: 'KHAN' });
    assert.equal(shapeless.status, 400);
    const nowhere = await admin.call('POST', '/api/v1/platform/pharmacies/no-such-pharmacy/referral-code', {});
    assert.equal(nowhere.status, 404);
  });

  it('keeps all of it from a pharmacy', async () => {
    assert.equal((await khan.client.call('GET', '/api/v1/platform/referral-codes')).status, 403);
    assert.equal((await khan.client.call('GET', `/api/v1/platform/pharmacies/${khan.pharmacyId}/referrals`)).status, 403);
    assert.equal((await khan.client.call('POST', `/api/v1/platform/pharmacies/${khan.pharmacyId}/referral-code`, {})).status, 403);
  });
});
