# Changelog

All notable changes to KSF Pharmacy Management System. Dates are in
Pakistan Standard Time.

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
