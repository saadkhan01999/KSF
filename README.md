# KSF Pharmacy Management System

A multi-pharmacy SaaS platform for Pakistan. Each pharmacy runs its counter,
stock, purchasing, prescriptions, customers and accounts in KSF; one platform
**Super Admin**, with a team of their own, runs the service itself — every
pharmacy, their plans and payments, the shared medicine directory, and the
support requests they raise.

**Version 2.3.0** · React 18 + TypeScript · Express 5 + TypeScript · MongoDB 7

---

## Contents

1. [What it does](#what-it-does)
2. [Quick start](#quick-start)
3. [Commands](#commands)
4. [How it is built](#how-it-is-built)
5. [Security model](#security-model)
6. [Roles, plans, support mode and themes](#roles-plans-support-mode-and-themes)
7. [Barcode scanners](#barcode-scanners)
8. [REST API](#rest-api)
9. [Project layout](#project-layout)
10. [Testing](#testing)
11. [University edition](#university-edition)
12. [Deployment](#deployment)
13. [Further reading](#further-reading)

---

## What it does

**For a pharmacy**

| Area | What is in it |
|---|---|
| Till | **Barcode scanning** — any USB or Bluetooth scanner, wherever the cursor is, plain barcodes and the GS1 DataMatrix on the pack, or the camera of a phone or laptop; an unknown barcode is linked to its medicine in one step — or search; FEFO batch allocation, prescription checks, cash / card / Easypaisa / JazzCash / bank / credit (udhaar), reasoned discounts with a per-pharmacy limit, printable 76 mm receipt, a calculator that stays open beside the sale |
| Stock | Medicines, categories, batches with expiry, adjustments after a count, quarantine and write-off, low-stock and expiry alerts, a full movement ledger |
| Buying | Suppliers, purchase orders, receiving into stock (atomically), dated supplier payments by cash, bank, cheque or wallet, what is owed to whom |
| People | Customers with allergies and credit limits, repayments and reversals, prescriptions verified by a pharmacist |
| Accounts | **Income and expenses in one place**: sales, other income, purchases, salaries and every other cost; net profit, cash in and out, receivables and payables; a profit-and-loss statement, a ledger, twelve months' trend; A4 statements to print or save as PDF and CSV downloads |
| Money | Expenses with approval, close-the-day drawer count with variance, reports by period, person, role, category and discount, CSV export |
| Medicine directory | A searchable reference — names, other names, brands and their companies, category, uses, precautions, side effects, interactions — with references to the monograph each entry was checked against, and one step to add a medicine to the pharmacy's own catalogue |
| Team | Staff accounts, five built-in roles plus custom roles, per-person figures, internal messaging, device limits, two-step sign-in |
| Account | Self-service sign-up with e-mail verification, setup checklist, subscription and billing (card through Stripe, bank transfer, JazzCash, Easypaisa), numbered invoices and receipts, payment history, referrals, data import (CSV / Excel / JSON) with validation, reconciliation and rollback |
| Help | **Help & Support**: raise a request to KSF and follow the conversation |

**For the platform Super Admin and their team**

| Area | What is in it |
|---|---|
| Overview | All pharmacies combined: their sales today and this month, your income this month and all time, monthly recurring revenue, plans, trials, open support requests |
| Pharmacies | Every pharmacy, searchable by name, city or Admin; one page per pharmacy with its figures, staff, branches, plan, payments, support history and activity |
| Actions | Edit a pharmacy, change or extend its plan, record an offline payment, suspend / reactivate (signs everybody out at once), and **work inside** any pharmacy in support mode |
| Plans and prices | Create plans and change prices, limits and features. **A change reaches every open screen at once** — the public pricing page, every pharmacy's dashboard and billing, and the checkout — and a pharmacy's features follow its subscription the moment it changes |
| Accounts | **KSF's own books**: subscription income by plan, refunds, other income (setup and training fees) and every expense (team salaries, servers, software, marketing, rent); net profit, a ledger of every movement, twelve months' trend, an A4 statement and CSV downloads |
| Payment methods | Which ways to pay are switched on (Stripe, bank transfer, JazzCash, Easypaisa, a gateway), test or live, the settings each still needs, and the webhook address to register |
| Income | Payments by month, plan, method and pharmacy; bank transfers to confirm; refunds (through Stripe where it was paid there); any pharmacy's invoice; offline payments recorded by hand, each slip number once per pharmacy |
| Medicine directory | Add and correct entries, verify each one as a pharmacist against its references, archive and restore, import a list |
| Support desk | Every request from every pharmacy in one queue, answered in a thread; the pharmacy is notified and e-mailed |
| People who need help | Anyone, anywhere, who could not sign in today — locked, wrong password, device limit, lost authenticator — and a search across every account |
| My team | The people who help run KSF, each with a team role made of platform permissions |

There is **no demonstration data** in the commercial service. A new
installation contains the subscription plans, the starter medicine directory
and one account — the Super Admin. Pharmacies sign up themselves from the
website. (The [university edition](#university-edition) has a demonstration
pharmacy, made on request with `npm run seed:demo`.)

---

## Quick start

You need **Node.js 20 or newer** and a **MongoDB** database. MongoDB Atlas
(free tier) is the easiest; a local MongoDB works too. `DATABASE_SETUP.md`
walks through both, step by step.

```bash
npm install
```

Open `.env` and paste your connection string into `MONGODB_URI`. The JWT
secrets in it were generated for this installation; to make new ones:

```bash
npm run secrets -- --write
```

Check the database is reachable, then start:

```bash
npm run db:check
```

```bash
npm run dev
```

The browser opens at `http://localhost:5180`. Sign in with the
`SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` from `.env` — then change both
from **My account**. On Windows, `windows\START_KSF.bat` does all of this.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (reloads on save) and website together, on free ports, browser opens itself |
| `npm run build` | Type-checks and compiles the API to `backend/dist`, builds the website to `frontend/dist` |
| `npm start` | Runs the compiled API, which also serves the built website |
| `npm run typecheck` | TypeScript, both projects |
| `npm test` | Unit tests and every API suite (see [Testing](#testing)) |
| `npm run test:unit` | The unit tests alone — no database needed |
| `npm run test:api` | The API suites alone, against a real MongoDB |
| `npm run db:check` | Connects, and reports version, transactions, collections, plans and the Super Admin |
| `npm run db:backup` | Writes a compressed, checksummed backup to `.data/backups` and verifies it reads back |
| `npm run db:verify -- <file>` | Verifies a backup file |
| `npm run db:restore -- <file> --yes` | Restores a backup (backs up the current data first) |
| `npm run db:reset -- --yes` | Empties a development database and sets it up again |
| `npm run secrets -- --write` | Generates new JWT and webhook secrets into `.env` |
| `npm run university:copy -- --out ../ksf-university` | Makes the separate [university edition](#university-edition) |
| `npm run seed:demo` | University edition only: one demonstration pharmacy with data and every role, on an empty database |

---

## How it is built

```
 Browser (React 18, TypeScript, Vite)
   │  Authorization: Bearer <access token, in memory only>
   │  Cookie: ksf_refresh (HttpOnly, Path=/api/v1/auth, rotated on every use)
   │  Live updates: Server-Sent Events (plans and subscriptions)
   ▼
 Express 5 API (TypeScript, Node 20+)          backend/src
   ├─ http/        app, authentication, route registry, cookies
   ├─ modules/     one file per area: auth, account, people, catalogue, inventory,
   │               purchasing, selling, cashbook, accounting, reporting, messaging,
   │               billing, invoices, directory, live, setup, migrate, support,
   │               platform, platform-accounts, team, admin
   ├─ services/    subscriptions, payments (Stripe, gateway, JazzCash, Easypaisa,
   │               bank transfer), live updates, referrals, mailer, data import
   ├─ domain/      permissions and roles, plans and features, platform team,
   │               the starter medicine directory
   ├─ security/    passwords (scrypt), JWT sessions, devices, one-time codes, TOTP
   ├─ db/          connection, transactions, document types, indexes, bootstrap
   └─ cli/         db:check, backup, restore, reset, secrets, seed:demo
   ▼
 MongoDB 7 (replica set or Atlas — multi-document transactions, change streams)
```

- **Every route states who may call it** in one line — `publicRoute`,
  `accountRoute`, `platformRoute(…, access)`, or
  `route(method, path, 'permission', handler, { feature })` — and the check
  runs before the handler, for every request. The [REST API](#rest-api) table
  below is that registry, and a test fails if a route is missing from it.
- **Tenancy is enforced in every query**: each pharmacy document carries
  `pharmacy_id`, and handlers only ever read with the caller's.
- **Money is integer paisa** everywhere; rupees exist only on screen. The
  accounts compute profit from what each sale cost when it was sold, so a
  later price change never rewrites last month.
- **Stock never goes below zero by accident**: sales decrement batches with
  conditional, atomic updates inside a transaction, so two tills selling the
  last pack cannot both succeed.
- **Live, without polling the API**: MongoDB change streams on the plans and
  the subscriptions feed one Server-Sent Events stream per browser; an event
  only says *what* changed, and the screen fetches the new figures through the
  ordinary, permissioned endpoints. Without a replica set a 15-second poll of
  the same two collections takes over.
- **Audit trail**: security-relevant actions go into a hash-chained,
  append-only log per pharmacy, verifiable from the Security Centre.

`docs/ARCHITECTURE.md` goes deeper.

---

## Security model

| | |
|---|---|
| Passwords | scrypt, per-user salt, 12-character minimum with strength rules, never logged |
| Access token | JWT (HS256), 15 minutes, issuer and audience checked, kept in memory — never in localStorage |
| Refresh token | JWT signed with a separate secret, in an HttpOnly + SameSite=Strict cookie scoped to `/api/v1/auth`, **rotated on every use**; only the hash of its one-time id is stored. Replaying an old one ends the session |
| Sessions | Server-side record per sign-in: idle timeout, absolute lifetime, revocable from the Security Centre, ended on password change |
| Step-up | Sensitive actions (suspending a pharmacy, confirming or refunding a subscription payment, rolling back an import, two-step and device changes) require the password again within 10 minutes |
| Two-step sign-in | TOTP authenticator apps, with one-time recovery codes |
| Devices | Per-person device limits; new devices are announced by e-mail |
| Permissions | Checked on the server for every request; a role can never be given more than its maker holds; a pharmacy's people never see another pharmacy's records (`tests/access.test.mjs` proves it for every route and every built-in role) |
| Plan features | A feature the pharmacy's plan does not include is refused with `402 feature_locked`, on the server — the screen showing a lock is a courtesy |
| Brute force | Per-account lock-out, per-IP limits on sign-in and sign-up, write throttling |
| Headers | Helmet: strict CSP (`script-src 'self'`, `form-action` limited to the payment pages), HSTS in production, frame denial; the camera is allowed for KSF's own pages only (`Permissions-Policy: camera=(self)`), for scanning at the till |
| Card payments | Cards are typed only on Stripe's hosted Checkout; no card number reaches KSF |
| Webhooks | Stripe: the `Stripe-Signature` HMAC-SHA256 over the raw body, within five minutes, each event applied once. Others: HMAC-SHA256 over the raw body. Amounts are checked against what the server asked for |

---

## Roles, plans, support mode and themes

- **Super Admin** — one account for the whole platform, created from `.env`
  on the first start and changed from **My account** afterwards. Sees the
  platform console, not a pharmacy.
- **The Super Admin's team** — people with team roles made of platform
  permissions (dashboard, pharmacies, support desk, finance, plans, the
  medicine directory, records). Ready-made starting points include Help desk,
  Finance, Operations manager, Clinical pharmacist and Read only.
- **Support mode** — the Super Admin (or a team member allowed to) opens any
  pharmacy ("Work inside") and has every permission there, to fix what the
  pharmacy cannot: unlock a cashier, reset a password, correct a role. A
  banner says whose pharmacy it is; every action is logged as support.
- **Pharmacy roles** — Admin (the person who registered, every permission),
  Regional Manager, Branch Manager, Pharmacist, Cashier. The Admin can create
  any other role by ticking permissions, and can never grant more than they
  hold. Seniority decides who may act on whom.
- **Plans** — Basic (free) has the till, stock with batches and expiry, the
  daily summaries and messaging. Paid plans add advanced reports, CSV export,
  custom roles, data import and more. The Super Admin decides what each plan
  includes; a pharmacy's screens unlock or lock the moment its plan changes.
- **Themes** — five colour themes (KSF Green, Ocean Blue, Royal Purple, Sunset
  Amber, Graphite), each with light and dark mode. The pharmacy Admin sets the
  pharmacy's theme in **Settings › Appearance** and chooses which roles may
  pick their own.

---

## Barcode scanners

The till (**Sell › New sale**) takes a scan wherever the cursor is — the
search box, a quantity box or nowhere at all — and the item goes straight into
the sale with a beep. Nothing has to be clicked first.

| | |
|---|---|
| Which scanners | Any USB or Bluetooth scanner in **keyboard (HID) mode**, which is how almost all of them come out of the box. No driver and no app. 1D (EAN-13, EAN-8, UPC, Code 128, Code 39) and 2D (QR, DataMatrix) |
| Setting it up | Plug it in (or pair it over Bluetooth) and scan. An **Enter** at the end of each scan is the factory setting and the fastest; Tab, or nothing at all, works too |
| How the till tells it from a person | A scanner types a whole code in a few milliseconds; a person cannot. Keys that arrive that fast are taken as a scan and kept out of whichever box has the cursor; normal typing is left alone |
| The pack's 2D code | The GS1 DataMatrix printed on medicine packs (product, expiry, batch, serial) finds the medicine by its product number; a lost leading zero on a barcode does not matter |
| Camera | The camera button beside the search box scans with a phone's or laptop's camera — the back camera, with the light, on phones. The browser asks for permission once. It needs **https** (Vercel and Railway give it; `localhost` counts too) |
| A barcode KSF does not know | The till asks which medicine it is and saves the barcode on it (with `medicines.write`), so the next scan finds it — or opens **Add medicine** with the barcode filled in |
| The scanner button | **Scanner ready** on the till: the last code read and what happened to it, the camera, the beep on or off, and these steps for whoever is at the counter |

While the payment window is open, scans are held back (with a low beep), so a
pack scanned by mistake never changes a sale that is being paid.

---

## REST API

Every endpoint KSF has is in the tables below: **265** in the route registry,
plus the two the server answers itself. The tables are the registry, read out
of `backend/src/modules/*.ts`; `tests/unit.test.mjs` fails when a route is
added without a line here.

### Conventions

| | |
|---|---|
| Base URL | `/api/v1` on the API server (on Vercel, the website forwards `/api` to Railway, so the browser uses the same origin) |
| Format | JSON in and out (`Content-Type: application/json`), UTF-8. Request fields are camelCase (`amountPaisa`); answers are documents in snake_case (`amount_paisa`) with readable ids (`MED-…`). Dates are ISO 8601 (`2026-10-12` or `2026-10-12T09:30:00.000Z`) |
| Money | Integer **paisa** in every field that ends `Paisa` / `_paisa` (Rs 125.50 is `12550`) |
| Signing in | `POST /auth/login` answers `accessToken` (15 minutes). Send it as `Authorization: Bearer <token>`. The refresh token is an HttpOnly cookie on `/api/v1/auth`; `POST /auth/refresh` exchanges it for a new pair |
| Who may call | **Anyone** — no sign-in (sign-up, plans, webhooks). **Signed in** — any person, pharmacy or platform. A permission such as `sales.create` — signed in, inside a pharmacy, holding it. **Super Admin**, **Platform team**, or a platform permission such as `platform.finance.view` — the platform console |
| Plan features | `plan reports.export` means the pharmacy's subscription must include that feature too |
| Support mode | The platform team adds `X-Pharmacy-Id: <pharmacy id>` to call pharmacy endpoints inside that pharmacy |
| Lists | Paged lists take `?page=1&size=50` (size up to 200) and answer `{ data, page, size, total, pages }`; short lists answer `{ data }`. Searches take `?q=`; periods take `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| Writes | Answer the saved record as `{ data }` (201 when something was created) |
| Errors | `{ message, field?, code? }` — `message` is written for the person at the screen; `field` names the input to correct |
| Live updates | `GET /events` (signed in) and `GET /public/events` are `text/event-stream`. Events: `ready`, `plans.changed`, `subscription.changed` (`{ pharmacyId }`), `resync`. Each stream closes after about 50 s; reconnect with `Last-Event-ID` and missed events are replayed |
| Webhooks | `POST /payments/webhook/stripe` (Stripe-Signature), `/payments/webhook/<provider>` for the others. Cross-origin, signed, idempotent |

| Status | Meaning |
|---|---|
| `200` / `201` | Done / created |
| `303` | A payment return: the browser is sent back into the application |
| `400` | The request is not valid; `field` says which input (`code: pharmacy_required` when a pharmacy endpoint is called outside a pharmacy) |
| `401` | Not signed in, or the token expired (`code: token_expired` — refresh and retry) |
| `402` | `code: feature_locked` — the plan does not include it; the reply names the `feature` and the `plans` that do |
| `403` | Signed in, but not allowed (no permission, another origin, a suspended pharmacy). `code: step_up_required` asks for the password again (`POST /auth/verify-identity`), then the same request is retried |
| `404` | Not found — also the answer for another pharmacy's record, so ids cannot be probed |
| `409` | Conflicts with what is there (a duplicate, a full device allowance, stock that is no longer there) |
| `413` | The body is larger than allowed |
| `429` | Too many attempts or changes; `Retry-After` says when to try again |

### Endpoints

#### Server

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/health` | Anyone | The service is up: version, time, whether transactions are available |
| `GET /api/v1/avatars/:id` | Anyone | A profile photo (the id is random and changes with every new photo) |

#### Sign-in and sessions

| Endpoint | Who may call | What it does |
|---|---|---|
| `POST /api/v1/auth/login` | Anyone | Sign in with e-mail and password; answers the access token, or a two-step challenge, or 409 when the device allowance is full |
| `POST /api/v1/auth/two-factor` | Anyone | Finish signing in with the authenticator code (or a recovery code) |
| `POST /api/v1/auth/device-release` | Anyone | Sign out one of the person's devices to make room for this one |
| `POST /api/v1/auth/refresh` | Anyone | A new access token from the refresh cookie (rotated on every use; replaying an old one ends the session) |
| `POST /api/v1/auth/logout` | Anyone | End this session and clear the refresh cookie |
| `GET /api/v1/auth/session` | Signed in | Who is signed in, with their permissions and the subscription (honours support mode) |
| `POST /api/v1/auth/verify-identity` | Signed in | Confirm the password again before a sensitive action (step-up, ten minutes) |
| `POST /api/v1/auth/change-password` | Signed in | Change one's own password; other sessions are signed out |
| `PATCH /api/v1/me` | Signed in | Update one's own name, phone and theme |
| `POST /api/v1/me/email/start` | Signed in | Start changing one's sign-in e-mail: a code goes to the new address |
| `POST /api/v1/me/email/confirm` | Signed in | Confirm the new e-mail address with that code |
| `POST /api/v1/auth/forgot-password` | Anyone | Send a password-reset code to an e-mail address (never says whether the account exists) |
| `POST /api/v1/auth/reset-password` | Anyone | Set a new password with the reset code |
| `GET /api/v1/me/sessions` | Signed in | One's own active sessions |

#### Website and sign-up

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/public/brand` | Anyone | The business details for the website footer and invoices, and the edition |
| `GET /api/v1/public/plans` | Anyone | The plans on sale, with prices, limits and features (what the pricing page shows) |
| `GET /api/v1/public/referral/:code` | Anyone | Check a referral code before sign-up |
| `GET /api/v1/register/state` | Anyone | The sign-up in progress in this browser |
| `POST /api/v1/register/start` | Anyone | Start a sign-up: name, e-mail, password, mobile; a code is e-mailed (and returned as testCode when SHOW_SIGNUP_CODE is on) |
| `POST /api/v1/register/verify-email` | Anyone | Confirm the e-mail code; creates the pharmacy and its Admin and signs them in |
| `POST /api/v1/register/resend` | Anyone | Send the sign-up code again |
| `POST /api/v1/public/password-strength` | Anyone | Which of the password rules a candidate password meets |
| `POST /api/v1/register/cancel` | Anyone | Abandon the sign-up in progress |
| `GET /api/v1/dev/outbox` | Anyone | Development only: the latest e-mails written to the file outbox (empty in production) |

#### My account

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/account/security` | Signed in | The Security Centre: password age, two-step status, devices, recent sign-ins |
| `GET /api/v1/account/audit-integrity` | `audit.read` | Verify the pharmacy's hash-chained audit trail end to end |
| `GET /api/v1/account/audit` | `audit.read` | The pharmacy's audit trail |
| `POST /api/v1/account/2fa/start` | Signed in | Begin two-step sign-in: a secret and QR code for an authenticator app |
| `POST /api/v1/account/2fa/enable` | Signed in | Turn two-step sign-in on with a first code; answers recovery codes |
| `POST /api/v1/account/2fa/disable` | Signed in | Turn two-step sign-in off (step-up) |
| `POST /api/v1/account/2fa/recovery-codes` | Signed in | Replace the recovery codes (step-up) |
| `GET /api/v1/account/devices` | Signed in | One's registered devices |
| `PATCH /api/v1/account/devices/:id` | Signed in | Rename one of one's devices |
| `DELETE /api/v1/account/devices/:id` | Signed in | Remove one of one's devices (signs it out) |
| `GET /api/v1/account/sessions` | Signed in | One's sessions, with device and address |
| `DELETE /api/v1/account/sessions/:id` | Signed in | End one of one's sessions |
| `POST /api/v1/account/sessions/logout-all` | Signed in | Sign out everywhere except here |
| `GET /api/v1/account/privacy` | Pharmacy member | What the pharmacy holds about this person, and why |
| `GET /api/v1/account/export` | `settings.read` | Export the pharmacy's data (data portability — never behind a plan) |
| `GET /api/v1/account/referrals` | Pharmacy member | This pharmacy's referral code and who used it |

#### Workspace (dashboard, settings, notifications, security)

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/bootstrap` | Signed in | Everything the app needs after sign-in: pharmacy (or platform), branches, settings, theme, badge counts |
| `GET /api/v1/notifications` | Pharmacy member | The person's notifications, paged |
| `GET /api/v1/notifications/recent` | Pharmacy member | The latest notifications, for the bell |
| `POST /api/v1/notifications/:id/read` | Pharmacy member | Mark one notification read (404 unless it is the person's) |
| `POST /api/v1/notifications/read-all` | Pharmacy member | Mark all of the person's notifications read |
| `POST /api/v1/notifications/refresh` | `inventory.read` | Recompute low-stock and expiry alerts now |
| `GET /api/v1/activity` | `audit.read` | The pharmacy's activity log, filterable |
| `GET /api/v1/settings` | `settings.read` | The pharmacy's settings |
| `PATCH /api/v1/settings` | `settings.write` | Change pharmacy settings (invoice, till, tax, security) |
| `PATCH /api/v1/settings/appearance` | `settings.write` | Set the pharmacy's theme and which roles may choose their own |
| `GET /api/v1/settings/appearance` | `settings.read` | The pharmacy's theme settings |

#### People and roles

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/staff` | `staff.read` | The pharmacy's staff |
| `POST /api/v1/staff` | `staff.invite` | Add a staff member with a role and a temporary password (plan's user limit applies) |
| `PATCH /api/v1/staff/:id` | `staff.manage` | Edit a staff member, change their role, suspend or reactivate |
| `POST /api/v1/staff/:id/reset-password` | `staff.manage` | Give a staff member a new temporary password |
| `POST /api/v1/staff/:id/unlock` | `staff.manage` | Unlock a staff member locked out by failed sign-ins |
| `POST /api/v1/staff/:id/sign-out` | `staff.manage` | Sign a staff member out of every device |
| `DELETE /api/v1/staff/:id` | `staff.manage` | Archive a staff member (their records stay) |
| `GET /api/v1/staff/help` | `staff.manage` | Staff who could not sign in today, and why |
| `GET /api/v1/staff/:id/devices` | `staff.manage` | A staff member's registered devices |
| `DELETE /api/v1/staff/:id/devices/:deviceId` | `staff.manage` | Remove a staff member's device |
| `POST /api/v1/staff/:id/reset-2fa` | `staff.manage` | Turn off a staff member's two-step sign-in (lost phone) |
| `GET /api/v1/roles` | `roles.read` | Roles with their permissions, the permission catalogue and the built-in templates |
| `POST /api/v1/roles` | `roles.manage` · plan `staff.roles` | Create a custom role (never more than the creator holds) |
| `PATCH /api/v1/roles/:id` | `roles.manage` · plan `staff.roles` | Change a role's name, description or permissions |
| `DELETE /api/v1/roles/:id` | `roles.manage` · plan `staff.roles` | Delete a custom role nobody holds |
| `POST /api/v1/roles/:id/duplicate` | `roles.manage` · plan `staff.roles` | Copy a role into a new custom role |
| `GET /api/v1/branches` | `settings.read` | The pharmacy's branches with their staff and sales |
| `POST /api/v1/branches` | `branches.manage` | Open a branch (plan's branch limit applies) |
| `PATCH /api/v1/branches/:id` | `branches.manage` | Edit or close a branch |

#### Catalogue

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/categories` | `medicines.read` | Medicine categories with counts |
| `POST /api/v1/categories` | `categories.manage` | Create a category (names unique regardless of case) |
| `PATCH /api/v1/categories/:id` | `categories.manage` | Rename or recolour a category |
| `DELETE /api/v1/categories/:id` | `categories.manage` | Delete an empty category |
| `GET /api/v1/medicines` | `medicines.read` | The catalogue with stock on hand, searchable, filterable and sortable |
| `GET /api/v1/medicines/:id` | `medicines.read` | One medicine with its batches and last 30 days' sales |
| `POST /api/v1/medicines` | `medicines.write` | Add a medicine (plan's medicine limit applies) |
| `PATCH /api/v1/medicines/:id` | `medicines.write` | Edit a medicine |
| `DELETE /api/v1/medicines/:id` | `medicines.delete` | Retire a medicine (history stays) |
| `GET /api/v1/medicines-lookup` | `medicines.read` | Fast search for the till, in-stock first |
| `GET /api/v1/medicines-scan` | `medicines.read` | Resolve one scanned code exactly: a barcode (tolerates a lost leading zero) or a GS1 DataMatrix; replies with the matches, the barcode to save for an unknown one, and the product, expiry, batch and serial it carried |

#### Stock

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/inventory` | `inventory.read` | Stock on hand per medicine with its state (in stock, low, out) |
| `GET /api/v1/inventory/batches` | `inventory.read` | Batches with quantity, cost and expiry |
| `POST /api/v1/inventory/adjust` | `inventory.adjust` | Correct stock after a count or breakage, with a reason |
| `POST /api/v1/inventory/batches` | `inventory.adjust` | Add opening stock as a new batch |
| `GET /api/v1/expiry` | `inventory.read` | Batches by expiry: expired, critical, expiring |
| `POST /api/v1/expiry/:id/quarantine` | `expiry.manage` | Take a batch off sale |
| `POST /api/v1/expiry/:id/release` | `expiry.manage` | Put a quarantined batch back on sale |
| `POST /api/v1/expiry/:id/write-off` | `expiry.manage` | Write a batch off (counted as a loss in the accounts) |
| `POST /api/v1/expiry/quarantine-expired` | `expiry.manage` | Quarantine every expired batch at once |
| `GET /api/v1/stock-movements` | `inventory.read` | The stock movement ledger |

#### Suppliers and purchasing

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/suppliers` | `suppliers.read` | Suppliers with what is owed to each |
| `POST /api/v1/suppliers` | `suppliers.write` | Add a supplier |
| `PATCH /api/v1/suppliers/:id` | `suppliers.write` | Edit a supplier |
| `DELETE /api/v1/suppliers/:id` | `suppliers.write` | Archive a supplier |
| `GET /api/v1/purchases` | `purchases.read` | Purchase orders with totals and what is payable |
| `GET /api/v1/purchases/:id` | `purchases.read` | One purchase order with its lines |
| `POST /api/v1/purchases` | `purchases.write` | Raise a purchase order, or receive stock at once (receiveNow, markPaid with paymentMethod) |
| `PATCH /api/v1/purchases/:id` | `purchases.write` | Edit a draft or ordered purchase |
| `POST /api/v1/purchases/:id/receive` | `purchases.write` | Receive an order into batches, once, in one transaction |
| `POST /api/v1/purchases/:id/approve` | `purchases.approve` | Approve an order |
| `POST /api/v1/purchases/:id/cancel` | `purchases.write` | Cancel an order not yet received |
| `POST /api/v1/purchases/:id/payment` | `purchases.write` | Pay a supplier against an order: amount, method, date, reference (written to the supplier ledger) |

#### Selling and customers

| Endpoint | Who may call | What it does |
|---|---|---|
| `POST /api/v1/sales` | `pos.operate` | Ring up a sale: FEFO batches, prescription check, discount rules, payment |
| `GET /api/v1/sales` | `sales.read` | Sales history, filterable (each person sees their own unless reports.everyone) |
| `GET /api/v1/sales/:id` | `sales.read` | One invoice with its lines |
| `POST /api/v1/sales/:id/refund` | `sales.refund` | Refund a sale and return its stock |
| `GET /api/v1/customers` | `customers.read` | Customers with their balances |
| `GET /api/v1/customers/:id` | `customers.read` | One customer with sales, receipts and prescriptions |
| `POST /api/v1/customers` | `customers.write` | Add a customer |
| `PATCH /api/v1/customers/:id` | `customers.write` | Edit a customer |
| `DELETE /api/v1/customers/:id` | `customers.write` | Archive a customer |
| `GET /api/v1/prescriptions` | `prescriptions.read` | Prescriptions by status |
| `GET /api/v1/prescriptions/:id` | `prescriptions.read` | One prescription |
| `POST /api/v1/prescriptions` | `prescriptions.read` | Record a prescription (pending until a pharmacist verifies it) |
| `PATCH /api/v1/prescriptions/:id` | `prescriptions.read` | Edit a pending prescription |
| `POST /api/v1/prescriptions/:id/verify` | `prescriptions.verify` | Verify a prescription as a pharmacist |
| `POST /api/v1/prescriptions/:id/reject` | `prescriptions.verify` | Reject a prescription with a reason |

#### Cash book and day close

| Endpoint | Who may call | What it does |
|---|---|---|
| `POST /api/v1/customers/:id/payments` | `pos.operate` | Take an udhaar repayment and issue a receipt |
| `POST /api/v1/customer-payments/:id/reverse` | `sales.refund` | Reverse a receipt entered wrongly (the balance goes back up) |
| `GET /api/v1/customer-payments` | `customers.read` | The receipt ledger |
| `GET /api/v1/day-close/preview` | `day-close.manage` | What the drawer should hold for a day, before counting |
| `GET /api/v1/day-close` | `day-close.manage` | Day closings with variances |
| `POST /api/v1/day-close` | `day-close.manage` | Record the drawer count; the difference is kept, never corrected |
| `GET /api/v1/day-close/:id` | `day-close.manage` | One day closing |

#### Expenses

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/expenses` | `expenses.read` | Expenses with totals by category |
| `POST /api/v1/expenses` | `expenses.write` | Record an expense |
| `PATCH /api/v1/expenses/:id` | `expenses.write` | Edit an expense |
| `POST /api/v1/expenses/:id/approve` | `expenses.approve` | Approve an expense |
| `DELETE /api/v1/expenses/:id` | `expenses.write` | Delete an expense (kept in the audit trail) |

#### Accounts (accounting)

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/accounting/summary` | `accounting.view` | Profit and loss, cash in and out, receivables, payables and stock value, and twelve months' trend, for `?from&to` |
| `GET /api/v1/accounting/transactions` | `accounting.view` | Every movement in one ledger — sales by day, other income, expenses, salaries, supplier payments (`?direction=in\|out&q`) |
| `GET /api/v1/accounting/income` | `accounting.view` | Other income entries, paged, with the categories and payment methods |
| `POST /api/v1/accounting/income` | `accounting.manage` | Record other income (supplier bonus, shelf rent…) |
| `PATCH /api/v1/accounting/income/:id` | `accounting.manage` | Correct an income entry |
| `DELETE /api/v1/accounting/income/:id` | `accounting.manage` | Delete an income entry (kept in the audit trail) |
| `GET /api/v1/accounting/salaries` | `accounting.view` | Salary payments for `?period=YYYY-MM` or `?from&to` |
| `GET /api/v1/accounting/salaries/payees` | `accounting.manage` | The pharmacy's people, for the salary form |
| `POST /api/v1/accounting/salaries` | `accounting.manage` | Record a salary, advance or bonus (409 for a second salary in a month) |
| `PATCH /api/v1/accounting/salaries/:id` | `accounting.manage` | Correct a salary payment |
| `DELETE /api/v1/accounting/salaries/:id` | `accounting.manage` | Delete a salary payment (kept in the audit trail) |
| `GET /api/v1/accounting/export` | `accounting.view` · plan `reports.export` | Rows for a CSV: `kind=profit-and-loss\|transactions\|income\|salaries` |

#### Reports

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/dashboard` | `dashboard.view` | The dashboard: today, this month, stock, expiry, trend, top sellers (own figures unless reports.everyone) |
| `GET /api/v1/reports/overview` | `reports.view` | Revenue, gross and net profit, refunds and purchases for `?from&to` |
| `GET /api/v1/reports/sales-trend` | `reports.view` | Sales and profit by day or month |
| `GET /api/v1/reports/top-medicines` | `reports.view` · plan `reports.advanced` | Best sellers by revenue with profit |
| `GET /api/v1/reports/category-mix` | `reports.view` · plan `reports.advanced` | Sales and profit by category |
| `GET /api/v1/reports/staff-performance` | `reports.view` · plan `reports.advanced` | Each person's sales, profit and discounts |
| `GET /api/v1/reports/discounts` | `reports.view` · plan `reports.advanced` | Every discount: who, how much, why |
| `GET /api/v1/reports/people` | `reports.everyone` | The people and roles whose figures can be opened |
| `GET /api/v1/reports/expenses` | `reports.view` | Expenses by category and month |
| `GET /api/v1/reports/stock-valuation` | `reports.view` · plan `reports.advanced` | Stock at cost and retail, by category |
| `GET /api/v1/reports/export` | `reports.export` · plan `reports.export` | Rows for a CSV: `kind=sales\|items\|inventory\|expiry\|expenses\|audit` |

#### Messaging

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/messages/summary` | `messages.read` · plan `messaging.internal` | Unread message counts |
| `GET /api/v1/messages/recent` | `messages.read` · plan `messaging.internal` | The latest conversations, for the top bar |
| `GET /api/v1/messages/directory` | `messages.write` · plan `messaging.internal` | Who can be messaged: people and roles |
| `GET /api/v1/messages/conversations` | `messages.read` · plan `messaging.internal` | Conversations, filterable |
| `GET /api/v1/messages/conversations/:id` | `messages.read` · plan `messaging.internal` | One conversation with its messages |
| `POST /api/v1/messages/conversations` | `messages.write` · plan `messaging.internal` | Start a conversation with people, a role, or everyone |
| `POST /api/v1/messages/conversations/:id/messages` | `messages.write` · plan `messaging.internal` | Reply in a conversation |
| `POST /api/v1/messages/conversations/:id/read` | `messages.read` · plan `messaging.internal` | Mark a conversation read |
| `POST /api/v1/messages/read-all` | `messages.read` · plan `messaging.internal` | Mark every conversation read |
| `POST /api/v1/messages/conversations/:id/resolve` | `messages.write` · plan `messaging.internal` | Mark a conversation resolved |
| `POST /api/v1/messages/conversations/:id/mute` | `messages.read` · plan `messaging.internal` | Mute or unmute a conversation |
| `DELETE /api/v1/messages/messages/:id` | `messages.write` · plan `messaging.internal` | Delete one's own message |

#### Help and support (pharmacy side)

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/support/tickets` | `support.raise` | The pharmacy's help requests |
| `POST /api/v1/support/tickets` | `support.raise` | Ask KSF for help |
| `GET /api/v1/support/tickets/:id` | `support.raise` | One request with its conversation |
| `POST /api/v1/support/tickets/:id/messages` | `support.raise` | Reply to KSF on a request |
| `POST /api/v1/support/tickets/:id/close` | `support.raise` | Close a request |
| `POST /api/v1/support/tickets/:id/reopen` | `support.raise` | Reopen a request |

#### Subscription, billing and payments

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/billing` | `settings.read` | The subscription, plans, payment history, referrals, payment methods and the card on file |
| `GET /api/v1/billing/payments` | `settings.read` | Every subscription payment |
| `POST /api/v1/billing/plan` | `settings.write` | Choose a plan (a paid plan waits for payment; Basic applies at once) |
| `POST /api/v1/billing/auto-renew` | `settings.write` | Turn automatic renewal on or off (told to Stripe first) |
| `POST /api/v1/billing/cancel` | `settings.write` | Cancel: renewal stops, the paid period runs to its end |
| `POST /api/v1/billing/checkout` | `settings.write` | Start paying for a plan with a provider: answers the redirect (Stripe Checkout, JazzCash…) or bank-transfer instructions; the amount comes from the plan |
| `POST /api/v1/billing/portal` | `settings.write` | A link to Stripe's page for changing the card |
| `GET /api/v1/billing/providers` | `settings.read` | The payment providers and whether each is configured |
| `GET /api/v1/billing/attempts` | `settings.read` | Payment attempts and refunds |
| `GET /api/v1/billing/plans` | Pharmacy member | The plans on sale |
| `GET /api/v1/billing/entitlements` | Pharmacy member | The subscription's status, features and limits now — what the app unlocks |
| `GET /api/v1/billing/invoices` | `settings.read` | The pharmacy's invoices (every successful payment), paged |
| `GET /api/v1/billing/invoices/:id` | `settings.read` | One invoice: seller, buyer, lines, totals, refunds, payment |
| `POST /api/v1/payments/return/:provider` | Anyone | Where a provider's page returns the browser (form post); verified, then redirected to Billing |
| `GET /api/v1/payments/return/:provider` | Anyone | Where a provider's page returns the browser; Stripe is confirmed by looking the session up, never trusted |
| `POST /api/v1/payments/webhook/:provider` | Anyone | Provider webhooks: Stripe (Stripe-Signature, five-minute window, events recorded once), JazzCash, Easypaisa, gateway |
| `POST /api/v1/webhooks/payments/:provider` | Anyone | Generic subscription events signed with PAYMENT_WEBHOOK_SECRET (X-KSF-Signature) |

#### Setup checklist

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/setup/state` | Pharmacy member | The setup checklist, worked out from the real records |
| `POST /api/v1/setup/pharmacy` | `settings.write` | Set the pharmacy's name and type |
| `POST /api/v1/setup/address` | `settings.write` | Set the pharmacy's address and phone |
| `POST /api/v1/setup/licence` | `settings.write` | Record the DRAP licence and tax numbers |
| `POST /api/v1/setup/plan` | `settings.write` | Choose a plan during setup |
| `POST /api/v1/setup/dismiss` | `settings.write` | Hide the setup reminder |

#### Data import

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/migration/categories` | `medicines.read` | What can be imported, and whether the plan includes importing |
| `GET /api/v1/migration/template/:category` | `medicines.read` | A template file for one kind of data |
| `GET /api/v1/migration/jobs` | `medicines.read` | Import jobs |
| `GET /api/v1/migration/jobs/:id` | `medicines.read` | One import job with its rows |
| `POST /api/v1/migration/jobs` | `medicines.write` | Upload a CSV, Excel or JSON file to import |
| `POST /api/v1/migration/jobs/:id/suggest-mapping` | `medicines.write` | Suggest which column is which |
| `POST /api/v1/migration/jobs/:id/validate` | `medicines.write` | Check every row before importing |
| `POST /api/v1/migration/jobs/:id/items/:itemId` | `medicines.write` | Correct one row |
| `POST /api/v1/migration/jobs/:id/import` | `medicines.write` | Import the valid rows |
| `POST /api/v1/migration/jobs/:id/rollback` | `medicines.write` | Undo an import (step-up) |
| `GET /api/v1/migration/jobs/:id/report` | `medicines.read` | The import report |
| `GET /api/v1/migration/jobs/:id/reconciliation` | `medicines.read` | What was imported against what was in the file |

#### Medicine directory

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/medicine-directory` | Signed in | Search the medicine directory (`?q&category&letter`; the team also `?status&verified`) |
| `GET /api/v1/medicine-directory/:id` | Signed in | One directory entry: uses, precautions, side effects, interactions, brands, references |
| `POST /api/v1/platform/medicine-directory` | `platform.medicines.manage` | Add an entry (unverified) |
| `PATCH /api/v1/platform/medicine-directory/:id` | `platform.medicines.manage` | Edit an entry; changing what it says clears its verification |
| `POST /api/v1/platform/medicine-directory/:id/verify` | `platform.medicines.manage` | Verify an entry against its references, under one's own name |
| `DELETE /api/v1/platform/medicine-directory/:id` | `platform.medicines.manage` | Archive an entry |
| `POST /api/v1/platform/medicine-directory/import` | `platform.medicines.manage` | Import rows ({ rows }) or reload the starter set ({ starter: true }); each row accepted or refused with a reason |

#### Live updates

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/public/events` | Anyone | Server-Sent Events for visitors: plans.changed |
| `GET /api/v1/events` | Signed in | Server-Sent Events for signed-in people: plans.changed and subscription.changed (one's own pharmacy; every pharmacy for the platform team) |

#### Platform: overview and pharmacies

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/platform/overview` | `platform.overview` | Every pharmacy combined: sales, income, recurring revenue, plans, trials, open requests |
| `GET /api/v1/platform/pharmacies` | `platform.pharmacies.view` | Pharmacies, searchable and filterable by status and plan |
| `GET /api/v1/platform/pharmacies/:id` | `platform.pharmacies.view` | One pharmacy: figures, staff, branches, plan, payments, requests, activity |
| `PATCH /api/v1/platform/pharmacies/:id` | `platform.pharmacies.manage` | Edit a pharmacy's details |
| `POST /api/v1/platform/pharmacies/:id/status` | `platform.pharmacies.manage` | Suspend or reactivate a pharmacy (step-up; signs everybody out) |
| `POST /api/v1/platform/pharmacies/:id/subscription` | `platform.pharmacies.manage` | Change or extend a pharmacy's plan |
| `POST /api/v1/platform/pharmacies/:id/payments` | `platform.finance.manage` | Record a payment received outside a provider |

#### Platform: accounts (KSF's own books)

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/platform/accounts/summary` | `platform.finance.view` | KSF's own profit and loss for `?from&to`: subscriptions by plan, refunds, other income, provider fees and expenses; paying pharmacies, payments waiting and refunds owed; twelve months' trend |
| `GET /api/v1/platform/accounts/transactions` | `platform.finance.view` | Every platform money movement in one ledger: subscription payments, refunds, other income and expenses (`?direction=in\|out&q`) |
| `GET /api/v1/platform/accounts/entries` | `platform.finance.view` | The platform's other income and expenses (`?kind=income\|expense&category&q`), with totals, the categories and the team's names |
| `POST /api/v1/platform/accounts/entries` | `platform.finance.manage` | Record platform income (a setup fee) or an expense (team salaries, servers, software, rent): kind, category, amount, date, method, who |
| `PATCH /api/v1/platform/accounts/entries/:id` | `platform.finance.manage` | Correct a platform income or expense entry |
| `DELETE /api/v1/platform/accounts/entries/:id` | `platform.finance.manage` | Delete a platform entry; the deletion stays in the activity log |
| `GET /api/v1/platform/accounts/export` | `platform.finance.view` | Rows for a CSV of KSF's books: `kind=profit-and-loss\|transactions\|entries` |

#### Platform: income, payments and plans

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/platform/income` | `platform.finance.view` | Income by month, plan, provider and pharmacy, with refunds |
| `GET /api/v1/platform/payments/attempts` | `platform.finance.view` | Payments waiting: bank transfers to confirm, open checkouts |
| `POST /api/v1/platform/payments/attempts/:id/verify` | `platform.finance.manage` | Confirm a bank transfer against the statement (step-up; not by the person who requested it) |
| `POST /api/v1/platform/payments/:id/refund` | `platform.finance.manage` | Refund a payment, through the provider where it can (step-up) |
| `POST /api/v1/platform/refunds/:id/complete` | `platform.finance.manage` | Mark a refund made in the provider's own portal as complete |
| `POST /api/v1/platform/payments/reconcile` | `platform.finance.manage` | Ask providers about payments nobody heard back on; expire the stale |
| `GET /api/v1/platform/payments/providers` | `platform.finance.view` | Every way to pay: switched on or not, the setting names it still needs (never values), test or live, and its webhook and return addresses |
| `GET /api/v1/platform/invoices/:id` | `platform.finance.view` | Any pharmacy's invoice, as the pharmacy sees it |
| `GET /api/v1/platform/plans` | Platform team | Every plan with how many pharmacies are on it, and the feature catalogue |
| `POST /api/v1/platform/plans` | `platform.plans.manage` | Create a plan |
| `PATCH /api/v1/platform/plans/:key` | `platform.plans.manage` | Change a plan's price, limits, features or status — pushed live to every open screen |

#### Platform: people, activity and notices

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/platform/users` | `platform.help` or `platform.support` | Find any pharmacy user by name, e-mail or phone |
| `GET /api/v1/platform/help` | `platform.help` | Everyone who could not sign in today, and why |
| `GET /api/v1/platform/activity` | `platform.activity` | The platform activity log |
| `GET /api/v1/platform/security` | `platform.activity` | Security events across the platform |
| `GET /api/v1/platform/notifications` | Platform team | The platform notices this person may see |
| `POST /api/v1/platform/notifications/:id/read` | Platform team | Mark a platform notice read (for this person) |
| `POST /api/v1/platform/notifications/read-all` | Platform team | Mark every platform notice read (for this person) |

#### Platform: support desk

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/platform/support/agents` | `platform.support` | Who can be given a request |
| `GET /api/v1/platform/support/tickets` | `platform.support` | The support desk queue (`?assignee=me\|none\|<id>`) |
| `GET /api/v1/platform/support/tickets/:id` | `platform.support` | One request with its conversation |
| `POST /api/v1/platform/support/tickets/:id/messages` | `platform.support` | Reply to a pharmacy (shown to them as KSF Support) |
| `PATCH /api/v1/platform/support/tickets/:id` | `platform.support` | Change a request's status, priority or who it is given to |

#### Platform: the Super Admin's team

| Endpoint | Who may call | What it does |
|---|---|---|
| `GET /api/v1/platform/team` | Super Admin | The Super Admin's team, their roles and the permission catalogue |
| `POST /api/v1/platform/team` | Super Admin | Add a team member with a role and a temporary password |
| `PATCH /api/v1/platform/team/:id` | Super Admin | Edit a team member, change their role, suspend |
| `POST /api/v1/platform/team/:id/reset-password` | Super Admin | Give a team member a new temporary password |
| `POST /api/v1/platform/team/:id/sign-out` | Super Admin | Sign a team member out everywhere |
| `DELETE /api/v1/platform/team/:id` | Super Admin | Remove a team member |
| `PUT /api/v1/platform/team/:id/avatar` | Super Admin | Set a team member's photo (JPEG, PNG or WebP data URL) |
| `DELETE /api/v1/platform/team/:id/avatar` | Super Admin | Remove a team member's photo |
| `PUT /api/v1/platform/me/avatar` | Platform team | Set one's own photo |
| `DELETE /api/v1/platform/me/avatar` | Platform team | Remove one's own photo |
| `POST /api/v1/platform/team/roles` | Super Admin | Create a team role from platform permissions |
| `PATCH /api/v1/platform/team/roles/:id` | Super Admin | Change a team role |
| `DELETE /api/v1/platform/team/roles/:id` | Super Admin | Delete a team role nobody holds (409 otherwise) |

---

## Project layout

```
backend/        Express + TypeScript API
  src/          see "How it is built"
frontend/       React + TypeScript website and application
  src/pages/    one screen per file; platform/ is the Super Admin console,
                accounts/ and directory/ the parts of those two screens
  src/styles/   tokens.css (design tokens), themes.css (the five themes), …
deploy/         Docker image, docker-compose (app, Nginx, optional MongoDB), Nginx
docs/           architecture, environment, backups, payments, brand, client report
scripts/        the development launcher, and the university copy
tests/          unit and API test suites
windows/        double-click launchers for Windows
```

---

## Testing

```bash
npm test
```

| Suite | What it proves |
|---|---|
| `tests/unit.test.mjs` | Import parsing, money and dates, payment rules and signatures (Stripe's included), passwords, authenticator codes, stock rules, roles and themes, the live feed's audiences, the calculator, telling a barcode scanner from a person typing, that every screen is guarded, and that this README lists every route. Needs no database |
| `tests/api.test.mjs` | The whole platform over HTTP: sign-up, stock, the till, refunds, day close, reports, staff, messaging, themes, support tickets, the platform console, support mode, data import, tenant isolation, suspension, and the Super Admin changing their own e-mail and password |
| `tests/accounting.test.mjs` | The accounts to the paisa: profit and loss, cash flow, other income, salaries, supplier payments, the ledger and the downloads |
| `tests/live.test.mjs` | A price change reaching a visitor's open page, a subscription change reaching its own pharmacy and no other, replay after a reconnect, and a feature locking and unlocking on the server the moment the plan changes |
| `tests/stripe.test.mjs` | Checkout at the plan's price, signed webhooks (forged, stale and unsigned ones refused; a repeat applied once), renewals at the right price, a failed renewal's grace period, cancellation, refunds and numbered invoices, against a stand-in for Stripe's API |
| `tests/directory.test.mjs` | The starter set, searching by name, other name, brand or category, verification and its reset when the words change, drafts and archived entries kept from pharmacies, imports, and that only the team members whose role includes it can change it |
| `tests/access.test.mjs` | Every role: refused without the permission, every built-in role's screens, the platform kept apart, and no pharmacy reading another's records |
| `tests/platform-accounts.test.mjs` | KSF's own books to the paisa (subscriptions, refunds, other income, expenses), the ledger and downloads, finance roles only, one slip number per pharmacy, and the payment-methods check |
| `tests/scanning.test.mjs` | Scanning at the till: a barcode with or without its leading zero, the GS1 DataMatrix on a pack, an unknown barcode saved on its medicine (and nothing else changed), a cashier who can scan but not change the catalogue, and no two medicines sharing a barcode |

The API suites run against a real MongoDB in a throwaway database
(`ksf_test_<random>`) that is dropped afterwards. Point them at a server with
`TEST_MONGODB_URI`; `tests/README.md` has the details.

---

## University edition

```bash
npm run university:copy -- --out ../ksf-university --student "Name" --university "Name" [--archive]
```

Makes a **separate, independently working copy** for academic submission,
isolated from the commercial service: its own folder and git history, its own
`.env` (its own database name, freshly generated keys, its own Super Admin,
e-mail written to files), and online payments switched off
(`KSF_EDITION=university`). The commercial deployment settings and client
documents are left out. Nothing in this repository changes.

Inside the copy, `npm run seed:demo` fills an empty database with one
demonstration pharmacy — an Admin and one person in every built-in role,
stock, sales, purchases, accounts and a prescription — and the copy's
`UNIVERSITY.md` explains how to run, demonstrate and test it.

---

## Deployment

`deploy/README.md` covers a production server with Docker (the app, Nginx
with HTTPS, and MongoDB Atlas or a bundled replica set), Railway (API) with
Vercel (website), and the settings that must change for production:
`NODE_ENV=production`, `COOKIE_SECURE=true`, your domain in `PUBLIC_APP_URL`
and `PUBLIC_ALLOWED_ORIGINS`, SMTP for e-mail, and — to take card payments —
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with the webhook registered in
Stripe (`docs/PAYMENTS.md`).

**Is the new version live?** Open the production address — on Vercel that is
`https://ksf-x86j.vercel.app` (or your own domain), not an address with an id
in it such as `ksf-x86j-6xq7t510v-ssam1.vercel.app`: each of those is one
frozen build and never changes. The version is in the website's footer and in
`/api/v1/health`, and the platform Overview (and a pharmacy's Settings ›
System) compares the two: "Website 2.3.0 · Server 2.3.0 — up to date", or
which one still has to redeploy from `main` (Railway › the service ›
Deployments, or Vercel › Deployments).

---

## Further reading

| Document | For |
|---|---|
| `DATABASE_SETUP.md` | Setting up MongoDB (Atlas or local), first start, backups |
| `CHANGELOG.md` | What changed in each release |
| `docs/ARCHITECTURE.md` | Modules, collections, sign-in flow, transactions |
| `docs/ENVIRONMENT.md` | Every setting in `.env` |
| `docs/BACKUP_AND_RESTORE.md` | Backups, restores, Atlas snapshots |
| `docs/PAYMENTS.md` | Subscription payments: Stripe, bank transfer, JazzCash, Easypaisa |
| `docs/BRAND_GUIDE.md` | The logo, colours and where each appears |
| `docs/HANDOVER_REVIEW.md` | What was verified for release 2.0.0, and how |
| `docs/client-report/` | The client report (PDF and Word) |

---

Created by **Saad Bin Saeed Khan** — Software Engineer — MPhil/MS Scholar.
