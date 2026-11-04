/* ==========================================================================
   Vercel Function: the whole KSF API
   --------------------------------------------------------------------------
   Used by a Vercel project whose Root Directory is deploy/vercel (see
   deploy/VERCEL_DEPLOYMENT.txt). The build runs at the repository root,
   compiles backend/src and copies the website into deploy/vercel/public.

   It runs backend/index.js, the entry every Vercel set-up shares: it loads
   the built handler (backend/dist/vercel.js) and, if that fails, answers
   with the reason instead of crashing. vercel.json here sends every /api/…
   request to this function, and Express sees the address that was asked for
   (/api/v1/…), so every route works as it does on a normal server.

   Housekeeping is started by Vercel Cron through /api/v1/cron/maintenance
   (backend/src/modules/cron.ts), since nothing runs between requests. On a
   VPS (Hostinger) or Docker, backend/src/server.ts is the entry point.
   ========================================================================== */

export { default } from '../../../backend/index.js';
