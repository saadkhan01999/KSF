/* Types for everything around the pharmacy itself: how an
   account is created, which devices may use it, what it is paying for, and
   what has been imported into it.

   These mirror what the API actually returns. TypeScript is a design aid
   here, not a guarantee — the server is the only thing that decides what a
   pharmacy may do, and `isEntitled` below asks the server's own answer
   rather than re-deciding on the client. */

/* --------------------------------------------------------------- plans --- */

export interface PlanLimits {
  desktopDevices: number;
  mobileDevices: number;
  users: number;
  branches: number;
  medicines: number;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  description: string | null;
  period: 'perpetual' | 'week' | 'month' | 'year' | 'trial';
  periodDays: number;
  pricePaisa: number;
  currency: string;
  annualDiscountPercent: number;
  graceDays: number;
  limits: PlanLimits;
  features: string[];
  autoRenew: boolean;
  isDefault: boolean;
  isFree: boolean;
  sortOrder: number;
  /** The free trial (Starter): started once, at registration, never bought. */
  isTrial: boolean;
  trialDays: number;
  /** What a pharmacy that came through a referral pays instead (Monthly: Rs 1,300), or null. */
  referralPricePaisa: number | null;
  /** How many periods one pharmacy may buy (Monthly: 3); 0 for no limit. */
  maxCycles: number;
}

/** A plan as one pharmacy sees it, in Billing: its own price, and whether it can still have it. */
export interface PlanOffer extends Plan {
  yourPricePaisa: number;
  referralApplied: boolean;
  cyclesUsed: number;
  cyclesLeft: number | null;
  available: boolean;
  unavailableReason: string | null;
}

export type SubscriptionStatus =
  | 'trial' | 'active' | 'payment_pending' | 'past_due'
  | 'grace' | 'cancelled' | 'expired' | 'suspended';

export interface TrialState {
  id: string;
  source: string;
  days: number;
  startedAt: string;
  expiresAt: string;
  daysLeft: number;
  /** Days added by referrals the pharmacy claimed (2.9). */
  bonusDays?: number;
}

export interface SubscriptionState {
  subscriptionId: string | null;
  plan: string;
  planName: string;
  status: SubscriptionStatus;
  entitled: boolean;
  /** The trial or the plan has ended: records can be read, not changed, until a plan is paid for. */
  locked: boolean;
  /** What this account can use right now. */
  features: string[];
  /** What the chosen plan includes — the two differ while payment is pending. */
  planFeatures?: string[];
  limits: Partial<PlanLimits>;
  isFree: boolean;
  isTrial: boolean;
  autoRenew: boolean;
  pricePaisa?: number;
  startedAt?: string;
  periodStart?: string;
  periodEnd?: string;
  renewalAt?: string | null;
  graceUntil?: string | null;
  cancelledAt?: string | null;
  endedAt?: string | null;
  failedPayments?: number;
  daysLeft: number | null;
  trial: TrialState | null;
  /** Chosen, not yet paid for: it starts when the payment clears. */
  pendingPlan: { key: string; name: string } | null;
  /** "Month 2 of 3" on a plan that runs for a set number of periods. */
  cycles: { used: number; max: number; period: string } | null;
  /** The pharmacy came through a referral, so it pays the referral price. */
  referralPricing: boolean;
}

export interface Payment {
  id: string;
  amount_paisa: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending' | 'refunded';
  kind: string;
  provider: string | null;
  provider_reference: string | null;
  method: string | null;
  failure_code?: string | null;
  failure_message: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  created_at: string;
  refunded_paisa?: number | null;
  /** Set on every payment that succeeded. */
  invoice_no?: string | null;
  plan_name?: string | null;
}

/* ----------------------------------------------------------- referrals --- */

export interface ReferralPrice { plan: string; name: string; pricePaisa: number; listPricePaisa: number; period: string }

