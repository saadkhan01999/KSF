/* ==========================================================================
   Settings › Billing and Subscription
   --------------------------------------------------------------------------
   The plan, what it costs this pharmacy, until when, what has been paid, and
   the referral code — laid out like the price sheet: Starter (the free
   trial), Monthly and Yearly.

   Nothing on this screen can make a subscription active. Choosing a plan
   writes the choice down and hands back a payment reference; the plan starts
   when the payment provider confirms it to the server, and the days left on
   the trial or the current plan run on underneath it. The copy says so
   plainly, because a screen that implies otherwise is how somebody ends up
   believing they have paid when they have not.
   ========================================================================== */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreditCard, Gift, ArrowUpRight, RefreshCw, Receipt, FileText, Lock, Sparkles, Ticket } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import {
  Button, Card, Modal, ConfirmDialog, Alert, CardSkeleton, EmptyState, Switch, Badge, TextInput
} from '../../components/ui';
import { StatusNote, DetailRow, SubscriptionBadge, CopyField } from '../../components/account-ui';
import { FullAccessStrip, SheetPlanCard } from '../../components/price-sheet';
import { InvoiceDialog } from '../../components/invoice';
import { rupees, date, dateTime } from '../../utils/format';
import type { BillingOverview, CheckoutReply, PlanOffer } from '../../types';

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
  const { data, loading, reload, setData } = useApiData<BillingOverview>('/billing');
  /* A payment confirmed by the provider, or a price changed by the platform, shows here at once. */
  useLiveRefresh(reload);

  const [cancelOpen, setCancelOpen] = useState(false);
  /* The plan being paid for, and how. */
  const [paying, setPaying] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [checkout, setCheckout] = useState<CheckoutReply | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const [params, setParams] = useSearchParams();
  const [returned] = useState(() => RETURNED[params.get('payment') ?? ''] ?? null);
  /* Arriving from the end-of-trial screen or the banner with a plan already picked. */
  const [preselected] = useState(() => params.get('choose'));
  useEffect(() => {
    if (!params.get('payment') && !params.get('choose')) return;
    const next = new URLSearchParams(params);
    next.delete('payment');
    next.delete('choose');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const choosePlan = async (planKey: string) => {
    const reply = await run(() => api.post<{ message: string }>('/billing/plan', { planKey }));
    if (!reply) return false;
    ok(reply.message);
    await reload(true);
    await refreshSubscription();
    return true;
  };

  /* Choose a plan, then straight on to how to pay for it. */
  const startPlan = async (offer: PlanOffer) => {
    if (!(await choosePlan(offer.key))) return;
    if (!offer.isFree) { setProvider(data?.defaultProvider ?? ''); setPaying(offer.key); }
  };

  useEffect(() => {
    if (!preselected || !data?.canManage) return;
    const offer = data.plans.find((plan) => plan.key === preselected);
    if (offer && offer.available !== false) void startPlan(offer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected, !!data]);

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

  const applyCode = async () => {
    const reply = await run(() => api.post<{ message: string; plans: PlanOffer[] }>('/billing/referral', { code }));
    if (!reply) return;
    ok(reply.message);
    setCode('');
    setData((current) => (current ? { ...current, plans: reply.plans } : current));
    await reload(true);
  };

  if (loading) return <CardSkeleton count={3} />;
  if (!data) return <EmptyState title="Billing could not be loaded" message="Try again in a moment." />;

  const { subscription, plans, payments, referrals, canManage } = data;
  const currentPlan = plans.find((plan) => plan.key === subscription.plan);
  const payingPlan = plans.find((plan) => plan.key === paying);
  const onTrial = subscription.status === 'trial';
  const paid = !!currentPlan && !currentPlan.isFree && !subscription.locked;
  /* A server from before 2.6 sends no referral prices and no availability:
     the screen still works with it until it is updated. */
  const referralPrice = (referrals.prices ?? [])[0];

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
        {subscription.locked && (
          <Alert tone="warn" title={subscription.isTrial || subscription.plan === 'none' ? 'Your free trial has ended' : `Your ${subscription.planName} plan has ended`}>
            Choose Monthly or Yearly below to carry on. Every record is safe and can still be viewed — nothing has been deleted,
            and everything opens again the moment the payment clears.
          </Alert>
        )}
        {(subscription.status === 'grace' || subscription.status === 'past_due') && (
          <Alert tone="warn" title="A payment did not go through">
            Everything is still working{subscription.graceUntil ? ` until ${date(subscription.graceUntil)}` : ''}. Nothing has been deleted and
            nothing will be — pay before then to carry on without a break.
          </Alert>
        )}

        <div className="billing-summary">
          <div className="billing-plan">
            <span className="billing-plan-label">Current plan</span>
            <strong>{onTrial ? `${subscription.planName} — free trial` : subscription.planName}</strong>
            <SubscriptionBadge status={subscription.status} />
          </div>

          <dl className="detail-list">
            {subscription.subscriptionId && (
              <DetailRow label="Subscription reference">
                <code>{subscription.subscriptionId}</code>
              </DetailRow>
            )}
            {paid && subscription.pricePaisa ? (
              <DetailRow label="Price">
                {rupees(subscription.pricePaisa)} per {currentPlan.period}
                {subscription.referralPricing && currentPlan.referralPricePaisa !== null && <span className="muted"> · referral price</span>}
              </DetailRow>
            ) : null}
            {subscription.cycles && !subscription.locked && (
              <DetailRow label="Plan term">
                {subscription.cycles.period === 'month' ? 'Month' : 'Period'} {Math.min(subscription.cycles.used, subscription.cycles.max)} of {subscription.cycles.max}
              </DetailRow>
            )}
            {subscription.periodEnd && !subscription.locked && (
              <DetailRow label={onTrial ? 'Free trial ends' : subscription.status === 'cancelled' || !subscription.autoRenew ? 'Runs until' : 'Current period ends'}>
                {date(subscription.periodEnd)}
                {subscription.daysLeft !== null && <span className="muted"> · {subscription.daysLeft} day(s) left</span>}
              </DetailRow>
            )}
            {subscription.locked && subscription.endedAt && <DetailRow label="Ended">{date(subscription.endedAt)}</DetailRow>}
            {subscription.pendingPlan && (
              <DetailRow label="Chosen next">{subscription.pendingPlan.name} — starts when it is paid for</DetailRow>
            )}
            {subscription.renewalAt && subscription.autoRenew && paid && (
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

        {onTrial && (
          <StatusNote tone="ok" icon={<Gift size={17} />} title="Your free trial is running — every feature, unlimited data">
            {subscription.daysLeft ?? 0} day(s) left, until {date(subscription.periodEnd ?? null)}. Choose Monthly or Yearly whenever
            you are ready: the plan starts where the trial ends, so no free day is lost, and nothing is charged until you pay.
          </StatusNote>
        )}

        {canManage && paid && (
          <div className="billing-toggle">
            <Switch
              checked={subscription.autoRenew}
              onChange={(value) => { void toggleRenewal(value); }}
              label="Renew this plan automatically"
            />
            <p className="card-note">
              {subscription.cycles && subscription.cycles.used >= subscription.cycles.max
                ? `${subscription.planName} runs for ${subscription.cycles.max} months and this is the last one, so it does not renew. Choose Yearly to carry on.`
                : 'With this off, the plan runs to the end of the period you have paid for; after that you choose a plan again. Nothing is deleted either way.'}
            </p>
          </div>
        )}

        {canManage && (
          <div className="card-actions">
            {subscription.pendingPlan && (
              <Button variant="primary" icon={<CreditCard size={15} />} onClick={() => { setProvider(data.defaultProvider); setPaying(subscription.pendingPlan!.key); }}>
                Pay for {subscription.pendingPlan.name}
              </Button>
            )}
            {data.card?.canChange && (
              <Button variant="outline" icon={<CreditCard size={15} />} onClick={() => { void openCardPage(); }} loading={busy}>
                Change card ({data.card.provider})
              </Button>
            )}
            {paid && subscription.status !== 'cancelled' && (
              <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel the subscription</Button>
            )}
          </div>
        )}
      </Card>

      {/* ---------------------------- the plans ---------------------------- */}
      <Card
        title={subscription.locked ? 'Choose your plan' : 'The plans'}
        subtitle={subscription.referralPricing ? 'Your pharmacy came through a referral, so Monthly is at the referral price' : 'Every plan has every feature and no limit on your records'}
        icon={<Sparkles size={18} />}
        className="span-2"
      >
        <div className="sheet-grid">
          {plans.map((plan) => {
            const current = plan.key === subscription.plan && !subscription.locked;
            const note = plan.isTrial
              ? (onTrial ? `${subscription.daysLeft ?? 0} day(s) of your trial left` : 'Used once, when the pharmacy registered')
              : plan.available === false
                ? <span className="is-warn">{plan.unavailableReason}</span>
                : plan.cyclesLeft !== null && plan.cyclesUsed > 0
                  ? `${plan.cyclesLeft} of ${plan.maxCycles} month(s) left on this plan`
                  : undefined;
            return (
              <SheetPlanCard
                key={plan.key}
                plan={plan}
                plans={plans}
                current={current}
                note={note}
                action={canManage && !plan.isTrial ? (
                  <Button
                    variant={plan.period === 'year' ? 'primary' : 'secondary'}
                    icon={<CreditCard size={16} />}
                    disabled={plan.available === false || busy}
                    onClick={() => { void startPlan(plan); }}
                  >
                    {current ? `Pay for another ${plan.period}` : subscription.pendingPlan?.key === plan.key ? `Pay ${rupees(plan.yourPricePaisa ?? plan.pricePaisa)}` : `Choose ${plan.name} — ${rupees(plan.yourPricePaisa ?? plan.pricePaisa)}`}
                  </Button>
                ) : undefined}
              />
            );
          })}
        </div>
        <FullAccessStrip />
        <StatusNote tone="info" title="How paying works">
          Choosing a plan gives you a payment reference; the plan starts when the payment provider confirms the payment to our
          server — nothing this browser does can start it. The days left on your trial or your current plan are added on, never lost.
        </StatusNote>
      </Card>

      {/* ------------------------------- referrals ------------------------- */}
      <Card
        title="Refer another pharmacy"
        subtitle={referralPrice ? `They pay ${rupees(referralPrice.pricePaisa)} a ${referralPrice.period} on ${referralPrice.name}, not ${rupees(referralPrice.listPricePaisa)}` : 'Share KSF with a pharmacy you know'}
        icon={<Gift size={18} />}
      >
        <CopyField
          label="Your referral link"
          value={referrals.link}
          hint={`Send this to a pharmacy you know. They start with the ${referrals.trialDays}-day free trial like everyone, and the referral price applies once they confirm their e-mail.`}
          monospace={false}
        />
        <CopyField label="Your code" value={referrals.code} hint="If they would rather type it in." />

        <div className="referral-stats">
          <div><strong>{referrals.uses}</strong><span>Used</span></div>
          <div><strong>{referrals.successful}</strong><span>Joined</span></div>
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
                  {item.status === 'converted' ? 'Joined' : item.status === 'pending' ? 'Not yet registered' : item.status}
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

      {/* --------------------------- a code of your own -------------------- */}
      <Card title="Have a referral code?" subtitle="From the pharmacy that told you about KSF" icon={<Ticket size={18} />}>
        {subscription.referralPricing ? (
          <StatusNote tone="ok" title="Referral price applied">
            Your pharmacy came through a referral{referralPrice ? `, so ${referralPrice.name} is ${rupees(referralPrice.pricePaisa)} a ${referralPrice.period} instead of ${rupees(referralPrice.listPricePaisa)}` : ''}.
          </StatusNote>
        ) : canManage ? (
          <>
            <p className="card-note">
              {referralPrice
                ? `Enter it here and ${referralPrice.name} costs ${rupees(referralPrice.pricePaisa)} a ${referralPrice.period} instead of ${rupees(referralPrice.listPricePaisa)}, from your next payment.`
                : 'Enter it here and the referral price applies from your next payment.'}
            </p>
            <form className="referral-entry" onSubmit={(event) => { event.preventDefault(); void applyCode(); }}>
              <TextInput label="Referral code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="REF-XXXXXX" maxLength={32} />
              <Button type="submit" variant="secondary" loading={busy} disabled={!code.trim()}>Apply</Button>
            </form>
          </>
        ) : (
          <p className="card-note">Your pharmacy Admin can enter a referral code here.</p>
        )}
      </Card>

      {/* -------------------------------- payments ------------------------- */}
      <Card title="Payment history" subtitle="Every charge, successful or not" icon={<Receipt size={18} />} className="span-2">
        {payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            message="Nothing has been charged to this pharmacy. The free trial never is."
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
        open={!!payingPlan}
        onClose={() => setPaying(null)}
        icon={<Lock />}
        title={payingPlan ? `Pay for ${payingPlan.name}` : 'Pay'}
        subtitle={payingPlan ? `${rupees(payingPlan.yourPricePaisa ?? payingPlan.pricePaisa)} per ${payingPlan.period}${payingPlan.referralApplied ? ' (referral price)' : ''}${payingPlan.autoRenew ? ', renewing automatically until you stop it' : ''}${payingPlan.maxCycles > 0 ? `, for up to ${payingPlan.cyclesLeft ?? payingPlan.maxCycles} month(s)` : ''}` : ''}
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
        message={`Automatic renewal stops. You keep the ${subscription.planName} plan until ${subscription.periodEnd ? date(subscription.periodEnd) : 'the end of the period you have paid for'}; after that you choose a plan again whenever you are ready. No record is deleted at any point.`}
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
