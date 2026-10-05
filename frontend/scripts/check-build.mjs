/* ==========================================================================
   Is what was just built fit to ship?
   --------------------------------------------------------------------------
   Runs automatically at the end of `npm run build`. It is not a test suite —
   it is the last gate before a folder gets copied onto a pharmacy's computer,
   and it fails the build rather than printing a warning nobody reads.

   Why it exists: `npm run build` was quietly producing a **development build
   of React**. Vite treats NODE_ENV inside a .env file as authoritative, the
   shipped `.env.example` sets it to `development` — correctly, for a developer
   on their own machine — and Vite was reading the server's .env. The bundle
   was twice the size, slower, and printed development warnings to a cashier's
   console. Nothing failed. It was found by building the release archive, where
   there is no .env, and noticing the bundle came out half the size.

   The cause is fixed in vite.config.ts. This makes sure it stays fixed, and
   catches the two other ways a build goes out wrong.
   ========================================================================== */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Anchored to the project root, like the server's own STATIC_FOLDER. */
const DIST = resolve(fileURLToPath(new URL('../..', import.meta.url)), process.env.STATIC_DIR || 'frontend/dist');
const ASSETS = join(DIST, 'assets');

let failed = 0;
const say = (ok, what, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

console.log('\nChecking the build\n');

if (!existsSync(ASSETS)) {
  console.error(`  There is nothing in ${DIST}. The build did not produce anything.\n`);
  process.exit(1);
}

const files = readdirSync(ASSETS);
const scripts = files.filter((name) => name.endsWith('.js'));
const maps = files.filter((name) => name.endsWith('.map'));

/* ---- 1. the production React ---- */
const developmentSources = [];
for (const name of maps) {
  let map;
  try { map = JSON.parse(readFileSync(join(ASSETS, name), 'utf8')); } catch { continue; }
  for (const source of map.sources ?? []) {
    if (/\.development\.js$/.test(source)) developmentSources.push(`${name}: ${source}`);
  }
}
say(
  developmentSources.length === 0,
  'no development build of a library was bundled',
  developmentSources.slice(0, 3).join(' | ')
);

/* ---- 2. the entry actually exists and is referenced ---- */
/* Read the entry from index.html rather than guess it from file names: a
   shared chunk built from an index.ts is also called index-<hash>.js. */
const html = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf8') : '';
const entry = /<script[^>]*type="module"[^>]*src="[^"]*\/assets\/([^"/]+\.js)"/.exec(html)?.[1];
say(!!entry, 'index.html loads an entry script', 'no module script in index.html');
say(!!entry && scripts.includes(entry), 'the entry script exists', entry ? `${entry} is not in dist/assets` : '');

/* ---- 3. nothing enormous slipped in ---- */
const biggest = scripts
  .map((name) => ({ name, bytes: statSync(join(ASSETS, name)).size }))
  .sort((a, b) => b.bytes - a.bytes)[0];
say(
  biggest.bytes < 1_200_000,
  'no single script is over 1.2 MB',
  `${biggest.name} is ${(biggest.bytes / 1024).toFixed(0)} kB`
);

/* ---- 4. no secret went into the client bundle ---- */
/* The client is downloaded by anybody who opens the page. A value from the
   server's .env appearing in it is the worst kind of leak: silent, permanent,
   and cached by every browser that ever loaded the page. */
const SECRETS = [
  'MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'SUPER_ADMIN_PASSWORD', 'MAIL_PASSWORD',
  'JAZZCASH_INTEGRITY_SALT', 'EASYPAISA_HASH_KEY', 'GATEWAY_API_KEY', 'GATEWAY_WEBHOOK_SECRET', 'PAYMENT_WEBHOOK_SECRET'
];
/* The values come from the shell, or else from the project's .env. */
const ENV_FILE = resolve(fileURLToPath(new URL('../..', import.meta.url)), '.env');
const fromFile = existsSync(ENV_FILE)
  ? Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
    .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, key, raw]) => [key, raw.trim().replace(/^(["'])(.*)\1$/, '$2')]))
  : {};
const leaked = [];
for (const key of SECRETS) {
  const value = process.env[key] || fromFile[key];
  if (!value || value.length < 8) continue;
  for (const name of scripts) {
    if (readFileSync(join(ASSETS, name), 'utf8').includes(value)) leaked.push(`${key} in ${name}`);
  }
}
say(leaked.length === 0, 'no server secret appears in the client bundle', leaked.join(', '));

console.log('');
if (failed) {
  console.error(`${failed} problem(s). This build must not be shipped.\n`);
  process.exit(1);
}
console.log(`The build is fit to ship: ${scripts.length} script(s), entry ${entry}.\n`);
