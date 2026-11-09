/* ==========================================================================
   Subscription plans and the features they unlock
   --------------------------------------------------------------------------
   Plans are documents, not code: the Super Admin changes a price or a limit
   from the platform console without a rebuild, and an existing pharmacy keeps
   whatever it signed up to. These are the plans a brand-new platform starts
   with; they are inserted once and never overwritten.

   Three plans, from the owner's Subscription wallet design (2.9.0; until
   2.8 they were called Starter, Monthly and Yearly, Monthly at Rs 1,500):

     Demo            the free trial: 15 days of everything, once per account
     Pro             Rs 1,400 a month, or the referral price for a pharmacy
                     that came through a referral, for up to three months
     Diamond Annual  Rs 12,000 a year, about Rs 1,000 a month

   Beside them, the Standard Referral: every pharmacy that registers through
   a pharmacy's link earns it 15 more days (services/referrals.ts).

   Every plan has every feature and no limit on the records a pharmacy keeps.
   When the trial (or a paid plan) ends, nothing is deleted: the pharmacy is
   asked to choose Pro or Diamond Annual, and until it does its records can be
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
    key: 'starter', name: 'Demo', tagline: 'Free trial — 15 days of the full system',
    description: 'Start billing, add medicines and use every feature from day one.',
    period: 'trial', periodDays: 15, pricePaisa: 0, discount: 0, trialDays: 15, graceDays: 0, ...DEVICES, ...UNLIMITED,
    features: EVERYTHING, autoRenew: 0, isDefault: 1, isFree: 1, sort: 1, referralPricePaisa: null, maxCycles: 0, isTrial: 1
  },
  {
    key: 'monthly', name: 'Pro', tagline: 'Full access, month by month',
    description: 'Keep your pharmacy running with full access on a monthly subscription.',
    period: 'month', periodDays: 30, pricePaisa: 140000, discount: 0, trialDays: 0, graceDays: 7, ...DEVICES, ...UNLIMITED,
    features: EVERYTHING, autoRenew: 1, isDefault: 0, isFree: 0, sort: 2, referralPricePaisa: 130000, maxCycles: 3, isTrial: 0
  },
  {
    key: 'yearly', name: 'Diamond Annual', tagline: 'Best value — about Rs 1,000 a month',
    description: 'Every feature, unlimited data and full access all year round, billed once a year.',
    period: 'year', periodDays: 365, pricePaisa: 1200000, discount: 33.3, trialDays: 0, graceDays: 14, ...DEVICES, ...UNLIMITED,
    features: EVERYTHING, autoRenew: 1, isDefault: 0, isFree: 0, sort: 3, referralPricePaisa: null, maxCycles: 0, isTrial: 0
  }
];

/** The plan every new pharmacy starts on: the free trial. */
export const TRIAL_PLAN_KEY = 'starter';

/** The plans of earlier releases, retired when an installation moves to these three. */
export const RETIRED_PLAN_KEYS = ['basic', 'weekly', 'annual'];

/**
 * The 2.9.0 renaming, applied once to an installation that already had the
 * plans: each name, wording and price moves only while it is still the old
 * default, so whatever the Super Admin changed by hand stays as they set it.
 */
export const WALLET_RENAMES: ReadonlyArray<{ key: string; from: { name: string; pricePaisa?: number }; to: { name: string; tagline: string; description: string; pricePaisa?: number } }> = [
  { key: 'starter', from: { name: 'Starter' }, to: { name: 'Demo', tagline: 'Free trial — 15 days of the full system', description: 'Start billing, add medicines and use every feature from day one.' } },
  {
    key: 'monthly', from: { name: 'Monthly', pricePaisa: 150000 },
    to: { name: 'Pro', tagline: 'Full access, month by month', description: 'Keep your pharmacy running with full access on a monthly subscription.', pricePaisa: 140000 }
  },
  { key: 'yearly', from: { name: 'Yearly' }, to: { name: 'Diamond Annual', tagline: 'Best value — about Rs 1,000 a month', description: 'Every feature, unlimited data and full access all year round, billed once a year.' } }
];
