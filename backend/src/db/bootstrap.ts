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
import { PLAN_SEED } from '../domain/plans.js';
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
  notifications: [{ key: { pharmacy_id: 1, created_at: -1 } }, { key: { pharmacy_id: 1, type: 1, is_read: 1 } }, { key: { pharmacy_id: 1, audience: 1, created_at: -1 } }],
  activity_logs: [{ key: { pharmacy_id: 1, created_at: -1 } }],
  audit_logs: [{ key: { pharmacy_id: 1, sequence: 1 }, unique: true }],
  security_events: [{ key: { user_id: 1, type: 1, created_at: -1 } }, { key: { pharmacy_id: 1, created_at: -1 } }],
  login_attempts: [{ key: { email: 1, created_at: -1 } }],
  conversations: [{ key: { pharmacy_id: 1, last_message_at: -1 } }, { key: { 'members.user_id': 1 } }],
  messages: [{ key: { conversation_id: 1, created_at: 1 } }],
  registrations: [{ key: { token_hash: 1 }, unique: true }, { key: { email: 1 } }],
  verification_codes: [{ key: { purpose: 1, email: 1, created_at: -1 } }],
  recovery_codes: [{ key: { user_id: 1 } }],
  subscription_plans: [{ key: { key: 1 }, unique: true }],
  subscriptions: [{ key: { pharmacy_id: 1, status: 1 } }, { key: { renewal_at: 1 } }],
  subscription_payments: [
    { key: { pharmacy_id: 1, created_at: -1 } },
    { key: { provider: 1, provider_reference: 1 }, unique: true, partialFilterExpression: { provider_reference: { $type: 'string' } } }
  ],
  payment_attempts: [{ key: { reference: 1 }, unique: true }, { key: { pharmacy_id: 1, created_at: -1 } }, { key: { status: 1, expires_at: 1 } }],
  payment_refunds: [{ key: { payment_id: 1 } }],
  webhook_events: [{ key: { provider: 1, event_id: 1 }, unique: true }],
  referral_codes: [{ key: { code: 1 }, unique: true }, { key: { pharmacy_id: 1 } }],
  referrals: [{ key: { code: 1, referred_email: 1 }, unique: true }, { key: { referrer_pharmacy_id: 1, status: 1 } }],
  trials: [{ key: { pharmacy_id: 1, status: 1 } }],
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

export async function ensureIndexes(): Promise<void> {
  for (const [name, indexes] of Object.entries(INDEXES)) {
    await db().collection(name).createIndexes(indexes);
  }
}

export async function ensurePlans(): Promise<number> {
  let added = 0;
  const at = nowIso();
  for (const plan of PLAN_SEED) {
    const id = `PLAN-${plan.key.toUpperCase()}`;
    const doc: Plan = {
      _id: id, id, key: plan.key, name: plan.name, tagline: plan.tagline, description: plan.description,
      period: plan.period, period_days: plan.periodDays, price_paisa: plan.pricePaisa, currency: 'PKR',
      annual_discount_pct: plan.discount, trial_days: plan.trialDays, grace_days: plan.graceDays,
      max_desktop_devices: plan.desktop, max_mobile_devices: plan.mobile, max_users: plan.users,
      max_branches: plan.branches, max_medicines: plan.medicines, features: plan.features,
      auto_renew: plan.autoRenew, is_default: plan.isDefault, is_public: 1, is_free: plan.isFree,
      sort_order: plan.sort, status: 'active', created_at: at, updated_at: at
    };
    const result = await col.plans().updateOne({ key: plan.key }, { $setOnInsert: doc }, { upsert: true });
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
  const admin = await ensureSuperAdmin();
  if (silent) return;
  if (plans) console.log(`[KSF] added ${plans} subscription plan(s)`);
  if (admin === 'created') console.log(`[KSF] created the platform Super Admin account for ${env.SUPER_ADMIN_EMAIL}`);
  if (admin === 'missing-settings') {
    console.warn('[KSF] No Super Admin yet. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env and restart.');
  }
}
