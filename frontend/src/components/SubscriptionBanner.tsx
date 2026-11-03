/* A line across the top of the workspace when the subscription needs the
   owner: the free trial running down, a plan chosen and not yet paid for, a
   renewal that failed, the last month of Monthly. It follows the live feed,
   so it goes away the moment the payment clears. Shown to the people who can
   act on it (settings.read); everyone else just keeps working. Once the trial
   or the plan has ended, the plan choice takes the whole screen instead. */

import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Button } from './ui';
import { date } from '../utils/format';

export function SubscriptionBanner() {
  const { subscription, can, user } = useApp();
  const navigate = useNavigate();
  if (!subscription || subscription.locked || user?.supportMode || !can('settings.read')) return null;

  const { status, planName, daysLeft, graceUntil, trial, pendingPlan, cycles, autoRenew, periodEnd } = subscription;
  const days = (n: number | null | undefined) => (n === 1 ? '1 day' : `${n ?? 0} days`);
  let tone: 'warn' | 'danger' | 'info' = 'warn';
  let message: string | null = null;
  let label = 'Choose a plan';
  if (status === 'grace' || status === 'past_due') {
    tone = (daysLeft ?? 0) <= 2 ? 'danger' : 'warn';
    message = `We could not take the ${planName} payment. Everything keeps working until ${date(graceUntil ?? null)} (${days(daysLeft)}); nothing is deleted after that either.`;
    label = 'Pay now';
  } else if (status === 'trial' && pendingPlan) {
    tone = 'info';
    message = `You have chosen ${pendingPlan.name}. Pay for it whenever you are ready — your free trial carries on until ${date(periodEnd ?? null)}, and no day of it is lost.`;
    label = `Pay for ${pendingPlan.name}`;
  } else if (status === 'trial' && (trial?.daysLeft ?? daysLeft ?? 99) <= 5) {
    tone = (trial?.daysLeft ?? daysLeft ?? 0) <= 1 ? 'warn' : 'info';
    message = `Your free trial ends in ${days(trial?.daysLeft ?? daysLeft)}. Choose Monthly or Yearly to keep every feature without a break.`;
  } else if (cycles && cycles.used >= cycles.max && !autoRenew && (daysLeft ?? 99) <= 10) {
    tone = 'info';
    message = `This is the last month of your ${planName} plan; it ends on ${date(periodEnd ?? null)}. Choose Yearly to carry on — it works out cheaper per month.`;
  } else if (status === 'cancelled' && (daysLeft ?? 99) <= 7) {
    tone = 'info';
    message = `Your ${planName} plan was cancelled and ends on ${date(periodEnd ?? null)}. Choose a plan to carry on after that.`;
  }
  if (!message) return null;

  return (
    <div className={`plan-banner tone-${tone}`} role="status">
      {tone === 'info' ? <Sparkles size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
      <span className="grow">{message}</span>
      <Button size="sm" variant="outline" icon={<CreditCard size={15} />} onClick={() => navigate(`/settings?tab=billing${pendingPlan ? `&choose=${pendingPlan.key}` : ''}`)}>
        {label}
      </Button>
    </div>
  );
}
