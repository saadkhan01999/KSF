# API inventory

Generated from the route table by `npm run api:inventory` — do not edit by hand;
`npm test` fails when it is out of date. Every route is also covered by
`tests/access.test.mjs` (who may call it) and `tests/security.test.mjs` (hostile
input never causes a server error); **Also tested in** lists the functional test
files that call it by name.

**273 endpoints:** 24 public, 22 for any signed-in person, 169 pharmacy, 58 platform console. All are under `/api/v1`; besides them the server answers `GET /api/v1/health` and `GET /api/v1/avatars/:id`.

Who may call it: **anyone** (no sign-in); **signed in** (any account); **pharmacy:**
signed in, inside a pharmacy, holding the permission named (a write also needs a
working plan); **platform:** the Super Admin (`owner`) or a KSF team member whose
role holds the access named (`any` is every team member).

| Method | Path | Who may call it | Plan feature | Other sites may post | Also tested in |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/device-release` | anyone |  |  |  |
| POST | `/api/v1/auth/forgot-password` | anyone |  |  | security |
| POST | `/api/v1/auth/login` | anyone |  |  | api, security |
| POST | `/api/v1/auth/logout` | anyone |  |  | security |
| POST | `/api/v1/auth/refresh` | anyone |  |  | api, security |
| POST | `/api/v1/auth/reset-password` | anyone |  |  | security |
| POST | `/api/v1/auth/two-factor` | anyone |  |  | security |
| GET | `/api/v1/cron/maintenance` | anyone |  |  | plans |
| GET | `/api/v1/dev/outbox` | anyone |  |  |  |
| GET | `/api/v1/payments/return/:provider` | anyone |  | yes (signed) | stripe |
| POST | `/api/v1/payments/return/:provider` | anyone |  | yes (signed) | stripe |
| POST | `/api/v1/payments/webhook/:provider` | anyone |  | yes (signed) | stripe |
| GET | `/api/v1/public/brand` | anyone |  |  |  |
| GET | `/api/v1/public/events` | anyone |  |  | live |
| POST | `/api/v1/public/password-strength` | anyone |  |  |  |
| GET | `/api/v1/public/plans` | anyone |  |  | live, plans, security |
| GET | `/api/v1/public/referral/:code` | anyone |  |  |  |
| POST | `/api/v1/public/visit` | anyone |  |  | wallet-insights |
| POST | `/api/v1/register/cancel` | anyone |  |  |  |
| POST | `/api/v1/register/resend` | anyone |  |  |  |
| POST | `/api/v1/register/start` | anyone |  |  | api, plans, wallet-insights |
| GET | `/api/v1/register/state` | anyone |  |  |  |
| POST | `/api/v1/register/verify-email` | anyone |  |  | api, plans, wallet-insights |
| POST | `/api/v1/webhooks/payments/:provider` | anyone |  | yes (signed) |  |
| POST | `/api/v1/account/2fa/disable` | signed in |  |  | security |
| POST | `/api/v1/account/2fa/enable` | signed in |  |  | security |
| POST | `/api/v1/account/2fa/recovery-codes` | signed in |  |  |  |
| POST | `/api/v1/account/2fa/start` | signed in |  |  | security |
| GET | `/api/v1/account/devices` | signed in |  |  |  |
| DELETE | `/api/v1/account/devices/:id` | signed in |  |  |  |
| PATCH | `/api/v1/account/devices/:id` | signed in |  |  |  |
| GET | `/api/v1/account/security` | signed in |  |  |  |
| GET | `/api/v1/account/sessions` | signed in |  |  |  |
| DELETE | `/api/v1/account/sessions/:id` | signed in |  |  | security |
| POST | `/api/v1/account/sessions/logout-all` | signed in |  |  | security |
| POST | `/api/v1/auth/change-password` | signed in |  |  | api |
| GET | `/api/v1/auth/session` | signed in |  |  | api, platform-accounts, security |
| POST | `/api/v1/auth/verify-identity` | signed in |  |  | api, plans, platform-accounts, security, stripe, wallet-insights |
| GET | `/api/v1/bootstrap` | signed in |  |  | api |
| GET | `/api/v1/events` | signed in |  |  | live |
| PATCH | `/api/v1/me` | signed in |  |  | api |
| POST | `/api/v1/me/email/confirm` | signed in |  |  | api |
| POST | `/api/v1/me/email/start` | signed in |  |  | api |
| GET | `/api/v1/me/sessions` | signed in |  |  |  |
| GET | `/api/v1/medicine-directory` | signed in |  |  | directory |
| GET | `/api/v1/medicine-directory/:id` | signed in |  |  | directory |
| GET | `/api/v1/account/audit` | pharmacy: audit.read |  |  | accounting |
| GET | `/api/v1/account/audit-integrity` | pharmacy: audit.read |  |  |  |
| GET | `/api/v1/account/export` | pharmacy: settings.read |  |  |  |
| GET | `/api/v1/account/privacy` | pharmacy: any member |  |  |  |
| GET | `/api/v1/account/referrals` | pharmacy: any member |  |  |  |
| GET | `/api/v1/accounting/export` | pharmacy: accounting.view | reports.export |  | accounting |
| GET | `/api/v1/accounting/income` | pharmacy: accounting.view |  |  | accounting |
| POST | `/api/v1/accounting/income` | pharmacy: accounting.manage |  |  | accounting |
| DELETE | `/api/v1/accounting/income/:id` | pharmacy: accounting.manage |  |  | accounting |
| PATCH | `/api/v1/accounting/income/:id` | pharmacy: accounting.manage |  |  | accounting |
| GET | `/api/v1/accounting/salaries` | pharmacy: accounting.view |  |  | accounting |
| POST | `/api/v1/accounting/salaries` | pharmacy: accounting.manage |  |  | accounting |
| DELETE | `/api/v1/accounting/salaries/:id` | pharmacy: accounting.manage |  |  | accounting |
| PATCH | `/api/v1/accounting/salaries/:id` | pharmacy: accounting.manage |  |  | accounting |
| GET | `/api/v1/accounting/salaries/payees` | pharmacy: accounting.manage |  |  | accounting |
| GET | `/api/v1/accounting/summary` | pharmacy: accounting.view |  |  | accounting |
| GET | `/api/v1/accounting/transactions` | pharmacy: accounting.view |  |  | accounting |
| GET | `/api/v1/activity` | pharmacy: audit.read |  |  | api |
| GET | `/api/v1/billing` | pharmacy: settings.read |  |  | plans, stripe, wallet-insights |
| GET | `/api/v1/billing/attempts` | pharmacy: settings.read |  |  |  |
| POST | `/api/v1/billing/auto-renew` | pharmacy: settings.write |  |  | stripe |
| POST | `/api/v1/billing/cancel` | pharmacy: settings.write |  |  | plans |
| POST | `/api/v1/billing/checkout` | pharmacy: settings.write |  |  | plans, stripe |
| GET | `/api/v1/billing/entitlements` | pharmacy: any member |  |  | api, live, plans, stripe |
| GET | `/api/v1/billing/invoices` | pharmacy: settings.read |  |  | stripe |
| GET | `/api/v1/billing/invoices/:id` | pharmacy: settings.read |  |  | stripe |
| GET | `/api/v1/billing/payments` | pharmacy: settings.read |  |  |  |
| POST | `/api/v1/billing/plan` | pharmacy: settings.write |  |  | plans, stripe |
| GET | `/api/v1/billing/plans` | pharmacy: any member |  |  |  |
| POST | `/api/v1/billing/portal` | pharmacy: settings.write |  |  | stripe |
| GET | `/api/v1/billing/providers` | pharmacy: settings.read |  |  | stripe |
| POST | `/api/v1/billing/referral` | pharmacy: settings.write |  |  | plans |
| POST | `/api/v1/billing/referral-rewards/claim` | pharmacy: settings.write |  |  | wallet-insights |
| GET | `/api/v1/branches` | pharmacy: settings.read |  |  |  |
| POST | `/api/v1/branches` | pharmacy: branches.manage |  |  |  |
| PATCH | `/api/v1/branches/:id` | pharmacy: branches.manage |  |  |  |
| GET | `/api/v1/categories` | pharmacy: medicines.read |  |  | api, plans, scanning |
| POST | `/api/v1/categories` | pharmacy: categories.manage |  |  | api, plans, scanning |
| DELETE | `/api/v1/categories/:id` | pharmacy: categories.manage |  |  |  |
| PATCH | `/api/v1/categories/:id` | pharmacy: categories.manage |  |  |  |
| GET | `/api/v1/customer-payments` | pharmacy: customers.read |  |  |  |
| POST | `/api/v1/customer-payments/:id/reverse` | pharmacy: sales.refund |  |  | api |
| GET | `/api/v1/customers` | pharmacy: customers.read |  |  | api, selling-gst-loan |
| POST | `/api/v1/customers` | pharmacy: customers.write |  |  | api, selling-gst-loan |
| DELETE | `/api/v1/customers/:id` | pharmacy: customers.write |  |  | api, selling-gst-loan |
| GET | `/api/v1/customers/:id` | pharmacy: customers.read |  |  | api, selling-gst-loan |
| PATCH | `/api/v1/customers/:id` | pharmacy: customers.write |  |  | api, selling-gst-loan |
| POST | `/api/v1/customers/:id/payments` | pharmacy: pos.operate |  |  | api |
| GET | `/api/v1/dashboard` | pharmacy: dashboard.view |  |  | api |
| GET | `/api/v1/day-close` | pharmacy: day-close.manage |  |  | api |
| POST | `/api/v1/day-close` | pharmacy: day-close.manage |  |  | api |
| GET | `/api/v1/day-close/:id` | pharmacy: day-close.manage |  |  | api, selling-gst-loan |
| GET | `/api/v1/day-close/preview` | pharmacy: day-close.manage |  |  | api, selling-gst-loan |
| GET | `/api/v1/expenses` | pharmacy: expenses.read |  |  | accounting |
| POST | `/api/v1/expenses` | pharmacy: expenses.write |  |  | accounting |
| DELETE | `/api/v1/expenses/:id` | pharmacy: expenses.write |  |  |  |
| PATCH | `/api/v1/expenses/:id` | pharmacy: expenses.write |  |  |  |
| POST | `/api/v1/expenses/:id/approve` | pharmacy: expenses.approve |  |  |  |
| GET | `/api/v1/expiry` | pharmacy: inventory.read |  |  |  |
| POST | `/api/v1/expiry/:id/quarantine` | pharmacy: expiry.manage |  |  |  |
| POST | `/api/v1/expiry/:id/release` | pharmacy: expiry.manage |  |  |  |
| POST | `/api/v1/expiry/:id/write-off` | pharmacy: expiry.manage |  |  |  |
| POST | `/api/v1/expiry/quarantine-expired` | pharmacy: expiry.manage |  |  |  |
| GET | `/api/v1/inventory` | pharmacy: inventory.read |  |  | api, selling-gst-loan |
| POST | `/api/v1/inventory/adjust` | pharmacy: inventory.adjust |  |  |  |
| GET | `/api/v1/inventory/batches` | pharmacy: inventory.read |  |  |  |
| POST | `/api/v1/inventory/batches` | pharmacy: inventory.adjust |  |  |  |
| GET | `/api/v1/medicines` | pharmacy: medicines.read |  |  | accounting, api, plans, scanning, selling-gst-loan |
| POST | `/api/v1/medicines` | pharmacy: medicines.write |  |  | accounting, api, plans, scanning, selling-gst-loan |
| GET | `/api/v1/medicines-barcode-info` | pharmacy: medicines.write |  |  | scanning |
| GET | `/api/v1/medicines-lookup` | pharmacy: medicines.read |  |  | selling-gst-loan |
| GET | `/api/v1/medicines-scan` | pharmacy: medicines.read |  |  | api, scanning |
| DELETE | `/api/v1/medicines/:id` | pharmacy: medicines.delete |  |  | api, scanning |
| GET | `/api/v1/medicines/:id` | pharmacy: medicines.read |  |  | api, scanning |
| PATCH | `/api/v1/medicines/:id` | pharmacy: medicines.write |  |  | api, scanning |
| GET | `/api/v1/messages/conversations` | pharmacy: messages.read | messaging.internal |  | api |
| POST | `/api/v1/messages/conversations` | pharmacy: messages.write | messaging.internal |  | api |
| GET | `/api/v1/messages/conversations/:id` | pharmacy: messages.read | messaging.internal |  | api |
| POST | `/api/v1/messages/conversations/:id/messages` | pharmacy: messages.write | messaging.internal |  | api |
| POST | `/api/v1/messages/conversations/:id/mute` | pharmacy: messages.read | messaging.internal |  |  |
| POST | `/api/v1/messages/conversations/:id/read` | pharmacy: messages.read | messaging.internal |  |  |
| POST | `/api/v1/messages/conversations/:id/resolve` | pharmacy: messages.write | messaging.internal |  |  |
| GET | `/api/v1/messages/directory` | pharmacy: messages.write | messaging.internal |  |  |
| DELETE | `/api/v1/messages/messages/:id` | pharmacy: messages.write | messaging.internal |  |  |
| POST | `/api/v1/messages/read-all` | pharmacy: messages.read | messaging.internal |  |  |
| GET | `/api/v1/messages/recent` | pharmacy: messages.read | messaging.internal |  |  |
| GET | `/api/v1/messages/summary` | pharmacy: messages.read | messaging.internal |  | api |
| GET | `/api/v1/migration/categories` | pharmacy: medicines.read |  |  |  |
| GET | `/api/v1/migration/jobs` | pharmacy: medicines.read |  |  | api, security |
| POST | `/api/v1/migration/jobs` | pharmacy: medicines.write |  |  | api, security |
| GET | `/api/v1/migration/jobs/:id` | pharmacy: medicines.read |  |  | api |
| POST | `/api/v1/migration/jobs/:id/import` | pharmacy: medicines.write |  |  | api, security |
| POST | `/api/v1/migration/jobs/:id/items/:itemId` | pharmacy: medicines.write |  |  |  |
| GET | `/api/v1/migration/jobs/:id/reconciliation` | pharmacy: medicines.read |  |  |  |
| GET | `/api/v1/migration/jobs/:id/report` | pharmacy: medicines.read |  |  |  |
| POST | `/api/v1/migration/jobs/:id/rollback` | pharmacy: medicines.write |  |  | api |
| POST | `/api/v1/migration/jobs/:id/suggest-mapping` | pharmacy: medicines.write |  |  |  |
| POST | `/api/v1/migration/jobs/:id/validate` | pharmacy: medicines.write |  |  | api |
| GET | `/api/v1/migration/template/:category` | pharmacy: medicines.read |  |  |  |
| GET | `/api/v1/notifications` | pharmacy: any member |  |  | plans, wallet-insights |
| POST | `/api/v1/notifications/:id/read` | pharmacy: any member |  |  |  |
| POST | `/api/v1/notifications/read-all` | pharmacy: any member |  |  |  |
| GET | `/api/v1/notifications/recent` | pharmacy: any member |  |  |  |
| POST | `/api/v1/notifications/refresh` | pharmacy: inventory.read |  |  |  |
| GET | `/api/v1/prescriptions` | pharmacy: prescriptions.read |  |  | api |
| POST | `/api/v1/prescriptions` | pharmacy: prescriptions.read |  |  | api |
| GET | `/api/v1/prescriptions/:id` | pharmacy: prescriptions.read |  |  | api |
| PATCH | `/api/v1/prescriptions/:id` | pharmacy: prescriptions.read |  |  | api |
| POST | `/api/v1/prescriptions/:id/reject` | pharmacy: prescriptions.verify |  |  |  |
| POST | `/api/v1/prescriptions/:id/verify` | pharmacy: prescriptions.verify |  |  | api |
| GET | `/api/v1/purchases` | pharmacy: purchases.read |  |  | accounting, api, selling-gst-loan |
| POST | `/api/v1/purchases` | pharmacy: purchases.write |  |  | accounting, api, selling-gst-loan |
| GET | `/api/v1/purchases/:id` | pharmacy: purchases.read |  |  | api, selling-gst-loan |
| PATCH | `/api/v1/purchases/:id` | pharmacy: purchases.write |  |  | api, selling-gst-loan |
| POST | `/api/v1/purchases/:id/approve` | pharmacy: purchases.approve |  |  |  |
| POST | `/api/v1/purchases/:id/cancel` | pharmacy: purchases.write |  |  |  |
| POST | `/api/v1/purchases/:id/payment` | pharmacy: purchases.write |  |  | api |
| POST | `/api/v1/purchases/:id/receive` | pharmacy: purchases.write |  |  | api, selling-gst-loan |
| GET | `/api/v1/reports/category-mix` | pharmacy: reports.view | reports.advanced |  |  |
| GET | `/api/v1/reports/discounts` | pharmacy: reports.view | reports.advanced |  |  |
| GET | `/api/v1/reports/expenses` | pharmacy: reports.view |  |  |  |
| GET | `/api/v1/reports/export` | pharmacy: reports.export | reports.export |  | api |
| GET | `/api/v1/reports/overview` | pharmacy: reports.view |  |  | api |
| GET | `/api/v1/reports/people` | pharmacy: reports.everyone |  |  |  |
| GET | `/api/v1/reports/sales-trend` | pharmacy: reports.view |  |  |  |
| GET | `/api/v1/reports/staff-performance` | pharmacy: reports.view | reports.advanced |  |  |
| GET | `/api/v1/reports/stock-valuation` | pharmacy: reports.view | reports.advanced |  |  |
| GET | `/api/v1/reports/top-medicines` | pharmacy: reports.view | reports.advanced |  | live |
| GET | `/api/v1/roles` | pharmacy: roles.read |  |  | api |
| POST | `/api/v1/roles` | pharmacy: roles.manage | staff.roles |  | api |
| DELETE | `/api/v1/roles/:id` | pharmacy: roles.manage | staff.roles |  |  |
| PATCH | `/api/v1/roles/:id` | pharmacy: roles.manage | staff.roles |  |  |
| POST | `/api/v1/roles/:id/duplicate` | pharmacy: roles.manage | staff.roles |  |  |
| GET | `/api/v1/sales` | pharmacy: sales.read |  |  | accounting, api, security, selling-gst-loan |
| POST | `/api/v1/sales` | pharmacy: pos.operate |  |  | accounting, api, security, selling-gst-loan |
| GET | `/api/v1/sales/:id` | pharmacy: sales.read |  |  | api, selling-gst-loan |
| POST | `/api/v1/sales/:id/refund` | pharmacy: sales.refund |  |  | api, selling-gst-loan |
| GET | `/api/v1/settings` | pharmacy: settings.read |  |  | selling-gst-loan |
| PATCH | `/api/v1/settings` | pharmacy: settings.write |  |  | selling-gst-loan |
| GET | `/api/v1/settings/appearance` | pharmacy: settings.read |  |  | api |
| PATCH | `/api/v1/settings/appearance` | pharmacy: settings.write |  |  | api |
| POST | `/api/v1/setup/address` | pharmacy: settings.write |  |  | api |
| POST | `/api/v1/setup/dismiss` | pharmacy: settings.write |  |  |  |
| POST | `/api/v1/setup/licence` | pharmacy: settings.write |  |  |  |
| POST | `/api/v1/setup/pharmacy` | pharmacy: settings.write |  |  | api |
| POST | `/api/v1/setup/plan` | pharmacy: settings.write |  |  |  |
| GET | `/api/v1/setup/state` | pharmacy: any member |  |  | api |
| GET | `/api/v1/staff` | pharmacy: staff.read |  |  | api |
| POST | `/api/v1/staff` | pharmacy: staff.invite |  |  | api |
| DELETE | `/api/v1/staff/:id` | pharmacy: staff.manage |  |  |  |
| PATCH | `/api/v1/staff/:id` | pharmacy: staff.manage |  |  |  |
| GET | `/api/v1/staff/:id/devices` | pharmacy: staff.manage |  |  |  |
| DELETE | `/api/v1/staff/:id/devices/:deviceId` | pharmacy: staff.manage |  |  |  |
| POST | `/api/v1/staff/:id/reset-2fa` | pharmacy: staff.manage |  |  |  |
| POST | `/api/v1/staff/:id/reset-password` | pharmacy: staff.manage |  |  |  |
| POST | `/api/v1/staff/:id/sign-out` | pharmacy: staff.manage |  |  |  |
| POST | `/api/v1/staff/:id/unlock` | pharmacy: staff.manage |  |  |  |
| GET | `/api/v1/staff/help` | pharmacy: staff.manage |  |  |  |
| GET | `/api/v1/stock-movements` | pharmacy: inventory.read |  |  |  |
| GET | `/api/v1/suppliers` | pharmacy: suppliers.read |  |  | accounting, api, selling-gst-loan |
| POST | `/api/v1/suppliers` | pharmacy: suppliers.write |  |  | accounting, api, selling-gst-loan |
| DELETE | `/api/v1/suppliers/:id` | pharmacy: suppliers.write |  |  |  |
| PATCH | `/api/v1/suppliers/:id` | pharmacy: suppliers.write |  |  |  |
| GET | `/api/v1/support/tickets` | pharmacy: support.raise |  |  | api |
| POST | `/api/v1/support/tickets` | pharmacy: support.raise |  |  | api |
| GET | `/api/v1/support/tickets/:id` | pharmacy: support.raise |  |  | api |
| POST | `/api/v1/support/tickets/:id/close` | pharmacy: support.raise |  |  |  |
| POST | `/api/v1/support/tickets/:id/messages` | pharmacy: support.raise |  |  |  |
| POST | `/api/v1/support/tickets/:id/reopen` | pharmacy: support.raise |  |  |  |
| GET | `/api/v1/platform/accounts/entries` | platform: platform.finance.view |  |  | platform-accounts |
| POST | `/api/v1/platform/accounts/entries` | platform: platform.finance.manage |  |  | platform-accounts |
| DELETE | `/api/v1/platform/accounts/entries/:id` | platform: platform.finance.manage |  |  | platform-accounts |
| PATCH | `/api/v1/platform/accounts/entries/:id` | platform: platform.finance.manage |  |  | platform-accounts |
| GET | `/api/v1/platform/accounts/export` | platform: platform.finance.view |  |  | platform-accounts |
| GET | `/api/v1/platform/accounts/summary` | platform: platform.finance.view |  |  | platform-accounts |
| GET | `/api/v1/platform/accounts/transactions` | platform: platform.finance.view |  |  | platform-accounts |
| GET | `/api/v1/platform/activity` | platform: platform.activity |  |  | platform-accounts |
| GET | `/api/v1/platform/analytics` | platform: platform.overview |  |  | wallet-insights |
| GET | `/api/v1/platform/help` | platform: platform.help |  |  | api |
| GET | `/api/v1/platform/income` | platform: platform.finance.view |  |  | api |
| GET | `/api/v1/platform/invoices/:id` | platform: platform.finance.view |  |  | stripe |
| DELETE | `/api/v1/platform/me/avatar` | platform: any |  |  |  |
| PUT | `/api/v1/platform/me/avatar` | platform: any |  |  |  |
| POST | `/api/v1/platform/medicine-directory` | platform: platform.medicines.manage |  |  | directory |
| DELETE | `/api/v1/platform/medicine-directory/:id` | platform: platform.medicines.manage |  |  | directory, security |
| PATCH | `/api/v1/platform/medicine-directory/:id` | platform: platform.medicines.manage |  |  | directory, security |
| POST | `/api/v1/platform/medicine-directory/:id/verify` | platform: platform.medicines.manage |  |  | directory |
| POST | `/api/v1/platform/medicine-directory/import` | platform: platform.medicines.manage |  |  | directory, security |
| GET | `/api/v1/platform/notifications` | platform: any |  |  | api |
| POST | `/api/v1/platform/notifications/:id/read` | platform: any |  |  |  |
| POST | `/api/v1/platform/notifications/read-all` | platform: any |  |  | api |
| GET | `/api/v1/platform/overview` | platform: platform.overview |  |  | api |
| POST | `/api/v1/platform/payments/:id/refund` | platform: platform.finance.manage |  |  | platform-accounts, stripe |
| GET | `/api/v1/platform/payments/attempts` | platform: platform.finance.view |  |  | plans |
| POST | `/api/v1/platform/payments/attempts/:id/verify` | platform: platform.finance.manage |  |  | plans |
| GET | `/api/v1/platform/payments/providers` | platform: platform.finance.view |  |  | platform-accounts |
| POST | `/api/v1/platform/payments/reconcile` | platform: platform.finance.manage |  |  |  |
| GET | `/api/v1/platform/pharmacies` | platform: platform.pharmacies.view |  |  | api |
| GET | `/api/v1/platform/pharmacies/:id` | platform: platform.pharmacies.view |  |  | api, live, plans, platform-accounts, security, wallet-insights |
| PATCH | `/api/v1/platform/pharmacies/:id` | platform: platform.pharmacies.manage |  |  | api, live, plans, platform-accounts, security, wallet-insights |
| POST | `/api/v1/platform/pharmacies/:id/payments` | platform: platform.finance.manage |  |  | api, plans, platform-accounts |
| POST | `/api/v1/platform/pharmacies/:id/status` | platform: platform.pharmacies.manage |  |  | api |
| POST | `/api/v1/platform/pharmacies/:id/subscription` | platform: platform.pharmacies.manage |  |  | api, live, plans, platform-accounts, security, wallet-insights |
| GET | `/api/v1/platform/plans` | platform: any |  |  |  |
| POST | `/api/v1/platform/plans` | platform: platform.plans.manage |  |  |  |
| PATCH | `/api/v1/platform/plans/:key` | platform: platform.plans.manage |  |  | live |
| POST | `/api/v1/platform/referrals/:id/approve` | platform: platform.pharmacies.manage |  |  | wallet-insights |
| POST | `/api/v1/platform/referrals/:id/reject` | platform: platform.pharmacies.manage |  |  | wallet-insights |
| POST | `/api/v1/platform/refunds/:id/complete` | platform: platform.finance.manage |  |  | platform-accounts |
| GET | `/api/v1/platform/security` | platform: platform.activity |  |  |  |
| GET | `/api/v1/platform/support/agents` | platform: platform.support |  |  | api |
| GET | `/api/v1/platform/support/tickets` | platform: platform.support |  |  | api |
| GET | `/api/v1/platform/support/tickets/:id` | platform: platform.support |  |  | api |
| PATCH | `/api/v1/platform/support/tickets/:id` | platform: platform.support |  |  | api |
| POST | `/api/v1/platform/support/tickets/:id/messages` | platform: platform.support |  |  | api |
| GET | `/api/v1/platform/team` | platform: owner |  |  | api, directory, platform-accounts |
| POST | `/api/v1/platform/team` | platform: owner |  |  | api, directory, platform-accounts |
| DELETE | `/api/v1/platform/team/:id` | platform: owner |  |  | api, directory, platform-accounts |
| PATCH | `/api/v1/platform/team/:id` | platform: owner |  |  | api, directory, platform-accounts |
| DELETE | `/api/v1/platform/team/:id/avatar` | platform: owner |  |  |  |
| PUT | `/api/v1/platform/team/:id/avatar` | platform: owner |  |  |  |
| POST | `/api/v1/platform/team/:id/reset-password` | platform: owner |  |  | api |
| POST | `/api/v1/platform/team/:id/sign-out` | platform: owner |  |  |  |
| POST | `/api/v1/platform/team/roles` | platform: owner |  |  | api, directory, platform-accounts |
| DELETE | `/api/v1/platform/team/roles/:id` | platform: owner |  |  | api |
| PATCH | `/api/v1/platform/team/roles/:id` | platform: owner |  |  | api |
| GET | `/api/v1/platform/users` | platform: platform.help,platform.support |  |  |  |
