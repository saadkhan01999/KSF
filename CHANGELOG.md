# Changelog

All notable changes to KSF Pharmacy Management System. Dates are in
Pakistan Standard Time.

## [2.2.0] — 2026-10-12

### Accounts for the Super Admin
- **Accounts** in the platform console (`platform.finance.view`, writing with
  `platform.finance.manage`): KSF's own books. Income is subscription
  payments by plan, less the refunds completed in the period, plus other
  income such as setup and training fees; costs are payment-provider fees
  and the platform's expenses — team salaries, servers and hosting, software,
  marketing, rent and the rest. Net profit, paying pharmacies, payments still
  waiting and refunds still owed, twelve months' trend, every movement in
  one ledger, an A4 statement and CSV downloads.
- **Payment methods** (Accounts › Payment methods): every way to pay — Stripe,
  bank transfer, JazzCash, Easypaisa, a gateway — switched on or not, test or
  live, the setting names each still needs (never their values), and the
  webhook and return addresses to register, copied with one click.

### Fixed
- Recording an offline payment for a pharmacy was refused when **another**
  pharmacy had used the same slip number. A slip, receipt or cheque number is
  now unique within its own pharmacy; recording it twice for the same pharmacy
  is still refused, and the message says when and for how much it was first
  recorded. (A provider's charge id stays unique across the platform.) The old
  database index is replaced on the first start.
- The account menu opened from the sidebar stretched across the whole screen.
  It now opens beside its card, at least as wide as it, inside the window.
- The website's header stayed transparent after scrolling, so the page showed
  through the links. It now turns solid, with a soft shadow, as soon as the
  page moves.

### Look and feel
- The sidebar's account card shows who is signed in and where ("Admin · Khan
  Pharmacy"), with a presence dot, and opens an account menu with a compact
  Light / Dark / Auto switch.
- The website has a **back to top** button once a page is long enough: a ring
  around it fills as the page is read, and it scrolls back smoothly (at once
  for visitors who ask for less motion).

## [2.1.0] — 2026-10-12

The ten points of the October update: accounts, card payments that renew
themselves, a shared medicine directory, plans and prices that change live
everywhere, every role tested route by route, and a university edition.

### Accounts
- **Accounts** (new screen, `accounting.view` / `accounting.manage`): income
  and expenses in one place — sales, other income, purchases, salaries and
  every other cost. Overview with net profit, cash in and out, receivables,
  payables, stock value and twelve months' trend; a profit-and-loss
  statement; one ledger of every movement; other income; salaries (a person
  is paid once a month; advances and bonuses are kept as what they are).
- Profit is computed from what each sale cost when it was sold, GST is kept
  out of income, and write-offs count as a cost.
- Supplier payments are dated, with a method (cash, bank transfer, cheque,
  card, Easypaisa, JazzCash) and
  a reference, so cash out is exact; Purchases has **Record payment**.
- Any period (this month, last month, quarter, year, or two dates); A4
  statements to print or save as PDF; CSV downloads on plans with exports.
- The Regional Manager can now read the accounts (granted once, on upgrade).

### Payments, invoices and receipts
- **Stripe**: cards on Stripe Checkout, and plans that renew themselves
  through Stripe. The amount is the plan's, the webhook is signature-checked
  and applied once, a returning browser is believed only after asking Stripe,
  renewals are applied only at the plan's price, a failed renewal starts the
  grace period, refunds go back through Stripe, and **Change card** opens
  Stripe's customer portal. Turning renewal off, cancelling or changing plan
  tells Stripe first.
- Every successful payment gets an **invoice number** (`KSF-INV-2026-000001`),
  a receipt by e-mail and a notification. Pharmacies see and print their
  invoices on Billing; the platform opens any of them from Income. Payments
  made before this release are numbered too.
- The Billing screen offers every configured way to pay, with the default
  first, and says where a payment stands when the person comes back.

### Plans and prices, live
- A change to a plan's price, limits or features reaches every open screen
  at once — the public pricing page, every pharmacy's dashboard and billing,
  and the checkout — over Server-Sent Events fed by MongoDB change streams
  (a 15-second poll where there is no replica set).
- A pharmacy's features follow its subscription the moment it changes, **on
  the server**: advanced reports, exports, custom roles and messaging answer
  `402 feature_locked` on a plan without them, and the screen shows what is
  locked and which plans include it. A banner says when a subscription needs
  attention.

### Medicine directory
- One directory for the whole platform: names, other names, brands and their
  companies, category, forms, uses, precautions, side effects, interactions,
  and references (secure addresses only). Search by the start of a name, an
  other name, a brand or a category; browse by letter.
- Kept by the platform team (`platform.medicines.manage`, and a ready-made
  **Clinical pharmacist** team role): drafts, archive and restore, imports,
  and **verification** under a pharmacist's name — cleared whenever what an
  entry says changes. A starter set of 34 common medicines arrives
  unverified, with search links to DailyMed and the NHS, for the team to
  check.
- A pharmacy adds a directory medicine to its own catalogue in one step.

### Access, tested
- `tests/access.test.mjs` calls **every route** as nobody, as each built-in
  role and as the platform team: refused without the permission, every
  screen each role is allowed, the platform console kept apart, and no
  pharmacy reading or changing another's records.
- Fixed: marking a notification read by id did not check whose it was. It
  now answers 404 for anybody else's.
- New permissions are added to the Admin role on every start.

### Logo
- The approved mark is used everywhere from one source: the app, the
  website, e-mails (as an image), the home-screen icons (192, 512 and Apple
  touch) and printed statements and invoices. In dark mode the tile has a
  hairline edge so it does not melt into the background.
  `docs/BRAND_GUIDE.md` says where each copy lives and how to replace it.

### University edition
- `npm run university:copy` makes a separate, independently working copy for
  academic submission: its own folder and git history, its own `.env` and
  keys, its own Super Admin, e-mail written to files, online payments off
  (`KSF_EDITION=university`), and no commercial deployment settings or
  client documents. Its `UNIVERSITY.md` explains how to run and demonstrate it.
- `npm run seed:demo` (university edition only, empty database only) makes a
  demonstration pharmacy through the real API: every role, stock, sales,
  purchases, accounts and a prescription.

### Checked again
- Pharmacies (list and detail) at phone, tablet and desktop widths, with no
  sideways scrolling; the counter calculator's sums and its staying open
  beside the sale.

### Documentation
- `README.md` lists every endpoint — who may call it, the plan feature it
  needs and what it does — with the API's conventions and status codes; a
  test fails if a route is missing.

### The Super Admin's team
- **My team** (platform console): the Super Admin adds the people who help
  run KSF — each with their own e-mail address, a temporary password they
  must replace, a job title and a photo — and gives each one a team role.
- **Team roles**: as many as needed, each exactly the platform permissions
  ticked for it (dashboard, pharmacies, working inside a pharmacy, support
  desk, people who need help, finance, plans, records), with ready-made
  starting points (Help desk, Finance, Operations manager, Read only).
  Managing the team is never part of a role, so nobody can promote
  themselves. A role change, suspension or removal applies at once.
- Every platform route names the permission it needs, checked on the
  server; menus and buttons show only what the person's role allows.
- **Support desk for the team**: a pharmacy's request reaches the Super Admin
  and everybody whose role answers requests; a request can be given to one
  person; each reply shows who wrote it (the pharmacy still sees "KSF
  Support"); when a team member resolves a request the Super Admin is
  notified with their name. Platform notices are per person.
- What a team member does inside a pharmacy is recorded as "KSF team:
  <role> (support)" under their own name.

### Fixed
- The side menu and the phone's bottom bar highlighted Overview on every
  platform page as well as the page itself.
- On phones, table cards (Pharmacies and others) laid a cell's lines side by
  side and ran off the screen; each cell now stacks beside its label.

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
- Sign-in and sign-up accept a request the browser marks
  `Sec-Fetch-Site: same-origin`, so they work on any address the site is
  opened at without listing it.
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
