/* npm run dev — start the API and the website together.

   Finds free ports, starts the API (TypeScript, reloaded on save) and the
   Vite dev server, waits until both actually answer, then opens the browser.
   The console says what is happening and what to do when it does not work. */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const children = [];
let stopping = false;

/* .env is only read here for the banner. It is not copied into the website's
   environment: the browser build must never see the server's secrets. */
function envValue(key) {
  if (process.env[key]) return process.env[key];
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return '';
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((row) => row.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
}

function launch(command, args, label, env = {}) {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env, FORCE_COLOR: '1' } });
  child.on('exit', (code) => { if (!stopping && code) console.error(`[${label}] stopped with exit code ${code}`); });
  children.push(child);
}

function availablePort(start) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', (error) => (error.code === 'EADDRINUSE' ? resolve(availablePort(start + 1)) : reject(error)));
    probe.listen(start, '0.0.0.0', () => probe.close(() => resolve(start)));
  });
}

async function waitFor(url, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (!stopping && Date.now() - startedAt < timeoutMs) {
    try {
      if ((await fetch(url, { cache: 'no-store' })).ok) return true;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

function openBrowser(url) {
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* printed below */ }
}

if (!existsSync(join(ROOT, '.env'))) {
  console.error('\n  There is no .env file yet. Copy .env.example to .env, add your MongoDB connection string,');
  console.error('  then run "npm run secrets -- --write" and start again. DATABASE_SETUP.md walks through it.\n');
  process.exit(1);
}

const webPort = await availablePort(5180);
const apiPort = await availablePort(Number(envValue('PORT')) || 8790);
const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

console.log(`\n  KSF Pharmacy Management System — version ${VERSION}`);
console.log('  --------------------------------------------------------');
console.log(`  Website      http://localhost:${webPort}`);
console.log(`  API          http://localhost:${apiPort}/api/v1/health`);
console.log(`  Super Admin  ${envValue('SUPER_ADMIN_EMAIL') || '(set SUPER_ADMIN_EMAIL in .env)'}`);
console.log('\n  Keep this window open while you use KSF. Ctrl+C stops it.\n');

launch(process.execPath, [tsx, 'watch', 'backend/src/server.ts'], 'API', { PORT: String(apiPort) });
launch(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'frontend/vite.config.ts', '--port', String(webPort), '--strictPort'], 'WEB', { KSF_API_PORT: String(apiPort) });

const [apiReady, webReady] = await Promise.all([waitFor(`http://127.0.0.1:${apiPort}/api/v1/health`), waitFor(`http://127.0.0.1:${webPort}`)]);
if (apiReady && webReady) {
  const url = `http://localhost:${webPort}/login`;
  console.log(`\n  KSF is ready: ${url}\n`);
  if (process.env.KSF_SKIP_BROWSER !== '1') openBrowser(url);
} else if (!stopping) {
  console.warn(`\n  ${apiReady ? 'The website' : 'The API'} did not answer. Read the messages above — a wrong MONGODB_URI is the usual cause.\n`);
}

function stop() {
  stopping = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 250);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
