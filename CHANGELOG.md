# Changelog

All notable changes to KSF Pharmacy Management System. Dates are in
Pakistan Standard Time.

## [2.9.0] — 2026-11-09

A subscription wallet for the pharmacy, referral days, and a growth view of
the platform for the Super Admin.

### Pharmacy: Subscription plans
- **A Subscription plans page** in the sidebar (Workspace / Subscription
  plans), with two tabs:
  - **Plans**: the current plan, what it costs, the medicines allowed and
    the access left; Demo (15 days), Standard Referral (+15 days for each
    registration, opens the Referrals tab) and Pro (PKR 1,400 a month,
    Choose Pro) side by side; then Diamond Annual (PKR 12,000 billed
    yearly, PKR 1,000 a month) and custom pricing (Contact KSF).
  - **Referrals**: invitations, completed registrations, days ready to
    claim and days claimed; the invite link with Copy link and Share via
    WhatsApp; the trial extension ("12 → 27 days") with **Claim 15 days**;
    and the referral activity.
- **Review your Pro subscription**: what is included and the payment
  summary (plan, access period, monthly rate, plan term, total), then
  **Preview payment** — the plan is chosen and the checkout opens. Nothing
  is charged until the payment is confirmed.
- **Review your annual plan**: the yearly price, the saving against twelve
  months of Pro ("Save PKR 4,800") and **Contact KSF about annual pricing**:
  call, WhatsApp, e-mail or a message to the KSF support desk. Paying online
  stays available where a payment method is switched on.
- The old /subscription address opens the new page; the billing settings
  use the same checkout.

### Plans
- The plans are renamed after the design: **Starter → Demo**, **Monthly →
  Pro**, **Yearly → Diamond Annual**. Pro is **PKR 1,400 a month** (was
  1,500); the referral price (1,300), the three-month term and the annual
  price are unchanged. Done once on start-up, and only where a plan still
  has its old name or price: a name or price the Super Admin changed stays.
  Pharmacies already paying keep the price they pay.
- A trial lengthened by a referral shows as **Standard Referral**.

### Referral days
- Each pharmacy that registers through a pharmacy's link earns it **15 days
  of full access** (`REFERRAL_REWARD_DAYS`). The pharmacy is notified and
  claims them in one step; the days are added to the trial or to the paid
  period, so nothing already paid for is lost; a pharmacy whose trial has
  ended is back in for the days it earned. Each registration is counted
  once, even when two people claim at the same moment.

### Super Admin
- **Platform overview** for any period (7, 30 or 90 days, this month, last
  month or custom dates): website visitors, active users, new
  registrations, pharmacies, referrals and paid subscriptions; a chart of
  visitors per day (hover or arrow keys for each day); the subscription mix;
  the latest pharmacy registrations. Sales, income and support stay below
  it.
- The menu has **Workspace** (Platform overview, Website traffic,
  Registrations) and **Management** (Users, Pharmacies, Referrals,
  Subscriptions):
  - **Website traffic**: unique visitors and page views per day, the busiest
    day, the pages read and the sites visitors came from;
  - **Registrations**: direct or through a referral, who registered and
    their plan today;
  - **Users**: everyone working in a pharmacy, with when they last signed in;
  - **Referrals**: each referral's stage and days; accept or turn down one
    held for checking;
  - **Subscriptions**: every pharmacy's plan, state, price and end date.

### Website visits
- The public website counts a visit once a day per browser: the page and
  the site the visitor came from. No cookie is set and no address is stored
  with it (the address only counts towards a one-minute limit); a random
  number in the browser's storage, scrambled with a server secret, is all
  that is kept, and it is deleted after 400 days. Browsers asking
  not to be tracked (Do Not Track, Global Privacy Control) are not counted,
  nor are bots. The privacy policy says so.

### Settings
- `REFERRAL_REWARD_DAYS` (15) and `SALES_PHONE` (the number on the annual
  offer) in `.env.example` and docs/ENVIRONMENT.md.

### Tests
- The wallet and the growth screens: the plan rename, claiming referral days
  (added once, one of two claims at the same moment, after a trial ended,
  Admin only), the visit counter (once a day; no crawlers, made-up visitors
  or pages), the overview figures and paid subscriptions, registrations,
  subscriptions, referrals with approve and reject, the users list, and the
  period checks (backwards or longer than a year is refused; pharmacies
  cannot see any of it).

## [2.8.1] — 2026-11-04

The loan (udhaar) could not be seen at the till.

