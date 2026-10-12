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
const { trustProxySetting, ALLOWED_ORIGINS, originMatcher, originAllowed } = await import('../backend/src/config/env.ts');
const { databaseHint } = await import('../backend/src/db/mongo.ts');
const { formEncode, verifyStripeSignature, parseStripeEvent, sessionOutcome } = await import('../backend/src/services/payments/stripe.ts');
const { concerns } = await import('../backend/src/services/live.ts');
const { createHmac } = await import('node:crypto');
const { readFileSync } = await import('node:fs');
const { PLATFORM_PERMISSION_KEYS, TEAM_MANAGE } = await import('../backend/src/domain/platform.ts');
const calc = await import('../frontend/src/utils/calculator.ts');
const { compareVersions } = await import('../frontend/src/utils/version.ts');

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

  it('takes the browser\'s same-origin mark from any address, and refuses other sites', () => {
    const railway = 'ksf-production-9911.up.railway.app';
    assert.equal(originAllowed('https://ksf-x86j-anything-ssam1.vercel.app', railway, 'same-origin'), true);
    assert.equal(originAllowed('https://pharmacy.example.pk', railway, 'same-origin'), true);
    assert.equal(originAllowed('https://evil.example', railway, 'cross-site'), false);
    assert.equal(originAllowed('https://evil.example', railway, 'same-site'), false);
    assert.equal(originAllowed('https://evil.example', railway, undefined), false);
  });

  it('explains an Atlas IP Access List refusal', () => {
    const error = Object.assign(new Error('40427917037F0000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:1601:SSL alert number 80'), { name: 'MongoServerSelectionError' });
    assert.match(databaseHint(error).join(' '), /Network Access/);
    assert.match(databaseHint(new Error('bad auth : authentication failed')).join(' '), /password/);
    assert.match(databaseHint(new Error('querySrv ENOTFOUND _mongodb._tcp.x')).join(' '), /MONGODB_URI/);
    assert.deepEqual(databaseHint(new Error('something else')), []);
  });
});

