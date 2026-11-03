/* Vercel Function: the whole KSF API.

   vercel.json sends every /api/… request here, and the Express application
   sees the address that was asked for (/api/v1/…), so every route works as
   it does on a normal server. The application itself is built from
   backend/src by `npm run build`; this file only hands requests to it. */

import { handle } from '../backend/dist/serverless.js';

export default handle;