### Till
- **Every payment method is a button:** Cash, **Loan (udhaar)**, Card,
  Easypaisa, JazzCash and Bank transfer, in that order. The method used to
  be a drop-down list that showed only "Cash" until it was opened, so the
  loan right after Cash was out of sight. The loan button is amber, like
  the loan section it opens.

### Updates
- **A tab left open across a release says so.** A browser keeps the
  screens it loaded until the page is reloaded. A till opened before 2.8.0
  kept the old payment window: it still listed no loan without a customer
  chosen, while the new server already sent each medicine's GST rate.
  - Every API answer now names the server's version (`X-KSF-Version`;
    `/api/v1/health` already made it public).
  - When the server is newer than the page, a line across the top says
    "KSF 2.8.1 is ready" with **Reload now**. It never reloads by itself,
    because a sale may be half rung up.
- Test: the version header on every API answer, exposed to the app's own
  origin only.

## [2.8.0] — 2026-11-04

GST and loans (udhaar) at the till. GST is now the cashier's choice on each
sale, and when it is added it is shown in the cart, in the payment window
and on the receipt. A loan is offered right after Cash, for any customer.

### Till
- **GST is optional on each sale.** A switch in the cart and in the payment
  window adds it or leaves it off. It starts off unless Settings › Till ›
  "Add GST to every sale unless the cashier turns it off" is on.
  - A medicine with its own GST % keeps that rate. Every other line takes
    the pharmacy's Default GST rate (Settings › Pharmacy), which until now
    selling never used.
  - The tax is worked out on what the customer pays: the discount is shared
    across the lines in proportion to their value, in whole paisa, before
    the GST. Before, it was charged on the price before the discount.
  - The payment window shows the breakdown (subtotal, discount, GST with its
    rate, total). With no rate set anywhere the switch is greyed out and
    says where to set one.
- **The till shows the figure the server charges.** The till did not
  receive each medicine's GST rate, so it showed one total and the server
  charged another (Rs 28,000 on screen, Rs 30,500 charged).
  - The lookup now sends the rate, and the till and the server use one
    calculation (`backend/src/domain/sale-totals.ts`, copied word for word
    to `frontend/src/utils/sale-totals.ts`; a unit test keeps the copies
    identical and runs 2,000 random carts through both).
  - The till sends the total it showed (`expectedTotalPaisa`). If a price or
    a rate changed meanwhile, the sale is refused with 409 `total_changed`
    and the new figures, and nothing is charged.
