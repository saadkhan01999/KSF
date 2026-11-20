/* ==========================================================================
   npm run deploy:check — is this server ready to go live?
   --------------------------------------------------------------------------
   Run on the Hostinger server before opening the doors, and after every
   change to deploy/.env:

     ksf run --rm app node backend/dist/cli/preflight.js

   It reads the settings the server will start with and says, line by line,
   what is ready, what must be fixed (FIX) and what is worth a look (NOTE):
   the address and HTTPS, the sign-in secrets, the database and its
   transactions, the Super Admin, e-mail, sign-up codes, and every way of
   taking a subscription payment — with the webhook and return addresses to
   register for each. Changes nothing; prints setting names, never values.
   Exits 1 when anything must be fixed, so a deploy script can stop on it.
   ========================================================================== */

import { CONFIG_PROBLEMS, IS_PROD, VERSION, env } from '../config/env.js';
import { connect, db, disconnect, supportsTransactions } from '../db/mongo.js';
import { mailTransport } from '../services/mailer.js';
import { providerSetup } from '../services/payments/index.js';

let fixes = 0;
let notes = 0;
const ok = (text: string) => console.log(`  ok   ${text}`);
const fix = (text: string, how?: string) => { fixes += 1; console.log(`  FIX  ${text}${how ? `\n       ${how}` : ''}`); };
const note = (text: string, how?: string) => { notes += 1; console.log(`  NOTE ${text}${how ? `\n       ${how}` : ''}`); };
const section = (title: string) => console.log(`\n${title}`);

