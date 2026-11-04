#!/usr/bin/env node
/* ==========================================================================
   npm run api:inventory            write docs/API_INVENTORY.md
   npm run api:inventory -- --check fail if it is out of date (the tests do)
   --------------------------------------------------------------------------
   Every endpoint, read from the server's own route table, so the list is
   never a guess: method, path, who may call it (and with which permission,
   platform role or plan feature), whether another site may post to it, and
   which test files name it besides the two sweeps that cover every route
   (tests/access.test.mjs and tests/security.test.mjs).

   Needs no database: routes are registered when the modules are imported.
   ========================================================================== */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = join(root, 'docs', 'API_INVENTORY.md');

/* The modules validate settings on import; these stand in, and no .env is read. */
Object.assign(process.env, {
  KSF_ENV_FILE: join(root, 'tests', '.no-env-file'),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'inventory-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'inventory-refresh-secret-0123456789abcdef'
});

const { routes } = await import('../backend/src/http/router.ts');
await import('../backend/src/modules/index.ts');

/* Which functional test files mention a route (its path with :params as any segment). */
const testDir = join(root, 'tests');
const testFiles = readdirSync(testDir).filter((file) => file.endsWith('.test.mjs') && file !== 'access.test.mjs');
const testText = Object.fromEntries(testFiles.map((file) => [file, readFileSync(join(testDir, file), 'utf8')]));
const mentionedIn = (path) => {
  const pattern = new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/\'"`?]+') + '(?![\\w/-])');
  return testFiles.filter((file) => pattern.test(testText[file])).map((file) => file.replace('.test.mjs', ''));
};

const who = (route) => {
  if (route.access === 'public') return 'anyone';
  if (route.access === 'account') return 'signed in';
  if (route.access === 'platform') return `platform: ${route.platform}`;
  return route.permission ? `pharmacy: ${route.permission}` : 'pharmacy: any member';
};

const order = { public: 0, account: 1, pharmacy: 2, platform: 3 };
const rows = [...routes].sort((a, b) => order[a.access] - order[b.access] || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const count = (access) => routes.filter((route) => route.access === access).length;

const lines = [
  '# API inventory',
  '',
  'Generated from the route table by `npm run api:inventory` — do not edit by hand;',
  '`npm test` fails when it is out of date. Every route is also covered by',
  '`tests/access.test.mjs` (who may call it) and `tests/security.test.mjs` (hostile',
  'input never causes a server error); **Also tested in** lists the functional test',
  'files that call it by name.',
  '',
  `**${routes.length} endpoints:** ${count('public')} public, ${count('account')} for any signed-in person, ` +
    `${count('pharmacy')} pharmacy, ${count('platform')} platform console. All are under \`/api/v1\`; ` +
    'besides them the server answers `GET /api/v1/health` and `GET /api/v1/avatars/:id`.',
  '',
  'Who may call it: **anyone** (no sign-in); **signed in** (any account); **pharmacy:**',
  'signed in, inside a pharmacy, holding the permission named (a write also needs a',
  'working plan); **platform:** the Super Admin (`owner`) or a KSF team member whose',
  'role holds the access named (`any` is every team member).',
  '',
  '| Method | Path | Who may call it | Plan feature | Other sites may post | Also tested in |',
  '|---|---|---|---|---|---|',
  ...rows.map((route) => `| ${route.method} | \`${route.path}\` | ${who(route)} | ${route.options.feature ?? ''} | ${route.options.allowCrossOrigin ? 'yes (signed)' : ''} | ${mentionedIn(route.path).join(', ')} |`),
  ''
];
const text = lines.join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* missing counts as out of date */ }
  if (current !== text) {
    console.error('docs/API_INVENTORY.md is out of date. Run: npm run api:inventory');
    process.exit(1);
  }
  console.log(`docs/API_INVENTORY.md is up to date (${routes.length} endpoints).`);
} else {
  writeFileSync(target, text);
  console.log(`Wrote docs/API_INVENTORY.md: ${routes.length} endpoints.`);
}
