/* The plans as the public website shows them, kept current: when the Super
   Admin changes a price or a plan, an open pricing page redraws itself. */

import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { subscribeLive } from '../services/live';
import type { Plan } from '../types';

export interface PublicPlans { data: Plan[]; trialDays: number; passwordMinLength: number }

export function usePublicPlans() {
  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => subscribeLive('/public/events', (event) => {
    if (event.type === 'plans.changed' || event.type === 'resync') setVersion((current) => current + 1);
  }), []);

  useEffect(() => {
    let current = true;
    api.get<PublicPlans>('/public/plans')
      .then((reply) => { if (current) { setPlans(reply); setProblem(null); } })
      .catch((error: Error) => { if (current) setProblem(error.message); });
    return () => { current = false; };
  }, [version]);

  return { plans: plans?.data ?? null, trialDays: plans?.trialDays ?? 15, problem };
}
