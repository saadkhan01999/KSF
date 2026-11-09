/* ==========================================================================
   Subscription plans — the Subscription wallet
   --------------------------------------------------------------------------
   Plans: what the pharmacy is on (plan, cost, medicines allowed, days of
   access left) and what it can move to — Demo, the Standard Referral, Pro,
   Diamond Annual, or a price of its own.

   Referrals: the pharmacy's link, how many pharmacies it has brought, and
   the 15 days each one earned, claimed with one button onto the end of the
   trial or the plan.

   Nothing here starts a paid plan: Pro goes on to the provider's checkout,
   and the plan begins when the provider confirms the payment to the server.
   Payment history, receipts, automatic renewal and cancelling stay under
   Settings › Billing.
   ========================================================================== */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, CalendarPlus, ChevronRight, CircleCheck, Clock, Copy, CreditCard, Gem, Gift, Headset, Link2, Phone,
  ReceiptText, Send, UsersRound, WalletCards
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Alert, Badge, Button, CardSkeleton, EmptyState } from '../../components/ui';
import { date } from '../../utils/format';
import type { BillingOverview, ReferralClaimReply } from '../../types';
import { ContactKsfDialog, Crumbs, currentPlanLabel, monthlyName, paidPlans, pkr } from './wallet-ui';

type Tab = 'plans' | 'referrals';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function Wallet() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'referrals' ? 'referrals' : 'plans';
  const setTab = (next: Tab) => setParams(next === 'plans' ? {} : { tab: next }, { replace: true });
  const { data, loading, reload, setData } = useApiData<BillingOverview>('/billing');
  useLiveRefresh(reload);
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <>
      <Crumbs trail={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Subscription plans' }]} />
      <div className="page-head wallet-head">
        <div>
          <h1>Subscription wallet</h1>
        </div>
        <div className="actions">
          <Button variant="ghost" icon={<ReceiptText size={16} />} onClick={() => navigate('/settings?tab=billing')}>Payments and receipts</Button>
        </div>
      </div>

      <div className="wallet-tabs" role="tablist" aria-label="Subscription wallet">
        <button type="button" role="tab" aria-selected={tab === 'plans'} className={tab === 'plans' ? 'is-on' : ''} onClick={() => setTab('plans')}>
          <WalletCards size={18} aria-hidden="true" /> Plans
        </button>
        <button type="button" role="tab" aria-selected={tab === 'referrals'} className={tab === 'referrals' ? 'is-on' : ''} onClick={() => setTab('referrals')}>
          <UsersRound size={18} aria-hidden="true" /> Referrals
          {(data?.referrals.rewards?.readyDays ?? 0) > 0 && <span className="wallet-tab-dot" aria-label="Days ready to claim" />}
        </button>
      </div>

      {loading && !data && <CardSkeleton count={3} />}
      {!loading && !data && <EmptyState title="The plans could not be loaded" message="Check the connection and try again." action={<Button onClick={() => { void reload(); }}>Try again</Button>} />}
      {data && tab === 'plans' && <PlansTab data={data} onReferrals={() => setTab('referrals')} onContact={() => setContactOpen(true)} />}
      {data && tab === 'referrals' && (
        <ReferralsTab
          data={data}
          onClaimed={(reply) => setData((current) => (current ? { ...current, subscription: reply.subscription, referrals: reply.referrals } : current))}
        />
      )}

      <ContactKsfDialog
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        contact={data?.sales}
        topic={{
          title: 'A price that fits your pharmacy',
          subject: 'Custom pricing',
          message: 'Assalam-o-alaikum. We would like to discuss a custom KSF price for our pharmacy.'
        }}
      />
    </>
  );
}

/* ================================== Plans ================================== */

