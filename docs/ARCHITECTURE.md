# Architecture

**KSF Pharmacy Management System 2.0**

How the system is put together, for the engineer who maintains it next.

---

## 1. Shape

```
frontend/  React 18 + TypeScript (strict) + Vite      the website and the application
backend/   Express 5 + TypeScript (strict, NodeNext)  the API; also serves the built website
MongoDB 7  replica set or Atlas                       one database, every pharmacy in it
```

One deployable unit: in production `node backend/dist/server.js` serves the
API under `/api/v1` and the built website from `frontend/dist`, behind Nginx
for TLS. In development Vite serves the website and proxies `/api` to the
API (`npm run dev` starts both).

The website is one bundle with two faces: the public marketing site and
sign-up (`/`, `/pricing`, `/register` …), and the application, which shows a
pharmacy's workspace or — for the Super Admin — the platform console.

---

## 2. Backend layout

```
backend/src/
  server.ts          start-up: connect, bootstrap, listen, graceful shutdown
  config/env.ts      .env read once and validated with zod
  http/
    app.ts           Express app: Helmet, CORS by allow-list, body limits,
                     the access check for every route, error envelope
    router.ts        publicRoute / accountRoute / platformRoute / route(perm)
    authenticate.ts  Bearer token → session → person → device → pharmacy → role
    context.ts       the typed context every handler receives
    cookies.ts       refresh and device cookies
  modules/           one file per area; each registers its routes on import
    auth, account, people, catalogue, inventory, purchasing, selling,
    cashbook, reporting, messaging, billing, setup, migrate, support,
    platform, admin, shared (helpers used by several modules)
  services/          logic used by more than one module
    subscriptions, payments/ (provider, adapters, index), referrals,
    mailer, migration (+ tabular parsing, reconciliation report)
  security/          password (scrypt), sessions (JWT), devices, otp, totp, crypto
  domain/            permissions and built-in roles, plan catalogue
  db/
    mongo.ts         client, typed collections, tx() transactions
    types.ts         one interface per collection
    bootstrap.ts     indexes, plans, the Super Admin
    pipeline.ts      shared aggregation stages
  core/              errors, utilities (money, dates, ids), audit trails
  cli/               db:check, db:backup / verify, db:restore, db:reset, secrets
```

### A request, end to end

1. `app.ts` matches the route and reads its **access type**.
2. `public` routes run at once (with an origin check on POSTs).
3. Otherwise `authenticate.ts` verifies the Bearer JWT (signature, issuer,
   audience, expiry), loads the **session** (revoked? idle? past absolute
   expiry?), the person (active?), the device (still registered?), the
   pharmacy (suspended?) and the role's permissions — fresh, on every request.
4. `platform` routes require the Super Admin; `pharmacy` routes require a
   pharmacy context and the named permission.
5. The handler receives a typed context: `ctx.user`, `ctx.pharmacyId`,
   `ctx.body`, `ctx.query`, `ctx.params`, `ctx.ip`. Every pharmacy query is
   written with `ctx.pharmacyId`.
6. Errors are `HttpError(status, message, field?, code?)` and leave as
   `{ message, field?, code? }`; the web app shows the message as written.
   An unexpected error is logged with a short correlation id, which is the
   only thing the caller sees besides a polite message.

### API conventions

- JSON in **snake_case**, flags as `0`/`1`, ids as readable strings
  (`MED-…`, `SAL-…`), timestamps ISO-8601 UTC, money as integer **paisa**.
- Lists return `{ data, total? }`; documents never expose `_id`.
- `403 step_up_required` asks the web app to confirm the password, then
  retries the request — it never signs the person out.

---

## 3. Data

All pharmacy data sits in shared collections, each document carrying
`pharmacy_id`; every index used by pharmacy screens starts with
`pharmacy_id`. Platform-wide collections (plans, the Super Admin's own
notifications) have `pharmacy_id: null`.

| Group | Collections |
|---|---|
| Tenancy and people | `pharmacies`, `branches`, `roles` (permissions embedded), `users`, `settings`, `counters` |
| Sign-in | `sessions`, `devices`, `login_attempts`, `verification_codes`, `recovery_codes`, `registrations` |
| Catalogue and stock | `categories`, `medicines`, `batches`, `stock_movements` |
| Buying | `suppliers`, `purchases` (items embedded) |
| Selling | `sales` (items and payments embedded), `customers`, `customer_payments`, `prescriptions` (items embedded) |
| Money | `expenses`, `day_closings` |
| Communication | `conversations` (members embedded), `messages`, `notifications`, `support_tickets` (messages embedded), `mail_deliveries` |
| Records | `activity_logs`, `audit_logs` + `audit_heads` (hash chain), `security_events` |
| Subscriptions | `subscription_plans`, `subscriptions`, `subscription_payments`, `payment_attempts`, `payment_refunds`, `webhook_events`, `trials` |
| Referrals | `referral_codes`, `referrals` |
| Data import | `migration_jobs`, `migration_items` |

