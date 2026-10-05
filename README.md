# KSF Pharmacy Management System

A multi-pharmacy SaaS platform for Pakistan. Each pharmacy runs its counter,
stock, purchasing, prescriptions, customers and accounts in KSF; one platform
**Super Admin** runs the service itself — every pharmacy, their plans and
payments, and the support requests they raise.

**Version 2.0.0** · React 18 + TypeScript · Express 5 + TypeScript · MongoDB 7

---

## Contents

1. [What it does](#what-it-does)
2. [Quick start](#quick-start)
3. [Commands](#commands)
4. [How it is built](#how-it-is-built)
5. [Security model](#security-model)
6. [Roles, support mode and themes](#roles-support-mode-and-themes)
7. [Project layout](#project-layout)
8. [Testing](#testing)
9. [Deployment](#deployment)
10. [Further reading](#further-reading)

---

## What it does

**For a pharmacy**

| Area | What is in it |
|---|---|
| Till | Barcode or search, FEFO batch allocation, prescription checks, cash / card / Easypaisa / JazzCash / bank / credit (udhaar), reasoned discounts with a per-pharmacy limit, printable 76 mm receipt |
| Stock | Medicines, categories, batches with expiry, adjustments after a count, quarantine and write-off, low-stock and expiry alerts, a full movement ledger |
| Buying | Suppliers, purchase orders, receiving into stock (atomically), part payments, what is owed to whom |
| People | Customers with allergies and credit limits, repayments and reversals, prescriptions verified by a pharmacist |
| Money | Expenses with approval, close-the-day drawer count with variance, reports by period, person, role, category and discount, CSV export |
| Team | Staff accounts, five built-in roles plus custom roles, per-person figures, internal messaging, device limits, two-step sign-in |
| Account | Self-service sign-up with e-mail verification, setup checklist, subscription and billing, referrals, data import (CSV / Excel / JSON) with validation, reconciliation and rollback |
| Help | **Help & Support**: raise a request to KSF and follow the conversation |

**For the platform Super Admin**

| Area | What is in it |
|---|---|
| Overview | All pharmacies combined: their sales today and this month, your income this month and all time, monthly recurring revenue, plans, trials, open support requests |
| Pharmacies | Every pharmacy, searchable by name, city or Admin; one page per pharmacy with its figures, staff, branches, plan, payments, support history and activity |
| Actions | Edit a pharmacy, change or extend its plan, record an offline payment, suspend / reactivate (signs everybody out at once), and **work inside** any pharmacy in support mode |
| Support desk | Every request from every pharmacy in one queue, answered in a thread; the pharmacy is notified and e-mailed |
| People who need help | Anyone, anywhere, who could not sign in today — locked, wrong password, device limit, lost authenticator — and a search across every account |
| Income & plans | Payments by month, plan, method and pharmacy; bank transfers to confirm; refunds; plan prices, limits and features |

There is **no demonstration data**. A new installation contains the
subscription plans and one account — the Super Admin. Pharmacies sign up
themselves from the website.

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
| `npm test` | Unit tests and the full API suite (see [Testing](#testing)) |
| `npm run db:check` | Connects, and reports version, transactions, collections, plans and the Super Admin |
| `npm run db:backup` | Writes a compressed, checksummed backup to `.data/backups` and verifies it reads back |
| `npm run db:verify -- <file>` | Verifies a backup file |
| `npm run db:restore -- <file> --yes` | Restores a backup (backs up the current data first) |
| `npm run db:reset -- --yes` | Empties a development database and sets it up again |
| `npm run secrets -- --write` | Generates new JWT and webhook secrets into `.env` |

---

## How it is built

```
 Browser (React 18, TypeScript, Vite)
   │  Authorization: Bearer <access token, in memory only>
   │  Cookie: ksf_refresh (HttpOnly, Path=/api/v1/auth, rotated on every use)
   ▼
 Express 5 API (TypeScript, Node 20+)          backend/src
   ├─ http/        app, authentication, route registry, cookies
   ├─ modules/     one file per area: auth, account, people, catalogue, inventory,
   │               purchasing, selling, cashbook, reporting, messaging, billing,
   │               setup, migrate, support, platform, admin
   ├─ services/    subscriptions, payments, referrals, mailer, data import
   ├─ security/    passwords (scrypt), JWT sessions, devices, one-time codes, TOTP
   ├─ db/          connection, transactions, document types, indexes, bootstrap
   └─ cli/         db:check, backup, restore, reset, secrets
   ▼
 MongoDB 7 (replica set or Atlas — multi-document transactions)
```

- **Every route states who may call it** in one line — `publicRoute`,
  `accountRoute`, `platformRoute`, or `route(method, path, 'permission')` — and
  the check runs before the handler, for every request.
- **Tenancy is enforced in every query**: each pharmacy document carries
  `pharmacy_id`, and handlers only ever read with the caller's.
- **Money is integer paisa** everywhere; rupees exist only on screen.
- **Stock never goes below zero by accident**: sales decrement batches with
  conditional, atomic updates inside a transaction, so two tills selling the
  last pack cannot both succeed.
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
| Brute force | Per-account lock-out, per-IP limits on sign-in and sign-up, write throttling |
| Headers | Helmet: strict CSP (`script-src 'self'`), HSTS in production, frame denial |
| Webhooks | HMAC-SHA256 over the raw body, amounts checked against what the server asked for, idempotent |

---

## Roles, support mode and themes

- **Super Admin** — one account for the whole platform, created from `.env`
  on the first start and changed from **My account** afterwards. Sees the
  platform console, not a pharmacy.
- **Support mode** — the Super Admin opens any pharmacy ("Work inside") and
  has every permission there, to fix what the pharmacy cannot: unlock a
  cashier, reset a password, correct a role. A banner says whose pharmacy it
  is; every action is logged as *Super Admin (support)*.
- **Pharmacy roles** — Admin (the person who registered, every permission),
  Regional Manager, Branch Manager, Pharmacist, Cashier. The Admin can create
  any other role by ticking permissions, and can never grant more than they
  hold. Seniority decides who may act on whom.
- **Themes** — five colour themes (KSF Green, Ocean Blue, Royal Purple, Sunset
  Amber, Graphite), each with light and dark mode. The pharmacy Admin sets the
  pharmacy's theme in **Settings › Appearance** and chooses which roles may
  pick their own.

---

## Project layout

```
backend/        Express + TypeScript API
  src/          see "How it is built"
frontend/       React + TypeScript website and application
  src/pages/    one screen per file; platform/ is the Super Admin console
  src/styles/   tokens.css (design tokens), themes.css (the five themes), …
deploy/         Docker image, docker-compose (app, Nginx, optional MongoDB), Nginx
docs/           architecture, environment, backups, payments, brand, client report
scripts/        the development launcher
tests/          unit and API test suites
windows/        double-click launchers for Windows
```

---

## Testing

```bash
npm test
```

- `tests/unit.test.mjs` — import parsing, money and dates, payment rules and
  signatures, passwords, authenticator codes, stock rules, roles and themes.
  Needs no database.
- `tests/api.test.mjs` — the whole platform over HTTP against a real MongoDB:
  sign-up, stock, the till, refunds, day close, reports, staff, messaging,
  themes, support tickets, the platform console, support mode, data import,
  tenant isolation, suspension, and the Super Admin changing their own e-mail
  and password. It runs in a throwaway database (`ksf_test_<random>`) that is
  dropped afterwards. Point it at a server with `TEST_MONGODB_URI`.

---

## Deployment

`deploy/README.md` covers a production server with Docker (the app, Nginx
with HTTPS, and MongoDB Atlas or a bundled replica set), and the settings that
must change for production: `NODE_ENV=production`, `COOKIE_SECURE=true`, your
domain in `PUBLIC_APP_URL` and `PUBLIC_ALLOWED_ORIGINS`, and SMTP for e-mail.

---

## Further reading

| Document | For |
|---|---|
| `DATABASE_SETUP.md` | Setting up MongoDB (Atlas or local), first start, backups |
| `CHANGELOG.md` | What changed in each release |
| `docs/ARCHITECTURE.md` | Modules, collections, sign-in flow, transactions |
| `docs/ENVIRONMENT.md` | Every setting in `.env` |
| `docs/BACKUP_AND_RESTORE.md` | Backups, restores, Atlas snapshots |
| `docs/PAYMENTS.md` | Subscription payments and providers |
| `docs/HANDOVER_REVIEW.md` | What was verified for this release, and how |
| `docs/client-report/` | The client report (PDF and Word) |

---

Created by **Saad Bin Saeed Khan** — Software Engineer — MPhil/MS Scholar.
