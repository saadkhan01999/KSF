/* Pure logic: no server, no database. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { readTable, parseCsv, detectDelimiter, neutraliseCell, excelSerialToDate } = await import('../backend/src/services/tabular.ts');
const { toDate, toPaisa, suggestMapping, validateRow } = await import('../backend/src/services/migration.ts');
const { canMoveTo, unitsToPaisa, paisaToUnits, sameSignature } = await import('../backend/src/services/payments/provider.ts');
const { jazzcashSignature } = await import('../backend/src/services/payments/adapters.ts');
const { hashPassword, verifyPassword, passwordProblem } = await import('../backend/src/security/password.ts');
const { generateSecret, totpNow, verifyTotp } = await import('../backend/src/security/totp.ts');
const { stockState, expiryState, plural } = await import('../backend/src/modules/shared.ts');
const { barcodeVariants } = await import('../backend/src/modules/catalogue.ts');
const { SYSTEM_ROLES, PERMISSION_KEYS, THEMES, PHARMACY_ADMIN_ROLE } = await import('../backend/src/domain/permissions.ts');
const { trustProxySetting, ALLOWED_ORIGINS, originMatcher } = await import('../backend/src/config/env.ts');
const { databaseHint } = await import('../backend/src/db/mongo.ts');

describe('reading imported files', () => {
  it('detects semicolons and keeps quoted commas and newlines', () => {
    const text = 'Name;Price\n"Panadol; 500mg";35\n"Line\nbreak";10\n';
    assert.equal(detectDelimiter(text), ';');
    assert.deepEqual(parseCsv(text), [['Name', 'Price'], ['Panadol; 500mg', '35'], ['Line\nbreak', '10']]);
  });

  it('neutralises spreadsheet formulas but not negative numbers', () => {
    assert.deepEqual(neutraliseCell('=HYPERLINK("x")'), { value: '\'=HYPERLINK("x")', changed: true });
    assert.deepEqual(neutraliseCell('-12.5'), { value: '-12.5', changed: false });
  });

  it('refuses a renamed file and reads JSON records', () => {
    const fake = readTable(Buffer.from('not a zip'), 'stock.xlsx');
    assert.equal(fake.ok, false);
    const json = readTable(Buffer.from(JSON.stringify({ data: [{ name: 'A', price: 1 }] })), 'list.json');
    assert.equal(json.ok, true);
    assert.deepEqual(json.columns, ['name', 'price']);
  });

  it('turns Excel serial numbers into dates', () => {
    assert.equal(excelSerialToDate(46022), '2025-12-31');
  });
});

describe('import values', () => {
  it('reads rupees the way people type them', () => {
    assert.equal(toPaisa('Rs 1,250.50'), 125050);
    assert.equal(toPaisa('1250/-'), 125000);
    assert.equal(toPaisa('abc'), null);
  });

  it('reads expiry dates day-first, and month-only as the end of the month', () => {
    assert.equal(toDate('03/12/2026'), '2026-12-03');
    assert.equal(toDate('03/2027', { endOfMonth: true }), '2027-03-31');
    assert.equal(toDate('Feb 2028'), '2028-02-29');
  });

  it('maps columns by name and alias without stealing exact matches', () => {
    const mapping = suggestMapping('medicines', ['Item Name', 'Cost Price', 'MRP']);
    assert.equal(mapping.name, 'Item Name');
    assert.equal(mapping.cost_paisa, 'Cost Price');
    assert.equal(mapping.price_paisa, 'MRP');
  });

  it('reports every problem on a row instead of throwing', () => {
    const context = { medicineIndex: new Map(), existingMedicines: new Set(), supplierIndex: new Map(), invoiceIndex: new Map(), seenNames: new Map(), rowNumber: 2 };
    const result = validateRow('medicines', { N: '', P: 'free' }, { name: 'N', price_paisa: 'P' }, context);
    assert.deepEqual(result.errors.map((error) => error.code).sort(), ['invalid_price', 'missing']);
  });
});

describe('payments', () => {
  it('never moves a succeeded payment anywhere but refunded', () => {
    assert.equal(canMoveTo('succeeded', 'pending'), false);
    assert.equal(canMoveTo('succeeded', 'refunded'), true);
    assert.equal(canMoveTo('pending', 'succeeded'), true);
    assert.equal(canMoveTo('expired', 'succeeded'), false);
  });

  it('converts money without floating-point loss', () => {
    assert.equal(unitsToPaisa('3,900.10'), 390010);
    assert.equal(paisaToUnits(390010), '3900.10');
    assert.equal(unitsToPaisa('12.345'), null);
  });

  it('signs JazzCash requests deterministically and compares in constant time', () => {
    const fields = { pp_Amount: '390000', pp_TxnRefNo: 'KSFPAY-1', pp_Empty: '' };
    const first = jazzcashSignature(fields, 'salt');
    assert.equal(first, jazzcashSignature({ ...fields, pp_SecureHash: 'ignored' }, 'salt'));
    assert.equal(sameSignature(first, first), true);
    assert.equal(sameSignature(first, first.toLowerCase()), false);
  });
});

describe('passwords and two-step sign-in', () => {
  it('hashes, verifies and refuses weak passwords', async () => {
    const stored = await hashPassword('Strong#Pass2026x');
    assert.equal((await verifyPassword('Strong#Pass2026x', stored)).ok, true);
    assert.equal((await verifyPassword('strong#pass2026x', stored)).ok, false);
    assert.ok(passwordProblem('password123'));
    assert.equal(passwordProblem('Strong#Pass2026x'), null);
  });

  it('accepts any password that meets the rules shown beside the field', () => {
    for (const chosen of ['Pakistan@123', 'Pharmacy#2026', 'KhanPharmacy@1']) assert.equal(passwordProblem(chosen), null, chosen);
    assert.match(passwordProblem('Pakistan1234'), /special character/);
    assert.match(passwordProblem('Pak@123'), /at least 12/);
  });

  it('accepts the current authenticator code and nothing else', () => {
    const secret = generateSecret();
    assert.equal(verifyTotp(secret, totpNow(secret)), true);
    assert.equal(verifyTotp(secret, '000000') && totpNow(secret) !== '000000', false);
  });
});

describe('stock rules', () => {
  it('classifies stock and expiry', () => {
    assert.equal(stockState(0, 10), 'out-of-stock');
    assert.equal(stockState(10, 10), 'low-stock');
    assert.equal(stockState(15, 10), 'reorder-soon');
    assert.equal(stockState(50, 10), 'in-stock');
    assert.equal(expiryState('2000-01-01').state, 'expired');
  });

  it('tries the barcode forms a scanner and a spreadsheet produce', () => {
    assert.ok(barcodeVariants('08964000111222').includes('8964000111222'));
    assert.ok(barcodeVariants('896400011122').includes('0896400011122'));
  });

  it('names role groups in plain English', () => {
    assert.equal(plural('Cashier'), 'Cashiers');
    assert.equal(plural('Pharmacy'), 'Pharmacies');
  });
});

describe('roles and themes', () => {
  it('gives the pharmacy Admin every permission and has no separate owner role', () => {
    const admin = SYSTEM_ROLES.find((role) => role.key === PHARMACY_ADMIN_ROLE);
    assert.deepEqual([...admin.permissions].sort(), [...PERMISSION_KEYS].sort());
    assert.equal(SYSTEM_ROLES.some((role) => role.key === 'owner'), false);
  });

  it('only grants permissions that exist, and ranks roles strictly', () => {
    for (const role of SYSTEM_ROLES) for (const key of role.permissions) assert.ok(PERMISSION_KEYS.includes(key), `${role.key}: ${key}`);
    const levels = SYSTEM_ROLES.map((role) => role.level);
    assert.deepEqual(levels, [...levels].sort((a, b) => b - a));
  });

  it('offers exactly five themes with the original green first', () => {
    assert.equal(THEMES.length, 5);
    assert.equal(THEMES[0].key, 'ksf-green');
  });
});

describe('deployment settings', () => {
  it('reads TRUST_PROXY as Express expects it', () => {
    assert.equal(trustProxySetting('1'), 1);
    assert.equal(trustProxySetting(' 2 '), 2);
    assert.equal(trustProxySetting('true'), true);
    assert.equal(trustProxySetting('false'), false);
    assert.equal(trustProxySetting('loopback'), 'loopback');
    assert.equal(trustProxySetting('loopback, 10.0.0.1'), 'loopback, 10.0.0.1');
  });

  it('allows the address people open KSF at', () => {
    assert.ok(ALLOWED_ORIGINS.has(new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:5180').origin));
  });

  it('allows every Vercel deployment address of one project, and nobody else', () => {
    const allowed = originMatcher(['https://ksf-x86j.vercel.app', 'https://ksf-x86j-*-ssam1.vercel.app']);
    assert.equal(allowed('https://ksf-x86j.vercel.app'), true);
    assert.equal(allowed('https://ksf-x86j-suicpihss-ssam1.vercel.app'), true);
    assert.equal(allowed('https://ksf-x86j-iv4iykmwl-ssam1.vercel.app'), true);
    assert.equal(allowed('https://ksf-x86j-abc-evil-ssam1.vercel.app'), false);
    assert.equal(allowed('https://ksf-x86j-abc-ssam1.vercel.app.evil.com'), false);
    assert.equal(allowed('https://evil.com/?https://ksf-x86j-abc-ssam1.vercel.app'), false);
    assert.equal(allowed('http://ksf-x86j-abc-ssam1.vercel.app'), false);
    assert.equal(allowed('https://ksf-x86jx-abc-ssam1.vercel.app'), false);
  });

  it('explains an Atlas IP Access List refusal', () => {
    const error = Object.assign(new Error('40427917037F0000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:1601:SSL alert number 80'), { name: 'MongoServerSelectionError' });
    assert.match(databaseHint(error).join(' '), /Network Access/);
    assert.match(databaseHint(new Error('bad auth : authentication failed')).join(' '), /password/);
    assert.match(databaseHint(new Error('querySrv ENOTFOUND _mongodb._tcp.x')).join(' '), /MONGODB_URI/);
    assert.deepEqual(databaseHint(new Error('something else')), []);
  });
});