export interface ReferralSummary {
  code: string;
  link: string;
  trialDays: number;
  /** What a referral is worth: Monthly at Rs 1,300 instead of Rs 1,500. */
  prices: ReferralPrice[];
  uses: number;
  successful: number;
  maxUses: number;
  counts: Record<string, number>;
  /** The days this pharmacy earns: 15 for each pharmacy that registers through its link. A server before 2.9 sends none. */
  rewards?: ReferralRewards;
  referrals: {
    id: string;
    email: string;
    pharmacyName: string | null;
    /** The person who started registering, while they have not finished. */
    name?: string | null;
    status: string;
    registeredAt: string | null;
    convertedAt: string | null;
    rewardDays?: number | null;
    rewardClaimedAt?: string | null;
    /** "Registered" / "Invited" / "Being checked" / "Not accepted". */
    registration?: string;
    extension?: 'ready' | 'claimed' | 'waiting' | 'review' | 'none';
    /** "Ready to claim", "Claimed +15 days", "Awaiting registration". */
    extensionLabel?: string;
  }[];
}

export interface ReferralRewards {
  daysPerReferral: number;
  invitations: number;
  completed: number;
  readyCount: number;
  readyDays: number;
  claimedDays: number;
}

/** What /billing/referral-rewards/claim answers. */
export interface ReferralClaimReply {
  message: string;
  subscription: SubscriptionState;
  referrals: ReferralSummary;
  claimed: { days: number; referrals: number; endsAt: string; restarted: boolean };
}

export interface PaymentProvider { key: string; label: string; mode: string; note: string; methods: string[] }

export interface BillingOverview {
  subscription: SubscriptionState;
  plans: PlanOffer[];
  payments: Payment[];
  referrals: ReferralSummary;
  canManage: boolean;
  /** The ways this installation can take a payment right now. */
  providers: PaymentProvider[];
  defaultProvider: string;
  /** The card on file, when a provider (Stripe) renews the plan by itself. */
  card: { provider: string; canChange: boolean } | null;
  /** Who to call about the annual plan or custom pricing. A server before 2.9 sends none. */
  sales?: { phone: string | null; whatsapp: string | null; email: string | null };
}

/** What /billing/checkout answers: go to the provider, or follow instructions (bank transfer). */
export interface CheckoutReply {
  reference: string; provider: string; amountPaisa: number; currency: string; plan: { key: string; name: string };
  redirect: { url: string; method: 'GET' | 'POST'; fields: Record<string, string> } | null;
  instructions: Record<string, unknown> | null;
  note: string;
}

/* ------------------------------------------------------------- devices --- */

export interface Device {
  id: string;
  label: string;
  category: 'desktop' | 'mobile' | 'tablet';
  platform: string | null;
  browser: string | null;
  browserVersion: string | null;
  registeredAt: string;
  lastActiveAt: string;
  lastSeenFrom: string;
  trusted: boolean;
  status: string;
}

export interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  from: string;
  device: string;
  category?: string;
}

export interface SecurityEventRow {
  id: string;
  type: string;
  severity: string;
  outcome: string;
  from: string;
  detail: string | null;
  at: string;
}

export interface SecurityCentre {
  password: {
    changedAt: string | null;
    algorithm: string;
    minLength: number;
    mustChange: boolean;
  };
  twoFactor: {
    enabled: boolean;
    confirmedAt: string | null;
    recoveryCodesLeft: number;
    recoveryGeneratedAt: string | null;
  };
  sessions: SessionRow[];
  devices: Device[];
  deviceLimits: { desktop: number; mobile: number };
  events: SecurityEventRow[];
  logins: { ok: boolean; from: string; at: string }[];
  /* What happened to the e-mail this pharmacy depends on. Null for anyone
     without settings.read — it lists addresses, masked, and who was written
     to is not everybody's business. */
  mail: MailHealth | null;
  elevated: boolean;
}

export interface MailHealth {
  transport: string;
  configured: boolean;
  total: number;
  sent: number;
  queued: number;
  failed: number;
  recent: {
    id: string; to_address: string; subject: string; template: string | null;
    status: string; attempts: number; last_error: string | null;
    created_at: string; sent_at: string | null;
  }[];
}

/* --------------------------------------------------------- registration -- */