- **Loan (udhaar), right after Cash.**
  - It is always offered. Choosing it asks whose account it goes on: pick
    the customer, or add a new one there with a name and phone number.
  - The customer may pay part now ("Paid now (optional)"). Only the rest
    goes on their account and counts against their credit limit. The
    window shows what is left on loan, what they will owe and any credit
    limit problem before the sale is completed.
  - The part paid now is recorded as a cash repayment with its own receipt
    number, inside the same transaction as the sale. The day close counts
    it as cash in, and the account statement reads: the invoice in full,
    then the payment against it.
  - Refunding a loan hands that cash back (`cashBackPaisa`, "Give back
    Rs …") and takes the rest off the account. The day close and the cash
    flow report count the cash handed back.
- Cheque is no longer listed at the till; the server never accepted it
  there. Bank transfer can now be the default payment method.

### Receipt
- With GST added it prints "Value excl. GST", "GST 18%" (or just "GST" when
  the medicines carry different rates), "TOTAL (incl. GST)" and the
  pharmacy's STRN.
- A loan prints "Paid now (cash)", "On loan (udhaar)", what the account now
  owes, and the receipt number of the part paid now.

### Other
- The Default GST rate is kept between 0 and 100%.
- The customer screen's payments carry the invoice they were paid against.
- The day close says "Loans (udhaar)" instead of "On account".
- Tests: `tests/selling-gst-loan.test.mjs` (16 API tests) and 8 unit tests
  for the calculation.

## [2.7.0] — 2026-11-04

A security and engineering-quality release: nothing a pharmacy uses changes,
except that sign-in is harder to attack. `QUALITY_AUDIT.md` has the audit,
the findings and the evidence.

### Security
- **Request checks before any handler** (`backend/src/http/safety.ts`).
  - A body may not carry MongoDB operator keys (`$ne`, `$where`) or
    prototype keys (`__proto__`, `constructor`).
  - Bodies are limited to 2 MB (12 MB only for the two file imports).
  - A body the server cannot read (an unknown charset or encoding) is
    answered 4xx instead of 500.
- **Open redirect fixed.** The payment-return redirect accepted any
  address that started with `PUBLIC_APP_URL`, so
  `https://<app>.evil.com` passed. The origin must now match exactly, and a
  path with a tab or line break (which browsers drop, making
  `/<tab>/evil` into `//evil`) is refused, on the server and in the web
  app.
- **Sign-in protection shared by every server instance.**
  - The limits on sign-in, sign-up, codes, password resets and
    referral-code guesses, and the two-step sign-in and device-release
    tickets, are kept in MongoDB (`rate_limits`, `auth_tickets`, both
    TTL-indexed) instead of one instance's memory.
  - On Vercel a memory counter reset on every cold start, and a ticket
    issued by one instance was unknown to the next, so a correct two-step
    code could be refused.
  - Tickets are stored by their SHA-256 hash only.
- **Each authenticator code is accepted once** (RFC 6238 §5.2). A code
  seen over someone's shoulder can no longer sign in again during its 90
  seconds. A reused code gets its own message.
- **Dependencies:** `npm audit fix` (body-parser, high; qs, moderate) and
  Vite 6.4.5 (high, development server only). No high or critical
  advisory remains; the one moderate left is in `SECURITY.md`.

### Testing
- `tests/security.test.mjs`, 19 tests:
  - the request checks;
  - forged (`alg: none`, another secret), expired, tampered and
    wrong-audience tokens;
  - headers and CORS;
  - shared counters;
  - two-step replay and attempt limits;
  - sign-out, password reset, sign-out everywhere and recovery codes;
  - **every registered route fed hostile input**: wrong types, huge
    strings, array bodies, odd ids and queries, with no server error and
    no stack trace allowed.
- 183 tests, all passing.
- `npm run test:coverage` fails under 85% lines, 65% branches or 80%
  functions. Backend coverage went from 86.17 / 64.19 / 82.91% to 89.24 /
  66.51 / 86.83%.
- `docs/API_INVENTORY.md`, generated from the route table by
  `npm run api:inventory`, lists all 268 endpoints, who may call each, and
  the tests that name it. A test fails when it is out of date.

### Engineering
- **ESLint 10** over the whole repository (`npm run lint`). Its 68
  findings were fixed rather than silenced:
  - unused code and dead assignments;
  - invisible characters written as escapes;
  - a rethrown error now keeps its cause;
  - React hooks: memoised lists, a camera cleanup that clears the right
    element, and two mis-placed suppressions.
- **CI** (`.github/workflows/ci.yml`) on every push to `main` and every
  pull request:
  - type check, lint and the inventory check;
  - every test on a MongoDB 7 replica set with the coverage thresholds;
  - the production build, then a smoke test of the built server;
  - the Docker image (non-root, with a health check);
  - `npm audit` on what ships.
- **Dependabot** for npm and GitHub Actions.
- **New documents:** `SECURITY.md`, `CONTRIBUTING.md`, a pull-request
  template and issue templates, and `QUALITY_AUDIT.md`.

## [2.6.4] — 2026-11-04

### Vercel: the backend no longer crashes with "Cannot find module"
- **One JavaScript entry for every Vercel set-up: `backend/index.js`.** A
  project whose Root Directory is `backend`, and the `backend` service of
  the two-service set-up, could run the TypeScript source (`src/server.ts`,
  `src/vercel.ts`). Vercel compiles such an entry file by file, and the
  backend imports its files by their compiled names (`./config/env.js`),
  so the function died on every request with `Cannot find module
  …/config/env.js` — "500 FUNCTION_INVOCATION_FAILED" on the backend
  project, and "error 500" for the prices on the website. `backend/index.js`
  is plain JavaScript that loads the built handler (`dist/vercel.js`); it
  carries the express import Vercel's Express detection looks for, so a
  Root Directory `backend` project now builds with the Express preset too.
  `backend/package.json` `main`, the backend service's `entrypoint`,
  `frontend/api/index.mjs` and `deploy/vercel/api/index.mjs` all use it.
- **A failure says why.** If the built handler cannot be loaded, every
  request is answered with the reason ("The KSF server could not be
  loaded: …") instead of a crashed function. A start-up check that fails
  after the database was reached (indexes, plans, the Super Admin) now says
  so, with its message, instead of "cannot reach its database"; the
  database message itself is shown too, without the user and password.
- A database connection that fails is closed before the next attempt.
- Checked with `vercel build` and Vercel's own function runner on Node 24,
  against a database left by 2.5.2: Root Directory `backend`, `frontend`
  and empty all answer health, plans and sign-in.

## [2.6.3] — 2026-11-04

### Vercel: no more 500 when Vercel picks the always-on server
- **`backend/dist/server.js` is safe on Vercel.** Vercel's Express detection
  runs `server.js` (not the configured handler) for a project rooted at
  `backend/` and for the `backend` service of the two-service set-up. That
  server listened, ran hourly timers and ended the process when a setting
  was missing or the database could not be reached, so every request was
  `500 FUNCTION_INVOCATION_FAILED`. On Vercel (`VERCEL=1`) it now starts
  nothing and its default export, the handler in `backend/src/vercel.ts`,
  answers: a short message naming any missing setting, then the API.
  Docker, Hostinger and `npm start` run it as before.
- `backend/src/vercel.ts` makes the Express app on the first request, so
  importing it costs nothing.
- The server finds its version in that Vercel layout too (it said `0.0.0`,
  so the version check claimed the server had not updated).
- The Vercel guide explains "404: NOT_FOUND" (a project that builds only
  the API, without the website) and the 500.

## [2.6.2] — 2026-11-04

### Everything on Vercel; Railway removed
- **The website's own Vercel project now runs the API too.** A project
  whose Root Directory is `frontend` (the live `ksf-x86j`) builds the whole
  repository, serves the website and runs the API as one Vercel Function,
  `frontend/api/index.mjs`, at `/api/…`, with the security headers and the
  daily Vercel Cron. Nothing in the project's settings has to change: add
  the environment variables and redeploy. The website and the API share one
  address, and every Root Directory (`frontend`, empty, `deploy/vercel`)
  now gets the whole system from the same handler, `backend/src/vercel.ts`.
- **Railway is no longer used.** `frontend/vercel.json` no longer forwards
  `/api` to Railway, and the Railway set-up is gone from the guides
  (`deploy/README.md`, `deploy/VERCEL_DEPLOYMENT.txt`,
  `deploy/HOSTINGER_DEPLOYMENT.txt`, `README.md`) and from the screens and
  messages that named it (the version check, Payment methods, the
  database hint). `TRUST_PROXY` on Vercel is `1`.
- The API function's rewrite no longer adds a `?path=` parameter to every
  request (`frontend/vercel.json` and `deploy/vercel/vercel.json`).
- The university copy also leaves out the root `vercel.json` and
  `frontend/api/`.
- The Vercel guide says to quote a value with `#` in it (the Super Admin
  password) in an imported `.env` file: unquoted, everything from the `#`
  on is read as a comment.

## [2.6.1] — 2026-11-03

### Vercel
- **Two services in one Vercel project.** The root `vercel.json` defines:
  - `backend` (`backend/`, Node), the whole API as one function, at
    `/api/…`;
  - `frontend` (`frontend/`, Vite), the website, at every other address;
  - the security headers and the daily Vercel Cron.

  Import the repository with the Root Directory left empty. No bindings
  are needed: the website is static and calls `/api/v1` on its own domain.
- **`backend/src/vercel.ts`** is the API as a request handler that connects
  to the database once per instance. Both Vercel set-ups use it.
  `backend/package.json` now points `main` at it, so a Vercel project with
  Root Directory `backend` runs it instead of the long-running server.
  Docker, Railway and `npm start` still run `server.js` by its path.
- **No more "This page is unavailable"** for a missing setting. On Vercel, a
  missing or wrong setting (`MONGODB_URI`, the JWT secrets, …) now answers
  every request with a short page naming it. The server used to exit, so
  the function crashed with `500 FUNCTION_INVOCATION_FAILED`. Away from
  Vercel the server still stops at start-up and says what to fix.
- The server reads its version from `backend/package.json` when the root
  one is not deployed with it.

## [2.6.0] — 2026-11-03

### The three plans from the price sheet
- **Starter — the free trial.** Every new pharmacy starts on it: 15 days with
  complete account access, every feature and unlimited data. No card is
  asked for.
- **Monthly — a 3-month starter plan for beginners.**
  - Rs 1,500 a month, or **Rs 1,300 a month** for a pharmacy that came
    through another pharmacy's referral.
  - It is paid month by month for up to three months. Once the third month
    is paid, it stops renewing by itself (at Stripe too) and the pharmacy is
    told to choose Yearly.
- **Yearly — best value.** Rs 12,000 a year: about Rs 1,000 a month, which
  saves Rs 6,000 (about 33%) against twelve months of Monthly.
- **Every plan includes everything:** the dashboard, purchasing, stock,
  sales and billing, customers and suppliers, reports, settings and
  administration, with unlimited records, staff and branches.
- **When the trial or a plan ends, nothing is deleted.**
  - Every screen shows "Your free trial has ended" with Monthly and Yearly.
  - Records can still be read and exported.
  - The server refuses every change (`402 plan_required`) until a plan is
    paid for. Paying opens everything again at once.
  - A trial ends to the minute, without waiting for the hourly
    housekeeping.
- **No free day is lost.** Choosing a plan changes nothing until its payment
  clears: the trial (or the current plan) carries on, and the paid period
  starts where it ends.
- **Referrals now give the referral price**, not extra trial days.
  - A pharmacy that registered without a code can enter one later, under
    Billing › Have a referral code?
  - It can never enter its own code, and only one referral per pharmacy.
- **The Super Admin can change everything under Platform › Plans:** each
  price, the referral price, how many months Monthly runs, the trial length
  and unlimited (-1) limits.
  - Recording a payment by hand asks which plan it is for.
  - Extra days given to a trial keep it a trial.
- **Existing installations move over once, at start-up.**
  - Monthly takes the new price; Starter and Yearly are added.
  - Basic, Weekly and Annual are retired (old invoices still name them).
  - Every pharmacy on the old free plan starts a fresh 15-day trial, so
    nobody is locked out.
  - A pharmacy that has paid keeps its plan to the end of its period.
- **The website, Billing and the sign-up** are laid out like the price
  sheet: Starter in green, Monthly in blue, Yearly in purple, the "All plans
  include full access" strip and the plan summary. The prices always come
  live from the plans.
- **E-mails:** a notice three days and one day before the trial (or a plan
  that will not renew) ends, with the plans that can be chosen.

### Fixed
- A failed first payment (on the trial, or after a plan had ended) no
  longer starts a grace period; only a failed renewal of a running plan
  does.
- A cancelled plan now ends on its last paid day; before, it stayed usable.
- A confirmed bank transfer now moves the pharmacy to the plan it paid for.
- Coming back from a payment page now shows "Payment received". Settings
  had been dropping `?payment=` from the address before Billing could read
  it.

### The whole system on Vercel, for testing
- **`deploy/vercel/` runs everything on one Vercel project** (Root
  Directory `deploy/vercel`):
  - the website;
  - the API as one Vercel Function (`deploy/vercel/api/index.mjs`), in
    Mumbai;
  - MongoDB Atlas as the database;
  - a daily Vercel Cron for the housekeeping, at
    `/api/v1/cron/maintenance`, protected by `CRON_SECRET`.
- **`deploy/VERCEL_DEPLOYMENT.txt`** gives every step and setting.
- Vercel projects with Root Directory `frontend` (the live site, with the
  API on Railway) or `backend` are unchanged. Everything for the new set-up
  is in its own folder; a first version at the repository root broke the
  `backend` project's build.
- The server reads its version from `package.json` relative to its own
  file, so a bundler takes the file along.
- The housekeeping a server runs hourly now lives in one place
  (`services/maintenance.ts`), shared by the server and the cron.

## [2.5.2] — 2026-10-28

### A bigger logo
- **The KSF logo is larger everywhere:**
  - the sidebar: the mark about 28% taller, "KSF Pharmacy" about 17%;
  - the collapsed sidebar;
  - the website header and footer;
  - the sign-in panel;
  - the forgotten-password page;
  - the loading screen;
  - printed documents;
  - e-mails: the logo is now 48 px tall, drawn at twice that for sharp
    screens.
- Side by side, the mark is now 0.9 of the lock-up's size (it was 0.82).
- It still fits the sidebar and a 320-pixel phone's header, with no
  sideways scroll.

### Deploying on Hostinger
- **`deploy/HOSTINGER_DEPLOYMENT.txt`:** the step-by-step guide.
  - **Which plan, and why:** a KVM 2 VPS with "Ubuntu 24.04 with Docker",
    in Mumbai.
  - **Every step:** the server's security, the code, the settings, HTTPS
    with automatic renewal, the first sign-in, payments, nightly verified
    backups with copies off the server, updates and going back, monitoring,
    moving over from Railway and Vercel without losing a sale, and fixes
    for common problems.
  - **Rehearsed:** its commands were rehearsed on the real production stack.
- **Fixed in the deploy kit (`deploy/nginx/ksf.conf`):**
  - Nginx no longer fails to start where the container has no IPv6. It
    listened on `[::]` inside the container; IPv6 visitors still arrive
    through Docker's port publishing.
  - The payment-webhook rule now matches the address the app actually uses
    (`/api/v1/payments/webhook/<provider>`), so payment callbacks are not
    held to the browser rate limit.

## [2.5.1] — 2026-10-27

### Fixed
- **A printed receipt stopped after the header.** The slip was printed from
  inside the till's "Sale completed" window. That window is fixed to the
  screen and scrolls inside itself, so the paper got only what fitted: the
  pharmacy, the invoice number, the date and the customer, with no
  medicines, total or payment.
  - **The fix:** the receipt is now printed from a copy of its own, drawn
    outside the app, so it flows onto the paper in full: every medicine
    with its batch and expiry, the subtotal, discount, GST, total, payment,
    change and footer.
  - **Paper length:** set to the slip's exact length (76 mm wide), so a
    thermal roll neither cuts it short nor feeds blank paper after it.
  - **Ctrl+P too:** while a receipt is on screen, pressing Ctrl+P prints
    the slip alone.
  - **Sales history** prints the same full receipt from an invoice. It did
    not print the receipt at all before when "Show the printable receipt"
    was closed.
- A receipt for a pharmacy with no street address no longer starts its
  address line with a comma.

### The website
- **A scrollbar you can hold.** The page has a green pill on its right
  edge. Over it the pointer becomes an open hand, holding it becomes a
  grabbing hand, and the page follows the drag. It widens when the pointer
  comes near. A click on the rail above or below it glides a screen at a
  time. A browser's own scrollbar cannot change the pointer, so on a mouse
  or trackpad this replaces it. The wheel, keys and touchpad scroll exactly
  as before, and a phone keeps its own overlay.
- **Back to the top, calmly.** It now glides there in about 0.7–1.5 seconds,
  easing away and easing to rest, instead of the browser's near-instant
  jump. Touching the wheel or the screen stops it at once. With "reduce
  motion" on it simply jumps.
- **Sections rise gently as they scroll into view, on every public page.**
  Before, a safety timer showed every section after 1.6 seconds, so by the
  time a visitor scrolled down nothing was left to animate. Now the timer
  acts only if the animation itself stops working. The motion:
  - each section fades up;
  - the cards, plans, questions and list items in it follow one after
    another, about 65 ms apart;
  - each page's heading arrives gently when it opens.
  - Sections that load later (the price comparison) are picked up as they
    appear, so nothing can stay hidden. "Reduce motion" switches it all off.

### Tests
- **Unit:** the glide's easing and timing.
- **In a real browser:**
  - an eight-medicine sale printed to PDF from the till and from Sales
    history: every line on one slip, nothing of the till behind it;
  - the scrollbar: the hand pointers, a drag scrolling one to one, the
    thumb following the page, and a phone keeping its own;
  - the glide back to the top: its time and smoothness;
  - every section and card on eight public pages shown once scrolled
    through, with no sideways scroll, desktop and phone.

## [2.5.0] — 2026-10-27

### The pharmacy's own logo, everywhere
- **The approved KSF artwork** — the interlocking K, S and F, "KSF Pharmacy"
  and "Dispensing care. Inspiring trust." — traced to vector outlines,
  transparent, and used everywhere the logo appears:
  - the app's sidebar and loading screen;
  - the website header and footer;
  - sign-in and forgotten password;
  - printed statements and invoices;
  - the website's product preview.
- **Colours:** the artwork's deep green (`#14442E`) in light mode, a pale green
  in dark mode so it never disappears, and white on the dark sign-in panel.
- **The favicon is the transparent mark.** It turns pale green when the
  browser is dark.
- **App icons:** the Android, desktop and iPhone home-screen icons carry the
  mark on white (a phone shows a transparent icon on black).
- **E-mails:** the header is now white with the logo and a green rule.
- **Browser theme colour** is the logo green. The designer's pack in
  `docs/brand/` and `docs/BRAND_GUIDE.md` describe the new artwork.

### A stronger scanner
- **The camera reads what it missed before.** It is asked for full HD with
  continuous focus, and offers **tap to focus** and **zoom** where the phone
  has them.
- **Two readers work at once:** the browser's own and ZXing in a background
  worker (so the picture never stutters). Each frame is looked at a
  different way in turn:
  - the whole frame;
  - the scan area at full resolution;
  - the middle enlarged twice over, for a tiny barcode on a strip or dropper
    bottle far from the lens;
  - turned a quarter turn, for a barcode printed upright on a narrow box;
  - sharpened, for faded or slightly blurred print;
  - a second binariser;
  - inverted, for light bars on dark foil.
- **Tested against 2.4.0:** on five such packs, 2.4.0's reader read one. The
  new one reads all five, live in 0.3–2.1 seconds and from a photo.
- **No wrong medicine from a smudge.** Codes with a check digit or error
  correction (EAN, UPC, Code 128, DataBar, QR, DataMatrix, PDF417, Aztec) are
  taken at the first read. Code 39, Code 93, Codabar and short ITF codes must
  read the same twice in a row.
- **Scan a photo** tries every one of those ways on the picture.
- **The checkout beep.** A short, bright scanner beep (and a buzz on a phone)
  the moment a code is read and the medicine picked. A low double buzz means
  it was not added.
- **The same beep and card for barcodes that arrive in the search box,**
  whether typed or from a scanner too slow to be told from typing.
- A scanner that types on the number pad with Num Lock off is understood.
- **The Add medicine form** beeps on a scan and shows a card: "Details filled
  in", "New barcode" or "Already in your catalogue".

### The website
- **Buttons are centred.** "Sign in" and every other button without an arrow
  had their words pushed off-centre by padding meant for the arrow badge.
  Only pills with the arrow tuck their right side in now. On every public page,
  at desktop, phone and 320-pixel widths, every button's words are measured
  centred.
- **The hero and closing buttons** ("Start free trial", "Sign in") are the same
  width. On a phone they stack, full width.
- **The scrollbar thumb is green**, in light and dark.

### Tests
- **Unit:** believing a camera read (check digits, the double read).
- **In a real browser:**
  - the live camera and photos on tiny, upright, inverted, faded and small
    DataMatrix packs;
  - every public page's buttons, measured centred;
  - the logo in light, dark and on a phone;
  - the 2.4.0 scanning checks again.

## [2.4.0] — 2026-10-26

### Every kind of barcode
- **Linear and 2D codes alike**: EAN-13, EAN-8, UPC-A, UPC-E, Code 128,
  Code 39, Code 93, Codabar, ITF-14 and GS1 DataBar; DataMatrix, QR, PDF417
  and Aztec — from a hardware scanner, the live camera, or a photo.
- **Scan a photo**, in the camera window: on a phone it opens the camera app,
  and it works on any address, also where the browser will not open the live
  camera (an http:// address, a refused permission).
- **QR codes with a GS1 Digital Link** (`https://…/01/<product number>/…`)
  find the medicine by its product number, with the batch and expiry.
- A GS1 DataMatrix whose separators a scanner sends as **Ctrl+]** is read
  whole. Before, the Ctrl key broke the scan in two.
- **Slower Bluetooth scanners** that stutter between keys are recognised: a
  scan is now told from typing by its average speed. A fast typist is still
  never taken for a scanner.
- A barcode can be up to 120 characters (QR text). A GS1 code typed into a
  medicine's barcode field is kept as the barcode printed on the box.

### Each scan, seen and heard
- **"Medicine selected"**: a small card at the top of the till, with an
  animated tick, the medicine's name, strength, price and how many are now in
  the sale. It leaves by itself after about two and a half seconds, and the
  next scan replaces it. A pack that cannot go in gets a red **"Not added"**
  card with the reason (out of stock, prescription only, no more on the
  shelf) instead of a separate error message.
- A brighter two-note chime for a scan that went in, a low double tone for one
  that did not. The sound is now woken by the first touch or key press, so
  the very first scan of the day beeps too.

### New medicines fill themselves in
- **Medicines › Add medicine** starts with "Scan the pack to fill this in".
  Scan the barcode (scanner or camera), or type it and press Enter, and the
  form fills in the name, generic name, manufacturer, category, form,
  strength, pack size, DRAP number and prescription status. The fields it
  filled are tinted until changed; nothing typed is ever overwritten. A GS1
  code also shows the pack's batch and expiry; a barcode the pharmacy already
  has opens that medicine instead.
- Where the details come from:
  - **KSF's shared barcode list.** What is printed on a pack, learned
    whenever any pharmacy saves a medicine with a barcode. It never holds a
    price, cost, stock, shelf or which pharmacy it was. The first pharmacy's
    details stand, and only it can correct them; later ones only fill in what
    was missing.
  - **The open product databases** (Open Products, Beauty and Food Facts,
    UPCitemdb). They are asked about product numbers only, once per barcode,
    with a short timeout, and at most 120 new barcodes an hour per pharmacy.
    `BARCODE_LOOKUP_ONLINE=false` turns this off.
  - **The KSF medicine directory**, which supplies the generic name, maker,
    category and prescription status a brand implies. Strength, form and pack
    size are read from the product's name.
- **At the till**, an unknown barcode that KSF knows shows the pack's details
  with **Add with these details**, which opens the form already filled in.

### API
- `GET /api/v1/medicines-barcode-info?code=` (`medicines.write`): what KSF
  knows about a scanned pack, for filling in a new medicine.

### Settings
- `BARCODE_LOOKUP_ONLINE` (default `true`) and `BARCODE_LOOKUP_TIMEOUT_MS`
  (default `3500`).

### Tests
- `tests/scanning.test.mjs` adds the Digital Link, typed GS1 codes, and the
  barcode lookup. The lookup is tested from another pharmacy (prices, stock
  and shelf never shared; the first pharmacy's details stand), from the open
  databases (a stand-in, asked once, never for other QR text), from the
  medicine directory, and for who may use it.
- The unit suite adds slow scanners, fast typists, Ctrl+] separators, Digital
  Links and reading a product's name.
- In a real browser, with no failures:
  - photos of QR, DataMatrix, ITF-14, Code 128, Code 39, UPC-A, EAN-8 and
    Aztec codes;
  - the live camera reading QR, DataMatrix and Code 128;
  - the scan card on a desktop, a phone and a 320-pixel screen;
  - the Add medicine form filled in from a scan, from the form and from the
    till.

## [2.3.0] — 2026-10-25

### Barcode scanning at the till
- **Any USB or Bluetooth barcode scanner** works on **Sell › New sale** with
  nothing to click first: the cursor can be in the search box, in a quantity
  box or nowhere at all. The till tells a scanner from a person by speed — a
  scanner types a whole code in a few milliseconds — so the code goes into the
  sale and never into the box that had the cursor, and normal typing is left
  alone. Scanners that end each scan with Enter (the factory setting), with
  Tab, or with nothing all work.
- **The GS1 DataMatrix** printed on medicine packs is read too: the product
  number finds the medicine; expiry, batch and serial come back with it.
- **Scan with the camera**: the camera button beside the search box uses a
  phone's or laptop's camera (the back camera on phones, with the light and a
  camera switch). It uses the browser's own barcode reader where there is one,
  and otherwise loads a reader only when the camera is opened, so the till
  itself is no bigger. It needs https, which Vercel and Railway provide.
- **The scanner button** ("Scanner ready") shows the last code read and what
  happened — added, not in the catalogue, more than one match — and opens a
  panel with the camera, the beep switch and the steps for the counter. Each
  scan beeps (a low double beep when it was not added), and the button flashes
  green or red.
- **A barcode KSF does not know** opens a short window: pick the medicine it
  belongs to and the barcode is saved on it (staff with `medicines.write`), so
  the next scan finds it — or add it as a new medicine with the barcode
  already filled in. Staff without that permission are told to ask a manager.
- Scans are held back while the payment window is open, so a pack scanned by
  mistake never changes a sale that is being paid.

### API
- `GET /api/v1/medicines-scan` also answers with `barcode` (the barcode to
  save for a code that is not in the catalogue) and `gs1` (the product,
  expiry, batch and serial a GS1 code carried, or `null`).

### Security
- `Permissions-Policy` allows the camera for KSF's own pages
  (`camera=(self)`, on the server and on Vercel); other sites embedded in a
  page still cannot use it.

### Tests
- `tests/scanning.test.mjs`: scanning over HTTP against MongoDB. The unit
  suite tells a scanner from a person typing and reads GS1 codes. In a real
  browser, the till was scanned with the cursor on the page, in a quantity
  box and in the search box; with Enter, Tab and no suffix; a GS1 code; an
  unknown barcode linked to its medicine; during payment; and through a
  camera fed a video of an EAN-13 barcode — on a desktop, a phone and a
  320-pixel screen.

## [2.2.1] — 2026-10-12

- **Is the new version live?** The platform Overview, and a pharmacy's
  Settings › System, ask the server which version it runs and compare it with
  the website's: "Website 2.2.1 · Server 2.2.1 — up to date", or which of the
  two (Railway or Vercel) still has to redeploy from `main`.
- The website's hero names this release's highlights.

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
