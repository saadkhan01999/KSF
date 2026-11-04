## What and why

<!-- What this changes, and the problem it solves. Link the issue if there is one. -->

## How it was tested

<!-- The tests added or changed, and anything checked by hand (screens, roles, devices). -->

## Checklist

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass locally
- [ ] A test covers the change (a fix: a test that failed before it)
- [ ] Routes added or changed: `npm run api:inventory` run, and the README's REST API section updated
- [ ] Security-relevant: a test in `tests/security.test.mjs`, and `SECURITY.md` updated if a control changed
- [ ] No secret, `.env` file or real customer data in the diff
- [ ] `CHANGELOG.md` updated for anything a user or operator would notice
