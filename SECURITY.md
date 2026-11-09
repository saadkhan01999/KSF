# Security

## Reporting a vulnerability

Please report it privately: on GitHub, open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue, and
do not test against a live pharmacy's data. Say what you found, how to
reproduce it and what it lets someone do. You will get an answer, and a fix
for a confirmed problem is released as soon as it is ready.

Only the latest release (the `main` branch) receives security fixes.

## How KSF protects an account and its data

The table in the README (**Security model**) is the summary. In more detail,
with where each control lives and the test that proves it:

| Control | Where | Proven by |
|---|---|---|
| Passwords hashed with scrypt, 12+ characters with strength rules | `backend/src/security/password.ts` | `tests/unit.test.mjs` |
| Access tokens: HS256 only, issuer and audience checked, 15 minutes | `backend/src/security/sessions.ts` | `tests/security.test.mjs` (forged, `alg: none`, expired, tampered, wrong audience or issuer, refresh token used as access) |
| Refresh tokens rotated on every use; a replay ends the session; HttpOnly, SameSite=Strict cookie | `backend/src/security/sessions.ts`, `backend/src/http/cookies.ts` | `tests/api.test.mjs`, `tests/security.test.mjs` (sign-out) |
| Every route authorised on the server, by access type, permission, platform role and plan | `backend/src/http/app.ts`, `backend/src/http/router.ts` | `tests/access.test.mjs` (every route, every built-in role, tenant isolation) |
| Sign-in, sign-up, code and password-reset limits shared by every server instance; account lock-out | `backend/src/security/throttle.ts`, `backend/src/modules/auth.ts` | `tests/security.test.mjs` |
| Two-step sign-in: tickets stored by hash, five tries, each authenticator code accepted once, recovery codes once | `backend/src/security/throttle.ts`, `backend/src/security/totp.ts` | `tests/security.test.mjs` |
| No MongoDB operator or prototype keys in a body; 2 MB body limit (12 MB for the two imports); unreadable bodies are a 4xx | `backend/src/http/safety.ts` | `tests/security.test.mjs` |
| Every route survives hostile input without a server error or a stack trace | the whole API | `tests/security.test.mjs` (all routes) |
| Redirects only to the application's own origin | `backend/src/http/safety.ts`, `frontend/src/utils/format.ts` | `tests/security.test.mjs` |
| Strict Content-Security-Policy, HSTS in production, no framing, no `X-Powered-By` | `backend/src/http/app.ts`, the `vercel.json` files | `tests/security.test.mjs` |
| Public writes refused from other sites; CORS credentials only for configured origins | `backend/src/http/app.ts`, `backend/src/config/env.ts` | `tests/security.test.mjs`, `tests/unit.test.mjs` |
| Payment webhooks verified (Stripe signature over the raw body, HMAC for the others), applied once, amounts checked | `backend/src/services/payments/` | `tests/stripe.test.mjs`, `tests/unit.test.mjs` |
| Uploaded photos checked by their bytes (JPEG, PNG, WebP), 300 KB at most | `backend/src/services/avatars.ts` | `tests/api.test.mjs`, `tests/unit.test.mjs` |
| Imported spreadsheet cells that start a formula neutralised | `backend/src/services/tabular.ts` | `tests/unit.test.mjs` |
| No account enumeration: sign-up and password reset answer the same for any address | `backend/src/modules/account.ts` | `tests/security.test.mjs` (password reset) |
| Errors never send a stack trace; a server error carries only a reference | `backend/src/http/app.ts` | `tests/security.test.mjs` |
| The scheduler's endpoint needs `CRON_SECRET`, compared in constant time | `backend/src/modules/cron.ts` | `tests/plans.test.mjs` |

## Secrets

Secrets live only in the host's environment (Vercel's Environment Variables,
or `deploy/.env` on a server) — never in the repository, an image or a log.
`.env`, `.env.*` and `deploy/.env` are ignored by git and by Docker.
`.env.example` has the names, not the values.

If a secret may have been seen by someone it was not meant for, replace it:

| Setting | How | What happens |
|---|---|---|
| The password in `MONGODB_URI` | Atlas › Database Access › the user › Edit Password; then the new `MONGODB_URI` | Nothing visible, after a redeploy |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `npm run secrets` prints new values | Everybody is signed out once |
| `CRON_SECRET` | Any 32+ random characters | The daily housekeeping uses the new one after a redeploy |
| `PAYMENT_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` | A new value here and at the provider | Webhooks signed with the old value are refused |
| The Super Admin's password | Platform › Account, or the reset flow | Their other sessions end |

## Risks that remain

These are known. None allows reading or changing another pharmacy's data.
- **React Router 6, moderate advisory (GHSA-wrjc-x8rr-h8h6):** an open
  redirect when a path beginning `/\` reaches `<Link>` or `navigate()`. The
  only fix is React Router 7, a major upgrade not yet made. KSF passes such
  paths only through `internalPath()`, which refuses them.
- **Some limits are per server instance:** the busy limits (writes per
  minute, live streams, messages) are kept in each instance's memory. They
  stop a stuck tab, not an attacker.
- **Website visitor figures can be inflated:** anyone can send the public
  visit counter made-up visitors (60 a minute from one address). Its
  figures only feed the Super Admin's traffic screens, so they are a guide,
  not a record; nothing is decided by them.
- **`style-src 'unsafe-inline'`** in the Content-Security-Policy, because
  React writes style attributes. Scripts stay `'self'` only.
- **Sign-up codes on screen:** `SHOW_SIGNUP_CODE=true` is for testing only.
  It must be off before real customers sign up.
- **No automated scan of the running site:** there is no dynamic scan
  (DAST) or web application firewall in front of it. On Vercel, its
  Firewall can add rate limiting at the edge.