function PlansTab({ data, onReferrals, onContact }: { data: BillingOverview; onReferrals: () => void; onContact: () => void }) {
  const navigate = useNavigate();
  const { subscription, plans, canManage } = data;
  const { trial, monthly, yearly } = paidPlans(plans);
  const rewards = data.referrals.rewards;
  const perReferral = rewards?.daysPerReferral ?? 15;
  const medicines = subscription.limits.medicines;
  const cost = subscription.isTrial || subscription.locked ? 0 : subscription.pricePaisa ?? 0;
  const period = subscription.cycles?.period ?? (subscription.plan === 'yearly' ? 'year' : 'month');
  const onMonthly = !!monthly && subscription.plan === monthly.key && !subscription.locked;
  const monthlyPrice = monthly ? monthly.yourPricePaisa ?? monthly.pricePaisa : 0;
  const yearlyPrice = yearly ? yearly.yourPricePaisa ?? yearly.pricePaisa : 0;

  return (
    <>
      {subscription.locked && (
        <Alert tone="warn" title={subscription.isTrial || subscription.plan === 'none' ? 'Your free trial has ended' : `Your ${subscription.planName} plan has ended`}>
          Every record is safe and can still be viewed. Choose a plan below — or claim referral days — and everything opens again.
        </Alert>
      )}
      {subscription.pendingPlan && !subscription.locked && (
        <Alert tone="info" title={`${subscription.pendingPlan.name} is chosen and waiting for its payment`}>
          It starts when the payment clears, after the days you have now.{' '}
          <button type="button" className="link-button" onClick={() => navigate(subscription.pendingPlan!.key === yearly?.key ? '/subscription-plans/annual' : '/subscription-plans/pro')}>
            Review and pay
          </button>
        </Alert>
      )}

      <section className="wallet-strip" aria-label="Your subscription">
        <div><span>Current plan</span><strong>{currentPlanLabel(subscription)}</strong></div>
        <div>
          <span>Current cost</span>
          <strong>{pkr(cost)}{cost > 0 && <small> / {period}</small>}</strong>
        </div>
        <div><span>Medicines allowed</span><strong>{medicines === undefined || medicines < 0 ? 'Unlimited' : medicines.toLocaleString('en-PK')}</strong></div>
        <div>
          <span>Access remaining</span>
          <strong>{subscription.locked ? 'Ended' : plural(subscription.daysLeft ?? 0, 'day')}</strong>
        </div>
      </section>

      <div className="wallet-section-head">
        <h2>Available plans</h2>
        <span>Full pharmacy access on every plan</span>
      </div>

      <div className="wallet-plans">
        {/* Demo: the free trial every pharmacy starts on. */}
        <article className="wallet-plan">
          <span className="wallet-plan-icon is-mint" aria-hidden="true"><Clock size={20} /></span>
          <h3>{trial?.name ?? 'Demo'}</h3>
          <p className="wallet-price"><strong>{plural(trial?.trialDays || 15, 'day')}</strong><span>/ trial</span></p>
          <p className="wallet-plan-text">{trial?.description || 'Start billing, add medicines and use every feature from day one.'}</p>
          <Button variant="secondary" block disabled className="wallet-plan-current">
            {subscription.isTrial && !subscription.locked ? 'Current plan' : 'Used at registration'}
          </Button>
        </article>

        {/* The Standard Referral: days for every pharmacy that registers through the link. */}
        <article className="wallet-plan">
          <span className="wallet-plan-icon is-mint" aria-hidden="true"><UsersRound size={20} /></span>
          <h3>Standard Referral</h3>
          <p className="wallet-price"><strong>+{plural(perReferral, 'day')}</strong><span>/ registration</span></p>
          <p className="wallet-plan-text">Invite a pharmacy. Once it registers, claim {perReferral} extra days of full access.</p>
          <Button variant="outline" block iconRight={<ArrowRight size={16} />} onClick={onReferrals}>
            {(rewards?.readyDays ?? 0) > 0 ? `Claim ${rewards!.readyDays} days` : 'Open referrals'}
          </Button>
        </article>

        {/* Pro: month by month. */}
        {monthly && (
          <article className="wallet-plan is-featured">
            <span className="wallet-plan-icon is-gold" aria-hidden="true"><CreditCard size={20} /></span>
            <h3>{monthly.name}</h3>
            <p className="wallet-price">
              <strong>{pkr(monthlyPrice)}</strong><span>/ month</span>
              {monthly.referralApplied && <Badge tone="ok" dot={false}>Referral price</Badge>}
            </p>
            <p className="wallet-plan-text">{monthly.description || 'Keep your pharmacy running with full access on a monthly subscription.'}</p>
            {monthly.available === false
              ? <p className="wallet-plan-note is-warn">{monthly.unavailableReason}</p>
              : monthly.maxCycles > 0 && <p className="wallet-plan-note">{monthly.cyclesUsed > 0 ? `${monthly.cyclesLeft} of ${monthly.maxCycles} months left on ${monthly.name}` : `Up to ${monthly.maxCycles} months, then ${yearly?.name ?? 'the annual plan'}`}</p>}
            <Button
              variant="primary" block iconRight={<ArrowRight size={16} />}
              disabled={monthly.available === false || !canManage}
              onClick={() => navigate('/subscription-plans/pro')}
            >
              {onMonthly ? `Pay for another month` : `Choose ${monthly.name}`}
            </Button>
          </article>
        )}
      </div>

      <p className="wallet-includes">
        <CircleCheck size={18} aria-hidden="true" /> Includes billing, unlimited medicines, inventory, expiry tracking and reports.
      </p>
      {!canManage && <p className="wallet-includes is-dim">Only your pharmacy Admin can choose or pay for a plan.</p>}

      {yearly && (
        <button type="button" className="wallet-row" onClick={() => navigate('/subscription-plans/annual')}>
          <span className="wallet-plan-icon is-gold" aria-hidden="true"><Gem size={20} /></span>
          <span className="wallet-row-text">
            <strong>{yearly.name}</strong>
            <span>{pkr(yearlyPrice)} billed yearly · Equivalent to {pkr(yearlyPrice / 12)} per month.</span>
          </span>
          <span className="wallet-row-link">View annual option <ChevronRight size={18} aria-hidden="true" /></span>
        </button>
      )}

      <div className="wallet-row is-plain">
        <span className="wallet-row-text">
          <strong>Custom pricing</strong>
          <span>Speak with KSF about a price that fits your pharmacy.</span>
        </span>
        <button type="button" className="wallet-row-link" onClick={onContact}>Contact KSF <Phone size={18} aria-hidden="true" /></button>
      </div>

      {monthly && yearly && (
        <p className="wallet-footnote">
          {monthlyName(monthly.name)} costs {pkr(monthlyPrice * 12)} over a year; {yearly.name} is {pkr(yearlyPrice)}. Every plan keeps every
          medicine, sale and prescription — nothing is deleted when a plan ends.
        </p>
      )}
    </>
  );
}

