# Changelog

All notable changes to KSF Pharmacy Management System. Dates are in
Pakistan Standard Time.

## Unreleased

### Deployment
- **Railway (API) and Vercel (website).** `frontend/vercel.json` forwards
  `/api` to the Railway service, so sign-in cookies stay first-party. Steps
  in `deploy/README.md`.
- `TRUST_PROXY` takes a hop count (`1`, `2`). It used to be passed to Express
  as text, which read `2` as an address and logged every visitor as the
  proxy.
- The origin of `PUBLIC_APP_URL` is always an allowed origin, and
  `PUBLIC_ALLOWED_ORIGINS` takes `*` for Vercel's per-deployment addresses
  (`https://ksf-x86j-*-ssam1.vercel.app`). A refused origin is named once in
  the server log.
- A start-up that MongoDB Atlas refuses (`SSL alert number 80`: the server's
  address is not on the IP Access List) or that has a wrong database password
  now says so, and how to fix it.
- `SHOW_SIGNUP_CODE=true` (testing only, off by default) shows the sign-up
  code on the confirm screen, so sign-up can be tried before SMTP is set up.
  Password-reset codes are never shown.
- The website's business details request uses `VITE_API_BASE_URL` like every
  other request, and a blank `VITE_API_BASE_URL` falls back to `/api/v1`.

## [2.0.0] — 2026-10-03

A new foundation: MongoDB, a typed Express API, proper JWT sessions, and a
platform console for the one Super Admin who runs the service. Every screen
a pharmacy used in 1.0.6 is still there and works the same way.

### Database
- **MongoDB replaces SQLite and PostgreSQL.** One database (Atlas or a
  replica set) for every pharmacy; each document carries `pharmacy_id` and
  every pharmacy index starts with it.
- Sales, purchase receiving, refunds and imports run in **multi-document
  transactions**; batch decrements are conditional and atomic, so two tills
  cannot sell the same last pack.
- New commands: `db:check`, `db:backup` (compressed, checksummed, verified on
  write), `db:verify`, `db:restore` (backs up the current data first),
  `db:reset`.
- **No demonstration data.** A new installation holds the plans and one
  account — the Super Admin, created from `.env` on the first start.

### API
- Rewritten in **TypeScript** (strict) on **Express 5**; one file per area
  under `backend/src/modules`, configuration validated with zod at start-up.
- Every route declares its access in one line: public, any signed-in
  account, platform only, or a named pharmacy permission.

### Sign-in and security
- **JWT access tokens** (15 minutes, memory only) and **rotating refresh
  tokens** (HttpOnly, SameSite=Strict, path-scoped cookie, reuse detection
  revokes the session).
- Sessions are checked on every request, so sign-out, password changes,
  suspensions and device removals apply at once.
- Re-confirming the password for sensitive actions now answers
  `403 step_up_required` and the request is retried after confirmation —
  it no longer risks signing the person out.
- `npm run secrets -- --write` generates the signing keys.
- A password is accepted whenever it meets the five rules shown beside the
  field. The hidden extra checks (common-word list, containing the person's
  name or e-mail) are gone, so a ticked checklist is never refused.

### Platform Super Admin (new)
- One Super Admin for the whole platform, above every pharmacy. The
  *Pharmacy Owner* role is gone; each pharmacy's top role is its **Admin**.
- **Overview** of all pharmacies combined: their sales, the platform's
  income, recurring revenue, plans, trials and open requests.
- **Pharmacies**: search, and one page per pharmacy with its figures, staff,
  branches, plan, payments, support history and activity. Edit, change or
  extend the plan, record an offline payment, suspend and reactivate.
- **Support mode**: work inside any pharmacy with every permission, clearly
  bannered and logged as *Super Admin (support)*.
- **Support desk**: requests from every pharmacy in one queue, answered in a
  thread. **People who need help**: sign-in problems across all pharmacies.
- **Income and plans**: payments by month, plan, method and pharmacy;
  confirming bank transfers; refunds; editing plan prices and limits.
- The Super Admin changes their own e-mail and password from **My account**.

### Pharmacies
- **Help & Support**: raise a request to the platform and follow the reply.
- **Roles**: the Admin creates custom roles by ticking permissions; nobody
  can grant more than they hold or act on someone more senior.
- **My account**: profile, password, two-step sign-in, devices and sessions
  in one place for everybody.

### Look and feel
- **Five themes** — KSF Green (unchanged default), Ocean Blue, Royal Purple,
  Sunset Amber, Graphite — each with light and dark mode. The Admin sets the
  pharmacy's theme and decides which roles may choose their own.
- **Full-width layout** that uses the whole screen, with seven breakpoints
  from small phones (< 360 px) to wide monitors (≥ 1536 px).
- Row action menus float above tables instead of being cut off.
- On phones, card headers move their buttons below the title instead of squeezing it.
- Long bar charts (30 days) label every few bars, so dates no longer overlap.
- The sign-up progress indicator is redesigned: numbered markers joined by a
  line, a tick for each finished step, and a short hint under each label. It
  no longer picks up the till's quantity-box styling.

### Kept
- Public website, self-service sign-up with e-mail verification, plans,
  subscription payments (bank transfer, gateway, JazzCash, Easypaisa),
  referrals and data import — all now on MongoDB.

### Removed
- SQLite and PostgreSQL drivers, the demo data loader and the demo sign-in
  buttons, the design-system page, the release archive and superseded
  hand-over notes.

---

## [1.0.6] — 2026-10-02

Restructured into `frontend/` and `backend/` workspaces. Discounts in the
till's payment window with a reason and a per-pharmacy limit; everyone sees
only their own figures unless allowed more; per-role and per-person reports
with profit; a "staff who need your help" card for sign-in problems.
SQLite or PostgreSQL.

## [1.0.5]

The release received from the client: the starting point for 1.0.6.
