/* ==========================================================================
   npm run secrets            print fresh secrets
   npm run secrets -- --write put them into .env
   --------------------------------------------------------------------------
   The JWT signing secrets must be long, random, different from each other
   and never shared with another installation. This prints a set; with
   --write it replaces the JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and
   PAYMENT_WEBHOOK_SECRET lines in .env and leaves every other line alone.

   Changing the JWT secrets signs everybody out — which is exactly what you
   want if you think one has leaked.
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const fresh = (bytes = 48): string => randomBytes(bytes).toString('base64url');

const secrets: Record<string, string> = {
  JWT_ACCESS_SECRET: fresh(),
  JWT_REFRESH_SECRET: fresh(),
  PAYMENT_WEBHOOK_SECRET: fresh(32)
};

if (!process.argv.includes('--write')) {
  console.log('\n  Copy these into .env (or run "npm run secrets -- --write"):\n');
  for (const [key, value] of Object.entries(secrets)) console.log(`  ${key}=${value}`);
  console.log('');
} else {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) {
    console.error('\n FIX There is no .env yet. Copy .env.example to .env first.\n');
    process.exit(1);
  }
  let text = readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(secrets)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  writeFileSync(file, text);
  console.log('\n  ok  New secrets written to .env. Restart the server; everybody will need to sign in again.\n');
}