/* ================================ Referrals ================================ */

function ReferralsTab({ data, onClaimed }: { data: BillingOverview; onClaimed: (reply: ReferralClaimReply) => void }) {
  const { ok, fail, refreshSubscription } = useApp();
  const { busy, run } = useAction();
  const { referrals, subscription, canManage } = data;
  const rewards = referrals.rewards ?? { daysPerReferral: 15, invitations: referrals.uses, completed: referrals.successful, readyCount: 0, readyDays: 0, claimedDays: 0 };
  const left = subscription.locked ? 0 : subscription.daysLeft ?? 0;
  const ready = rewards.readyDays;
  const extension = subscription.isTrial || subscription.locked ? 'Trial extension' : 'Access extension';
  const shareText = `Assalam-o-alaikum! We run our pharmacy on KSF — billing, stock and expiry in one place. Start your ${referrals.trialDays}-day free trial with my link: ${referrals.link}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referrals.link);
      ok('Link copied', 'Paste it into a message to the pharmacy you are inviting.');
    } catch {
      fail(new Error('This browser did not allow copying. Select the link and copy it by hand.'));
    }
  };

  const claim = () => run(
    () => api.post<ReferralClaimReply>('/billing/referral-rewards/claim', {}),
    (reply) => { onClaimed(reply); ok(reply.message); void refreshSubscription(); }
  );

  return (
    <>
      <section className="wallet-strip" aria-label="Your referrals">
        <div><span>Invitations</span><strong>{rewards.invitations}</strong></div>
        <div><span>Completed registrations</span><strong>{rewards.completed}</strong></div>
        <div><span>Days ready to claim</span><strong>{plural(ready, 'day')}</strong></div>
        <div><span>Days claimed</span><strong>{plural(rewards.claimedDays, 'day')}</strong></div>
      </section>

      <div className="wallet-referral-grid">
        <article className="wallet-card">
          <span className="wallet-plan-icon is-mint" aria-hidden="true"><Link2 size={20} /></span>
          <h3>Invite a pharmacy</h3>
          <p className="wallet-plan-text">
            Share your personal link. Each pharmacy that registers through it earns you {plural(rewards.daysPerReferral, 'extra day')}.
          </p>
          <input className="input wallet-link" readOnly value={referrals.link} aria-label="Your referral link" onFocus={(event) => event.currentTarget.select()} />
          <div className="wallet-actions">
            <Button variant="primary" icon={<Copy size={17} />} onClick={() => { void copy(); }}>Copy link</Button>
            <a className="btn btn-outline" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
              <Send size={17} aria-hidden="true" /> Share via WhatsApp
            </a>
          </div>
          <p className="wallet-fineprint">Your code is <strong>{referrals.code}</strong>, if they would rather type it in when they register.</p>
        </article>

        <article className="wallet-card">
          <span className="wallet-plan-icon is-gold" aria-hidden="true"><Gift size={20} /></span>
          <h3>{extension}</h3>
          <p className="wallet-plan-text">
            {ready > 0
              ? subscription.locked
                ? `${rewards.readyCount === 1 ? 'One pharmacy has' : `${rewards.readyCount} pharmacies have`} registered. Claim ${plural(ready, 'day')} to open your pharmacy again.`
                : `${rewards.readyCount === 1 ? 'One pharmacy has' : `${rewards.readyCount} pharmacies have`} registered. Add ${plural(ready, 'day')} to your remaining ${plural(left, 'day')} of full access.`
              : `When a pharmacy you invite registers, its ${plural(rewards.daysPerReferral, 'day')} appear here to claim.`}
          </p>
          <p className="wallet-days" aria-label={ready > 0 ? `${left} days now, ${left + ready} days after claiming` : `${left} days left`}>
            {left}{ready > 0 && <><span aria-hidden="true"> → </span>{left + ready}</>} <span>days</span>
          </p>
          <Button
            variant="primary" iconRight={<ArrowRight size={17} />} icon={<CalendarPlus size={17} />}
            disabled={ready <= 0 || !canManage} loading={busy} onClick={() => { void claim(); }}
          >
            {ready > 0 ? `Claim ${plural(ready, 'day')}` : 'Nothing to claim yet'}
          </Button>
          {!canManage && ready > 0 && <p className="wallet-fineprint">Your pharmacy Admin can claim these days.</p>}
          {!subscription.locked && subscription.periodEnd && <p className="wallet-fineprint">Full access now runs until {date(subscription.periodEnd)}.</p>}
        </article>
      </div>

      <div className="wallet-section-head">
        <h2>Referral activity</h2>
        <span>{plural(rewards.invitations, 'invitation')}</span>
      </div>
      {referrals.referrals.length === 0
        ? (
          <EmptyState
            icon={<Headset size={28} />}
            title="No invitations yet"
            message={`Share your link with a pharmacy you know. Every one that registers adds ${plural(rewards.daysPerReferral, 'day')} to yours.`}
          />
        )
        : (
          <div className="table-scroll wallet-table">
            <table className="tbl responsive">
              <thead>
                <tr><th scope="col">Pharmacy</th><th scope="col">Registration</th><th scope="col">Extension</th></tr>
              </thead>
              <tbody>
                {referrals.referrals.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-title">
                      <div className="cell-main">{row.pharmacyName ?? row.name ?? row.email}</div>
                      <div className="cell-sub">{row.email}{row.registeredAt ? ` · ${date(row.registeredAt)}` : ''}</div>
                    </td>
                    <td data-label="Registration">{row.registration ?? (row.status === 'converted' ? 'Registered' : 'Invited')}</td>
                    <td data-label="Extension">
                      {row.extension === 'ready' && <Badge tone="ok" dot={false}>{row.extensionLabel}</Badge>}
                      {row.extension === 'claimed' && <Badge tone="info" dot={false}>{row.extensionLabel}</Badge>}
                      {row.extension === 'review' && <Badge tone="warn" dot={false}>{row.extensionLabel}</Badge>}
                      {(row.extension === 'waiting' || row.extension === 'none' || !row.extension) && <span className="t-dim">{row.extensionLabel ?? 'Awaiting registration'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
