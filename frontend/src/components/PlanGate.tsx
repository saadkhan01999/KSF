/* What a pharmacy sees once its free trial — or its plan — has ended: the
   choice of Monthly or Yearly, and the reassurance that nothing is lost.

   The server is what actually holds the line (every change answers 402
   plan_required until a plan is paid for); this screen only makes sure
   nobody is left typing a sale into a till that will refuse it. The Admin
   chooses here and pays in Billing; everybody else is told who can. */

import { useNavigate } from 'react-router-dom';
import { Bell, CreditCard, LifeBuoy, ShieldCheck, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useLiveRefresh } from '../hooks/useApi';
import { usePublicPlans } from '../hooks/usePublicPlans';
import { Button, CardSkeleton } from './ui';
import { FullAccessStrip, SheetPlanCard } from './price-sheet';
import type { BillingOverview, PlanOffer } from '../types';

export function PlanGate() {
  const { subscription, can } = useApp();
  const navigate = useNavigate();
  const canPay = can('settings.write');
  /* The Admin sees their own price (Rs 1,300 through a referral); everyone else the list price. */
  const billing = useApiData<BillingOverview>(canPay ? '/billing' : null);
  useLiveRefresh(billing.reload);
  const { plans: listed } = usePublicPlans();

  const afterTrial = !!subscription?.isTrial || subscription?.plan === 'none';
  const offers = (canPay ? billing.data?.plans : listed)?.filter((plan) => !plan.isTrial) ?? null;
  const all = canPay ? billing.data?.plans ?? [] : listed ?? [];

  return (
    <div className="plan-gate">
      <div className="plan-gate-head">
        <span className="plan-gate-icon" aria-hidden="true"><Sparkles size={26} /></span>
        <h1>{afterTrial ? 'Your free trial has ended' : `Your ${subscription?.planName ?? ''} plan has ended`.replace('  ', ' ')}</h1>
        <p>
          {canPay
            ? 'Choose a plan to carry on. Every medicine, batch, sale and prescription is exactly where you left it — nothing has been deleted, and everything opens again the moment the payment clears.'
            : 'Your pharmacy Admin needs to choose a plan before the till and the stock screens open again. Every record is safe — nothing has been deleted.'}
        </p>
      </div>

      {!offers && <CardSkeleton count={2} />}
      {offers && (
        <div className="sheet-grid">
          {offers.map((plan) => {
            const offer = 'available' in plan ? (plan as PlanOffer) : null;
            return (
              <SheetPlanCard
                key={plan.key}
                plan={plan}
                plans={all}
                note={offer && !offer.available ? <span className="is-warn">{offer.unavailableReason}</span> : undefined}
                action={canPay ? (
                  <Button
                    variant="primary"
                    icon={<CreditCard size={16} />}
                    disabled={!!offer && !offer.available}
                    onClick={() => navigate(`/settings?tab=billing&choose=${encodeURIComponent(plan.key)}`)}
                  >
                    Choose {plan.name}
                  </Button>
                ) : undefined}
              />
            );
          })}
        </div>
      )}

      <FullAccessStrip />

      <div className="plan-gate-links">
        <Button variant="ghost" icon={<ShieldCheck size={16} />} onClick={() => navigate('/account')}>My account and data export</Button>
        <Button variant="ghost" icon={<Bell size={16} />} onClick={() => navigate('/notifications')}>Notifications</Button>
        <Button variant="ghost" icon={<LifeBuoy size={16} />} onClick={() => navigate('/support')}>Ask KSF for help</Button>
      </div>
    </div>
  );
}
