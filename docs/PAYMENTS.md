# Taking subscription payments

**KSF 2.2**

This is about the money KSF collects for itself — the subscription a pharmacy
pays to use it. Money a pharmacy takes over its own counter is a different
thing and needs no provider: cash, card on the shop's own terminal, or a wallet
transfer the cashier records at the till.

---

## 1. The rules this implementation does not break

Read these before changing anything in `backend/src/services/payments/`.

1. **A payment is never marked successful because a browser said so.** The
   browser is redirected back from the provider as a courtesy. What settles a
   payment is the provider's own server-to-server callback, verified, or a
   person confirming a bank transfer against a statement.
2. **The amount is the server's.** It is read from the plan row when the
   payment request is created and written down. A callback whose amount differs
   from what was asked for is refused and recorded as a security event, not
   accepted and reconciled later.
3. **Every callback is idempotent.** A unique index on
   `subscription_payments (provider, provider_reference)` means the same delivery twice extends a subscription once. A
   provider that retries for an hour is normal.
4. **A provider that is not configured does not exist.** The Billing screen
   lists what is available and says which setting is missing for the rest. There
   is no button that cannot work.
5. **Card numbers never reach this server.** Cards are handled on the
   provider's hosted page or on a terminal in the shop. There is no field in
   KSF that takes a card number, and there must never be one.
6. **Secrets live in the environment.** Never in the database, never in the
   repository, never in a log line.

---

## 2. What is actually connected today

