/* ==========================================================================
   npm run seed:demo
   --------------------------------------------------------------------------
   Fills an EMPTY database with one demonstration pharmacy, for the
   university edition: an Admin and one person in each built-in role, a
   catalogue taken from the medicine directory, a supplier delivery, sales,
   customers on credit, a prescription, expenses, other income and a month's
   salaries — so whoever marks the project can sign in and see every screen
   working.

   It goes through the real API, in this process, exactly as a browser does,
   so every rule (stock, batches, permissions, totals, the audit trail) is
   applied as in real use. It refuses to run outside the university edition,
   and on a database that already holds a pharmacy.
   ========================================================================== */

process.env.SHOW_SIGNUP_CODE = 'true';

const { env, IS_PROD } = await import('../config/env.js');
const { col, connect, disconnect } = await import('../db/mongo.js');
const { bootstrap } = await import('../db/bootstrap.js');
await import('../modules/index.js');
const { createApp } = await import('../http/app.js');

const DEMO_PASSWORD = 'Demo#Pass2026';
const ADMIN_EMAIL = 'admin@demo.ksf';
const ROLES: Array<[string, string, string]> = [
  ['regional-manager', 'Rabia Regional', 'regional@demo.ksf'],
  ['manager', 'Kamran Manager', 'manager@demo.ksf'],
  ['pharmacist', 'Dr Sana Pharmacist', 'pharmacist@demo.ksf'],
  ['cashier', 'Usman Cashier', 'cashier@demo.ksf']
];

/** A small client for the in-process API, with the cookie jar sign-up needs. */
function client(base: string) {
  let token = '';
  const jar = new Map<string, string>();
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const json = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) throw new Error(`${method} ${path}: ${json.message ?? response.status}`);
    return json as T;
  };
  return {
    get: <T = any>(path: string) => call<T>('GET', path),
    post: <T = any>(path: string, body: unknown = {}) => call<T>('POST', path, body),
    useToken: (value: string) => { token = value; }
  };
}

/* Prices that look like a shop's, from the same inputs every run. */
const price = (index: number) => 2_500 + ((index * 7_919) % 45_000);

