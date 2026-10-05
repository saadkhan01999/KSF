/* ==========================================================================
   Permissions, built-in roles, default settings and themes
   --------------------------------------------------------------------------
   Two levels of authority:

     Platform   One Super Admin runs the service: every pharmacy, combined
                and one by one, the platform's income, plans, and support.
                That account belongs to no pharmacy. It is created once, at
                install, from SUPER_ADMIN_* in .env.

     Pharmacy   Each pharmacy that signs up gets its own Admin (the person
                who registered it) and builds its team from the roles below,
                or from roles of its own.

   Every permission is [key, description, group]. The descriptions are what a
   pharmacy Admin reads when building a role, so they are written for them.
   ========================================================================== */

export const PERMISSIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['dashboard.view', 'Open the dashboard and see daily summaries', 'Workspace'],
  ['appearance.theme', 'Choose their own colour theme', 'Workspace'],

  ['pos.operate', 'Use the till and complete sales', 'Point of Sale'],
  ['pos.discount', 'Give a discount on a sale, up to the till limit, with a reason', 'Point of Sale'],
  ['pos.discount.override', 'Give a discount above the till limit', 'Point of Sale'],
  ['pos.hold', 'Hold and resume an unfinished sale', 'Point of Sale'],
  ['sales.read', 'View sales history and invoices', 'Point of Sale'],
  ['sales.refund', 'Refund or return a completed sale', 'Point of Sale'],
  ['sales.void', 'Cancel an invoice and restore its stock', 'Point of Sale'],

  ['medicines.read', 'View the medicine catalogue', 'Catalogue'],
  ['medicines.write', 'Add and edit medicines', 'Catalogue'],
  ['medicines.delete', 'Retire a medicine from the catalogue', 'Catalogue'],
  ['categories.manage', 'Create and edit medicine categories', 'Catalogue'],

  ['inventory.read', 'View stock levels and batches', 'Inventory'],
  ['inventory.adjust', 'Correct stock after a count or breakage', 'Inventory'],
  ['expiry.manage', 'Quarantine, write off and clear expired batches', 'Inventory'],

  ['suppliers.read', 'View suppliers and their contact details', 'Purchasing'],
  ['suppliers.write', 'Add and edit suppliers', 'Purchasing'],
  ['purchases.read', 'View purchase orders and stock-in records', 'Purchasing'],
  ['purchases.write', 'Raise purchase orders and receive stock', 'Purchasing'],
  ['purchases.approve', 'Approve purchase orders before payment', 'Purchasing'],

  ['customers.read', 'View customer records', 'Customers'],
  ['customers.write', 'Add and edit customer records', 'Customers'],

  ['prescriptions.read', 'View prescriptions', 'Prescriptions'],
  ['prescriptions.verify', 'Verify a prescription as a pharmacist', 'Prescriptions'],
  ['prescriptions.dispense', 'Dispense against a verified prescription', 'Prescriptions'],

  ['expenses.read', 'View pharmacy expenses', 'Finance'],
  ['expenses.write', 'Record and edit expenses', 'Finance'],
  ['expenses.approve', 'Approve expenses for payment', 'Finance'],
  ['day-close.manage', 'Close the day, count the drawer and explain the difference', 'Finance'],

  ['reports.view', 'Open reports and analytics', 'Reporting'],
  ['reports.export', 'Export report data to CSV', 'Reporting'],
  ['reports.everyone', "See every staff member's sales, dashboard and reports — without it, a person sees only their own", 'Reporting'],

  ['staff.read', 'View staff members', 'Administration'],
  ['staff.invite', 'Add a new staff member', 'Administration'],
  ['staff.manage', 'Edit, suspend and reset staff accounts, and fix their sign-in problems', 'Administration'],
  ['roles.read', 'View roles and their permissions', 'Administration'],
  ['roles.manage', 'Create, edit and delete roles', 'Administration'],
  ['branches.manage', 'Add and edit pharmacy branches', 'Administration'],
  ['settings.read', 'View pharmacy settings', 'Administration'],
  ['settings.write', 'Change pharmacy settings', 'Administration'],

  ['audit.read', 'Read the activity and audit trail', 'Governance'],
  ['audit.export', 'Export the audit trail', 'Governance'],
  ['owner.transfer', 'Transfer ownership of the pharmacy', 'Governance'],

  ['messages.read', 'Read internal messages sent to them', 'Communication'],
  ['messages.write', 'Start a conversation and reply to one', 'Communication'],
  ['messages.broadcast', 'Announce to a whole role or the whole team', 'Communication'],

  ['support.raise', 'Ask the platform support team for help', 'Communication']
];

export const PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p[0]);

/* --------------------------------------------------------------------------
   BUILT-IN PHARMACY ROLES
   They ship with every pharmacy. They cannot be deleted, but any of them can
   be duplicated into a custom role and adjusted. `level` orders seniority so
   a manager can never act on an Admin.
   -------------------------------------------------------------------------- */
const READ_ONLY_OPS = [
  'dashboard.view', 'sales.read', 'medicines.read', 'inventory.read',
  'suppliers.read', 'purchases.read', 'customers.read', 'prescriptions.read',
  'expenses.read', 'reports.view'
];

export interface RoleTemplate {
  key: string; name: string; description: string; level: number; icon: string; permissions: string[];
}

export const PHARMACY_ADMIN_ROLE = 'admin';

