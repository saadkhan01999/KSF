/* ==========================================================================
   Pricing.
   --------------------------------------------------------------------------
   Rebuilt for 1.0.4: a billing-cycle toggle, a card per plan, and the four
   things a pharmacy owner actually wants answered before they type a card
   number — what the trial is, when it renews, what happens if a payment
   fails, and what happens to their records if they stop paying.

   The plans, prices, limits and feature lists are read from
   /api/v1/public/plans. Changing what the Monthly plan costs is a row in
   subscription_plans, not a rebuild. This file contains no price.
   ========================================================================== */

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight, Check, Gift, Minus, RefreshCw, ShieldCheck, Sparkles, Clock
} from 'lucide-react';
import { SitePage, SiteCta } from '../../components/SiteChrome';
import { PlanCard } from '../../components/account-ui';
import { Alert, CardSkeleton, Segmented } from '../../components/ui';
import { useParallax, useReveal, useViewMode } from '../../hooks/useParallax';
import { usePublicPlans } from '../../hooks/usePublicPlans';
import { rupees } from '../../utils/format';
import { FEATURE_NAMES, FAQ, TRIAL_POINTS, RENEWAL_POINTS, SUBSCRIPTION_TERMS } from './content';
import type { Plan } from '../../types';

type Cycle = 'week' | 'month' | 'year';

const CYCLES: { value: Cycle; label: string }[] = [
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Annual' }
];

const FLAG: Record<Cycle, string> = {
  week: 'Pay as you go',
  month: 'Most chosen',
  year: 'Best value'
};

