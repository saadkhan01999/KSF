# Quality and security audit — KSF 2.7.0

November 2026. This audit covers the repository as it stood at 2.6.4 and the
changes made for 2.7.0. Every figure below comes from a command that was
actually run; where something could not be checked, the report says so.

Each item carries one of these statuses:

| Status | Meaning |
|---|---|
| **COMPLETED AND VERIFIED** | Done, and checked by running it |
| **IMPLEMENTED BUT NOT FULLY VERIFIED** | Done, but not every part could be checked |
| **FAILED** | Tried, and it does not work |
| **BLOCKED** | Could not be done or checked here, for the reason given |
| **NOT IMPLEMENTED** | Deliberately not done this time, for the reason given |

No quality score is claimed. The aim was better software, measured by the
checks below, not a number from an assessment tool.

---

## 1. Executive summary

KSF began this audit in good shape for a single-developer project. It already
had:
- a central route registry with authorisation on every request;
- scrypt password hashing and pinned JWTs;
- rotating refresh tokens with replay detection;
- tenant-isolation tests over every route;
- a strict Content-Security-Policy;
- 163 passing tests.

It had no linter, no CI, no dependency monitoring and no coverage gate.

The audit found and fixed these problems, each now covered by a test:
- an open redirect check that matched by prefix;
- two-step sign-in tickets and brute-force counters held in one server's
  memory. On Vercel's many instances this made two-step sign-in unreliable
  and the limits easy to reset;
- authenticator codes that could be replayed within their validity window;
- request bodies of any shape and up to 12 MB on every route;
- an unreadable body answered with a 500;
- one high and three moderate dependency advisories.

The audit also added:
- a security suite that feeds **all 268 endpoints** hostile input;
- a generated API inventory;
- ESLint, with every finding fixed;
- coverage thresholds;
- a GitHub Actions pipeline, which ran green on this pull request;
- Dependabot;
- security and contribution documents.

The main things still outstanding:
- browser end-to-end tests are not in the repository;
- 27 explicit `any` remain at trust boundaries;
- one moderate React Router advisory is mitigated but not upgraded;
- the credentials shared during the Vercel set-up should be replaced
  (section 12).

## 2. The project before the audit (2.6.4)

| Area | Found |
|---|---|
| Tests | 163, all passing (`npm test` against a MongoDB replica set) |
| Backend coverage | 86.17% lines, 64.19% branches, 82.91% functions (`backend/src`, CLI aside) |
| Lint | None configured. ESLint, once added, reported **68 errors and 9 warnings** |
| CI | None (no `.github/` directory) |
| Dependency monitoring | None |
| `npm audit` | 1 high (body-parser, denial of service), 1 high (Vite, development server only), 2 moderate (qs, React Router) |
| Security documentation | A security-model table in the README; no `SECURITY.md` |
| API documentation | Every route listed in the README, checked by a unit test |
| Secrets in git history | None found: the matches were placeholders, and no `.env` file was ever committed |

## 3. Technologies and architecture

| Layer | What it is |
|---|---|
| Frontend | React 18.3, React Router 6.30, TypeScript 5.7, Vite 6.4; 115 files, about 28,600 lines |
| Backend | Express 5.2, TypeScript 5.7 (NodeNext ESM), MongoDB driver 7.7; 72 files, about 17,800 lines |
| Database | MongoDB 7, run as a replica set (multi-document transactions); collections and indexes created at start-up (`backend/src/db/bootstrap.ts`) |
| Authentication | Access JWT (HS256, 15 min) in memory; a refresh JWT in an HttpOnly cookie, rotated on use; server-side sessions; TOTP two-step with recovery codes; device limits; step-up for sensitive actions |
| Authorisation | One route registry (`backend/src/http/router.ts`) declaring each endpoint as public, account, pharmacy (permission, plan feature) or platform (team role), enforced in `backend/src/http/app.ts` |
| Live updates | Server-sent events fed by MongoDB change streams, falling back to polling |
| Payments | Stripe Checkout, bank transfer confirmed by the Super Admin, JazzCash and Easypaisa signed forms |
| Package manager | npm workspaces (`frontend`, `backend`), one lockfile |
| Tests | `node:test` with `tsx`; the API suites start the real app in-process on a throwaway database |
| Deployment | Vercel (Root Directory `frontend`, the two-service set-up, or `deploy/vercel`), all on one shared handler (`backend/index.js`); Docker with Nginx for a VPS (Hostinger) |

