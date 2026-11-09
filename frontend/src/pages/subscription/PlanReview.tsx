/* ==========================================================================
   Subscription plans › Review your Pro subscription / Review your annual plan
   --------------------------------------------------------------------------
   What the plan includes, and the payment summary: the plan, how long it
   runs, the monthly rate and the total. Pro goes on to the payment (the
   provider's own page, or transfer instructions); Diamond Annual is
   discussed with KSF, who activate it — with paying online as the
   alternative when the installation takes payments.
   ========================================================================== */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Boxes, CreditCard, Gem, Pill, ReceiptText, TrendingDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Alert, Button, CardSkeleton, EmptyState } from '../../components/ui';
import { CheckoutDialogs } from '../../components/checkout';
import type { BillingOverview, PlanOffer } from '../../types';
import { ContactKsfDialog, Crumbs, monthlyName, paidPlans, pkr } from './wallet-ui';

const INCLUDED = [
  { icon: <Pill size={20} />, title: 'Unlimited medicines', text: 'Add medicines and record opening stock.' },
  { icon: <ReceiptText size={20} />, title: 'Billing and sales', text: 'Run the till and issue receipts.' },
  { icon: <Boxes size={20} />, title: 'Stock, expiry and reports', text: 'Track batches, expiry dates and pharmacy sales.' }
];

export default function PlanReview({ kind }: { kind: 'pro' | 'annual' }) {
  const navigate = useNavigate();
  const { ok, refreshSubscription } = useApp();
  const { busy, run } = useAction();
  const { data, loading, reload } = useApiData<BillingOverview>('/billing');
  useLiveRefresh(reload);
  const [paying, setPaying] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  if (loading && !data) return <><Crumbs trail={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Subscription plans', to: '/subscription-plans' }]} /><CardSkeleton count={2} /></>;
  if (!data) return <EmptyState title="The plan could not be loaded" message="Check the connection and try again." action={<Button onClick={() => { void reload(); }}>Try again</Button>} />;

  const { monthly, yearly } = paidPlans(data.plans);
  const plan: PlanOffer | null = kind === 'pro' ? monthly : yearly;
  if (!plan) return <Navigate to="/subscription-plans" replace />;

  const annual = kind === 'annual';
  const price = plan.yourPricePaisa ?? plan.pricePaisa;
  const perMonth = annual ? price / 12 : price;
  const monthlyPrice = monthly ? monthly.yourPricePaisa ?? monthly.pricePaisa : 0;
  const saving = annual && monthly ? monthlyPrice * 12 - price : 0;
  const title = annual ? plan.name : monthlyName(plan.name);
  const phone = data.sales?.phone ?? null;
  const canPay = data.canManage && plan.available !== false;

  /* Write the choice down, then on to how to pay. Nothing is charged yet. */
  const pay = () => run(
    () => api.post<{ message: string }>('/billing/plan', { planKey: plan.key }),
    async () => { await reload(true); await refreshSubscription(); setPaying(plan.key); }
  );

  return (
    <>
      <Crumbs trail={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Subscription plans', to: '/subscription-plans' }]} />
      <button type="button" className="wallet-back" onClick={() => navigate('/subscription-plans')}>
        <ArrowLeft size={18} aria-hidden="true" /> Back to plans
      </button>
      <div className="page-head">
        <div>
          <h1>{annual ? 'Review your annual plan' : `Review your ${plan.name} subscription`}</h1>
          <p className="sub">{annual ? 'Review the yearly price and discuss activation with KSF.' : 'Check your plan and monthly total before continuing to payment.'}</p>
        </div>
      </div>

      {plan.available === false && <Alert tone="warn" title={`${plan.name} cannot be chosen now`}>{plan.unavailableReason}</Alert>}
      {data.subscription.pendingPlan?.key === plan.key && (
        <Alert tone="info" title={`${plan.name} is chosen`}>It starts when the payment clears, after the days you have now. Nothing has been charged yet.</Alert>
      )}

      <div className="review-grid">
        <article className="review-plan">
          <header className="review-plan-head">
            <span className="review-plan-kind">
              <span className="review-plan-chip" aria-hidden="true">{annual ? <Gem size={18} /> : <CreditCard size={18} />}</span>
              {annual ? 'Annual subscription' : 'Monthly subscription'}
            </span>
            <h2>{title}</h2>
            <p>Full pharmacy access</p>
          </header>
          <div className="review-plan-body">
            <h3>Included in your plan</h3>
            <ul>
              {INCLUDED.map((item) => (
                <li key={item.title}>
                  <span aria-hidden="true">{item.icon}</span>
                  <span><strong>{item.title}</strong><small>{item.text}</small></span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <aside className="review-summary" aria-label="Payment summary">
          <h2>Payment summary</h2>
          <dl>
            <div><dt>Subscription</dt><dd>{title}</dd></div>
            <div><dt>Access period</dt><dd>{annual ? '12 months' : '1 month'}</dd></div>
            <div><dt>Monthly rate</dt><dd>{pkr(perMonth)}{plan.referralApplied && <small> referral price</small>}</dd></div>
            {!annual && plan.maxCycles > 0 && <div><dt>Plan term</dt><dd>Up to {plan.maxCycles} months{plan.cyclesUsed > 0 ? ` (${plan.cyclesLeft} left)` : ''}</dd></div>}
          </dl>
          {saving > 0 && (
            <p className="review-saving"><TrendingDown size={18} aria-hidden="true" /> Save {pkr(saving)} a year compared with {monthly ? monthlyName(monthly.name) : 'paying monthly'}.</p>
          )}
          <div className="review-total">
            <span>{annual ? 'Total for one year' : 'Total for one month'}</span>
            <strong>{pkr(price)}</strong>
          </div>
          {annual ? (
            <>
              <Button variant="primary" block size="lg" onClick={() => setContactOpen(true)}>Contact KSF about annual pricing</Button>
              <p className="review-note">
                {phone ? <>Call <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a> to discuss the annual offer.</> : 'Send KSF a message to discuss the annual offer.'}
              </p>
              {canPay && data.providers.length > 0 && (
                <button type="button" className="link-button review-alt" onClick={() => { void pay(); }} disabled={busy}>
                  Or pay {pkr(price)} online now
                </button>
              )}
            </>
          ) : (
            <>
              <Button variant="primary" block size="lg" loading={busy} disabled={!canPay} onClick={() => { void pay(); }}>Preview payment</Button>
              <p className="review-note">
                {data.canManage
                  ? 'Secure checkout · Nothing is charged until you confirm the payment.'
                  : 'Only your pharmacy Admin can pay for a plan.'}
              </p>
            </>
          )}
        </aside>
      </div>

      <CheckoutDialogs
        data={data}
        planKey={paying}
        onClose={() => setPaying(null)}
        onDone={() => { void reload(true); void refreshSubscription(); ok('Waiting for the payment', 'The plan starts the moment the payment is confirmed.'); }}
      />
      <ContactKsfDialog
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        contact={data.sales}
        topic={{
          title: `${plan.name} — ${pkr(price)} a year`,
          subject: `${plan.name} plan`,
          message: `Assalam-o-alaikum. We would like the ${plan.name} plan (${pkr(price)} a year) for our pharmacy. Please call us to discuss activation.`
        }}
      />
    </>
  );
}
