# Contributing to KSF

## Set up

You need Node.js 20.11 or newer (CI uses 22) and, for the API tests, a
MongoDB **replica set** (transactions need one): MongoDB Atlas, or a local
`mongod --replSet rs0` after `rs.initiate()`.

```bash
npm ci                    # exactly what package-lock.json says
cp .env.example .env      # then fill in MONGODB_URI; `npm run secrets -- --write` adds the keys
npm run dev               # API and website together, reloading on save
```

`DATABASE_SETUP.md` covers the database, and `docs/ENVIRONMENT.md` covers
every setting.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
TEST_MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" npm test
npm run build
```

CI (`.github/workflows/ci.yml`) runs the same checks, plus coverage, a
smoke test of the built server, the Docker image build and `npm audit`.
A pull request is merged only when all of them pass.

## The rules

- **A change comes with its test.** A fix comes with a test that failed
  before it. A new endpoint comes with a functional test of what it does.
  `tests/access.test.mjs` and `tests/security.test.mjs` cover who may call
  it and hostile input by themselves.
- **New or changed routes:** run `npm run api:inventory`, so
  `docs/API_INVENTORY.md` lists them (`npm test` fails until it does).
  Also add the route to the README's REST API section (a unit test checks).
- **Security changes** get a test in `tests/security.test.mjs`, and an
  entry in `SECURITY.md` if they add or change a control.
- **Never commit a secret.** `.env` files stay out of git. Tests use the
  settings in `tests/setup.mjs` and never read `.env`. The API tests run
  in a throwaway `ksf_test_<random>` database; never point them at
  production data.
- **Don't silence a check to get a green run.** That means no skipped or
  deleted tests, no lowered coverage thresholds, and no `eslint-disable`
  without a comment saying why. Explicit `any` is capped at its current
  count (`npm run lint`), so it can only go down.
- **Keep changes small and focused.** Leave unrelated tidying for another
  pull request.

## Commits and releases

- **Commit messages:** a short summary line in the imperative ("Refuse
  reused authenticator codes"), then a body saying what changed and why.
- **Releases:** a release bumps the version in `package.json`,
  `frontend/package.json`, `backend/package.json`, `package-lock.json` and
  `frontend/src/brand.ts`, and adds a dated entry at the top of
  `CHANGELOG.md`.
