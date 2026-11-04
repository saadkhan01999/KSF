/* ==========================================================================
   Vercel Function: the whole KSF API, for the website's own Vercel project
   --------------------------------------------------------------------------
   Used by a Vercel project whose Root Directory is "frontend" (ksf-x86j).
   frontend/vercel.json builds the whole repository from its root (the API
   in backend/ and the website), serves the website from frontend/dist, and
   sends every /api/… request here. Express sees the address that was asked
   for (/api/v1/…), so every route works as it does on a normal server, and
   the website and the API share one address: no other server is involved.

   The handler is backend/src/vercel.ts (compiled to backend/dist/vercel.js),
   the same one the two-service set-up in the repository's vercel.json and
   deploy/vercel use. Housekeeping runs from Vercel Cron through
   /api/v1/cron/maintenance. On a VPS (Hostinger) or Docker,
   backend/src/server.ts is the entry point instead and this file is unused.
   ========================================================================== */

export { default } from '../../backend/dist/vercel.js';
