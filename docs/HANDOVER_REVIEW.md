# Hand-over review — release 2.0.0

**KSF Pharmacy Management System** · reviewed 4 October 2026

What was checked before this release was handed over, how, and with what
result. Every check below can be repeated with the command next to it.

---

## 1. Automated checks

| Check | Command | Result |
|---|---|---|
| TypeScript, API and website (strict) | `npm run typecheck` | No errors |
| Unit tests | `npm run test:unit` | Pass |
| API tests against a real MongoDB 7.0 replica set | `npm run test:api` | Pass |
| All tests together | `npm test` | **49 / 49 pass**, 17 suites |
| Production build, with the build gate | `npm run build` | Pass — production React, no server secret in the bundle, largest script 303 kB (94 kB gzipped) |
| End-to-end over HTTP (sign-up to day close, platform console, support mode, import and rollback, suspension) | separate script, 155 requests | **155 / 155 pass** |

The API tests create a throwaway database `ksf_test_<random>` and drop it
afterwards; they never touch real data.

## 2. In the browser

**By hand**, on the development build in Chrome at 375 px and 1920 px:

- [x] Super Admin: overview, pharmacies, a pharmacy's page, extending a plan,
      suspending (the password is asked again first) and reactivating, the
      support desk and answering a request.
- [x] Pharmacy: dashboard; medicines added, viewed, edited and deleted; a cash
      sale at the till with its receipt; **Settings › Appearance** with all five
      themes; raising a support request; **My account**.
- [x] The phone menu opens as a drawer (checked again at 375 px on 4 October).

**Screenshot pass for the client report** (4 October), headless Chrome against
a fresh MongoDB database holding four sample pharmacies made through the
normal sign-up and API — 62 screens at 390 px (phone), 820 px (tablet),
1440 px (laptop) and 1920 px (wide monitor):

- [x] Every Super Admin page, including **Work inside** a pharmacy (banner,
      the pharmacy's staff, back to the platform) and a support thread.
- [x] Every pharmacy page signed in as its Admin, the row menu, the medicine
      View and Edit windows, all five themes and dark mode.
- [x] Found and fixed during the pass: card headers with buttons squeezed
      their titles on phones; date labels overlapped on 30-day charts.

**Covered by the API tests rather than by hand:** sign-up with an e-mail code,
refunds, udhaar repayment and reversal, the day close, data import and undo,
tenant isolation, and the Super Admin changing their own e-mail and password.

## 3. Security review

| Area | Finding |
|---|---|
| Tokens | Access JWT 15 min in memory; refresh JWT with a separate key in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`, rotated on every use. Replaying an old refresh token revokes the session (tested) |
| Sessions | The session row is checked on every request, so a password change, suspension or device removal ends access at once (suspension tested; the old password refused after a change, tested) |
| Tenant isolation | Every pharmacy query carries `pharmacy_id`; a person from pharmacy A asking for B's records gets 404 (tested) |
| Permissions | Enforced on the server for every route (a cashier refused the platform console and hidden reports, tested). Nobody can grant a permission they lack or edit a role at or above their own level (`modules/people.ts`) |
| Step-up | Suspending a pharmacy, confirming or refunding a subscription payment, rolling back an import, two-step changes and removing a device need the password within 10 minutes; answered `403 step_up_required`, never a sign-out (suspension and rollback tested) |
| Secrets | `.env` git- and docker-ignored; JWT secrets ≥ 32 chars enforced at start-up and different in production; the build gate scans the bundle for them |
| Headers | Helmet CSP `script-src 'self'`, frame denial, HSTS in production, `x-powered-by` off |
| Errors | Unexpected errors return a polite message and a correlation id; stack traces stay in the server log |
| Health check | Hides database details in production |

## 4. Known limits

- **Business dates are UTC.** A sale between 00:00 and 05:00 Pakistan time
  counts towards the previous day in reports and day close.
- **Rate limits are per server process.** With several API containers behind
  a load balancer, each keeps its own counters; Nginx's limits still apply in
  front.
- **Payment providers** (JazzCash, Easypaisa, a card gateway) need the
  merchant's own credentials and a live test before they are switched on.
  Bank transfer works out of the box and is confirmed by the Super Admin.
- **E-mail** needs SMTP settings in production; until then codes appear in
  the server console only.

## 5. Before go-live

- [ ] `MONGODB_URI` set to the production cluster; Atlas backups on.
- [ ] New JWT secrets for production (`npm run secrets -- --write`).
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS in front,
      `PUBLIC_APP_URL` and `PUBLIC_ALLOWED_ORIGINS` set to the real domain.
- [ ] SMTP configured and a test sign-up completed with a real inbox.
- [ ] Super Admin e-mail and password changed, two-step sign-in on.
- [ ] `npm run db:backup` scheduled daily and a restore rehearsed once.
