# Settings reference — `.env`

**KSF Pharmacy Management System 2.0**

Every setting the server reads, what it does, and its default. The server
validates the file on start-up (`backend/src/config/env.ts`) and refuses to
start with a message naming the line to fix, rather than failing later in
the middle of a request.

- The file is `.env` in the project root. `KSF_ENV_FILE=<path>` points the
  server at a different file (used by the test suite).
- A variable already set by the shell, Docker or the host **wins** over
  `.env`.
- One setting per line, `NAME=value`, no spaces around `=`. Quote any value
  containing `#` or spaces: `"a#b c"`.
- `.env` is never committed (`.gitignore`) and never copied into a Docker
  image (`.dockerignore`).

Only **three** settings are required: `MONGODB_URI`, the two JWT secrets, and
— for the first start only — the Super Admin's e-mail and password.

---

## Server and site

| Setting | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `production` turns on HSTS, refuses console e-mail, hides internals from the health check and requires distinct JWT secrets |
| `PORT` | `8790` | Port the API (and, after a build, the website) listens on |
| `PUBLIC_APP_URL` | `http://localhost:5180` | The address people type. Used in e-mails, referral links and payment returns |
| `PUBLIC_ALLOWED_ORIGINS` | `http://localhost:5180,http://localhost:4180` | Comma-separated origins allowed to call the API from another origin. A page calling the API on its own address (Vercel forwarding `/api`, or the API's own site) needs no entry: current browsers mark those requests `Sec-Fetch-Site: same-origin`. The origin of `PUBLIC_APP_URL` is always allowed. `*` stands for one run of letters and digits, so `https://ksf-x86j-*-ssam1.vercel.app` covers every Vercel deployment address of that project. In development any localhost port is accepted as well |
| `STATIC_DIR` | `frontend/dist` | The built website the API serves in production |
| `TRUST_PROXY` | `loopback` | Which proxies to believe for the visitor's IP (Express `trust proxy`): `loopback`, `uniquelocal`, an IP, `false`, or a number of proxy hops. Behind Nginx on Docker: `uniquelocal`. On Railway: `1`, or `2` with Vercel forwarding `/api` to it |

## Database — required

| Setting | Default | Meaning |
|---|---|---|
| `MONGODB_URI` | — | The connection string, `mongodb+srv://…` (Atlas) or `mongodb://…`. Must be a replica set for transactions. `DATABASE_SETUP.md` explains |
| `MONGODB_DB` | `ksf_pharmacy` | The database name inside the cluster |

## Sign-in tokens — required

| Setting | Default | Meaning |
|---|---|---|
| `JWT_ACCESS_SECRET` | — | Signs access tokens. At least 32 characters; `npm run secrets -- --write` |
| `JWT_REFRESH_SECRET` | — | Signs refresh tokens. Different from the access secret (enforced in production) |
| `JWT_ISSUER` | `ksf-pharmacy` | `iss` claim, checked on every request |
| `JWT_AUDIENCE` | `ksf-web` | `aud` claim, checked on every request |
| `JWT_ACCESS_MINUTES` | `15` | Lifetime of an access token. The browser keeps it in memory only |
| `JWT_REFRESH_DAYS` | `7` | Lifetime of a refresh token. It is replaced on every use |
| `REFRESH_COOKIE_NAME` | `ksf_refresh` | HttpOnly, SameSite=Strict cookie, `Path=/api/v1/auth` |
| `DEVICE_COOKIE_NAME` | `ksf_device` | Identifies a registered device for device limits |
| `COOKIE_SECURE` | `false` | `true` whenever the site is served over HTTPS — always in production |

Changing either JWT secret signs everybody out at once.

## The platform Super Admin — required for the first start

| Setting | Default | Meaning |
|---|---|---|
| `SUPER_ADMIN_NAME` | `Super Admin` | Display name |
| `SUPER_ADMIN_EMAIL` | — | Sign-in e-mail |
| `SUPER_ADMIN_PASSWORD` | — | At least 12 characters with upper and lower case, a digit and a symbol. Keep the quotes |

Read **only** when no Super Admin exists yet. Afterwards the Super Admin
changes their e-mail and password in **My account**, and these lines are
ignored. You may clear the password from `.env` after the first start.

## Sessions and sign-in protection

| Setting | Default | Meaning |
|---|---|---|
| `SESSION_IDLE_MINUTES` | `45` | A session unused this long ends |
| `SESSION_ABSOLUTE_HOURS` | `72` | A session ends this long after sign-in, however active |
| `STEP_UP_MINUTES` | `10` | How long a password re-confirmation covers sensitive actions |
| `DEVICE_LIMIT_DESKTOP` | `1` | Default desktop devices per person (plans and Admins can raise it) |
| `DEVICE_LIMIT_MOBILE` | `1` | Default mobile devices per person |
| `LOGIN_MAX_ATTEMPTS` | `5` | Wrong passwords before the account locks |
| `LOGIN_LOCK_MINUTES` | `15` | How long the lock lasts |
| `LOGIN_MAX_PER_IP` | `60` | Sign-in attempts per IP per 15 minutes |

## Passwords

| Setting | Default | Meaning |
|---|---|---|
| `PASSWORD_MIN_LENGTH` | `12` | Minimum length (8 or more) |
| `PASSWORD_SCRYPT_N` | `32768` | scrypt cost. Do not lower |
| `PASSWORD_SCRYPT_R` | `8` | scrypt block size |
| `PASSWORD_SCRYPT_P` | `3` | scrypt parallelism |

Existing hashes keep working when these change; new and changed passwords use
the new parameters.

## E-mail

| Setting | Default | Meaning |
|---|---|---|
| `MAIL_TRANSPORT` | `console` in development, `smtp` in production | `console` prints and saves to the outbox · `file` saves only · `smtp` sends · `none` discards (tests) |
| `MAIL_FROM` | `no-reply@ksfpharmacy.pk` | Sender address |
| `MAIL_FROM_NAME` | `KSF` | Sender name |
| `MAIL_OUTBOX` | `.data/outbox` | Where `console` and `file` save messages |
| `MAIL_HOST` | — | SMTP server, e.g. `smtp.gmail.com`, `smtp.office365.com`, `email-smtp.<region>.amazonaws.com` |
| `MAIL_PORT` | `587` | `587` (STARTTLS) or `465` (TLS) |
| `MAIL_SECURE` | `false` | `true` for direct TLS (port 465 implies it) |
| `MAIL_USER`, `MAIL_PASSWORD` | — | SMTP credentials. Quote the password |
| `MAIL_STARTTLS` | `true` | `false` only for a relay on a private network that has no TLS |
| `MAIL_EHLO` | `ksf-pharmacy` | Name announced to the SMTP server |
| `MAIL_TIMEOUT_MS` | `15000` | SMTP socket timeout |

## Sign-up codes and referrals

| Setting | Default | Meaning |
|---|---|---|
| `OTP_EXPIRY_MINUTES` | `10` | How long an e-mailed code is valid |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong guesses before a code is used up |
| `OTP_MAX_SENDS` | `5` | Codes per address per hour |
| `SHOW_SIGNUP_CODE` | `false` | **Testing only.** `true` shows the sign-up code on the confirm screen as well as e-mailing it, so sign-up works without SMTP. E-mail addresses are then not really checked; the server logs a warning at every start. Password-reset codes are never shown |
| `REFERRAL_TRIAL_DAYS` | `15` | Extra trial days for a pharmacy that signs up with a referral code |
| `REFERRAL_MAX_USES` | `100` | Lifetime uses of one code |
| `REFERRAL_MAX_PER_DAY` | `10` | Uses of one code per day |
| `REFERRAL_MAX_PER_IP_PER_DAY` | `3` | Referral sign-ups from one IP per day |
| `REGISTER_MAX_PER_IP` | `20` | Sign-up attempts per IP per hour |

## Subscription payments

| Setting | Default | Meaning |
|---|---|---|
| `PAYMENT_PROVIDER` | `manual` | The provider offered first: `bank-transfer`, `gateway`, `jazzcash`, `easypaisa` |
| `PAYMENT_WEBHOOK_SECRET` | — | Shared secret for signed provider callbacks |
| `BANK_*`, `GATEWAY_*`, `JAZZCASH_*`, `EASYPAISA_*` | — | Each provider's account details. A provider stays switched off until its own settings are filled in |

The full list per provider, and how a payment moves from *pending* to
*succeeded*, is in `docs/PAYMENTS.md`.

## Data import and backups

| Setting | Default | Meaning |
|---|---|---|
| `MIGRATION_MAX_ROWS` | `20000` | Largest import file, in rows |
| `MIGRATION_BACKUP_DIR` | `.data/backups` | Where the pre-import snapshot is kept |
| `BACKUP_DIR` | `.data/backups` | Where `npm run db:backup` writes |

## Your business

Shown on the public website (contact page, footer) and in e-mails. All
optional; anything left empty is simply not shown.

`BUSINESS_LEGAL_NAME`, `BUSINESS_ADDRESS`, `BUSINESS_CITY`,
`BUSINESS_COUNTRY`, `BUSINESS_PHONE`, `BUSINESS_WHATSAPP`, `SUPPORT_EMAIL`,
`SALES_EMAIL`, `BUSINESS_WEBSITE`, `SUPPORT_HOURS`, `BUSINESS_NTN`,
`BUSINESS_STRN`.

## Development and tests only

| Setting | Meaning |
|---|---|
| `KSF_ENV_FILE` | Read this file instead of `.env` |
| `KSF_API_PORT` | Port the Vite dev server proxies `/api` to (set by `npm run dev`) |
| `KSF_SKIP_BROWSER` | `1` stops `npm run dev` opening a browser |
| `TEST_MONGODB_URI` | MongoDB server for `npm test` (falls back to `MONGODB_URI`) |

---

## Production checklist

```ini
NODE_ENV=production
COOKIE_SECURE=true
PUBLIC_APP_URL=https://pharmacy.example.pk
PUBLIC_ALLOWED_ORIGINS=https://pharmacy.example.pk
TRUST_PROXY=uniquelocal
MAIL_TRANSPORT=smtp
```

plus fresh JWT secrets (`npm run secrets -- --write`), a dedicated Atlas
database user, and the Super Admin password changed after the first sign-in.
