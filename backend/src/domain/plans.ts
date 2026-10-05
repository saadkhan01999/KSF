/* ==========================================================================
   Subscription plans and the features they unlock
   --------------------------------------------------------------------------
   Plans are documents, not code: the Super Admin changes a price or a limit
   from the platform console without a rebuild, and an existing pharmacy keeps
   whatever it signed up to. These are the plans a brand-new platform starts
   with; they are inserted once and never overwritten.

   Basic is free and permanent, and deliberately capable enough to run a
   single counter safely — expiry control and batch tracking are never behind
   a paywall.
   ========================================================================== */

export const FEATURES: ReadonlyArray<readonly [string, string, string]> = [
  ['pos.core', 'Point of sale and invoicing', 'Selling'],
  ['inventory.batches', 'Batch and expiry control', 'Stock'],
  ['inventory.multi_branch', 'Stock across several branches', 'Stock'],
  ['reports.core', 'Daily and monthly summaries', 'Reporting'],
  ['reports.advanced', 'Profitability, supplier and staff analytics', 'Reporting'],
  ['reports.export', 'Export any report to CSV', 'Reporting'],
  ['messaging.internal', 'Internal messaging between roles', 'Team'],
  ['staff.roles', 'Custom roles and permissions', 'Team'],
  ['migration.import', 'Import data from your old system', 'Data'],
  ['backup.scheduled', 'Scheduled encrypted backups', 'Data'],
  ['devices.extra', 'Additional registered devices', 'Access'],
  ['support.priority', 'Priority support', 'Support']
];

export const FEATURE_KEYS = FEATURES.map((feature) => feature[0]);

const BASIC = ['pos.core', 'inventory.batches', 'reports.core', 'messaging.internal'];
const STANDARD = [...BASIC, 'reports.advanced', 'reports.export', 'staff.roles', 'migration.import'];
const FULL = [...STANDARD, 'inventory.multi_branch', 'backup.scheduled', 'devices.extra', 'support.priority'];

export interface PlanSeed {
  key: string; name: string; tagline: string; description: string; period: string; periodDays: number;
  pricePaisa: number; discount: number; trialDays: number; graceDays: number; desktop: number; mobile: number;
  users: number; branches: number; medicines: number; features: string[]; autoRenew: 0 | 1;
  isDefault: 0 | 1; isFree: 0 | 1; sort: number;
}

export const PLAN_SEED: PlanSeed[] = [
  {
    key: 'basic', name: 'Basic', tagline: 'Free, for as long as you need it',
    description: 'One counter, one branch and full expiry control. No card, no expiry date on the plan itself.',
    period: 'perpetual', periodDays: 0, pricePaisa: 0, discount: 0, trialDays: 0, graceDays: 0,
    desktop: 1, mobile: 1, users: 3, branches: 1, medicines: 500,
    features: BASIC, autoRenew: 0, isDefault: 1, isFree: 1, sort: 1
  },
  {
    key: 'weekly', name: 'Weekly', tagline: 'Pay as the week goes',
    description: 'The full professional feature set, billed every seven days. Useful for a seasonal or trial counter.',
    period: 'week', periodDays: 7, pricePaisa: 120000, discount: 0, trialDays: 0, graceDays: 3,
    desktop: 2, mobile: 2, users: 8, branches: 2, medicines: 5000,
    features: STANDARD, autoRenew: 1, isDefault: 0, isFree: 0, sort: 2
  },
  {
    key: 'monthly', name: 'Monthly', tagline: 'The usual choice',
    description: 'Everything a busy neighbourhood pharmacy needs, billed monthly and cancellable at any time.',
    period: 'month', periodDays: 30, pricePaisa: 390000, discount: 0, trialDays: 0, graceDays: 7,
    desktop: 3, mobile: 3, users: 15, branches: 3, medicines: 20000,
    features: FULL, autoRenew: 1, isDefault: 0, isFree: 0, sort: 3
  },
  {
    key: 'annual', name: 'Annual', tagline: 'Two months on the house',
    description: 'The monthly plan paid a year at a time, with priority support and scheduled backups included.',
    period: 'year', periodDays: 365, pricePaisa: 3900000, discount: 16.7, trialDays: 0, graceDays: 14,
    desktop: 5, mobile: 5, users: -1, branches: -1, medicines: -1,
    features: FULL, autoRenew: 1, isDefault: 0, isFree: 0, sort: 4
  }
];

/** The plan a referred pharmacy trials. */
export const TRIAL_PLAN_KEY = 'monthly';