| Provider | State | What it needs |
|---|---|---|
| **Stripe** (cards on Stripe Checkout) | Implemented and tested against a stand-in that speaks Stripe's API: Checkout, signed webhooks, renewals, failed renewals, refunds, the card page, cancellation | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the webhook endpoint registered in the Stripe Dashboard (§4) |
| **Bank transfer / Raast** | Implemented and tested. Works with no provider account at all | The pharmacy's own bank details in the environment |
| **Aggregator** (Safepay, PayFast, Paymob, Keenu, or a bank's own gateway) | Implemented, and the real adapter is tested against a stub that speaks the documented shape | A merchant account and its keys |
| **JazzCash** | Implemented from the published integration shape. **Never run against JazzCash's sandbox** | Merchant ID, password, integrity salt, and the sandbox cases in §6 |
| **Easypaisa** | Same: implemented, never run against a sandbox. The hash field order is configurable because it differs between merchant packs | Store ID, hash key, and the sandbox cases in §6 |
| **A card form inside KSF** | Deliberately not built: cards are typed on Stripe's own page | — |

The Super Admin sees the same in the console, under **Accounts › Payment
methods** (`GET /api/v1/platform/payments/providers`): each provider, switched
on or not, test or live, the setting names it still needs, and the webhook and
return addresses to register — copied with one click. `GET /api/v1/billing/providers` is the truth at runtime: it reports
`configured` and `verified` per provider, and `missing` lists the settings that
are absent. `verified` is a flag you set yourself — `JAZZCASH_VERIFIED=true` —
**after** you have run the sandbox cases. It exists so that nobody can mistake
"the code is written" for "we have seen it work".

---

## 3. How a payment actually flows

```
  The pharmacy Admin presses Pay on the Billing screen
        │
        ▼
  POST /api/v1/billing/checkout          ← the server decides the amount
        │                                  from the plan row
        ▼
  payment_attempts row: created
  reference KSFPAY-…  amount  currency  provider
        │
        ├── a redirect (form fields + URL) ──► the provider's hosted page
        │                                            │
        │                                    the customer pays
        │                                            │
        │   ┌────────────────────────────────────────┴──────────────┐
        │   ▼                                                       ▼
        │  POST /api/v1/payments/webhook/:provider        GET/POST  /payments/return/:provider
        │  (server to server — this is the one that counts)  (the browser coming back)
        │   │                                                       │
        │   └────────────────┬──────────────────────────────────────┘
        │                    ▼
        │      signature → reference → amount → currency → state transition
        │                    ▼
        │      subscription_payments: succeeded
        │      subscription period extended, exactly once
        │
        └── or bank details to transfer to
                    │
              the customer transfers
                    │
              a person finds it on the statement and confirms it:
              POST /api/v1/platform/payments/attempts/:id/verify   (Super Admin)
              (statement reference required; by default the person who
               started the payment cannot be the one who confirms it)
```

If a callback never arrives — a deploy, a DNS blip, a firewall rule —
`POST /api/v1/platform/payments/reconcile` (Super Admin, Income › Waiting to be confirmed) asks the provider what happened to every open
attempt and settles whatever it finds. Run it from the Billing screen, or on a
schedule.

---

## 4. Configuration

Every setting is an environment variable. None of them has a default that
points at a live provider, and nothing below is a real credential.

### Stripe — cards, and plans that renew themselves

```bash
PAYMENT_PROVIDER=stripe                 # offer it first on the Billing screen
STRIPE_SECRET_KEY="sk_test_…"           # sk_live_… for real money
STRIPE_WEBHOOK_SECRET="whsec_…"         # from the webhook endpoint below
STRIPE_RECURRING=true                   # false: one payment per period, no auto-renewal
STRIPE_EXPIRY_MINUTES=60                # how long a Checkout page stays open
STRIPE_TIMEOUT_MS=15000
```

In the Stripe Dashboard › Developers › Webhooks, add the endpoint
`https://<your API>/api/v1/payments/webhook/stripe` with these events, and put
its signing secret in `STRIPE_WEBHOOK_SECRET`:

```
checkout.session.completed            checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
invoice.paid                          invoice.payment_succeeded
invoice.payment_failed
customer.subscription.updated         customer.subscription.deleted
```

How it works:

- **Paying.** `POST /api/v1/billing/checkout` with `provider: "stripe"`
  creates a Checkout Session for the plan's price — read from the plan row,
  never from the browser — in subscription mode (a Stripe subscription that
  renews every period) or, with `STRIPE_RECURRING=false`, a single payment.
  The request carries an idempotency key, so a double click is one session.
- **Coming back.** The browser returns to `/api/v1/payments/return/stripe`;
  KSF asks Stripe about the session before saying anything, then sends the
  person to Billing with the result.
- **The webhook settles it.** The `Stripe-Signature` header is checked
  (HMAC-SHA256 over the raw body, five minutes' tolerance) and each event id
  is applied once. The amount and currency must match the attempt.
- **Renewals.** `invoice.paid` for a new period extends the subscription
  once, and only when the amount is the plan's price; `invoice.payment_failed`
  starts the grace period, and nothing is switched off at once.
- **Invoices and receipts.** Every successful payment gets an invoice number
  (`KSF-INV-2026-000001`), a receipt by e-mail and a notification; the
  pharmacy sees and prints its invoices on Billing, the platform on Income.
- **Changing the card, stopping renewal.** Billing › Change card opens
  Stripe's customer portal. Turning auto-renew off, cancelling, moving to
  Basic or to another plan tells Stripe first, and only then says it is done.
- **Refunds** go back through Stripe, on the payment behind the invoice.

### Bank transfer — works with no merchant account

```bash
BANK_ACCOUNT_TITLE="KSF Pharmacy Systems"
BANK_ACCOUNT_NUMBER="1234-5678-9012-3456"
BANK_NAME="Meezan Bank"
BANK_BRANCH="Clifton, Karachi"
BANK_IBAN="PK00MEZN0000000000000000"
BANK_RAAST_ID="+923001234567"          # optional
BANK_TRANSFER_EXPIRY_DAYS=7
PAYMENT_ALLOW_SELF_VERIFY=false         # leave false: two pairs of eyes
```

### An aggregator

```bash
PAYMENT_PROVIDER=gateway                # the default offered on the screen
GATEWAY_NAME="Safepay"
GATEWAY_CHECKOUT_URL="https://sandbox.api.example/checkout"
GATEWAY_MERCHANT_ID="…"
GATEWAY_API_KEY="…"
GATEWAY_WEBHOOK_SECRET="…"              # HMAC-SHA256 over the raw request body
GATEWAY_SIGNATURE_HEADER=x-signature
GATEWAY_STATUS_URL="https://sandbox.api.example/status"   # enables reconcile
GATEWAY_REFUND_URL="https://sandbox.api.example/refund"   # enables refunds
GATEWAY_MODE=sandbox
GATEWAY_EXPIRY_MINUTES=30
GATEWAY_TIMEOUT_MS=12000
GATEWAY_VERIFIED=false                  # set true only after §6
```

Without `GATEWAY_STATUS_URL` there is no reconciliation, and the screen says
so. Without `GATEWAY_REFUND_URL` a refund is recorded for the operator to make
in the provider's own portal, and the reply says that in plain words.

### JazzCash

```bash
JAZZCASH_MERCHANT_ID="…"
JAZZCASH_PASSWORD="…"
JAZZCASH_INTEGRITY_SALT="…"
JAZZCASH_POST_URL="https://sandbox.jazzcash.com.pk/…"
JAZZCASH_TXN_TYPE=MWALLET               # MWALLET | MIGS | OTC
JAZZCASH_VERSION=2.0
JAZZCASH_MODE=sandbox
JAZZCASH_EXPIRY_MINUTES=30
JAZZCASH_VERIFIED=false
```

### Easypaisa

```bash
EASYPAISA_STORE_ID="…"
EASYPAISA_HASH_KEY="…"
EASYPAISA_POST_URL="https://easypay.easypaisa.com.pk/…"
EASYPAISA_METHOD=MA_PAYMENT_METHOD
EASYPAISA_MODE=sandbox
EASYPAISA_EXPIRY_MINUTES=30
# The order of the fields in the hash differs between merchant packs.
# Confirm yours and set it here before switching Easypaisa on.
EASYPAISA_HASH_FIELDS="amount,storeId,postBackURL,orderRefNum,expiryDate,merchantHashedReq,autoRedirect"
EASYPAISA_VERIFIED=false
```

### The callback URLs to register with the provider

```
Webhook (server to server):  https://your-domain/api/v1/payments/webhook/<provider>
Return (the browser):        https://your-domain/api/v1/payments/return/<provider>
```

`<provider>` is `stripe`, `jazzcash`, `easypaisa`, `gateway` or `bank-transfer`. Both must
be reachable over HTTPS from the internet. `PUBLIC_APP_URL` must be set
correctly or the redirect back into the application will not work.

---

## 5. What to confirm with each provider before you build against them

Everything in §4 is from published documentation rather than from an account
anybody here holds. Confirm these, in writing, with the provider:

- **The hash construction.** Which fields, in which order, with the salt
  prefixed or appended. This is the single most common reason a first
  integration fails, and for JazzCash it is the only function that changes
  (`jazzcashSignature()` in `backend/src/services/payments/adapters.ts`).
- **The sandbox and live endpoints**, and whether they differ by product.
- **The response codes** that mean success, failure, cancellation and expiry.
  The adapters map them; confirm the list for your account.
- **Whether a webhook exists at all.** Some Pakistani integrations are
  redirect-only. The code handles that — the return URL verifies the signature
  and applies the result — but it changes what "reconciliation" means for you.
- **Settlement timing and fees**, so the Billing screen's figures are not a
  surprise. **Do not describe "no setup fee" as "free transactions."**
- **Refund support**: through an API, or only in their portal.

---

## 6. The sandbox cases to run before setting `*_VERIFIED=true`

Run each against the provider's sandbox, with a real merchant account, and keep
the evidence. The automated suites (`npm test`) already prove the
adapter code handles each of these correctly against a stub — what this proves
is that the provider behaves the way its documentation says.

| # | Case | What must happen |
|---|---|---|
| 1 | A payment that succeeds | The subscription period extends once. The ledger row says `succeeded` with the provider's reference |
| 2 | The same callback delivered twice | Nothing changes the second time. The period does not extend twice |
| 3 | A payment the customer cancels | The attempt ends `cancelled`. Nothing is extended |
| 4 | A payment that times out | The attempt ends `expired` after its window |
| 5 | A callback with a tampered signature | Refused. A security event is recorded. Nothing changes |
| 6 | A callback with the right signature but the wrong amount | Refused and recorded as an amount mismatch. Nothing is extended |
| 7 | A late callback for a payment already cancelled | Ignored. The state machine does not allow the transition |
| 8 | A successful payment whose callback never arrives (block it at the firewall) | `POST /platform/payments/reconcile` finds it and settles it |
| 9 | A refund | Recorded against the original charge. A second refund of the same amount is refused |
| 10 | A bank transfer | Cannot be confirmed without a statement reference, and by default not by the person who started it |

When all ten pass, set that provider's `*_VERIFIED=true`. Until then the
Billing screen tells the pharmacy Admin the method has not been verified, which is the
truth.

---

## 7. What to watch once it is live

- **Open attempts older than their expiry.** `GET /api/v1/platform/payments/attempts` (all pharmacies) or `GET /api/v1/billing/attempts` (one pharmacy).
  A growing pile means callbacks are not arriving — check the webhook URL first.
- **Amount mismatches.** These are in the security log. One is a
  misconfiguration; a pattern is somebody probing.
- **Refunds without a provider reference.** Those are the ones somebody has to
  finish by hand in the provider's portal.
- **The reconciliation job.** If you run it on a schedule, read its output
  occasionally. A reconcile that settles something every day means the webhook
  is broken and nobody has noticed.

---

## 8. Where the code is

| File | What it holds |
|---|---|
| `backend/src/services/payments/provider.ts` | The status vocabulary, the legal transitions, HMAC helpers, and the adapter contract |
| `backend/src/services/payments/adapters.ts` | The four adapters: the generic gateway, JazzCash (`pp_SecureHash`), Easypaisa (configurable hash order) and bank transfer (its `verifyCallback()` always refuses — a transfer is confirmed by a person) |
| `backend/src/services/payments/stripe.ts` | Stripe: Checkout Sessions, the `Stripe-Signature` check, events, lookups, refunds, renewal and the customer portal |
| `backend/src/services/payments/index.ts` | Creating an attempt, settling from a provider, reconciling, refunding, confirming a transfer by hand |
| `backend/src/modules/billing.ts` | The pharmacy's Billing endpoints and the public callback routes |
| `backend/src/modules/platform.ts` | The Super Admin's side: confirming transfers, refunds, recording offline payments, income |
| `backend/src/modules/invoices.ts` | Invoices and receipts for the pharmacy and the platform |
| `tests/unit.test.mjs` | Transition rules, money conversion and signature checks |
| `tests/stripe.test.mjs` | Stripe end to end against a stand-in for its API |
