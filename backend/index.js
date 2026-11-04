/* ==========================================================================
   KSF on Vercel: the one entry point every Vercel set-up runs
   --------------------------------------------------------------------------
   Plain JavaScript on purpose. Vercel compiles a TypeScript entry file by
   file, and the backend's sources import each other by their compiled names
   (./config/env.js), which only exist after `npm run build` - so a project
   that ran src/*.ts directly died on every request with "Cannot find module
   ... config/env.js" (500 FUNCTION_INVOCATION_FAILED). This file loads the
   built handler, dist/vercel.js, instead.

   It is used by:
     - a Vercel project whose Root Directory is backend/ (Vercel's Express
       detection picks app/index/server.js that imports express; this one);
     - the backend service of the repository's vercel.json;
     - frontend/api/index.mjs (Root Directory frontend) and
       deploy/vercel/api/index.mjs (Root Directory deploy/vercel).

   If the built handler cannot be loaded, every request is answered with the
   reason (500, as JSON under /api) instead of a crashed function, so the
   browser and /api/v1/health say what is wrong.

   On a VPS (Hostinger) or Docker, dist/server.js is the entry point and this
   file is unused.
   ========================================================================== */

import 'express'; // the line Vercel's Express detection looks for; the app is built in dist/

let handler = null;
let failure = null;

const loading = import('./dist/vercel.js').then(
  (module) => { handler = module.default; },
  (error) => {
    failure = error;
    console.error('[KSF] The server could not be loaded:', error);
  }
);

export default async function ksf(req, res) {
  await loading;
  if (handler) return handler(req, res);

  const reason = String((failure && failure.message) || failure || 'unknown error').slice(0, 600);
  res.statusCode = 500;
  if (String(req.url || '').startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ message: `The KSF server could not be loaded: ${reason}` }));
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`The KSF server could not be loaded.\n\n${reason}\n\nVercel > the project > Logs has the details.`);
}
