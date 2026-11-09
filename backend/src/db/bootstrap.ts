/* ==========================================================================
   Start-up: indexes, plans and the platform Super Admin
   --------------------------------------------------------------------------
   Safe to run on every start. Nothing here ever overwrites what is already
   in the database, and nothing here creates demonstration data: a new
   installation has the subscription plans (configuration, not data) and one
   account — the Super Admin from SUPER_ADMIN_* in .env. Every pharmacy, its
   staff, medicines and sales are created by real people through the app.
   ========================================================================== */

import type { IndexDescription } from 'mongodb';
import { env } from '../config/env.js';
import { col, db } from './mongo.js';
import type { Plan, User } from './types.js';
import { PLAN_SEED, RETIRED_PLAN_KEYS, TRIAL_PLAN_KEY, WALLET_RENAMES, type PlanSeed } from '../domain/plans.js';
import { PERMISSION_KEYS, PHARMACY_ADMIN_ROLE, ROLE_GRANTS_BY_RELEASE } from '../domain/permissions.js';
import { starterFields } from '../domain/medicine-directory.js';
import { hashPassword, passwordProblem } from '../security/password.js';
import { isEmail, nowIso, uid } from '../core/util.js';

const INDEXES: Record<string, IndexDescription[]> = {
  pharmacies: [{ key: { slug: 1 }, unique: true }, { key: { status: 1, created_at: -1 } }],
  branches: [{ key: { pharmacy_id: 1 } }],
  roles: [{ key: { pharmacy_id: 1, key: 1 }, unique: true }],
  users: [{ key: { email: 1 }, unique: true }, { key: { pharmacy_id: 1, role_id: 1 } }, { key: { is_platform_admin: 1 } }, { key: { is_platform_staff: 1, platform_role_id: 1 } }],
  platform_roles: [{ key: { name_key: 1 }, unique: true }],
  avatars: [{ key: { user_id: 1 } }],
  sessions: [{ key: { user_id: 1, revoked_at: 1 } }, { key: { device_id: 1 } }, { key: { expires_at: 1 } }],
  devices: [{ key: { user_id: 1, status: 1 } }, { key: { pharmacy_id: 1 } }],
  settings: [{ key: { pharmacy_id: 1 } }],
  categories: [{ key: { pharmacy_id: 1, name: 1 } }],
  medicines: [{ key: { pharmacy_id: 1, status: 1, name: 1 } }, { key: { pharmacy_id: 1, barcode: 1 } }, { key: { pharmacy_id: 1, sku: 1 } }],
  batches: [{ key: { medicine_id: 1, status: 1, expiry_date: 1 } }, { key: { pharmacy_id: 1, status: 1, expiry_date: 1 } }],
  stock_movements: [{ key: { pharmacy_id: 1, medicine_id: 1, created_at: -1 } }, { key: { pharmacy_id: 1, created_at: -1 } }],
  suppliers: [{ key: { pharmacy_id: 1, name: 1 } }],
  purchases: [{ key: { pharmacy_id: 1, purchase_date: -1 } }, { key: { supplier_id: 1 } }],
  customers: [{ key: { pharmacy_id: 1, name: 1 } }, { key: { pharmacy_id: 1, phone: 1 } }],
  customer_payments: [{ key: { customer_id: 1, received_at: -1 } }, { key: { pharmacy_id: 1, received_at: -1 } }],
  prescriptions: [{ key: { pharmacy_id: 1, created_at: -1 } }, { key: { pharmacy_id: 1, status: 1 } }],
  sales: [
    { key: { pharmacy_id: 1, sold_at: -1 } }, { key: { pharmacy_id: 1, served_by: 1, sold_at: -1 } },
    { key: { pharmacy_id: 1, invoice_no: 1 } }, { key: { customer_id: 1 } }, { key: { pharmacy_id: 1, 'items.medicine_id': 1 } }
  ],
  expenses: [{ key: { pharmacy_id: 1, expense_date: -1 } }],
  day_closings: [{ key: { pharmacy_id: 1, business_date: -1 } }],
  income_entries: [{ key: { pharmacy_id: 1, received_on: -1 } }],
  platform_entries: [{ key: { entry_date: -1 } }, { key: { kind: 1, category: 1 } }],
  salary_payments: [{ key: { pharmacy_id: 1, paid_on: -1 } }, { key: { pharmacy_id: 1, staff_id: 1, period: 1, kind: 1 } }],
  supplier_payments: [{ key: { pharmacy_id: 1, paid_on: -1 } }, { key: { purchase_id: 1 } }],
  medicine_directory: [{ key: { name_key: 1 }, unique: true }, { key: { status: 1, category: 1, name_key: 1 } }],
  notifications: [{ key: { pharmacy_id: 1, created_at: -1 } }, { key: { pharmacy_id: 1, type: 1, is_read: 1 } }, { key: { pharmacy_id: 1, audience: 1, created_at: -1 } }],
  activity_logs: [{ key: { pharmacy_id: 1, created_at: -1 } }],
  audit_logs: [{ key: { pharmacy_id: 1, sequence: 1 }, unique: true }],
  security_events: [{ key: { user_id: 1, type: 1, created_at: -1 } }, { key: { pharmacy_id: 1, created_at: -1 } }],
  login_attempts: [{ key: { email: 1, created_at: -1 } }],
  conversations: [{ key: { pharmacy_id: 1, last_message_at: -1 } }, { key: { 'members.user_id': 1 } }],
  messages: [{ key: { conversation_id: 1, created_at: 1 } }],
  registrations: [{ key: { token_hash: 1 }, unique: true }, { key: { email: 1 } }],
  verification_codes: [{ key: { purpose: 1, email: 1, created_at: -1 } }],
  rate_limits: [{ key: { expires_at: 1 }, expireAfterSeconds: 0 }],
  auth_tickets: [{ key: { expires_at: 1 }, expireAfterSeconds: 0 }],
  recovery_codes: [{ key: { user_id: 1 } }],
  subscription_plans: [{ key: { key: 1 }, unique: true }],
  subscriptions: [{ key: { pharmacy_id: 1, status: 1 } }, { key: { renewal_at: 1 } }],
  subscription_payments: [
    { key: { pharmacy_id: 1, created_at: -1 } },
    /* A provider's charge id is unique anyway; a slip number typed for an
       offline payment is unique within its own pharmacy only. */
    { key: { provider: 1, provider_reference: 1, pharmacy_id: 1 }, unique: true, partialFilterExpression: { provider_reference: { $type: 'string' } } }
  ],
  payment_attempts: [{ key: { reference: 1 }, unique: true }, { key: { pharmacy_id: 1, created_at: -1 } }, { key: { status: 1, expires_at: 1 } }],
  payment_refunds: [{ key: { payment_id: 1 } }],
  webhook_events: [{ key: { provider: 1, event_id: 1 }, unique: true }],
  referral_codes: [{ key: { code: 1 }, unique: true }, { key: { pharmacy_id: 1 } }],
  referrals: [{ key: { code: 1, referred_email: 1 }, unique: true }, { key: { referrer_pharmacy_id: 1, status: 1 } }, { key: { referred_pharmacy_id: 1 } }, { key: { created_at: -1 } }],
  trials: [{ key: { pharmacy_id: 1, status: 1 } }],
  /* Website visitors and daily use, kept about 13 months for the platform overview. */
  site_visits: [{ key: { day: 1 } }, { key: { expires_at: 1 }, expireAfterSeconds: 0 }],
  site_pages: [{ key: { day: 1 } }, { key: { expires_at: 1 }, expireAfterSeconds: 0 }],
  active_days: [{ key: { day: 1 } }, { key: { expires_at: 1 }, expireAfterSeconds: 0 }],
  migration_jobs: [{ key: { pharmacy_id: 1, created_at: -1 } }],
  migration_items: [{ key: { job_id: 1, row_number: 1 } }, { key: { job_id: 1, status: 1 } }],
  mail_deliveries: [
    { key: { status: 1, next_attempt_at: 1 } }, { key: { pharmacy_id: 1, created_at: -1 } },
    { key: { notice_key: 1 }, unique: true, partialFilterExpression: { notice_key: { $type: 'string' } } }
  ],
  support_tickets: [
    { key: { reference: 1 }, unique: true }, { key: { pharmacy_id: 1, last_activity_at: -1 } }, { key: { status: 1, last_activity_at: -1 } },
    { key: { assigned_to: 1, status: 1 } }
  ]
};

