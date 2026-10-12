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

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CreditCard, Gift, ArrowUpRight, RefreshCw, Receipt, AlertTriangle, Check, FileText, Lock
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import {
  Button, Card, Modal, ConfirmDialog, Alert, CardSkeleton, EmptyState,
  Switch, Badge
} from '../../components/ui';
import { PlanCard, StatusNote, DetailRow, SubscriptionBadge, CopyField } from '../../components/account-ui';
import { InvoiceDialog } from '../../components/invoice';
import { rupees, date, dateTime } from '../../utils/format';
import { FEATURE_NAMES } from '../site/content';
import type { BillingOverview, CheckoutReply } from '../../types';

/** Send the browser to the provider's own page: a link, or a signed form it posts. */
function goToProvider(redirect: NonNullable<CheckoutReply['redirect']>): void {
  if (redirect.method === 'GET') { window.location.assign(redirect.url); return; }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = redirect.url;
  for (const [name, value] of Object.entries(redirect.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/* What the provider's return said, in words. The plan itself follows the
   live feed: it turns active when the provider confirms, not before. */
const RETURNED: Record<string, { tone: 'ok' | 'info' | 'warn'; title: string; body: string }> = {
  paid: { tone: 'ok', title: 'Payment received', body: 'Thank you — the plan is active and the receipt is in the payment history below.' },
  pending: { tone: 'info', title: 'Waiting for the payment to be confirmed', body: 'The provider has not confirmed it yet. This screen updates by itself the moment it does.' },
  mismatch: { tone: 'warn', title: 'The payment could not be matched', body: 'What the provider reported did not match the payment request, so nothing was applied. Please contact KSF support with the reference.' },
  cancelled: { tone: 'info', title: 'Payment cancelled', body: 'Nothing was charged. You can pay whenever you are ready.' }
};

export function Billing() {
  const { ok, refreshSubscription } = useApp();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const { data, loading, reload } = useApiData<BillingOverview>('/billing');
  /* A payment confirmed by the provider, or a price changed by the platform, shows here at once. */
  useLiveRefresh(reload);

  const [changing, setChanging] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  /* The paid plan being paid for, and how. */
  const [paying, setPaying] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [checkout, setCheckout] = useState<CheckoutReply | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  const [params, setParams] = useSearchParams();
  const [returned] = useState(() => RETURNED[params.get('payment') ?? ''] ?? null);
  useEffect(() => {
    if (!params.get('payment')) return;
    const next = new URLSearchParams(params);
    next.delete('payment');
    setParams(next, { replace: true });
  }, [params, setParams]);

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

  const startCheckout = async (planKey: string, providerKey: string) => {
    const reply = await run(() => api.post<CheckoutReply>('/billing/checkout', { planKey, provider: providerKey }));
    if (!reply) return;
    setPaying(null);
    if (reply.redirect) goToProvider(reply.redirect);
    else setCheckout(reply);
  };

  const openCardPage = async () => {
    const reply = await run(() => api.post<{ url: string }>('/billing/portal'));
    if (reply?.url) window.location.assign(reply.url);
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

  const payingPlan = plans.find((plan) => plan.key === paying);

  return (
    <div className="grid grid-2">
      {returned && (
        <div className="span-2">
          <StatusNote tone={returned.tone} title={returned.title}>{returned.body}</StatusNote>
        </div>
      )}

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
            {subscription.status === 'payment_pending' && currentPlan && !currentPlan.isFree && (
              <Button variant="secondary" icon={<CreditCard size={15} />} onClick={() => { setProvider(data.defaultProvider); setPaying(currentPlan.key); }}>
                Pay for {currentPlan.name}
              </Button>
            )}
            {data.card?.canChange && (
              <Button variant="outline" icon={<CreditCard size={15} />} onClick={() => { void openCardPage(); }} loading={busy}>
                Change card ({data.card.provider})
              </Button>
            )}
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
            <table className="tbl responsive">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">When</th>
                  <th scope="col">What for</th>
                  <th scope="col" className="t-right">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="t-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const invoiced = payment.status === 'succeeded' || payment.status === 'refunded';
                  return (
                    <tr key={payment.id}>
                      <td className="cell-title"><span className="mono t-sm">{payment.invoice_no ?? '—'}</span></td>
                      <td data-label="When">{dateTime(payment.paid_at ?? payment.created_at)}</td>
                      <td data-label="What for">
                        {payment.plan_name ? `${payment.plan_name} — ` : ''}{payment.kind === 'renewal' ? 'renewal' : payment.kind === 'checkout' ? 'subscription' : payment.kind}
                        {payment.failure_message && <div className="muted">{payment.failure_message}</div>}
                      </td>
                      <td data-label="Amount" className="t-right num">
                        {rupees(payment.amount_paisa)}
                        {(payment.refunded_paisa ?? 0) > 0 && <div className="muted">{rupees(payment.refunded_paisa ?? 0)} refunded</div>}
                      </td>
                      <td data-label="Status">
                        <Badge tone={payment.status === 'succeeded' ? 'ok' : payment.status === 'failed' ? 'danger' : 'neutral'}>
                          {payment.status === 'succeeded' ? 'Paid' : payment.status === 'failed' ? 'Failed' : payment.status === 'refunded' ? 'Refunded' : 'Pending'}
                        </Badge>
                      </td>
                      <td data-label="Receipt" className="t-right">
                        {invoiced
                          ? <Button size="sm" variant="ghost" icon={<FileText size={15} />} onClick={() => setInvoiceId(payment.id)}>View</Button>
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
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
                if (plans.find((p) => p.key === key)?.isFree) { void choosePlan(key); return; }
                void choosePlan(key).then(() => { setProvider(data.defaultProvider); setPaying(key); });
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
        open={!!payingPlan}
        onClose={() => setPaying(null)}
        icon={<Lock />}
        title={payingPlan ? `Pay for ${payingPlan.name}` : 'Pay'}
        subtitle={payingPlan ? `${rupees(payingPlan.pricePaisa)} per ${payingPlan.period}${payingPlan.autoRenew ? ', renewing automatically until you stop it' : ''}` : ''}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPaying(null)}>Not now</Button>
            <Button
              variant="primary" icon={<Lock size={15} />} loading={busy} disabled={!provider || !payingPlan}
              onClick={() => { if (payingPlan) void startCheckout(payingPlan.key, provider); }}
            >
              Continue to payment
            </Button>
          </>
        )}
      >
        {data.providers.length === 0 ? (
          <StatusNote tone="warn" title="Online payment is not set up yet">
            This installation cannot take payments online yet. The KSF team can record a payment for you — contact support
            with your subscription reference.
          </StatusNote>
        ) : (
          <div className="pay-options" role="radiogroup" aria-label="How to pay">
            {data.providers.map((option) => (
              <label key={option.key} className={`pay-option ${provider === option.key ? 'is-on' : ''}`}>
                <input type="radio" name="provider" value={option.key} checked={provider === option.key} onChange={() => setProvider(option.key)} />
                <span>
                  <strong>{option.label}</strong>
                  {option.mode === 'test' || option.mode === 'sandbox' ? <Badge tone="warn" dot={false}>Test mode</Badge> : null}
                  <small>{option.note}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="card-note">
          You pay on the provider&apos;s own secure page; card details never reach KSF. The plan turns active the moment the
          provider confirms the payment to our server, and this screen updates by itself.
        </p>
      </Modal>

      <Modal
        open={!!checkout}
        onClose={() => setCheckout(null)}
        title="Complete the payment"
        subtitle={checkout ? `${checkout.plan.name} — ${rupees(checkout.amountPaisa)}` : ''}
        footer={<Button variant="primary" onClick={() => { setCheckout(null); void reload(true); }}>Done</Button>}
      >
        {checkout && (
          <>
            <CopyField label="Payment reference" value={checkout.reference} hint="Put this on the transfer. Without it the payment cannot be matched to your pharmacy." />
            {checkout.instructions && (
              <dl className="detail-list">
                {(['bank', 'accountTitle', 'accountNumber', 'iban', 'branch', 'raastId'] as const).map((key) => (
                  checkout.instructions?.[key]
                    ? <DetailRow key={key} label={{ bank: 'Bank', accountTitle: 'Account title', accountNumber: 'Account number', iban: 'IBAN', branch: 'Branch', raastId: 'Raast ID' }[key]}>{String(checkout.instructions[key])}</DetailRow>
                    : null
                ))}
              </dl>
            )}
            <StatusNote tone="info">{checkout.note}</StatusNote>
          </>
        )}
      </Modal>

      <InvoiceDialog paymentId={invoiceId} onClose={() => setInvoiceId(null)} />

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
