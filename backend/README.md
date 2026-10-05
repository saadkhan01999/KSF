# backend — the API

Express 5 + TypeScript (strict, NodeNext) + the MongoDB Node.js driver.
Node.js 20 or newer. `docs/ARCHITECTURE.md` explains the design; this page is
the working reference.

## Run

From the project root (recommended):

```bash
npm run dev          # API reloads on save, with the website
npm run build        # compile to backend/dist
npm start            # run the compiled API (also serves frontend/dist)
```

Or from this folder — it reads the same `.env`, because every path is
resolved from the project root:

```bash
npm run dev
npm run db:check
npm run db:backup
```

## Layout

| Path | Holds |
|---|---|
| `src/server.ts` | Start-up: connect, create indexes / plans / Super Admin, listen, shut down cleanly |
| `src/config/env.ts` | `.env` read once and validated with zod; stops with a plain message if something is missing |
| `src/http/` | `app.ts` (Helmet, CORS allow-list, access checks, errors), `router.ts` (route registry), `authenticate.ts`, `context.ts`, `cookies.ts` |
| `src/modules/` | The API by area: `auth`, `account`, `people` (staff, roles), `catalogue`, `inventory`, `purchasing`, `selling` (till, refunds, customers, prescriptions), `cashbook` (udhaar, expenses, day close), `reporting`, `messaging`, `billing`, `setup`, `migrate`, `support`, `platform` (Super Admin), `admin` (workspace, settings, themes) |
| `src/services/` | `subscriptions`, `payments/` (provider contract, four adapters, ledger), `referrals`, `mailer` (SMTP + outbox), `migration` + `tabular` + `migration-report` (data import) |
| `src/security/` | `password` (scrypt), `sessions` (JWT access + rotating refresh), `devices`, `otp`, `totp`, `crypto` |
| `src/domain/` | `permissions` (every permission, the five built-in roles, themes), `plans` |
| `src/db/` | `mongo.ts` (client, typed collections, `tx()`), `types.ts`, `bootstrap.ts` (indexes, plans, Super Admin), `pipeline.ts` |
| `src/core/` | `errors` (`HttpError`, `bad`, `missing`…), `util` (ids, money, dates), `trails` (activity, audit hash chain, document numbers) |
| `src/cli/` | `check-database`, `backup` (and `--verify`), `restore`, `reset-database`, `generate-secrets` |

## Adding an endpoint

```ts
// src/modules/<area>.ts
route('GET', '/api/v1/things/:id', 'things.read', async (ctx) => {
  const thing = await col.things().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!thing) missing('That record could not be found.');
  return { data: thing };
});
```

- Always filter by `ctx.pharmacyId` — that is the tenant boundary.
- New permission? Add it to `src/domain/permissions.ts` and to the roles that
  should have it.
- Several writes that must succeed together go inside `tx(async () => …)`,
  each with `...s()` in its options.
- Money is integer paisa; convert input with `toPaisa()` from `modules/shared.ts`.
- Sensitive action? Call `ctx.requireRecentVerification()` first.
- Errors are thrown with the wording the person will read: `bad('…', 'field')`.
