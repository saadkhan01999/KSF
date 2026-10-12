/* A line across the top of the workspace when the subscription needs the
   owner: a plan waiting for payment, a renewal that failed, a grace period
   running out, a trial about to end. It follows the live feed, so it goes
   away the moment the payment clears. Shown to the people who can act on it
   (settings.read); everyone else just keeps working. */

import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Button } from './ui';
import { date } from '../utils/format';

export function SubscriptionBanner() {
  const { subscription, can, user } = useApp();
  const navigate = useNavigate();
  if (!subscription || user?.supportMode || !can('settings.read')) return null;

  const { status, planName, daysLeft, graceUntil, trial } = subscription;
  const days = (n: number | null | undefined) => (n === 1 ? '1 day' : `${n ?? 0} days`);
  let tone: 'warn' | 'danger' | 'info' = 'warn';
  let message: string | null = null;
  if (status === 'payment_pending') {
    message = `The ${planName} plan starts as soon as its payment is confirmed. Until then the pharmacy works on the free features.`;
  } else if (status === 'grace' || status === 'past_due') {
    tone = (daysLeft ?? 0) <= 2 ? 'danger' : 'warn';
    message = `We could not take the ${planName} payment. Everything keeps working until ${date(graceUntil ?? null)} (${days(daysLeft)}), then the pharmacy moves to Basic — nothing is deleted.`;
  } else if (status === 'trial' && trial && trial.daysLeft <= 3) {
    tone = 'info';
    message = `Your premium trial ends in ${days(trial.daysLeft)}. Choose a plan to keep every feature.`;
  }
  if (!message) return null;

  return (
    <div className={`plan-banner tone-${tone}`} role="status">
      {tone === 'info' ? <Sparkles size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
      <span className="grow">{message}</span>
      <Button size="sm" variant="outline" icon={<CreditCard size={15} />} onClick={() => navigate('/settings?tab=billing')}>
        {status === 'trial' ? 'Choose a plan' : 'Pay now'}
      </Button>
    </div>
  );
}