describe('the platform team', () => {
  it('keeps only grantable permissions, with what they depend on', async () => {
    const { normalisePlatformPermissions, TEAM_MANAGE } = await import('../backend/src/domain/platform.ts');
    assert.deepEqual(normalisePlatformPermissions(['platform.finance.manage', 'staff.manage', TEAM_MANAGE, 'nonsense']), ['platform.finance.view', 'platform.finance.manage']);
    assert.deepEqual(normalisePlatformPermissions('platform.support'), []);
  });

  it('lets the Super Admin do anything and a member only what the role holds', async () => {
    const { platformAllows } = await import('../backend/src/domain/platform.ts');
    const owner = { isPlatformAdmin: true, isPlatformStaff: false, platformPermissions: new Set() };
    const desk = { isPlatformAdmin: false, isPlatformStaff: true, platformPermissions: new Set(['platform.support']) };
    const pharmacy = { isPlatformAdmin: false, isPlatformStaff: false, platformPermissions: new Set(['platform.support']) };
    assert.equal(platformAllows(owner, 'owner'), true);
    assert.equal(platformAllows(desk, 'owner'), false);
    assert.equal(platformAllows(desk, 'any'), true);
    assert.equal(platformAllows(desk, 'platform.support'), true);
    assert.equal(platformAllows(desk, ['platform.help', 'platform.support']), true);
    assert.equal(platformAllows(desk, 'platform.finance.view'), false);
    assert.equal(platformAllows(pharmacy, 'any'), false);
  });

  it('accepts a real photo and refuses anything pretending to be one', async () => {
    const { readImage } = await import('../backend/src/services/avatars.ts');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    assert.equal(readImage(png).type, 'image/png');
    assert.equal(readImage(png.replace('image/png', 'image/jpeg')).type, 'image/png');
    assert.throws(() => readImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='));
    assert.throws(() => readImage('data:image/png;base64,PHN2Zz48L3N2Zz4='));
    assert.throws(() => readImage(`data:image/jpeg;base64,${'A'.repeat(500_000)}`));
  });
});

describe('Stripe', () => {
  const secret = 'whsec_unit';
  const sign = (raw, at) => `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex')}`;
  const now = 1_790_000_000;

  it("encodes nested parameters the way Stripe's API expects", () => {
    const encoded = formEncode({ mode: 'subscription', line_items: [{ quantity: 1, price_data: { unit_amount: 390000, recurring: { interval: 'month' } } }], skip: undefined, flag: false });
    assert.equal(encoded.get('line_items[0][price_data][unit_amount]'), '390000');
    assert.equal(encoded.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(encoded.get('flag'), 'false');
    assert.equal(encoded.has('skip'), false);
  });

  it('accepts a correctly signed event and refuses a forged, rolled or stale one', () => {
    const raw = '{"id":"evt_1","type":"invoice.paid"}';
    assert.equal(verifyStripeSignature(raw, sign(raw, now), secret, now).ok, true);
    /* While a secret is rolled Stripe sends two signatures; either may match. */
    assert.equal(verifyStripeSignature(raw, `t=${now},v1=${'0'.repeat(64)},${sign(raw, now).split(',')[1]}`, secret, now).ok, true);
    assert.equal(verifyStripeSignature(raw.replace('paid', 'void'), sign(raw, now), secret, now).ok, false);
    assert.equal(verifyStripeSignature(raw, sign(raw, now - 301), secret, now).ok, false);
    assert.equal(verifyStripeSignature(raw, 'v1=abc', secret, now).ok, false);
  });

  it('reads a paid Checkout session as a payment against its reference and invoice', () => {
    const outcome = sessionOutcome({ id: 'cs_1', client_reference_id: 'KSFPAY-1', status: 'complete', payment_status: 'paid', amount_total: 390000, currency: 'pkr', invoice: 'in_1', subscription: { id: 'sub_1' }, customer: 'cus_1' });
    assert.equal(outcome.status, 'succeeded');
    assert.equal(outcome.providerReference, 'in_1');
    assert.equal(outcome.currency, 'PKR');
    assert.deepEqual(outcome.recurring, { subscriptionId: 'sub_1', customerId: 'cus_1' });
    assert.equal(sessionOutcome({ id: 'cs_2', status: 'open', payment_status: 'unpaid', invoice: 'in_2' }).providerReference, 'cs_2');
  });

  it('tells renewals from first payments, in either invoice shape', () => {
    const event = (object, type = 'invoice.paid') => {
      const raw = JSON.stringify({ id: 'evt_2', type, data: { object } });
      return parseStripeEvent(raw, sign(raw, now), secret, now);
    };
    assert.equal(event({ id: 'in_1', subscription: 'sub_1', billing_reason: 'subscription_create' }).kind, 'ignored');
    const renewal = event({ id: 'in_2', parent: { subscription_details: { subscription: 'sub_1' } }, billing_reason: 'subscription_cycle', amount_paid: 390000, currency: 'pkr' });
    assert.equal(renewal.kind, 'renewal');
    assert.equal(renewal.subscriptionId, 'sub_1');
    assert.equal(renewal.amountPaisa, 390000);
    assert.equal(event({ id: 'in_3', subscription: 'sub_1', billing_reason: 'subscription_cycle', amount_due: 390000 }, 'invoice.payment_failed').paid, false);
    assert.equal(event({ id: 'sub_1', cancel_at_period_end: true, status: 'active' }, 'customer.subscription.updated').renews, false);
  });
});

describe('live updates', () => {
  it("sends plan changes to everyone and a subscription only to its pharmacy and the platform team", () => {
    const plans = { type: 'plans.changed' };
    const mine = { type: 'subscription.changed', pharmacyId: 'PH-1' };
    assert.equal(concerns({ pharmacyId: null, platform: false }, plans), true);
    assert.equal(concerns({ pharmacyId: null, platform: false }, mine), false);
    assert.equal(concerns({ pharmacyId: 'PH-1', platform: false }, mine), true);
    assert.equal(concerns({ pharmacyId: 'PH-2', platform: false }, mine), false);
    assert.equal(concerns({ pharmacyId: null, platform: true }, mine), true);
  });
});

describe('screens and their guards', () => {
  const app = readFileSync(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
  const signedIn = app.slice(app.indexOf('function Protected()'), app.indexOf('function NotFound'));
  const screens = [...signedIn.matchAll(/<Route path="([^"]+)" element=\{(<Guard permission="([^"]+)">)?/g)]
    .map(([, path, guarded, permission]) => ({ path, guarded: !!guarded, permission }));

  it('puts every signed-in screen behind a permission, except the ones everybody has', () => {
    /* Open to everybody signed in: their own account and notices, the
       directory, setup, and the redirects. */
    const open = new Set(['/', '/login', '/register', '/forgot-password', '/subscription', '/setup', '/notifications', '/account', '*',
      '/platform/*', '/platform/notifications', '/directory', '/directory/:id', '/platform/directory', '/platform/directory/:id']);
    assert.ok(screens.length > 40);
    assert.deepEqual(screens.filter((screen) => !screen.guarded && !open.has(screen.path)).map((screen) => screen.path), []);
  });

  it('guards each screen with a permission that exists', () => {
    const known = new Set([...PERMISSION_KEYS, ...PLATFORM_PERMISSION_KEYS, TEAM_MANAGE]);
    assert.deepEqual(screens.filter((screen) => screen.guarded && !known.has(screen.permission)).map((screen) => `${screen.path}: ${screen.permission}`), []);
  });
});

describe('the REST API reference in README.md', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const listed = new Set([...readme.matchAll(/^\| `(GET|POST|PATCH|PUT|DELETE) (\/api\/v1\/[^`]*)` \|/gm)].map(([, method, path]) => `${method} ${path}`));

  it('lists every route the server registers, and nothing it does not', async () => {
    await import('../backend/src/modules/index.ts');
    const { routes } = await import('../backend/src/http/router.ts');
    const registered = new Set([...routes.map((route) => `${route.method} ${route.path}`), 'GET /api/v1/health', 'GET /api/v1/avatars/:id']);
    assert.deepEqual([...registered].filter((key) => !listed.has(key)), [], 'routes missing from README.md');
    assert.deepEqual([...listed].filter((key) => !registered.has(key)), [], 'README.md lists routes that do not exist');
  });
});

describe('the counter calculator', () => {
  /** Press keys as a person would, e.g. "1250×3+18%=", and read the display. */
  const run = (keys) => {
    let state = calc.initialCalc;
    for (const key of keys) state = calc.press(state, calc.keyAction(key) ?? key).state;
    return calc.displayValue(state);
  };
  const plain = (value) => calc.toPlain(value);

  it('adds money exactly, where floating point would not', () => {
    assert.equal(plain(calc.add(calc.dec('0.1'), calc.dec('0.2'))), '0.3');
    assert.equal(plain(calc.mul(calc.dec('1.15'), calc.dec(100))), '115');
    assert.equal(run('0.1+0.2='), '0.3');
  });

  it('multiplies and divides before it adds and subtracts', () => {
    assert.equal(run('2+3*4='), '14');
    assert.equal(run('100-20/4='), '95');
    assert.equal(run('1250*3+675='), '4,425');
  });

  it('works out percentages the way a shop calculator does', () => {
    assert.equal(run('200+10%='), '220');
    assert.equal(run('200*10%='), '20');
    assert.equal(run('1250*3+18%='), '4,425');
    assert.equal(run('500-20%='), '400');
  });

  it('rounds a recurring division and refuses division by zero', () => {
    assert.match(run('10/3='), /^3\.3333333333/);
    assert.equal(run('2/3*3='), '2');
    assert.throws(() => calc.div(calc.dec(1), calc.ZERO), calc.DivisionByZero);
    assert.notEqual(run('5/0='), '0');
  });

  it('carries a result into the next sum, and corrects a mistyped operator', () => {
    assert.equal(run('12+3=*2='), '30');
    assert.equal(run('9+*2='), '18');
  });

  it('gets the pharmacy tools right to the paisa', () => {
    const discount = calc.discountTool('35', '10', '3');
    assert.deepEqual([plain(discount.gross), plain(discount.discount), plain(discount.payable)], ['105', '10.5', '94.5']);
    const added = calc.taxTool('1000', '17', false);
    assert.deepEqual([plain(added.net), plain(added.tax), plain(added.gross)], ['1000', '170', '1170']);
    const inside = calc.taxTool('1170', '17', true);
    assert.deepEqual([plain(inside.net), plain(inside.tax)], ['1000', '170']);
    const margin = calc.marginTool('80', '100');
    assert.deepEqual([plain(margin.profit), plain(margin.margin), plain(margin.markup)], ['20', '20', '25']);
    assert.deepEqual(Object.values(calc.changeTool('450', '500')).map(plain), ['50', '0']);
    assert.deepEqual(Object.values(calc.changeTool('500', '450')).map(plain), ['0', '50']);
    const unit = calc.unitTool('120', '10', '3');
    assert.deepEqual([plain(unit.perUnit), plain(unit.total)], ['12', '36']);
    assert.equal(calc.unitTool('120', '0', '3'), null);
    assert.equal(calc.discountTool('abc', '10', '1'), null);
  });

  it('reads typed amounts with commas and a rupee prefix, and refuses nonsense', () => {
    assert.equal(plain(calc.parseDec('Rs 1,250.75')), '1250.75');
    assert.equal(calc.parseDec('12.3.4'), null);
    assert.equal(calc.keyAction('Enter'), '=');
    assert.equal(calc.keyAction('x'), '×');
    assert.equal(calc.keyAction('a'), null);
  });
});

describe('the version check', () => {
  it('orders releases by number, not by text', () => {
    assert.ok(compareVersions('2.10.0', '2.9.1') > 0);
    assert.ok(compareVersions('2.1.0', '2.2.1') < 0);
    assert.equal(compareVersions('2.2.1', '2.2.1'), 0);
    assert.equal(compareVersions('2.2', '2.2.0'), 0);
  });
});