export interface RegistrationState {
  started: boolean;
  step: number;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  mobile?: string;
  hasPassword?: boolean;
  referral?: { code: string; trialDays: number } | null;
  expiresAt?: string;
  pending?: {
    expiresAt: string;
    secondsLeft: number;
    attemptsLeft: number;
    sends: number;
  } | null;
}

/* --------------------------------------------------------- progressive setup */

/** One line of the post-signup checklist. `done` is worked out on the server
    from the records themselves, never from a stored flag — a checklist that
    keeps its own answer starts lying as soon as the data behind it changes. */
export interface SetupStep {
  key: string;
  label: string;
  note: string;
  to: string;
  done: boolean;
  optional?: boolean;
}

export interface SetupPharmacy {
  name: string;
  placeholderName: boolean;
  type: string;
  address: string;
  city: string;
  province: string;
  postcode: string;
  phone: string;
  website: string;
  drapLicence: string;
  ntn: string;
  registrationNo: string;
}

export interface SetupState {
  steps: SetupStep[];
  /** Required steps only, so a one-person pharmacy can still reach 100%. */
  percent: number;
  complete: boolean;
  dismissed: boolean;
  pharmacy: SetupPharmacy;
  options: { types: string[]; provinces: string[] };
}

export interface ReferralCheck {
  valid: boolean;
  code?: string;
  pharmacyName?: string;
  trialDays?: number;
  reason?: string;
  /** What the referral is worth: Monthly at Rs 1,300 instead of Rs 1,500. */
  prices?: ReferralPrice[];
}

/* ----------------------------------------------------------- migration --- */

export interface MigrationField {
  key: string;
  label: string;
  required: boolean;
  type: 'text' | 'money' | 'integer' | 'date' | 'boolean';
  hint: string;
}

export interface MigrationCategory {
  key: string;
  label: string;
  description: string;
  fields: MigrationField[];
}

export interface MigrationProblem {
  code: string;
  message: string;
  field: string | null;
  fixable: boolean;
}

export interface MigrationItem {
  id: string;
  rowNumber: number;
  raw: Record<string, string>;
  mapped: Record<string, unknown>;
  status: 'pending' | 'valid' | 'error' | 'skipped' | 'imported';
  resolution: string | null;
  problems: MigrationProblem[];
  targetId: string | null;
}

export interface MigrationJobSummary {
  id: string;
  category: string;
  source: string;
  file_name: string;
  status: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  error_rows: number;
  created_by_name: string | null;
  created_at: string;
  finished_at: string | null;
  rolled_back_at: string | null;
}

export interface MigrationReport {
  finishedAt: string;
  category: string;
  file: string;
  total: number;
  imported: number;
  merged: number;
  skipped: number;
  stillToFix: number;
  categoriesCreated: number;
  backupPath: string;
  failures: { fromRow: number; count: number; reason: string }[];
  reconciliation: string;
}

export interface MigrationJobDetail {
  job: {
    id: string;
    category: string;
    categoryLabel: string;
    source: string;
    fileName: string;
    fileSize: number;
    status: string;
    columns: string[];
    mapping: Record<string, string | null>;
    report: MigrationReport | null;
    backupPath: string | null;
    createdBy: string | null;
    createdAt: string;
    finishedAt: string | null;
    rolledBackAt: string | null;
  };
  fields: MigrationField[];
  counts: { total: number; valid: number; errors: number; skipped: number; imported: number };
  items: MigrationItem[];
  page: number;
  size: number;
}

export interface ValidationSummary {
  ok: boolean;
  valid: number;
  errors: number;
  skipped: number;
  total: number;
  errorCounts: Record<string, number>;
  canImport: boolean;
  message: string;
}

/* --------------------------------------------------------------- login --- */

/** What POST /auth/login can come back with. */
export type LoginOutcome =
  | { kind: 'signed-in' }
  | { kind: 'two-factor'; challenge: string; message: string }
  | { kind: 'device-limit'; limit: number; category: string; devices: Device[]; releaseTicket: string; message: string };