The architecture is sound:
- authorisation is declared once per route and checked in one place;
- every module owns one domain, with business rules in `services/`;
- the database layer is typed (`db/types.ts`).

No architectural change was needed. Section 6 explains why no large
refactor was made.

## 4. Main issues identified

| # | Problem | Files | Severity | Impact | Fix | Verified by |
|---|---|---|---|---|---|---|
| F1 | A handler-result redirect was allowed when it only **started with** `PUBLIC_APP_URL`, so `https://<app>.evil.com/...` passed | `backend/src/http/app.ts` | Low (latent: today's redirect targets are built by the server, but the check is the guard for future ones) | An open redirect from a payment return | `isSafeRedirect()` compares origins exactly | `tests/security.test.mjs` |
| F2 | Redirect checks ignored tabs and line breaks, which browsers delete, so `/<tab>/evil.com` became `//evil.com` | `backend/src/http/app.ts`, `frontend/src/utils/format.ts` | Low | The same open redirect, by a different path | Control characters refused | `tests/security.test.mjs` |
| F3 | Two-step sign-in tickets and the sign-in, sign-up, code and reset counters lived in one instance's memory | `backend/src/modules/auth.ts`, `backend/src/modules/account.ts`, `backend/src/core/util.ts` | Medium | On Vercel a correct two-step code could be refused (ticket on another instance), and brute-force limits reset on every cold start | Moved to MongoDB with TTL indexes (`security/throttle.ts`); tickets stored by hash | `tests/security.test.mjs` (counter and ticket in the database, never the raw ticket) |
| F4 | An authenticator code could be used again while still valid (about 90 seconds, with drift) | `backend/src/security/totp.ts` and its three callers | Medium | Someone who sees a code and knows the password signs in again | Last accepted step recorded atomically; reuse refused | `tests/security.test.mjs` (replay refused, the next step accepted) |
| F5 | Nothing stopped operator keys (`{"$ne": null}`) or `__proto__` in a body before the handler | `backend/src/http/app.ts` | Low (no exploitable path found: handlers convert fields to strings and numbers) | Defence in depth missing | `unsafeKey()` guard, 400 `invalid_field` | `tests/security.test.mjs`; without the guard the payload reached the login handler (401) |
| F6 | An unreadable body (charset or encoding) was answered with **500** | `backend/src/http/app.ts` | Low | Noise in the error log; a request fault reported as a server fault | 4xx for reader errors | `tests/security.test.mjs`; without the fix: `expected 415, actual 500` |
| F7 | A 12 MB body limit on every route | `backend/src/http/app.ts` | Low | Memory to spare for a flood of large requests | 2 MB, with 12 MB only on the two file imports | `tests/security.test.mjs` (413) |
| F8 | Vulnerable dependencies: body-parser (high), Vite (high, development only), qs and React Router (moderate) | `package-lock.json`, `frontend/package.json` | High (body-parser) | Denial of service through a compressed body | `npm audit fix`; Vite 6.4.5. React Router: section 13 | `npm audit --omit=dev --audit-level=high` exits 0, locally and in CI |
| F9 | No lint, CI, coverage gate or dependency monitoring | the repository | Medium (process) | Regressions noticed late or never | ESLint, GitHub Actions, thresholds, Dependabot | The CI run in section 14 |
| F10 | 68 lint errors: unused code, dead assignments, invisible characters typed into regexes, a rethrown error without its cause, browser globals | 20 files | Low | Readability, and a few latent bugs | All fixed (section 6) | `npm run lint`: 0 errors |
| F11 | Sign-out, password reset, sign-out everywhere, two-step sign-in, recovery codes and session lists had no functional test | `tests/` | Medium (coverage of security flows) | Regressions in the most sensitive flows would go unnoticed | Tests added | `tests/security.test.mjs` |
| F12 | React hooks: a camera cleanup reading a ref that may have changed; two arrays rebuilt every render, defeating memoisation; two suppressions on the wrong line | 5 frontend files | Low | Needless re-renders; a cleanup touching the wrong element | Fixed | `npm run lint`, `npm run build` |
| F13 | 27 explicit `any` at trust boundaries: the shared request-body type and payment providers' JSON | 13 backend files | Low (technical debt) | Less help from the compiler where input arrives | Kept as capped warnings | `npm run lint` (`--max-warnings=27`) |

What was checked and found sound:
- **Passwords:** scrypt with per-user salt.
- **JWTs:** HS256 pinned, issuer and audience checked.
- **Refresh tokens:** rotation and replay detection.
- **Brute force:** per-account lock-out stored in the database.
- **Origins:** public writes refused from other sites, credentialed CORS
  only for configured origins.
- **Headers:** helmet CSP with `script-src 'self'`.
- **Payments:** webhook signatures over the raw body, applied once, with
  amounts checked.
- **Uploads:** checked by their bytes, 300 KB at most.
- **Spreadsheet imports:** cells that start a formula are neutralised.
- **Account enumeration:** none in sign-up or password reset.
- **Cron secret:** compared in constant time.
- **Development mail viewer:** closed in production.
- **Error responses:** never contain a stack trace.
- **Outbound requests:** go only to fixed hosts (no server-side request
  forgery).

## 5. Improvements implemented

| Area | Change | Status |
|---|---|---|
| Security | F1–F8 above | **COMPLETED AND VERIFIED** |
| Tests | `tests/security.test.mjs` (19 tests, including a sweep of every route); an inventory check in `tests/unit.test.mjs` | **COMPLETED AND VERIFIED** |
| API inventory | `scripts/api-inventory.mjs` generates `docs/API_INVENTORY.md`; `npm test` fails when it is stale | **COMPLETED AND VERIFIED** |
| Lint | ESLint 10 with the recommended JavaScript, TypeScript and React-hook rules; `npm run lint` | **COMPLETED AND VERIFIED** |
| Coverage | `npm run test:coverage` with thresholds of 85% lines, 65% branches, 80% functions | **COMPLETED AND VERIFIED** |
| CI | `.github/workflows/ci.yml`: quality, Docker and audit jobs | **COMPLETED AND VERIFIED** (section 14) |
| Dependencies | `npm audit fix`; Vite 6.4.5; Dependabot | **COMPLETED AND VERIFIED** |
| Documentation | `SECURITY.md`, `CONTRIBUTING.md`, PR and issue templates, README, `tests/README.md`, CHANGELOG | **COMPLETED AND VERIFIED** (instructions followed in a fresh clone, section 16) |
| Formatting check (Prettier) | Not added: it would reformat about 46,000 lines in one commit, burying the real changes. ESLint and the type check cover correctness | **NOT IMPLEMENTED** |

## 6. Refactoring performed

The refactoring was targeted. No large-scale refactor was made.

- **New modules with one job each:**
  - `backend/src/http/safety.ts`: the request checks, pure and unit-tested;
  - `backend/src/security/throttle.ts`: shared counters and tickets. It
    replaced roughly 25 lines of in-memory ticket handling in
    `modules/auth.ts`.
- **Authenticator codes:** `security/totp.ts` gained `totpStep()`, with
  `verifyTotp()` as a wrapper, so the code-matching logic lives in one
  place.
- **Lint fixes:**
  - invisible characters written as `\u` escapes (same behaviour, now
    reviewable);
  - dead initial values removed;
  - `{ cause }` kept on a rethrown error;
  - unused imports removed;
  - the browser scripts in `frontend/public` declared as such.
- **Large files:** the largest (`frontend/src/components/ui.tsx`, 1,042
  lines; `backend/src/services/migration.ts`, 886) were **not split**.
  Their size comes from many small, related pieces, and splitting them
  without a functional need would mean churn and regression risk with no
  test gain. Recorded as technical debt.

## 7. API inventory

`docs/API_INVENTORY.md`, generated from the server's own route table:

| | Count |
|---|---|
| Endpoints | **268** |
| Public | 23 |
| Any signed-in account | 22 |
| Pharmacy (permission, and plan feature where set) | 168 |
| Platform console (Super Admin or team role) | 55 |
| By method | 116 GET, 108 POST, 23 PATCH, 19 DELETE, 2 PUT |
| Named in a functional test | 166 (was 157 before this audit) |
| Covered by the access sweep and the hostile-input sweep | **268 (all)** |

Besides these, the app answers `GET /api/v1/health` and `GET /api/v1/avatars/:id`.

## 8. API testing results

- **Access sweep** (`tests/access.test.mjs`, existing). Every route is
  called by:
  - nobody signed in;
  - each built-in role, with and without the route's permission;
  - a pharmacy on platform routes;
  - a team member outside their role;
  - one pharmacy with another's record IDs.

  The result: no wrong answer and no 5xx.
- **Hostile-input sweep** (`tests/security.test.mjs`, new). About **1,116
  requests per run**, each sent as someone allowed to call the route:
  - every route with three odd IDs (a traversal string, `$gt`, 400
    characters) where it takes an ID;
  - writes with three bodies: wrong types for 48 common field names
    (arrays, objects, NaN, `1e400`, null bytes, 20,000-character strings);
    the same object inside an array; and an empty object;
  - reads with a hostile query string.

  The result: **no 5xx and no stack trace on any route.**
- **Focused security tests** (new):
  - operator and prototype payloads (400);
  - malformed JSON (400), an unsupported charset or encoding (415), an
    oversized body (413);
  - six forged tokens: `alg: none`, another secret, expired, refresh used
    as access, tampered pharmacy ID, wrong audience or issuer. All 401,
    while the real token still works;
  - security headers;
  - CORS for own and foreign origins, and a cross-site sign-in (403);
  - failed sign-ins counted in the database and cleared on success;
  - two-step sign-in on hashed, shared tickets: replay refused, the next
    step accepted, five tries then 429, a spent ticket refused;
  - sign-out ends the access token and the refresh cookie;
  - password reset: the same answer for known and unknown addresses, the
    wrong code refused, old sessions ended, the old password refused;
  - sign-out everywhere ends the other sessions only;
  - a recovery code works once;
  - turning two-step sign-in off needs a fresh password check.
- **Business workflows** (existing suites): sign-up through to selling, FEFO
  stock, refunds, day close, accounting to the paisa, Stripe against a
  stand-in API, plans and trials, imports with rollback, tenant isolation,
  live updates.
- **Proof that the new tests test something:** with the `app.ts` changes
  reverted, the operator test failed (`expected 400, actual 401`) and the
  charset test failed (`expected 415, actual 500`). With them, all pass.

**Status: COMPLETED AND VERIFIED.** The sweeps check for no server error and
no leak, not that every field-level answer is right. Field-level behaviour is
tested for 166 endpoints.

## 9. Frontend testing results

| Check | Result | Status |
|---|---|---|
| Type check (`tsc -b`) | Passes | **COMPLETED AND VERIFIED** |
| Lint, including the React hook rules | 0 errors; hook findings fixed | **COMPLETED AND VERIFIED** |
| Production build, with the bundle checker (`frontend/scripts/check-build.mjs`) | "The build is fit to ship: 98 script(s)" | **COMPLETED AND VERIFIED** |
| Logic shared with the server (scanner input, GS1 parsing, calculator, version check, `internalPath`) | Unit-tested in `tests/unit.test.mjs` and `tests/security.test.mjs` | **COMPLETED AND VERIFIED** |
| Every guarded screen declares a real permission | Unit test (existing) | **COMPLETED AND VERIFIED** |
| The built site is served, including a deep link (`/settings`) | CI smoke test | **COMPLETED AND VERIFIED** |
| Component tests and browser end-to-end tests in the repository | Earlier releases were checked in a browser by hand-run Playwright scripts, but none is in the repository, and this audit did not add one | **NOT IMPLEMENTED** |

## 10. Automated test results

| Run | Command | Result |
|---|---|---|
| This workspace | `TEST_MONGODB_URI=… npm run test:coverage` | 183 tests, 183 passed, 0 failed |
| Fresh clone | `npm test` | 183 tests in 39 suites: 183 passed, 0 failed, 0 skipped |
| GitHub Actions (run 41785692436) | `npm run test:coverage` on MongoDB 7 | Job "Type-check, lint, test, build": **success** |

## 11. Coverage

Backend (`backend/src`, with `backend/src/cli` excluded), Node's built-in
coverage:

| | Before (2.6.4) | After (2.7.0) | Threshold |
|---|---|---|---|
| Lines | 86.17% | 89.24% (89.14% in the fresh clone) | 85% |
| Branches | 64.19% | 66.51% (66.60%) | 65% |
| Functions | 82.91% | 86.83% (86.46%) | 80% |

The small differences between runs come from timing-dependent branches in
the live feed and housekeeping.

Least covered: `services/payments/adapters.ts` (59% lines; JazzCash and
Easypaisa need their sandboxes), `services/mailer.ts` (68%; SMTP),
`modules/people.ts`, `services/migration.ts`, `modules/inventory.ts` and
`services/tabular.ts` (71–72%).

Frontend coverage is not measured (no component tests; section 9).

## 12. Security findings

Fixed: F1–F8 in section 4. Each has a test, and the test was seen failing
without the fix.

**Credentials to replace now.** During the Vercel set-up, the deployment's
`.env` file was shared outside the secret store, in a support conversation.
Replace these (names only; how: `SECURITY.md`):
- the database password in `MONGODB_URI`;
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`;
- `CRON_SECRET`;
- `PAYMENT_WEBHOOK_SECRET`;
- the Super Admin's password.

No credential was ever committed to the repository.

Remaining risks: section 19.

## 13. Dependency audit

| Advisory | Severity | Before | After |
|---|---|---|---|
| body-parser 2.0–2.3: denial of service, trailing bytes after a compressed body | High | present | **fixed** (`npm audit fix`) |
| Vite ≤ 6.4.3: development-server file access and launch-editor issues | High (development only) | present | **fixed** (6.4.5) |
| qs: `stringify` TypeError (denial of service) | Moderate | present | **fixed** |
| React Router 6.0–7.17: open redirect through `/\` in `<Link>` or `navigate()`; constructor injection in SSR hydration | Moderate | present | **mitigated, not fixed.** The only fix is React Router 7, a major upgrade. KSF does not render on the server, and passes outside paths only through `internalPath()`, which refuses `//`, `/\` and control characters (tested) |

`npm audit --omit=dev --audit-level=high` exits 0, and CI enforces it.

Outdated packages (`npm outdated`, not upgraded in this release on purpose):
- **Majors:** React 19, React Router 7, Vite 8, TypeScript 7,
  `@vitejs/plugin-react` 6, lucide-react 1, dotenv 18. Each is a migration
  with its own testing.
- **Patches available:** express 5.3, mongodb 7.8. Dependabot will propose
  them weekly, grouped.

No unused production dependency was found. Every one in the two
`package.json` files is imported by the source.

## 14. CI/CD

`.github/workflows/ci.yml`, on every push to `main` and every pull request,
with read-only permissions and stale runs cancelled:

| Job | Steps |
|---|---|
| Type-check, lint, test, build | `npm ci`; type check; lint; API inventory check; MongoDB 7 replica set; `npm run test:coverage` with thresholds; `npm run build`; start `backend/dist/server.js` in production mode and request `/api/v1/health`, `/` and `/settings` |
| Production image builds | `docker build -f deploy/docker/Dockerfile`; check that the image runs as user `ksf` and has a health check |
| Dependency audit | `npm audit --omit=dev --audit-level=high` |

Evidence, on pull request #22 (run 41785692436, commit `84d8e7b`):
- "Type-check, lint, test, build": **success** (06:29–06:34 UTC);
- "Production image builds": **success**;
- "Dependency audit": **success**.

The Vercel preview builds for the commit were **success** too.

`.github/dependabot.yml`: weekly npm updates (minor and patch grouped) and
GitHub Actions updates.

**Status: COMPLETED AND VERIFIED.**

## 15. Docker and environment verification

| Check | Result | Status |
|---|---|---|
| Multi-stage build, non-root `ksf` user, `HEALTHCHECK`, `.dockerignore` keeping `.env` and backups out, secrets only through `env_file` | Reviewed in `deploy/docker/Dockerfile`, `deploy/docker-compose.yml`, `.dockerignore` | **COMPLETED AND VERIFIED** |
| The image builds from a clean checkout | GitHub Actions job "Production image builds": success, user and health check asserted | **COMPLETED AND VERIFIED** |
| The image builds in this workspace | The sandbox cannot resolve Alpine's package mirror (`dl-cdn.alpinelinux.org: DNS: name does not exist`) | **BLOCKED** |
| The whole stack (`docker compose up`: app, Nginx, MongoDB) | Needs a domain's TLS certificates and a filled `deploy/.env`; not started here | **IMPLEMENTED BUT NOT FULLY VERIFIED** |
| The built server starts in production mode | Locally and in CI: health 200, website 200, deep link 200 | **COMPLETED AND VERIFIED** |
| `.env.example` | Names every setting and holds no real value | **COMPLETED AND VERIFIED** |

## 16. Documentation, and the clean-environment check

New:
- `SECURITY.md`;
- `CONTRIBUTING.md`;
- `.github/pull_request_template.md` and `.github/ISSUE_TEMPLATE/` (bug,
  feature, with security reports routed to private advisories);
- `docs/API_INVENTORY.md`;
- this report.

Updated:
- `README.md`: commands, security model, testing and CI, further reading;
- `tests/README.md`: the security suite, coverage, adding a route;
- `CHANGELOG.md`.

**The instructions in `CONTRIBUTING.md` were followed in a fresh clone** of
the pushed branch, in an empty folder:

| Step | Result |
|---|---|
| `git clone --branch claude/vibrant-hypatia-vbglv8` | Commit `84d8e7b`, no `node_modules` |
| `npm ci` | Exit 0 (52 s) |
| `npm run typecheck` | Exit 0 (17 s) |
| `npm run lint` | Exit 0 (7 s): 0 errors, 27 warnings (the capped `any`) |
| `npm run api:inventory -- --check` | Exit 0: "docs/API_INVENTORY.md is up to date (268 endpoints)." |
| `npm test` (against a local MongoDB 7 replica set) | Exit 0 (156 s): 183 of 183 passed |
| `npm run test:coverage` | Exit 0 (166 s): thresholds met |
| `npm run build` | Exit 0 (23 s): "The build is fit to ship" |
| `npm audit --omit=dev --audit-level=high` | Exit 0 |

**Status: COMPLETED AND VERIFIED.**

## 17. Performance

| Finding | Action | Status |
|---|---|---|
| The till's medicine list and the import's field list were new arrays on every render, so the callbacks and memos built on them were rebuilt each time | Memoised (`Pos.tsx`, `Migration.tsx`) | **IMPLEMENTED BUT NOT FULLY VERIFIED** (the lint finding is gone and the build passes; render counts were not measured) |
| 12 MB of JSON accepted on every route | 2 MB, except the two imports | **COMPLETED AND VERIFIED** |
| Lookups for many items at once | Already batched with `$in`, not one query per item (the purchasing and selling modules) | Checked; no change needed |
| Indexes | Created at start-up for every collection; the two new collections get TTL indexes | **COMPLETED AND VERIFIED** (bootstrap runs in every API test) |
| Cost of the shared limiter | One or two extra MongoDB round trips per sign-in, sign-up or code attempt; not on ordinary reads or writes | Accepted; not benchmarked |
| Bundle | Entry script 340 KB (108 KB gzipped); the barcode decoder (433 KB) loads only when the camera is opened | No change |

No benchmark was run, so no speed-up is claimed.

## 18. Remaining technical debt

- **Explicit `any`:** 27 remain, on the request-body type
  (`http/context.ts`) and the payment providers' JSON. Replacing the body
  type with a schema per route (zod is already a dependency) would let the
  compiler check every handler's input.
- **Large files:** `components/ui.tsx` (1,042 lines),
  `services/migration.ts` (886), `services/subscriptions.ts` (858) and
  `pages/Pos.tsx` (852) work, but are slow to read.
- **No browser tests in the repository:** add Playwright for sign-in, a
  sale at the till, plan choice, and the Super Admin confirming a payment.
- **Low coverage in places:** the JazzCash and Easypaisa adapters, SMTP
  sending, and parts of inventory and import (section 11).
- **Major upgrades not made:** React 19, React Router 7, Vite 8,
  TypeScript 7.
- **No Prettier:** formatting is consistent by convention, not enforced.

## 19. Unresolved bugs and security risks

No failing test and no known functional bug remain. These risks remain, and
none exposes one pharmacy's data to another:
- **Exposed credentials:** the ones in section 12 must be replaced. This is
  the most important open item.
- **React Router advisory:** moderate, mitigated in the app's code, but
  only fixed by an upgrade.
- **Busy limits per instance:** writes per minute, live streams and
  messages are counted in each instance's memory. They stop a stuck tab,
  not a determined attacker.
- **`style-src 'unsafe-inline'`:** React writes style attributes. Scripts
  stay `'self'` only.
- **Testing settings:** `SHOW_SIGNUP_CODE=true` and `MAIL_TRANSPORT=none`
  are set on the test deployment. They must be off and real SMTP on before
  real customers sign up.
- **File imports on Vercel:** functions accept at most a 4.5 MB request
  body there, so a file import over about 3 MB fails on Vercel. It works on
  a VPS.
- **No dynamic testing:** no scan of the running site (DAST), and no
  firewall rules configured.
- **Vercel runtime not checked from here:** the preview builds succeeded,
  but this workspace cannot open `*.vercel.app`.

## 20. Suggested next tasks

1. Replace the exposed credentials (section 12), then redeploy.
2. Before real customers: turn off `SHOW_SIGNUP_CODE` and set up SMTP.
3. Add Playwright end-to-end tests for the critical flows, and run them in
   CI.
4. Validate request bodies with a schema per route, removing the `any` in
   `http/context.ts`.
5. Upgrade React Router to 7, closing the remaining advisory.
6. Raise the coverage thresholds as the payment-adapter and inventory tests
   grow.
7. Turn on GitHub's private vulnerability reporting and secret scanning in
   the repository settings (`SECURITY.md` points reporters there).
8. On Vercel, add Firewall rate limits for `/api/v1/auth/*`.

---

### The commits of this work

| Commit | What |
|---|---|
| `e856686` | Security: request checks, shared sign-in limits and tickets, single-use codes |
| `2544794` | Tests: security suite, hostile input on every route, generated API inventory |
| `705e7b8` | Tooling: ESLint, coverage thresholds, dependency fixes |
| `cbcabad` | CI: GitHub Actions quality gates and Dependabot |
| `84d8e7b` | Docs and 2.7.0 |
| this commit | `QUALITY_AUDIT.md` |
