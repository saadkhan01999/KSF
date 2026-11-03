/* ==========================================================================
   Pricing.
   --------------------------------------------------------------------------
   The owner's price sheet, as a page: Starter (a free 15-day trial),
   Monthly (Rs 1,300 with a referral or Rs 1,500 without, a three-month
   starter plan) and Yearly (Rs 12,000, about Rs 1,000 a month). Every plan
   has every feature and no limit on records, so there is no comparison
   table — the plans differ in how long they run and what they cost.

   The plans, prices and terms are read from /api/v1/public/plans, so a price
   the Super Admin changes is the price shown; this file contains no price.
   ========================================================================== */

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check, Clock, Gift, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { SitePage, SiteCta } from '../../components/SiteChrome';
import { FullAccessStrip, PlanSummaryTable, SheetPlanCard } from '../../components/price-sheet';
import { Alert, CardSkeleton } from '../../components/ui';
import { useParallax, useReveal, useViewMode } from '../../hooks/useParallax';
import { usePublicPlans } from '../../hooks/usePublicPlans';
import { rupees } from '../../utils/format';
import { FAQ, TRIAL_POINTS, RENEWAL_POINTS, SUBSCRIPTION_TERMS } from './content';

export default function Pricing() {
  useViewMode('site');
  useReveal([]);
  const location = useLocation();
  const glow = useParallax<HTMLDivElement>({ speed: 0.26, max: 120 });

  /* The Super Admin's current prices, redrawn the moment they change. */
  const { plans, trialDays, problem } = usePublicPlans();
  const referral = plans?.find((plan) => plan.referralPricePaisa !== null && plan.referralPricePaisa < plan.pricePaisa);

  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }, [location.hash, plans]);

  const ctaFor = (isTrial: boolean, name: string) => (
    <Link to="/register" className={`btn btn-block ${isTrial ? 'btn-primary' : 'btn-secondary'}`}>
      {isTrial ? 'Start free trial' : `Start free, then choose ${name}`} <ArrowRight size={15} />
    </Link>
  );

  return (
    <SitePage>
      <section className="page-hero is-short">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-blob three" ref={glow} />
        </div>
        <div className="page-hero-inner">
          <span className="eyebrow">Subscription plans</span>
          <h1>Full access on every plan. Start free for {trialDays} days.</h1>
          <p className="lede">
            Every plan opens the whole system — the till, stock, purchasing, customers,
            reports and settings — with no limit on what you record. Try it free, then pay
            month by month while you settle in, or once a year for the best price.
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

        {!plans && !problem && <CardSkeleton count={3} />}

        {plans && (
          <div className="sheet-grid plan-grid">
            {plans.map((plan) => (
              <SheetPlanCard key={plan.key} plan={plan} plans={plans} action={ctaFor(plan.isTrial, plan.name)} />
            ))}
          </div>
        )}

        <FullAccessStrip />

        {plans && (
          <div className="sheet-summary-band">
            <h2 className="sheet-summary-title">Plan summary</h2>
            <PlanSummaryTable plans={plans} />
          </div>
        )}

        <p className="plan-footnote">
          Prices are in Pakistani rupees and exclude any tax that applies to your business.
          Nothing is charged when you create an account, and no card is asked for.
        </p>
      </section>

      {/* ---------------------------- free trial -------------------------- */}
      <section className="band band-tint" id="trial" data-reveal>
        <div className="split-band">
          <div className="split-band-head">
            <span className="eyebrow">The free trial</span>
            <h2>{trialDays} days of everything, without a card</h2>
            <p>
              Every new pharmacy starts on the Starter plan: complete account access, every
              feature and unlimited data for {trialDays} days. There is no card to enter, so there
              is nothing to cancel and nothing that can quietly start charging you.
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
              Nothing is deleted when the trial or a plan ends, or when it is cancelled. Your
              records can still be read and exported; changing them waits until a plan is paid
              for, and then everything carries on exactly where it stopped.
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
            <h2>Came through a referral? Pay less.</h2>
            <p>
              Every pharmacy on KSF has a code of its own, and a link to go with it. A pharmacy
              that registers through one pays the referral price
              {referral ? <> — <strong>{rupees(referral.referralPricePaisa)} a month on {referral.name}</strong> instead of {rupees(referral.pricePaisa)}</> : null}.
            </p>
            <ul className="tick-list">
              <li><Check size={15} /> Everybody gets the {trialDays}-day free trial first, referred or not</li>
              <li><Check size={15} /> The referral price applies once the new pharmacy confirms its e-mail</li>
              <li><Check size={15} /> Registered without a code? Enter it later under Settings › Billing</li>
              <li><Check size={15} /> One referral per pharmacy, and never your own code</li>
            </ul>
            <p className="referral-fineprint">
              You cannot refer yourself, and a code cannot be sprayed at a list of addresses —
              both are checked on the server. The referrer sees whether a referral joined, and
              a masked version of the address, never the whole thing.
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
        title={`Start free for ${trialDays} days`}
        body="No card to enter. Bring your catalogue across, serve a week or two of customers, and choose Monthly or Yearly when you are sure."
      />
    </SitePage>
  );
}