Embedding is used where the child never lives without the parent and is
always read with it (a sale's lines, a role's permissions, a ticket's
thread). Anything queried on its own — batches, movements, payments — is its
own collection.

### Consistency

- **Transactions.** `tx(fn)` runs `fn` inside a MongoDB transaction; the
  session is carried in `AsyncLocalStorage`, so code inside simply writes
  `{ session: s() }`. A sale (stock, movements, receipt number, customer
  credit), receiving a purchase, a refund and an import each commit whole or
  not at all.
- **Stock cannot oversell.** Each batch decrement is a conditional
  `findOneAndUpdate({ quantity: { $gte: n } }, { $inc: { quantity: -n } })`.
  If any line fails, the transaction aborts. On a standalone server without
  transactions, the decrements already made are reversed before the error is
  returned.
- **Numbers.** Receipt and document numbers come from `counters` with an
  atomic `$inc` per pharmacy and document type, so two tills are never
  handed the same number.
- **Idempotency.** Payment callbacks are deduplicated by a unique index on
  `(provider, provider_reference)` and by `webhook_events`.

---

## 4. Sign-in

```
POST /auth/login ─────► password (scrypt) ─► lock-out / device checks ─► 2FA?
                        │
                        ▼
              session row created ─► access JWT (15 min, body)
                                   ─► refresh JWT (7 days, HttpOnly cookie)

POST /auth/refresh ───► refresh JWT verified with its own secret
                        jti hash == session's current hash ?
                          yes ─► rotate: new jti, new refresh cookie, new access token
                          no  ─► token was copied: revoke the session
```

The web app (`frontend/src/services/api.ts`) keeps the access token in a
module variable. When it expires, the next request is answered
`401 token_expired`; the module refreshes **once** — however many requests
were in flight — and repeats them. A refresh that fails means the session
is over and the person is returned to sign-in.

**Step-up.** Sensitive routes call `ctx.requireRecentVerification()`, which
checks when the password was last confirmed against `STEP_UP_MINUTES`.
Otherwise `403 step_up_required`; the web app asks for the password
(`POST /auth/verify-identity`) and retries the original request.

---

## 5. Roles and permissions

`domain/permissions.ts` lists every permission (`pos.operate`,
`sales.refund`, `inventory.adjust`, `appearance.theme`, `support.raise`, …)
and the five built-in roles with a **level** each:

| Role | Level | Notes |
|---|---|---|
| Admin | 100 | Every permission. The person who registered the pharmacy (`is_owner`) |
| Regional Manager | 70 | Several branches, their staff and stock; no pharmacy settings |
| Branch Manager | 60 | One branch: stock, purchasing, refunds, the day's numbers |
| Pharmacist | 50 | Prescriptions, dispensing, the catalogue and stock |
| Cashier | 30 | The till and customers |

Custom roles are built by ticking permissions. Two rules are enforced on
the server: a person cannot grant a permission they do not hold, and cannot
act on someone of equal or higher level.

The **Super Admin** (`is_platform_admin: 1`, `pharmacy_id: null`) holds no
pharmacy role. Sending `X-Pharmacy-Id` puts them in **support mode** for
that pharmacy with every permission; `activity_logs` and `audit_logs`
record them as *Super Admin (support)*.

---

## 6. Themes

`frontend/src/styles/tokens.css` defines every colour as a CSS custom
property; `themes.css` overrides the brand set for `html[data-brand="…"]`
(ocean-blue, royal-purple, sunset-amber, graphite; KSF Green is the default)
and each has a dark variant under `data-theme="dark"`. `public/theme.js`
applies the saved choice before the first paint, so there is no flash.

The pharmacy's theme is stored in its settings; a person's own choice in
`users.theme`. Whether a role may choose its own is the `appearance.theme`
permission, which the Admin grants role by role in **Settings ›
Appearance** (or on the Roles screen).

---

## 7. Front end

```
frontend/src/
  App.tsx              routes: public site, pharmacy workspace, platform console
  context/AppContext   the signed-in person, permissions, workspace, support mode
  services/api.ts      fetch wrapper: tokens, refresh, step-up, errors
  components/          Layout (shell, sidebar, topbar), ui (Modal, Menu, Table…),
                       support (ticket list and thread), auth-ui
  pages/               one screen per file; platform/ = Super Admin console;
                       settings/ = Billing, Data migration; site/ = public pages
  styles/              tokens, themes, base, layout, components, per-area sheets
  types/               API shapes
```

Layout is full-width with seven breakpoints — xxs < 360, xs 360–479,
sm 480–639, md 640–1023, lg 1024–1279, xl 1280–1535, xxl ≥ 1536. Below
1100 px the sidebar becomes a drawer; below 720 px the five daily actions
move to a bottom bar.

---

## 8. Tests

`tests/unit.test.mjs` (no database) and `tests/api.test.mjs` (the whole API
over HTTP against a throwaway MongoDB database). See `tests/README.md`.
