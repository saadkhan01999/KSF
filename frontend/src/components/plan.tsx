/* What the pharmacy's plan includes, shown where it matters.

   The server refuses a locked feature with 402 whatever the screen does;
   these only make sure the screen offers the upgrade instead of a button
   that fails. */

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Button, EmptyState } from './ui';

/** A whole screen, or part of one, that the plan does not include. */
export function FeatureLocked({ name, description }: { name: string; description?: string }) {
  const { can } = useApp();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<Lock size={28} />}
      title={`${name} comes with a paid plan`}
      message={description ?? 'Nothing has been deleted — it opens again as soon as the pharmacy is on a plan that includes it.'}
      action={can('settings.read')
        ? <Button variant="primary" icon={<Sparkles size={17} />} onClick={() => navigate('/settings?tab=billing')}>See plans</Button>
        : undefined}
    />
  );
}

/** Children when the plan includes `feature`; otherwise `fallback`. */
export function WithFeature({ feature, children, fallback = null }: { feature: string; children: ReactNode; fallback?: ReactNode }) {
  const { hasFeature } = useApp();
  return <>{hasFeature(feature) ? children : fallback}</>;
}