export default function Pricing() {
  useViewMode('site');
  useReveal([]);
  const location = useLocation();
  const glow = useParallax<HTMLDivElement>({ speed: 0.26, max: 120 });

  /* The Super Admin's current prices, redrawn the moment they change. */
  const { plans, trialDays, problem } = usePublicPlans();
  const [cycle, setCycle] = useState<Cycle>('month');

  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }, [location.hash, plans]);

  /* Every feature any plan mentions, in a stable order, for the table. */
  const allFeatures = useMemo(
    () => (plans ? [...new Set(plans.flatMap((plan) => plan.features))] : []),
    [plans]
  );

  /* What a longer cycle works out at per month, so "Rs 14,000 per year" can be
     compared with "Rs 1,400 per month" without arithmetic at the counter. */
  const equivalentFor = (plan: Plan): string | undefined => {
    if (plan.pricePaisa === 0 || plan.periodDays <= 31) return undefined;
    const months = plan.periodDays / 30.44;
    return `About ${rupees(Math.round(plan.pricePaisa / months))} a month`;
  };

  return (
    <SitePage>
      <section className="page-hero is-short">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-blob three" ref={glow} />
        </div>
        <div className="page-hero-inner">
          <span className="eyebrow">Pricing</span>
          <h1>Four levels, and one of them is free for ever</h1>
          <p className="lede">
            Basic is not a trial that runs out. It is a plan, it costs nothing, and a single
            counter can run on it indefinitely — with batch tracking and expiry control
            included, because those are safety features and not upsells.
          </p>
        </div>
      </section>

      <section className="band" id="plans" data-reveal>
        {problem && (
          <Alert tone="warn" title="The live prices could not be loaded">
            {problem} Try again in a moment — these prices come from the database rather than
            from this page, so there is nothing out of date to fall back on.
          </Alert>
        )}

        <div className="pricing-toggle">
          <span className="pricing-toggle-label">How would you like to pay?</span>
          <Segmented
            options={CYCLES}
            value={cycle}
            onChange={setCycle}
            label="Billing cycle"
          />
          <span className="pricing-toggle-note">
            Basic stays free on every setting. The premium plan for the cycle you pick is
            highlighted below.
          </span>
        </div>

        {!plans && !problem && <CardSkeleton count={4} />}

        {plans && (
          <div className="plan-grid">
            {plans.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                featured={plan.period === cycle}
                flag={plan.period === cycle ? FLAG[cycle] : undefined}
                equivalent={equivalentFor(plan)}
                featureNames={FEATURE_NAMES}
                action={
                  <Link
                    to="/register"
                    className={`btn btn-block ${plan.period === cycle ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {plan.isFree ? 'Start on Basic' : `Start free trial`}
                  </Link>
                }
              />
            ))}
          </div>
        )}

        <p className="plan-footnote">
          Prices are in Pakistani rupees and exclude any tax that applies to your business.
          Nothing is charged when you create an account, on any plan.
        </p>
      </section>

      {/* ---------------------------- free trial -------------------------- */}
      <section className="band band-tint" id="trial" data-reveal>
        <div className="split-band">
          <div className="split-band-head">
            <span className="eyebrow">The free trial</span>
            <h2>{trialDays} days of everything, without a card</h2>
            <p>
              A pharmacy that arrives through a referral link gets the full premium feature
              set for {trialDays} days. There is no card to enter, so there is nothing to
              cancel and nothing that can quietly start charging you.
            </p>
            <Link to="/register" className="btn btn-primary btn-pill">
              Start free trial <ArrowRight size={15} />
            </Link>
          </div>
          <ul className="tick-list is-strong">
            {TRIAL_POINTS.map((point) => (
              <li key={point}><Check size={16} aria-hidden="true" /> {point}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------- comparison --------------------------- */}
      {plans && (
        <section className="band" id="compare" data-reveal>
          <div className="band-head">
            <span className="eyebrow">Side by side</span>
            <h2>What each plan includes</h2>
          </div>

          <div className="table-scroll">
            <table className="tbl compare-table">
              <caption className="sr-only">Features included in each subscription plan</caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {plans.map((plan) => (
                    <th key={plan.key} scope="col" className={plan.period === cycle ? 'is-featured' : undefined}>
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allFeatures.map((feature) => (
                  <tr key={feature}>
                    <th scope="row">{FEATURE_NAMES[feature] ?? feature}</th>
                    {plans.map((plan) => {
                      const has = plan.features.includes(feature);
                      return (
                        <td key={plan.key} className={has ? 'is-yes' : 'is-no'}>
                          {has
                            ? <><Check size={15} aria-hidden="true" /><span className="sr-only">Included</span></>
                            : <><Minus size={15} aria-hidden="true" /><span className="sr-only">Not included</span></>}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                <tr className="compare-divider">
                  <th scope="row">Registered computers</th>
                  {plans.map((plan) => <td key={plan.key}>{plan.limits.desktopDevices}</td>)}
                </tr>
                <tr>
                  <th scope="row">Registered phones and tablets</th>
                  {plans.map((plan) => <td key={plan.key}>{plan.limits.mobileDevices}</td>)}
                </tr>
                <tr>
                  <th scope="row">Staff accounts</th>
                  {plans.map((plan) => (
                    <td key={plan.key}>{plan.limits.users < 0 ? 'Unlimited' : plan.limits.users}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Branches</th>
                  {plans.map((plan) => (
                    <td key={plan.key}>{plan.limits.branches < 0 ? 'Unlimited' : plan.limits.branches}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Medicines in the catalogue</th>
                  {plans.map((plan) => (
                    <td key={plan.key}>
                      {plan.limits.medicines < 0 ? 'Unlimited' : plan.limits.medicines.toLocaleString('en-PK')}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Grace period if a payment fails</th>
                  {plans.map((plan) => (
                    <td key={plan.key}>{plan.graceDays ? `${plan.graceDays} days` : '—'}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Renews automatically</th>
                  {plans.map((plan) => (
                    <td key={plan.key}>{plan.isFree ? 'Nothing to renew' : plan.autoRenew ? 'Yes' : 'No'}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* -------------------------- auto-renewal -------------------------- */}
      <section className="band band-tint" id="renewal" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Renewals and payments</span>
          <h2>How the money side works</h2>
          <p className="lede">
            A payment is only ever recorded once the provider confirms it to our server. The
            browser is never believed about money — not because we distrust you, but because a
            browser is the one place a payment result can be faked.
          </p>
        </div>

        <div className="renewal-grid">
          <article className="renewal-card">
            <span className="renewal-icon" aria-hidden="true"><RefreshCw size={20} /></span>
            <h3>Automatic renewal</h3>
            <ul className="tick-list">
              {RENEWAL_POINTS.slice(0, 3).map((point) => (
                <li key={point}><Check size={15} aria-hidden="true" /> {point}</li>
              ))}
            </ul>
          </article>

          <article className="renewal-card">
            <span className="renewal-icon is-warn" aria-hidden="true"><Clock size={20} /></span>
            <h3>If a payment fails</h3>
            <ul className="tick-list">
              {RENEWAL_POINTS.slice(3).map((point) => (
                <li key={point}><Check size={15} aria-hidden="true" /> {point}</li>
              ))}
            </ul>
          </article>

          <article className="renewal-card">
            <span className="renewal-icon is-ok" aria-hidden="true"><ShieldCheck size={20} /></span>
            <h3>Your records, either way</h3>
            <p>
              Nothing is deleted when a subscription ends, expires, or is cancelled. The
              premium features stop being reachable; the medicines, batches, sales, purchases
              and prescriptions do not go anywhere. You can export all of it whenever you like.
            </p>
          </article>
        </div>
      </section>

      {/* ---------------------------- conditions -------------------------- */}
      <section className="band" id="terms" data-reveal>
        <div className="band-head">
          <span className="eyebrow">The conditions</span>
          <h2>In plain sentences</h2>
        </div>
        <dl className="terms-grid">
          {SUBSCRIPTION_TERMS.map((term) => (
            <div key={term.title} className="terms-item">
              <dt>{term.title}</dt>
              <dd>{term.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------------------- referral ---------------------------- */}
      <section className="band band-accent" id="referral" data-reveal>
        <div className="referral-panel">
          <span className="referral-icon" aria-hidden="true"><Gift size={22} /></span>
          <div>
            <h2>The referral programme</h2>
            <p>
              Every pharmacy has a code of its own, and a link to go with it. A pharmacy that
              registers through that link gets <strong>{trialDays} days of the full premium
              feature set</strong>, free.
            </p>
            <ul className="tick-list">
              <li><Check size={15} /> The trial starts when the new pharmacy confirms its e-mail, not when it clicks</li>
              <li><Check size={15} /> One trial per account, ever</li>
              <li><Check size={15} /> No card is asked for, and none is charged when it ends</li>
              <li><Check size={15} /> When it ends the account moves to free Basic with every record intact</li>
            </ul>
            <p className="referral-fineprint">
              You cannot refer yourself, and a code cannot be sprayed at a list of addresses —
              both are checked on the server. The referrer sees whether a referral converted,
              and a masked version of the address, never the whole thing.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------- FAQ ------------------------------ */}
      <section className="band" id="faq" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Questions</span>
          <h2>Everything pharmacy owners ask</h2>
        </div>
        <div className="faq-grid is-wide">
          {FAQ.map((item) => (
            <details key={item.q} className="faq-item">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
        <div className="band-actions">
          <Link to="/register" className="btn btn-primary btn-pill">
            Start free trial <ArrowRight size={15} />
          </Link>
          <Link to="/product" className="btn btn-outline btn-pill">
            <Sparkles size={15} /> See the product
          </Link>
        </div>
      </section>

      <SiteCta
        title="Start on Basic, move up when it pays for itself"
        body="There is no card to enter and no clock running. Bring your catalogue across, serve a week of customers, and decide then."
      />
    </SitePage>
  );
}
