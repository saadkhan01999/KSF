/* ==========================================================================
   The platform team — who may do what in the platform console
   --------------------------------------------------------------------------
   The Super Admin runs the service and may build a team under it: a help
   desk, a finance desk, an operations manager. Each team member signs in
   with their own e-mail address and holds one platform role, and a role is
   exactly the permissions ticked for it below — nothing more.

   Two things never go into a role, so nobody can grant them:
     - managing the team itself (members, roles, photos), and
     - anything the Super Admin keeps for themselves.
   Those stay with the Super Admin, which is what makes it impossible for a
   team member to promote themselves.

   Every permission is [key, description, group]. The descriptions are what
   the Super Admin reads when building a role.
   ========================================================================== */

export const PLATFORM_PERMISSIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['platform.overview', 'Open the platform dashboard: pharmacies, their sales, income and support at a glance', 'Dashboard'],

  ['platform.pharmacies.view', 'See every pharmacy and open one: its people, plan, payments and requests', 'Pharmacies'],
  ['platform.pharmacies.manage', 'Edit a pharmacy, suspend or reactivate it, and change or extend its plan', 'Pharmacies'],
  ['platform.pharmacies.enter', 'Work inside a pharmacy to fix a problem there (support mode, every action logged)', 'Pharmacies'],

  ['platform.support', 'Answer pharmacies’ help requests on the support desk, and assign or resolve them', 'Help desk'],
  ['platform.help', 'See who could not sign in today, and find any pharmacy user by name, e-mail or phone', 'Help desk'],

  ['platform.finance.view', 'See income, payments, and bank transfers waiting to be confirmed', 'Finance'],
  ['platform.finance.manage', 'Record payments, confirm bank transfers, refund and reconcile', 'Finance'],

  ['platform.plans.manage', 'Create plans and change their prices, limits and features', 'Plans'],

  ['platform.activity', 'Read the platform activity log and security events', 'Records']
];

export const PLATFORM_PERMISSION_KEYS: readonly string[] = PLATFORM_PERMISSIONS.map(([key]) => key);

/** The Super Admin's own: managing the team. Never part of a role. */
export const TEAM_MANAGE = 'platform.team.manage';

/* Doing something with a record means being able to see it first. Saving a
   role adds what its choices depend on, so a "manage" without its "view"
   cannot leave somebody with buttons on a screen they cannot open. */
const IMPLIES: Readonly<Record<string, readonly string[]>> = {
  'platform.pharmacies.manage': ['platform.pharmacies.view'],
  'platform.pharmacies.enter': ['platform.pharmacies.view'],
  'platform.finance.manage': ['platform.finance.view']
};

/** Only real, grantable keys, with what they depend on, sorted and unique. */
export function normalisePlatformPermissions(input: unknown): string[] {
  const chosen = new Set<string>();
  for (const value of Array.isArray(input) ? input : []) {
    const key = String(value);
    if (!PLATFORM_PERMISSION_KEYS.includes(key)) continue;
    chosen.add(key);
    for (const needed of IMPLIES[key] ?? []) chosen.add(needed);
  }
  return PLATFORM_PERMISSION_KEYS.filter((key) => chosen.has(key));
}

/**
 * Who may use a platform route:
 *   'owner'        the Super Admin only
 *   'any'          the Super Admin and every active team member
 *   key | keys     the Super Admin, and a team member holding any one of them
 */
export type PlatformAccess = 'owner' | 'any' | string | readonly string[];

export function platformAllows(
  who: { isPlatformAdmin: boolean; isPlatformStaff: boolean; platformPermissions: ReadonlySet<string> },
  access: PlatformAccess
): boolean {
  if (who.isPlatformAdmin) return true;
  if (!who.isPlatformStaff || access === 'owner') return false;
  if (access === 'any') return true;
  const keys: readonly string[] = typeof access === 'string' ? [access] : access;
  return keys.some((key) => who.platformPermissions.has(key));
}

/** Starting points for a new role. The Super Admin can change any of them. */
export const PLATFORM_ROLE_TEMPLATES: ReadonlyArray<{ key: string; name: string; description: string; permissions: string[] }> = [
  {
    key: 'help-desk', name: 'Help desk',
    description: 'Answers pharmacies’ requests, helps people who cannot sign in, and can step inside a pharmacy to fix a problem.',
    permissions: ['platform.support', 'platform.help', 'platform.pharmacies.view', 'platform.pharmacies.enter']
  },
  {
    key: 'finance', name: 'Finance',
    description: 'Confirms bank transfers, records and refunds payments, and follows the platform’s income.',
    permissions: ['platform.overview', 'platform.finance.view', 'platform.finance.manage', 'platform.pharmacies.view']
  },
  {
    key: 'operations', name: 'Operations manager',
    description: 'Looks after pharmacies and plans day to day: plans, suspensions, extensions and the records.',
    permissions: ['platform.overview', 'platform.pharmacies.view', 'platform.pharmacies.manage', 'platform.plans.manage', 'platform.support', 'platform.activity']
  },
  {
    key: 'viewer', name: 'Read only',
    description: 'Sees the dashboard, the pharmacies and the records, and changes nothing.',
    permissions: ['platform.overview', 'platform.pharmacies.view', 'platform.activity']
  }
];
