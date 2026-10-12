/* The first screen a person can actually open. A cashier without dashboard
   access lands on the till rather than on an error; a member of the
   platform team without the dashboard lands on the first platform screen
   their role includes. */

import { useApp } from '../context/AppContext';

const PLATFORM_HOMES: Array<[string, string]> = [
  ['platform.overview', '/platform'],
  ['platform.pharmacies.view', '/platform/pharmacies'],
  ['platform.support', '/platform/support'],
  ['platform.help', '/platform/help'],
  ['platform.finance.view', '/platform/income'],
  ['platform.plans.manage', '/platform/plans'],
  ['platform.activity', '/platform/activity'],
  ['platform.medicines.manage', '/platform/directory']
];

export function useHomeRoute(): string {
  const { can, isPlatform } = useApp();
  if (isPlatform) return PLATFORM_HOMES.find(([permission]) => can(permission))?.[1] ?? '/platform/notifications';
  if (can('dashboard.view')) return '/dashboard';
  if (can('pos.operate')) return '/pos';
  if (can('sales.read')) return '/sales';
  if (can('inventory.read')) return '/inventory';
  if (can('messages.read')) return '/messages';
  return '/notifications';
}