/* Indexes a later release replaced. Dropped once they are found, after their
   replacement exists. */
const RETIRED_INDEXES: Array<[collection: string, index: string]> = [
  /* 2.2.0: offline payment references became unique per pharmacy. */
  ['subscription_payments', 'provider_1_provider_reference_1']
];

export async function ensureIndexes(): Promise<void> {
  for (const [name, indexes] of Object.entries(INDEXES)) {
    await db().collection(name).createIndexes(indexes);
  }
  for (const [name, index] of RETIRED_INDEXES) {
    if (await db().collection(name).indexExists(index).catch(() => false)) await db().collection(name).dropIndex(index);
  }
}

/** The fields of a plan that come from the price sheet (everything but its identity and dates). */
const sheetFields = (plan: PlanSeed) => ({
  name: plan.name, tagline: plan.tagline, description: plan.description, period: plan.period, period_days: plan.periodDays,
  price_paisa: plan.pricePaisa, currency: 'PKR', annual_discount_pct: plan.discount, trial_days: plan.trialDays, grace_days: plan.graceDays,
  max_desktop_devices: plan.desktop, max_mobile_devices: plan.mobile, max_users: plan.users, max_branches: plan.branches,
  max_medicines: plan.medicines, features: plan.features, auto_renew: plan.autoRenew, is_default: plan.isDefault, is_public: 1 as const,
  is_free: plan.isFree, sort_order: plan.sort, status: 'active', referral_price_paisa: plan.referralPricePaisa,
  max_cycles: plan.maxCycles, is_trial: plan.isTrial
});

