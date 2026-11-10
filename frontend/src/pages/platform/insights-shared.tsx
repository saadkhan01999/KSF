/* Small pieces of the Super Admin's Analytics page: the plan badge and the pharmacy's initials. */

import { Badge } from '../../components/ui';
import type { PlanCategory } from '../../types/platform';

const PLAN_TONE: Record<PlanCategory, 'ok' | 'gold' | 'neutral' | 'info' | 'purple'> = {
  demo: 'neutral', referral: 'gold', pro: 'ok', annual: 'info', other: 'purple'
};

/** "Pro monthly" in green, "Standard Referral" in gold, "Demo trial" in grey. */
export function PlanBadge({ plan }: { plan: { category: PlanCategory; label: string; entitled?: boolean } | null }) {
  if (!plan) return <span className="t-dim">No plan</span>;
  if (plan.entitled === false) return <Badge tone="danger" dot={false}>{plan.label} · ended</Badge>;
  return <Badge tone={PLAN_TONE[plan.category]} dot={false}>{plan.label}</Badge>;
}

/** "AM" for Aman Pharmacy, "SH" for Shifa Medical Store: the first two letters of the name. */
export const initials = (name: string): string => (name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '—').toUpperCase();