async function main(): Promise<number> {
  if (env.KSF_EDITION !== 'university' && !process.argv.includes('--force')) {
    console.error('\n FIX seed:demo is for the university edition (KSF_EDITION=university). It never runs against the live service.\n');
    return 1;
  }
  if (IS_PROD) { console.error('\n FIX NODE_ENV is production. Demo data does not belong there.\n'); return 1; }

  await connect();
  await bootstrap({ silent: true });
  if (await col.pharmacies().countDocuments({}) > 0) {
    console.error(`\n FIX The database "${env.MONGODB_DB}" already holds a pharmacy. Run npm run db:reset -- --yes first, then this again.\n`);
    return 1;
  }

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const admin = client(base);
    const started = await admin.post('/register/start', { firstName: 'Ayesha', lastName: 'Admin', email: ADMIN_EMAIL, password: DEMO_PASSWORD, mobile: '0300 1234567' });
    const signedUp = await admin.post('/register/verify-email', { code: started.data.testCode });
    admin.useToken(signedUp.accessToken);
    const pharmacyId: string = signedUp.data.pharmacyId;
    await admin.post('/setup/pharmacy', { name: 'University Demo Pharmacy', type: 'retail' });
    await admin.post('/setup/address', { address: 'Shop 7, University Road', city: 'Karachi', province: 'Sindh', phone: '021 34567890' });

    /* Every feature on, so every screen can be seen. */
    const platform = client(base);
    platform.useToken((await platform.post('/auth/login', { email: env.SUPER_ADMIN_EMAIL, password: env.SUPER_ADMIN_PASSWORD })).accessToken);
    await platform.post(`/platform/pharmacies/${pharmacyId}/subscription`, { planKey: 'annual', note: 'University demonstration' });

    const roles = (await admin.get('/roles')).data as Array<{ id: string; key: string }>;
    for (const [key, name, email] of ROLES) {
      await admin.post('/staff', {
        fullName: name, email, roleId: roles.find((role) => role.key === key)!.id, password: DEMO_PASSWORD,
        ...(key === 'pharmacist' ? { pharmacistRegNo: 'PCP-DEMO-2026' } : {})
      });
    }
    /* Demo accounts sign straight in with the password above; a real
       pharmacy's new staff are asked to choose their own. */
    await col.users().updateMany({ pharmacy_id: pharmacyId }, { $set: { must_change_password: 0 } });

    /* The catalogue, from the medicine directory's branded entries. */
    const directory = (await admin.get('/medicine-directory?size=60')).data as Array<{ id: string; name: string; category: string; brands: Array<{ name: string; manufacturer: string | null }>; forms: string[]; prescription: string }>;
    const categories = new Map<string, string>();
    const medicines: Array<{ id: string; cost: number; price: number; otc: boolean }> = [];
    for (const [index, entry] of directory.filter((row) => row.brands.length).slice(0, 18).entries()) {
      if (!categories.has(entry.category)) categories.set(entry.category, (await admin.post('/categories', { name: entry.category })).data.id);
      const [form = 'Tablet', ...strength] = (entry.forms[0] ?? 'Tablet').split(' ');
      const sell = price(index);
      const created = await admin.post('/medicines', {
        name: `${entry.brands[0].name} ${strength.join(' ')}`.trim(), genericName: entry.name, manufacturer: entry.brands[0].manufacturer,
        form, strength: strength.join(' ') || null, categoryId: categories.get(entry.category), pricePaisa: sell, costPaisa: Math.round(sell * 0.78),
        minStock: 20, requiresPrescription: entry.prescription !== 'otc'
      });
      medicines.push({ id: created.data.id, cost: Math.round(sell * 0.78), price: sell, otc: entry.prescription === 'otc' });
    }

    const supplier = (await admin.post('/suppliers', { name: 'Karachi Medical Distributors', phone: '0300 7654321', city: 'Karachi' })).data.id;
    const expiry = new Date(Date.now() + 540 * 86_400_000).toISOString().slice(0, 10);
    await admin.post('/purchases', {
      supplierId: supplier, receiveNow: true, markPaid: true, paymentMethod: 'bank-transfer', paymentReference: 'IBFT-DEMO-1',
      items: medicines.map((medicine, index) => ({ medicineId: medicine.id, quantity: 120, costPaisa: medicine.cost, pricePaisa: medicine.price, batchNo: `DEMO-${100 + index}`, expiryDate: expiry }))
    });

    const customers: string[] = [];
    for (const [name, phone] of [['Bilal Ahmed', '0301 2223344'], ['Nadia Hussain', '0302 3334455'], ['Imran Siddiqui', '0303 4445566']]) {
      customers.push((await admin.post('/customers', { name, phone })).data.id);
    }
    /* The till sells prescription-only medicine against a verified
       prescription only, so the walk-in sales are over-the-counter lines. */
    const counter = medicines.filter((medicine) => medicine.otc);
    for (let sale = 0; sale < 24; sale += 1) {
      const lines = [...new Set([counter[sale % counter.length], counter[(sale * 5 + 3) % counter.length]])];
      await admin.post('/sales', {
        items: lines.map((medicine, line) => ({ medicineId: medicine.id, quantity: 1 + ((sale + line) % 3) })),
        paymentMethod: sale % 6 === 0 ? 'credit' : sale % 3 === 0 ? 'card' : 'cash', paidPaisa: 1_000_000,
        ...(sale % 6 === 0 ? { customerId: customers[sale % customers.length] } : {})
      });
    }
    await admin.post(`/customers/${customers[0]}/payments`, { amountPaisa: 1_000 });
    await admin.post('/prescriptions', {
      patientName: 'Nadia Hussain', doctorName: 'Dr Faisal Qureshi', customerId: customers[1],
      items: [{ medicineId: medicines[1].id, medicineText: 'As prescribed', quantity: 1, dosage: 'One twice a day', duration: '5 days' }]
    });

    await admin.post('/expenses', { category: 'Rent', description: 'Shop rent', amountPaisa: 6_000_000, vendor: 'Landlord' });
    await admin.post('/expenses', { category: 'Electricity (K-Electric)', description: 'K-Electric bill', amountPaisa: 1_850_000, vendor: 'K-Electric' });
    await admin.post('/accounting/income', { category: 'Supplier bonus or rebate', description: 'Quarterly volume bonus', amountPaisa: 750_000, payer: 'Karachi Medical Distributors', paymentMethod: 'cheque' });
    const month = new Date().toISOString().slice(0, 7);
    const payees = (await admin.get('/accounting/salaries/payees')).data as Array<{ id: string; name: string }>;
    for (const [index, person] of payees.filter((row) => row.name !== 'Ayesha Admin').entries()) {
      await admin.post('/accounting/salaries', { staffId: person.id, period: month, basicPaisa: 3_500_000 + index * 500_000, allowancesPaisa: 250_000, paymentMethod: 'bank-transfer' });
    }

    console.log('\n  ok  University Demo Pharmacy is ready.\n');
    console.log(`      Sign in at ${env.PUBLIC_APP_URL} with any of these (password ${DEMO_PASSWORD}):\n`);
    console.log(`        Admin              ${ADMIN_EMAIL}`);
    for (const [key, , email] of ROLES) console.log(`        ${key.padEnd(18)} ${email}`);
    console.log(`\n      The platform Super Admin is ${env.SUPER_ADMIN_EMAIL} (password from .env).\n`);
    return 0;
  } finally {
    server.close();
  }
}

main()
  .then(async (code) => { await disconnect(); process.exit(code); })
  .catch(async (error) => { console.error(`\n FIX ${(error as Error).message}\n`); await disconnect(); process.exit(1); });