async function main(): Promise<number> {
  console.log(`\nKSF ${VERSION} — ready to go live?${IS_PROD ? '' : '  (NODE_ENV is not production: the Docker stack sets it)'}`);

  section('The address');
  let origin = '';
  try { origin = new URL(env.PUBLIC_APP_URL).origin; } catch { /* reported below */ }
  if (!origin) fix(`PUBLIC_APP_URL is not an address: "${env.PUBLIC_APP_URL}"`, 'Set it to https://<your domain>, for example https://ksfpharmacy.com');
  else if (!origin.startsWith('https://')) fix(`PUBLIC_APP_URL is not HTTPS (${origin})`, 'Pharmacies sign in here: use https://<your domain> once the certificate is in place (guide Part 8).');
  else if (/localhost|127\.0\.0\.1/.test(origin)) fix(`PUBLIC_APP_URL still points at this computer (${origin})`);
  else ok(`Website and links in e-mails: ${origin}`);
  const allowed = env.PUBLIC_ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) fix(`PUBLIC_ALLOWED_ORIGINS does not include ${origin}`, `Add it: PUBLIC_ALLOWED_ORIGINS=${origin},${origin.replace('https://', 'https://www.')}`);
  else if (origin) ok(`Sign-up and sign-in accepted from: ${allowed.join(', ')}`);
  if (IS_PROD && !env.COOKIE_SECURE) fix('COOKIE_SECURE is off in production', 'The Docker stack turns it on; set COOKIE_SECURE=true if you run without it.');

  section('Sign-in secrets');
  if (CONFIG_PROBLEMS.length) for (const problem of CONFIG_PROBLEMS) fix(problem, 'Make new ones with: openssl rand -base64 48');
  else if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) fix('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are the same', 'They must be two different random values.');
  else ok('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are set, long enough and different');

  section('The database');
  try {
    await connect();
    const info = await db().admin().command({ buildInfo: 1 }).catch(() => ({ version: 'unknown' }));
    ok(`Connected to MongoDB ${info.version}, database "${env.MONGODB_DB}"`);
    if (supportsTransactions()) ok('Transactions available (replica set or Atlas): sales, stock and payments are all-or-nothing');
    else fix('Transactions are not available: MongoDB is a single standalone server', 'Use the bundled replica set (--profile local-db) or MongoDB Atlas.');
    const [plans, owner] = await Promise.all([
      db().collection('subscription_plans').countDocuments(),
      db().collection('users').countDocuments({ is_platform_admin: 1 })
    ]);
    if (plans) ok(`${plans} subscription plans in place`);
    else note('No subscription plans yet', 'The server creates them when it first starts (ksf up -d).');
    if (owner) ok('The platform Super Admin exists');
    else if (env.SUPER_ADMIN_EMAIL && env.SUPER_ADMIN_PASSWORD) note('The Super Admin will be created when the server starts, from SUPER_ADMIN_EMAIL');
    else fix('No Super Admin, and SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD are not set', 'Set both in deploy/.env (guide Part 5), then start the server.');
  } catch (error) {
    fix(`Could not connect to MongoDB: ${(error as Error).message}`, 'Check MONGODB_URI; with Atlas, allow this server\'s IP under Network Access.');
  }

  section('E-mail (sign-up codes, password resets, receipts of payment)');
  const transport = mailTransport();
  if (transport === 'smtp') {
    if (!env.MAIL_HOST) fix('MAIL_TRANSPORT is smtp but MAIL_HOST is empty', 'Hostinger Business Email: MAIL_HOST=smtp.hostinger.com, MAIL_PORT=465, MAIL_SECURE=true');
    else ok(`Sent through ${env.MAIL_HOST}`);
  } else if (IS_PROD) fix(`MAIL_TRANSPORT is "${transport}": nobody receives a sign-up code`, 'Set MAIL_TRANSPORT=smtp and the MAIL_* lines (guide Part 5).');
  else note(`MAIL_TRANSPORT is "${transport}" (fine for trying it out, not for real pharmacies)`);
  if (env.SHOW_SIGNUP_CODE) fix('SHOW_SIGNUP_CODE is on: anyone can sign up with an address they do not own', 'Set SHOW_SIGNUP_CODE=false.');
  else ok('Sign-up codes are only e-mailed');

  section('Subscription payments (docs/PAYMENTS.md)');
  const providers = providerSetup();
  const live = providers.filter((provider) => provider.configured);
  if (!live.length) fix('No way to pay is set up: pharmacies cannot pay for Pro or Diamond Annual', 'Fill in at least the bank details (BANK_ACCOUNT_TITLE, BANK_ACCOUNT_NUMBER, BANK_NAME, BANK_IBAN).');
  for (const provider of providers) {
    if (provider.configured) {
      const mode = provider.mode === 'live' || provider.mode === 'manual' ? provider.mode : `${provider.mode ?? 'sandbox'} mode`;
      ok(`${provider.label}: switched on (${mode})${provider.verified ? '' : ' — not yet marked verified'}`);
      if (provider.webhookUrl) console.log(`       webhook to register with ${provider.label}: ${provider.webhookUrl}`);
      if (provider.returnUrl) console.log(`       return address:                     ${provider.returnUrl}`);
      if (!provider.verified && provider.key !== 'bank-transfer' && provider.key !== 'stripe') {
        note(`${provider.label} has not been run against its sandbox here`, `Run the sandbox cases in docs/PAYMENTS.md §6, then set ${provider.key.toUpperCase()}_VERIFIED=true.`);
      }
    } else {
      console.log(`  off  ${provider.label}: needs ${provider.missing.join(', ')}`);
    }
  }

  section('Your business, on the website and invoices');
  if (env.BUSINESS_LEGAL_NAME) ok(`Legal name: ${env.BUSINESS_LEGAL_NAME}`);
  else note('BUSINESS_LEGAL_NAME is empty: the website footer and the terms show the product name instead');
  if (env.SUPPORT_EMAIL) ok(`Support e-mail: ${env.SUPPORT_EMAIL}`);
  else note('SUPPORT_EMAIL is empty: the website has no address to write to');
  if (env.SALES_PHONE || env.BUSINESS_PHONE) ok(`Number for the annual plan: ${env.SALES_PHONE || env.BUSINESS_PHONE}`);

  console.log(`\n${fixes ? `${fixes} thing(s) to fix before going live` : 'Ready to go live'}${notes ? `, ${notes} note(s) worth a look` : ''}.\n`);
  await disconnect().catch(() => undefined);
  return fixes ? 1 : 0;
}

main().then((code) => process.exit(code), (error) => {
  console.error(error);
  process.exit(1);
});