export async function ensurePlans(): Promise<number> {
  let added = 0;
  const at = nowIso();
  for (const plan of PLAN_SEED) {
    const id = `PLAN-${plan.key.toUpperCase()}`;
    const doc: Plan = { _id: id, id, key: plan.key, ...sheetFields(plan), created_at: at, updated_at: at };
    const result = await col.plans().updateOne({ key: plan.key }, { $setOnInsert: doc }, { upsert: true });
    added += result.upsertedCount;
  }
  return added;
}

/**
 * Move an installation from the plans of 2.5 and earlier (Basic, Weekly,
 * Monthly, Annual) to the three on the price sheet — once, so a price the
 * Super Admin changes afterwards is never put back.
 *
 *   - Starter, Monthly and Yearly take the sheet's prices and terms; Basic,
 *     Weekly and Annual are retired (kept, so old invoices still name them).
 *   - A pharmacy on the free Basic plan, a trial, or no plan at all starts a
 *     fresh 15-day trial today, so nobody is locked out by the change.
 *   - A pharmacy that has paid keeps what it paid for, to the end of its
 *     period; then it chooses Monthly or Yearly like everyone else.
 */
export async function adoptPriceSheet(): Promise<{ trials: number }> {
  const marker = await col.counters().updateOne(
    { _id: 'plans:price-sheet-2026-11' }, { $setOnInsert: { pharmacy_id: 'platform', name: 'price-sheet', value: 1 } }, { upsert: true }
  );
  if (!marker.upsertedCount) return { trials: 0 };
  const at = nowIso();
  for (const plan of PLAN_SEED) await col.plans().updateOne({ key: plan.key }, { $set: { ...sheetFields(plan), updated_at: at } });
  await col.plans().updateMany({ key: { $in: RETIRED_PLAN_KEYS } }, { $set: { status: 'retired', is_public: 0, is_default: 0, updated_at: at } });
  await col.plans().updateMany({ key: { $ne: TRIAL_PLAN_KEY }, is_default: 1 }, { $set: { is_default: 0, updated_at: at } });

  const { currentSubscription, isEntitled, startTrial } = await import('../services/subscriptions.js');
  let trials = 0;
  for (const pharmacy of await col.pharmacies().find({}, { projection: { _id: 1 } }).toArray()) {
    const subscription = await currentSubscription(pharmacy._id);
    const paid = subscription && !subscription.is_free && subscription.price_paisa > 0 && subscription.status !== 'trial' && isEntitled(subscription);
    if (paid) continue;
    await startTrial({ pharmacyId: pharmacy._id, source: 'plan-change', again: true });
    trials += 1;
  }
  return { trials };
}

/**
 * 2.9.0: Starter, Monthly and Yearly become Demo, Pro (Rs 1,400) and
 * Diamond Annual — once, and only where the Super Admin has not already
 * renamed or repriced a plan. A pharmacy already paying keeps its own price
 * until it chooses again (subscriptions carry their own price).
 */
export async function adoptWalletPlans(): Promise<number> {
  const marker = await col.counters().updateOne(
    { _id: 'plans:wallet-2026-11' }, { $setOnInsert: { pharmacy_id: 'platform', name: 'wallet-plans', value: 1 } }, { upsert: true }
  );
  if (!marker.upsertedCount) return 0;
  let changed = 0;
  const at = nowIso();
  for (const rename of WALLET_RENAMES) {
    const named = await col.plans().updateOne(
      { key: rename.key, name: rename.from.name },
      { $set: { name: rename.to.name, tagline: rename.to.tagline, description: rename.to.description, updated_at: at } }
    );
    changed += named.modifiedCount;
    if (rename.from.pricePaisa !== undefined && rename.to.pricePaisa !== undefined) {
      changed += (await col.plans().updateOne({ key: rename.key, price_paisa: rename.from.pricePaisa }, { $set: { price_paisa: rename.to.pricePaisa, updated_at: at } })).modifiedCount;
    }
  }
  return changed;
}

