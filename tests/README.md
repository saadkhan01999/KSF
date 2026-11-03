# Tests

```bash
npm test            # everything
npm run test:unit   # pure logic — no database needed
npm run test:api    # every API suite over HTTP — needs MongoDB
```

| File | What it proves |
|---|---|
| `unit.test.mjs` | File import parsing and formula neutralising, rupee and date reading, column mapping, payment state rules and signatures (Stripe's included), password hashing, authenticator codes, stock and expiry rules, roles and themes, who hears which live event, the counter calculator, telling a barcode scanner from a person typing (a slow Bluetooth scanner, a fast typist, Ctrl+] separators), reading GS1 codes and Digital Links and a product's strength, form and pack size, that every signed-in screen is guarded by a real permission, and that `README.md` lists every route |
| `api.test.mjs` | One run of the real API against a real MongoDB: Super Admin only on a fresh install, refresh-token rotation and replay detection, sign-up with an e-mail code, setup checklist, catalogue, purchasing, FEFO selling, prescriptions, udhaar, refunds, day close, reports, staff and own-figures scoping, messaging, themes, support tickets, the platform console, support mode, data import and rollback, tenant isolation, suspension, and the Super Admin changing their own e-mail and password |
| `accounting.test.mjs` | The accounts: supplier payments in the ledger, other income, salaries once a month, profit and loss and cash flow to the rupee, the ledger filters, downloads only on plans with exports, access by role, one pharmacy seeing nothing of another, deletions in the audit trail |
| `live.test.mjs` | The live feed: a price change reaching a visitor, a subscription change reaching its own pharmacy and no other, the private feed refused to visitors, replay after a reconnect, features locking and unlocking on the server with the plan |
| `stripe.test.mjs` | Stripe against a stand-in for its API: Checkout at the plan's price during the free trial, a returning browser believed only after asking Stripe, a payment applied once, forged / stale / unsigned events refused, renewals, a failed renewal's grace period, invoices, refunds, the card page, Monthly stopping by itself after its third month, the move to Yearly |
| `plans.test.mjs` | The price sheet: exactly Starter, Monthly and Yearly with every feature; the free trial at sign-up; Rs 1,300 through a referral (at registration or entered later) and Rs 1,500 without; the trial ending — changes refused with `plan_required`, reading never; paying unlocks at once; a cancelled plan and an unpaid renewal ending; the Super Admin's free plan and extra trial days; an older installation moving to the three plans once, keeping what was paid for |
| `directory.test.mjs` | The medicine directory: the starter set, search, who may keep it, secure references only, verification and its reset, drafts and archived entries kept from pharmacies, imports |
| `access.test.mjs` | Every route in the route table: anonymous callers turned away, each pharmacy role refused what it does not hold, every built-in role's screens, the platform console per team role, support mode, and no pharmacy reading or changing another's records |
| `platform-accounts.test.mjs` | KSF's own books: one slip number per pharmacy, subscriptions less refunds plus other income against expenses to the rupee, the ledger and its filters, the downloads, finance roles only (a read-only role can read, not write), deletions in the activity log, and the payment-methods check naming missing settings, never their values |
| `scanning.test.mjs` | Barcode scanning: a barcode with or without its leading zero, the GS1 DataMatrix on a pack (product, expiry, batch, serial), a GS1 Digital Link QR, an unknown barcode answered with the barcode to save, saving it on a medicine without changing anything else, a cashier who can scan but not edit, no two medicines sharing a barcode; and a new medicine filled in from its barcode — from another pharmacy's pack details (never its price, stock or shelf, and the first pharmacy's details stand), from the open product databases (answered by a stand-in, asked once per barcode, never for other QR text) and from the medicine directory |
| `setup.mjs` | The configuration every test run uses. Tests never read `.env` |
| `support/server.mjs` | Starts the API inside the test process on a free port and drops its database afterwards |

The API suites use `TEST_MONGODB_URI` when it is set, otherwise the `MONGODB_URI` in `.env` —
always in a fresh database called `ksf_test_<random>`, which is dropped when the suite ends,
so it never touches the data the pharmacies use. Without any MongoDB it is skipped and says why.

Transactions need a replica set: MongoDB Atlas (any tier) or a local `mongod --replSet rs0`.
