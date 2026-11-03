/* ==========================================================================
   Subscription plans and the features they unlock
   --------------------------------------------------------------------------
   Plans are documents, not code: the Super Admin changes a price or a limit
   from the platform console without a rebuild, and an existing pharmacy keeps
   whatever it signed up to. These are the plans a brand-new platform starts
   with; they are inserted once and never overwritten.

   Three plans, from the owner's price sheet (November 2026):

     Starter   the free trial: 15 days of everything, once per account
     Monthly   Rs 1,500 a month, or Rs 1,300 for a pharmacy that came through
               a referral — a beginner's plan, for up to three months
     Yearly    Rs 12,000 a year, about Rs 1,000 a month

   Every plan has every feature and no limit on the records a pharmacy keeps.
   When the trial (or a paid plan) ends, nothing is deleted: the pharmacy is
   asked to choose Monthly or Yearly, and until it does its records can be
   read but not changed.
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

/* Every plan includes everything: the plans differ in how long they run and
   what they cost, never in what a pharmacy can do. */
const EVERYTHING = FEATURE_KEYS;

export interface PlanSeed {
  key: string; name: string; tagline: string; description: string; period: string; periodDays: number;
  pricePaisa: number; discount: number; trialDays: number; graceDays: number; desktop: number; mobile: number;
  users: number; branches: number; medicines: number; features: string[]; autoRenew: 0 | 1;
  isDefault: 0 | 1; isFree: 0 | 1; sort: number;
  /** The price for a pharmacy that registered through a referral, or null. */
  referralPricePaisa: number | null;
  /** How many periods one pharmacy may buy on this plan; 0 for no limit. */
  maxCycles: number;
  /** The free trial: started once, at registration, and never bought. */
  isTrial: 0 | 1;
}

/* -1 is unlimited. The device allowance is per person, and is a security
   measure rather than a plan limit: it is what stops one password being
   shared round a whole market. */
const UNLIMITED = { users: -1, branches: -1, medicines: -1 };
const DEVICES = { desktop: 3, mobile: 3 };

export const PLAN_SEED: PlanSeed[] = [
  {
    key: 'starter', name: 'Starter', tagline: 'Free trial — 15 days of the full system',
    description: 'Complete account access, every feature and unlimited data for 15 days. No card is asked for. When it ends, choose Monthly or Yearly — nothing you entered is lost.',
    period: 'trial', periodDays: 15, pricePaisa: 0, discount: 0, trialDays: 15, graceDays: 0, ...DEVICES, ...UNLIMITED,
    features: EVERYTHING, autoRenew: 0, isDefault: 1, isFree: 1, sort: 1, referralPricePaisa: null, maxCycles: 0, isTrial: 1
  },
  {
    key: 'monthly', name: 'Monthly', tagline: '3-month starter plan, for beginners',
    description: 'Every feature and unlimited data, paid month by month for up to three months. Rs 1,300 a month with a referral, Rs 1,500 without one.',
    period: 'month', periodDays: 30, pricePaisa: 150000, discount: 0, trialDays: 0, graceDays: 7, ...DEVICES, ...UNLIMITED,
    features: EVERYTHING, autoRenew: 1, isDefault: 0, isFree: 0, sort: 2, referralPricePaisa: 130000, maxCycles: 3, isTrial: 0
  },
  {
    key: 'yearly', name: 'Yearly', tagline: 'Best value — about Rs 1,000 a month',
    description: 'Every feature, unlimited data and 24/7 access all year round, for one payment. Saves Rs 6,000 against twelve months on Monthly.',
    period: 'year', periodDays: 365, pricePaisa: 1200000, discount: 33.3, trialDays: 0, graceDays: 14, ...DEVICES, ...UNLIMITED,
    features: EVERYTHING, autoRenew: 1, isDefault: 0, isFree: 0, sort: 3, referralPricePaisa: null, maxCycles: 0, isTrial: 0
  }
];

/** The plan every new pharmacy starts on: the free trial. */
export const TRIAL_PLAN_KEY = 'starter';

/** The plans of earlier releases, retired when an installation moves to these three. */
export const RETIRED_PLAN_KEYS = ['basic', 'weekly', 'annual'];