/**
 * Bring the built-in roles of pharmacies created before a release up to it.
 * The Admin holds every permission by definition, so it gets any new one on
 * every start. Other built-in roles get what a release added to them once —
 * the marker makes sure an Admin who later takes one away is not overruled.
 */
export async function syncSystemRoles(): Promise<number> {
  let changed = 0;
  for (const grant of ROLE_GRANTS_BY_RELEASE) {
    const marker = await col.counters().updateOne(
      { _id: `release:${grant.release}:${grant.role}` },
      { $setOnInsert: { pharmacy_id: 'platform', name: 'role-grant', value: 1 } },
      { upsert: true }
    );
    if (!marker.upsertedCount) continue;
    changed += (await col.roles().updateMany({ key: grant.role, is_system: 1 }, { $addToSet: { permissions: { $each: grant.permissions } } })).modifiedCount;
  }
  changed += (await col.roles().updateMany({ key: PHARMACY_ADMIN_ROLE, is_system: 1 }, { $addToSet: { permissions: { $each: PERMISSION_KEYS } } })).modifiedCount;
  return changed;
}

/**
 * The medicine directory's starter set, once per installation. Reference
 * content, like the plans — not demonstration data — and every entry arrives
 * unverified until a pharmacist on the KSF team checks it. Run once, so an
 * entry the team archives does not come back at the next start.
 */
export async function ensureMedicineDirectory(): Promise<number> {
  const marker = await col.counters().updateOne(
    { _id: 'directory:starter-v1' }, { $setOnInsert: { pharmacy_id: 'platform', name: 'directory-starter', value: 1 } }, { upsert: true }
  );
  if (!marker.upsertedCount) return 0;
  const at = nowIso();
  let added = 0;
  for (const fields of starterFields()) {
    const id = uid('DIR');
    const result = await col.directory().updateOne({ name_key: fields.name_key }, {
      $setOnInsert: {
        _id: id, id, ...fields, source: 'starter', verified_by: null, verified_by_name: null, verified_at: null,
        created_by: null, created_at: at, updated_by: null, updated_at: at
      }
    }, { upsert: true });
    added += result.upsertedCount;
  }
  return added;
}

/**
 * The platform's one Super Admin, created the first time the server starts
 * with SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD set. After that the account
 * lives in the database: the Super Admin changes their own e-mail address and
 * password from their dashboard, and .env is no longer read for it.
 */
export async function ensureSuperAdmin(): Promise<'exists' | 'created' | 'missing-settings'> {
  if (await col.users().findOne({ is_platform_admin: 1 }, { projection: { _id: 1 } })) return 'exists';

  const email = env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const password = env.SUPER_ADMIN_PASSWORD;
  if (!isEmail(email) || !password) return 'missing-settings';
  const problem = passwordProblem(password);
  if (problem) throw new Error(`SUPER_ADMIN_PASSWORD in .env is not strong enough: ${problem}`);

  const at = nowIso();
  const id = uid('USR');
  const user: User = {
    _id: id, id, pharmacy_id: null, branch_id: null, role_id: null, is_platform_admin: 1,
    full_name: env.SUPER_ADMIN_NAME || 'Super Admin', email, phone: null, cnic: null, pharmacist_reg_no: null,
    password_hash: await hashPassword(password), password_changed_at: at, must_change_password: 0,
    status: 'active', failed_attempts: 0, locked_until: null, last_login_at: null, email_verified_at: at,
    totp_secret: null, totp_enabled: 0, totp_confirmed_at: null, recovery_generated_at: null,
    is_owner: 0, theme: null, created_at: at, updated_at: at
  };
  await col.users().insertOne(user);
  return 'created';
}

export async function bootstrap({ silent = false } = {}): Promise<void> {
  await ensureIndexes();
  const plans = await ensurePlans();
  const sheet = await adoptPriceSheet();
  await adoptWalletPlans();
  const roles = await syncSystemRoles();
  const directory = await ensureMedicineDirectory();
  const admin = await ensureSuperAdmin();
  if (silent) return;
  if (plans) console.log(`[KSF] added ${plans} subscription plan(s)`);
  if (sheet.trials) console.log(`[KSF] moved to the Starter, Monthly and Yearly plans: ${sheet.trials} pharmacy(ies) on a free plan started a 15-day free trial`);
  if (roles) console.log(`[KSF] brought ${roles} built-in role(s) up to this release`);
  if (directory) console.log(`[KSF] added ${directory} medicine(s) to the directory's starter set — unverified until the team checks them`);
  if (admin === 'created') console.log(`[KSF] created the platform Super Admin account for ${env.SUPER_ADMIN_EMAIL}`);
  if (admin === 'missing-settings') {
    console.warn('[KSF] No Super Admin yet. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env and restart.');
  }
}