export const SYSTEM_ROLES: RoleTemplate[] = [
  {
    key: PHARMACY_ADMIN_ROLE,
    name: 'Admin',
    description: 'Runs the pharmacy: every screen, every report, the team and their sign-in problems, roles and settings.',
    level: 100,
    icon: 'crown',
    permissions: PERMISSION_KEYS
  },
  {
    key: 'regional-manager',
    name: 'Regional Manager',
    description: 'Oversees several branches, their staff and stock. Sees their own sales figures; does not change pharmacy settings.',
    level: 70,
    icon: 'map',
    permissions: [
      ...READ_ONLY_OPS, 'reports.export', 'pos.operate', 'pos.discount', 'pos.discount.override',
      'purchases.write', 'purchases.approve', 'suppliers.write',
      'inventory.adjust', 'expiry.manage', 'expenses.write', 'expenses.approve', 'day-close.manage',
      'staff.read', 'roles.read', 'audit.read', 'customers.write', 'medicines.write',
      'messages.read', 'messages.write', 'messages.broadcast', 'appearance.theme', 'support.raise'
    ]
  },
  {
    key: 'manager',
    name: 'Branch Manager',
    description: 'Runs one branch: stock, purchasing, staff on shift and the daily numbers.',
    level: 60,
    icon: 'store',
    permissions: [
      ...READ_ONLY_OPS, 'pos.operate', 'pos.discount', 'pos.discount.override', 'pos.hold', 'sales.refund',
      'medicines.write', 'categories.manage', 'inventory.adjust', 'expiry.manage',
      'suppliers.write', 'purchases.write', 'customers.write',
      'prescriptions.verify', 'expenses.write', 'day-close.manage',
      'reports.export', 'staff.read', 'audit.read',
      'messages.read', 'messages.write', 'messages.broadcast', 'appearance.theme', 'support.raise'
    ]
  },
  {
    key: 'pharmacist',
    name: 'Pharmacist',
    description: 'Qualified pharmacist. Verifies and dispenses prescriptions and controls the medicine catalogue.',
    level: 50,
    icon: 'stethoscope',
    permissions: [
      'dashboard.view', 'pos.operate', 'pos.discount', 'pos.hold', 'sales.read',
      'medicines.read', 'medicines.write', 'categories.manage',
      'inventory.read', 'inventory.adjust', 'expiry.manage',
      'suppliers.read', 'purchases.read', 'purchases.write',
      'customers.read', 'customers.write',
      'prescriptions.read', 'prescriptions.verify', 'prescriptions.dispense',
      'reports.view', 'messages.read', 'messages.write', 'support.raise'
    ]
  },
  {
    key: 'cashier',
    name: 'Cashier',
    description: 'Works the till. Sells over-the-counter medicine and records customers.',
    level: 30,
    icon: 'wallet',
    permissions: [
      'dashboard.view', 'pos.operate', 'pos.discount', 'pos.hold', 'sales.read',
      'medicines.read', 'inventory.read', 'customers.read', 'customers.write',
      'prescriptions.read', 'messages.read', 'messages.write', 'support.raise'
    ]
  }
];

/* --------------------------------------------------------------------------
   THEMES
   Five colour themes. "KSF Green" is the original look and the default; the
   others change the brand colour only — the layout, spacing and contrast
   rules stay exactly the same, and every theme has a light and dark mode.
   -------------------------------------------------------------------------- */
export const THEMES = [
  { key: 'ksf-green', name: 'KSF Green', description: 'The original pharmacy green.' },
  { key: 'ocean-blue', name: 'Ocean Blue', description: 'Calm clinical blue.' },
  { key: 'royal-purple', name: 'Royal Purple', description: 'Deep purple with gold accents.' },
  { key: 'sunset-amber', name: 'Sunset Amber', description: 'Warm amber and terracotta.' },
  { key: 'graphite', name: 'Graphite', description: 'Neutral slate for long shifts.' }
] as const;

export type ThemeKey = typeof THEMES[number]['key'];
export const THEME_KEYS: string[] = THEMES.map((theme) => theme.key);
export const DEFAULT_THEME: ThemeKey = 'ksf-green';

/* --------------------------------------------------------------------------
   DEFAULT SETTINGS — one set per pharmacy, overridden key by key.
   -------------------------------------------------------------------------- */
export const DEFAULT_SETTINGS: Record<string, string> = {
  'invoice.prefix': 'KSF',
  'invoice.footer': 'Shukriya! Medicines once sold are only returnable with the invoice and in original packing.',
  'stock.low_threshold_default': '10',
  'expiry.warn_days': '90',
  'expiry.block_days': '0',
  'pos.allow_negative_stock': 'false',
  'pos.require_prescription_check': 'true',
  'pos.default_payment': 'cash',
  /* The biggest discount, as a percentage of the sale, that someone without
     pos.discount.override may give. */
  'pos.max_discount_percent': '10',
  'tax.gst_percent': '0',
  'loyalty.enabled': 'true',
  'loyalty.points_per_100': '1',
  'security.session_hours': '10',
  'security.idle_minutes': '45',
  'security.two_person_refund': 'false',
  'locale.currency': 'PKR',
  'locale.language': 'en-PK',
  /* The theme everyone in the pharmacy sees unless they may, and do, choose
     their own. */
  'appearance.theme': DEFAULT_THEME
};
