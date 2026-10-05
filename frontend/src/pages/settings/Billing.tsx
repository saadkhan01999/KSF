/* ==========================================================================
   Settings › Billing and Subscription
   --------------------------------------------------------------------------
   The plan, what it costs, when it renews, what has been paid, and the
   referral code.

   Nothing on this screen can make a subscription active. Choosing a paid
   plan records the choice and hands back a payment reference; the plan
   becomes active when the payment provider confirms it to the server. The
   copy says so plainly, because a screen that implies otherwise is how
   somebody ends up believing they have paid when they have not.
   ========================================================================== */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard, Gift, ArrowUpRight, RefreshCw, Receipt, AlertTriangle, Check
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction } from '../../hooks/useApi';
import { api } from '../../services/api';
import {
  Button, Card, Modal, ConfirmDialog, Alert, CardSkeleton, EmptyState,
  Switch, Badge
} from '../../components/ui';
import { PlanCard, StatusNote, DetailRow, SubscriptionBadge, CopyField } from '../../components/account-ui';
import { rupees, date, dateTime } from '../../utils/format';
import { FEATURE_NAMES } from '../site/content';
import type { BillingOverview } from '../../types';

export function Billing() {
  const { ok, refreshSubscription } = useApp();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const { data, loading, reload } = useApiData<BillingOverview>('/billing');

  const [changing, setChanging] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [checkout, setCheckout] = useState<{
    reference: string; provider: string; subscriptionId: string;
    plan: { name: string; pricePaisa: number }; note: string;
  } | null>(null);

  if (loading) return <CardSkeleton count={3} />;
  if (!data) return <EmptyState title="Billing could not be loaded" message="Try again in a moment." />;

  const { subscription, plans, payments, referrals, canManage } = data;
  const currentPlan = plans.find((plan) => plan.key === subscription.plan);

  const choosePlan = async (planKey: string) => {
    const reply = await run(() => api.post<{ message: string }>('/billing/plan', { planKey }));
    if (!reply) return;
    ok(reply.message);
    setChanging(null);
    await reload(true);
    await refreshSubscription();
  };

  const startCheckout = async (planKey: string) => {
    const reply = await run(() => api.post<typeof checkout>('/billing/checkout', { planKey }));
    if (reply) setCheckout(reply);
  };

  const toggleRenewal = async (enabled: boolean) => {
    const reply = await run(() => api.post<{ message: string }>('/billing/auto-renew', { enabled }));
    if (reply) { ok(reply.message); await reload(true); await refreshSubscription(); }
  };

  const cancel = async (reason: string) => {
    const reply = await run(() => api.post<{ message: string }>('/billing/cancel', { reason }));
    if (reply) { ok(reply.message); setCancelOpen(false); await reload(true); await refreshSubscription(); }
  };

  const needsAttention = ['grace', 'past_due', 'payment_pending'].includes(subscription.status);

  return (
    <div className="grid grid-2">
      {/* ------------------------------ the plan --------------------------- */}
      <Card
        title="Your subscription"
        subtitle="What this pharmacy is on, and until when"
        icon={<CreditCard size={18} />}
        className="span-2"
      >
        {needsAttention && (
          <Alert
            tone={subscription.status === 'payment_pending' ? 'info' : 'warn'}
            title={
              subscription.status === 'payment_pending'
                ? 'Waiting for the first payment'
                : 'A payment did not go through'
            }
          >
            {subscription.status === 'payment_pending'
              ? `The ${subscription.planName} plan is set up but not yet paid for. Your pharmacy is working normally on the free feature set until it is.`
              : `Everything is still working${subscription.graceUntil ? ` until ${date(subscription.graceUntil)}` : ''}. Nothing has been deleted and nothing will be — after the grace period the account simply moves to the free Basic plan.`}
          </Alert>
        )}

        <div className="billing-summary">
          <div className="billing-plan">
            <span className="billing-plan-label">Current plan</span>
            <strong>{subscription.planName}</strong>
            <SubscriptionBadge status={subscription.status} />
          </div>

          <dl className="detail-list">
            {subscription.subscriptionId && (
              <DetailRow label="Subscription reference">
                <code>{subscription.subscriptionId}</code>
              </DetailRow>
            )}
            {currentPlan && !currentPlan.isFree && (
              <DetailRow label="Price">
                {rupees(currentPlan.pricePaisa)} per {currentPlan.period}
              </DetailRow>
            )}
            {subscription.periodEnd && (
              <DetailRow label={subscription.status === 'cancelled' ? 'Runs until' : 'Current period ends'}>
                {date(subscription.periodEnd)}
                {subscription.daysLeft !== null && <span className="muted"> · {subscription.daysLeft} day(s) left</span>}
              </DetailRow>
            )}
            {subscription.renewalAt && subscription.autoRenew && (
              <DetailRow label="Renews">{date(subscription.renewalAt)}</DetailRow>
            )}
            {subscription.graceUntil && (
              <DetailRow label="Grace period ends" tone="warn">{date(subscription.graceUntil)}</DetailRow>
            )}
            {subscription.cancelledAt && (
              <DetailRow label="Cancelled">{dateTime(subscription.cancelledAt)}</DetailRow>
            )}
          </dl>
        </div>

        {subscription.trial && (
          <StatusNote tone="ok" icon={<Gift size={17} />} title="Your premium trial is running">
            {subscription.trial.daysLeft} day(s) left, until {date(subscription.trial.expiresAt)}. When it
            ends the pharmacy moves to the free Basic plan — every medicine, batch, sale and
            prescription stays exactly where it is.
          </StatusNote>
        )}

        {canManage && currentPlan && !currentPlan.isFree && (
          <div className="billing-toggle">
            <Switch
              checked={subscription.autoRenew}
              onChange={(value) => { void toggleRenewal(value); }}
              label="Renew this plan automatically"
            />
            <p className="card-note">
              With this off, the plan runs to the end of the period you have paid for and then
              moves to Basic. Nothing is deleted either way.
            </p>
          </div>
        )}

        {canManage && (
          <div className="card-actions">
            <Button variant="primary" icon={<ArrowUpRight size={15} />} onClick={() => setChanging(subscription.plan)}>
              Change plan
            </Button>
            {currentPlan && !currentPlan.isFree && subscription.status !== 'cancelled' && (
              <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel the subscription</Button>
            )}
          </div>
        )}
      </Card>

      {/* ----------------------------- what you get ------------------------ */}
      <Card title="What your plan includes" subtitle="Checked by the server on every request">
        <ul className="feature-check-list">
          {(subscription.planFeatures ?? subscription.features).map((feature) => {
            const active = subscription.features.includes(feature);
            return (
              <li key={feature} className={active ? 'is-on' : 'is-off'}>
                {active ? <Check size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
                {FEATURE_NAMES[feature] ?? feature}
                {!active && <span className="muted"> — not available until the plan is paid for</span>}
              </li>
            );
          })}
        </ul>

        {subscription.limits && (
          <dl className="detail-list">
            <DetailRow label="Registered computers">{subscription.limits.desktopDevices}</DetailRow>
            <DetailRow label="Phones and tablets">{subscription.limits.mobileDevices}</DetailRow>
            <DetailRow label="Staff accounts">
              {(subscription.limits.users ?? 0) < 0 ? 'Unlimited' : subscription.limits.users}
            </DetailRow>
          </dl>
        )}
      </Card>

      {/* ------------------------------- referrals ------------------------- */}
      <Card title="Refer another pharmacy" subtitle={`They get ${referrals.trialDays} days of the full system, free`} icon={<Gift size={18} />}>
        <CopyField
          label="Your referral link"
          value={referrals.link}
          hint="Send this to a pharmacy you know. Their trial starts when they confirm their e-mail."
          monospace={false}
        />
        <CopyField label="Your code" value={referrals.code} hint="If they would rather type it in." />

        <div className="referral-stats">
          <div><strong>{referrals.uses}</strong><span>Used</span></div>
          <div><strong>{referrals.successful}</strong><span>Converted</span></div>
          <div><strong>{Math.max(0, referrals.maxUses - referrals.uses)}</strong><span>Left</span></div>
        </div>

        {referrals.referrals.length > 0 && (
          <ul className="referral-list">
            {referrals.referrals.slice(0, 6).map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.pharmacyName ?? item.email}</strong>
                  <span>{item.email}</span>
                </div>
                <Badge tone={item.status === 'converted' ? 'ok' : item.status === 'rejected' ? 'danger' : 'neutral'}>
                  {item.status === 'converted' ? 'Trial started' : item.status === 'pending' ? 'Not yet registered' : item.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <p className="card-note">
          Addresses are shown partly hidden. You can see whether a referral worked, not
          somebody else&apos;s full e-mail address.
        </p>
      </Card>

      {/* -------------------------------- payments ------------------------- */}
      <Card title="Payment history" subtitle="Every charge, successful or not" icon={<Receipt size={18} />} className="span-2">
        {payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            message="Nothing has been charged to this pharmacy. The free Basic plan never will be."
          />
        ) : (
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What for</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reference</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{dateTime(payment.paid_at ?? payment.created_at)}</td>
                    <td>
                      {payment.kind === 'renewal' ? 'Subscription renewal' : payment.kind}
                      {payment.failure_message && (
                        <div className="muted">{payment.failure_message}</div>
                      )}
                    </td>
                    <td className="num">{rupees(payment.amount_paisa)}</td>
                    <td>
                      <Badge tone={payment.status === 'succeeded' ? 'ok' : payment.status === 'failed' ? 'danger' : 'neutral'}>
                        {payment.status === 'succeeded' ? 'Paid' : payment.status === 'failed' ? 'Failed' : 'Pending'}
                      </Badge>
                    </td>
                    <td><code className="muted">{payment.provider_reference ?? '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ================================ modals =========================== */}

      <Modal
        open={!!changing}
        onClose={() => setChanging(null)}
        title="Choose a plan"
        subtitle="You can move in either direction, and nothing is deleted when you do"
        size="lg"
        footer={<Button variant="ghost" onClick={() => setChanging(null)}>Close</Button>}
      >
        <div className="plan-grid is-compact">
          {plans.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              current={plan.key === subscription.plan}
              selected={plan.key === changing}
              featureNames={FEATURE_NAMES}
              busy={busy}
              onChoose={(key) => {
                setChanging(key);
                if (plans.find((p) => p.key === key)?.isFree) void choosePlan(key);
                else void choosePlan(key).then(() => startCheckout(key));
              }}
            />
          ))}
        </div>

        <StatusNote tone="info" title="How paying works">
          Choosing a paid plan sets it up and gives you a payment reference. It becomes active
          when the payment provider confirms the payment to our server — nothing this browser
          does can activate it, which is what stops anybody giving themselves a paid plan.
        </StatusNote>
      </Modal>

      <Modal
        open={!!checkout}
        onClose={() => setCheckout(null)}
        title="Complete the payment"
        subtitle={checkout ? `${checkout.plan.name} — ${rupees(checkout.plan.pricePaisa)}` : ''}
        footer={<Button variant="primary" onClick={() => { setCheckout(null); void reload(true); }}>Done</Button>}
      >
        {checkout && (
          <>
            <CopyField
              label="Payment reference"
              value={checkout.reference}
              hint="Quote this to the payment provider, or to us if you telephone."
            />
            <StatusNote tone="info">{checkout.note}</StatusNote>
            <p className="card-note">
              Payment provider: <strong>{checkout.provider}</strong>. Once it confirms, this
              screen will show the plan as active — you may need to refresh.
            </p>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onConfirm={cancel}
        tone="warn"
        title="Cancel your subscription?"
        message={`Automatic renewal stops. You keep the ${subscription.planName} plan until ${subscription.periodEnd ? date(subscription.periodEnd) : 'the end of the period you have paid for'}, then the pharmacy moves to the free Basic plan. No record is deleted at any point.`}
        confirmLabel="Cancel the subscription"
        loading={busy}
        reasonLabel="Why are you cancelling? (optional)"
        reasonHint="It helps us, and it is recorded against the subscription."
      />

      <div className="span-2">
        <Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => { void reload(); void refreshSubscription(); }}>
          Refresh
        </Button>
        <Button variant="ghost" icon={<ArrowUpRight size={15} />} onClick={() => navigate('/subscription')}>
          How subscriptions work
        </Button>
      </div>
    </div>
  );
}

export default Billing;
