/* Loaded before every test file (node --import ./tests/setup.mjs).

   Tests never read the project's .env: a test run must not depend on, or
   write to, the database the pharmacy is using. The settings below are the
   whole configuration of a test run.

   The API suite needs a MongoDB server. It uses TEST_MONGODB_URI when set,
   otherwise the MONGODB_URI from .env — but always in a database of its own
   (ksf_test_<random>) that is dropped when the suite finishes. */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

function uriFromDotEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return '';
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((row) => row.startsWith('MONGODB_URI='));
  return line ? line.slice('MONGODB_URI='.length).trim().replace(/^["']|["']$/g, '') : '';
}

const uri = process.env.TEST_MONGODB_URI || uriFromDotEnv();
const usable = /^mongodb(\+srv)?:\/\//.test(uri);

Object.assign(process.env, {
  NODE_ENV: 'test',
  KSF_ENV_FILE: join(root, 'tests', '.no-env-file'),
  KSF_TEST_DATABASE: usable ? 'yes' : 'no',
  MONGODB_URI: usable ? uri : 'mongodb://127.0.0.1:27017/',
  MONGODB_DB: `ksf_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-0123456789',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-0123456789',
  SUPER_ADMIN_NAME: 'Test Super Admin',
  SUPER_ADMIN_EMAIL: 'superadmin@ksf.test',
  SUPER_ADMIN_PASSWORD: 'Platform#Owner2026',
  MAIL_TRANSPORT: 'file',
  MAIL_OUTBOX: '.data/test-outbox',
  PASSWORD_SCRYPT_N: '16384',
  PUBLIC_APP_URL: 'http://localhost:5180',
  PUBLIC_ALLOWED_ORIGINS: 'http://localhost:5180',
  /* Tests never reach the internet; scanning.test.mjs answers for the product databases itself. */
  BARCODE_LOOKUP_ONLINE: 'false'
});
