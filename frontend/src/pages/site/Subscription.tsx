/* The subscription page: what a plan actually means once you are on it —
   how renewal works, what happens when a payment fails, and exactly what
   does and does not happen to your data. */

import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock, CreditCard, RefreshCw, ShieldCheck, Database } from 'lucide-react';
import { SitePage, SiteCta } from '../../components/SiteChrome';
import { StatusNote } from '../../components/account-ui';
import { FullAccessStrip, SheetPlanCard } from '../../components/price-sheet';
import { CardSkeleton, Alert } from '../../components/ui';
import { useReveal, useViewMode } from '../../hooks/useParallax';
import { usePublicPlans } from '../../hooks/usePublicPlans';

const LIFECYCLE = [
  {
    icon: <CreditCard size={16} />,
    title: 'You start free, then choose a plan',
    body: 'Every pharmacy starts on the 15-day free trial with everything. Choosing Monthly or Yearly changes nothing yet: the trial carries on, and the plan starts where it ends — no free day is lost.'
  },
  {
    icon: <ShieldCheck size={16} />,
    title: 'The payment provider confirms it',
    body: 'Not your browser — the provider, server to server, over a signed message. Nothing the front end can do makes a subscription active. That is deliberate.'
  },
  {
    icon: <RefreshCw size={16} />,
    title: 'It renews on its own',
    body: 'On the day the period ends, if auto-renewal is on. Monthly stops by itself after its third month, so you can move to Yearly. Each renewal is recorded with its own reference, and a delivery arriving twice extends the period exactly once.'
  },
  {
    icon: <Clock size={16} />,
    title: 'If a payment fails',
    body: 'A grace period starts and you are told immediately, by e-mail and in the app. The pharmacy carries on working normally throughout. Nothing is switched off the moment a card is declined.'
  },
  {
    icon: <Database size={16} />,
    title: 'If it is never paid',
    body: 'You are asked to choose a plan. Every medicine, batch, sale, purchase and prescription stays exactly where it is and can still be viewed and exported; changing records waits for the payment.'
  }
];

export default function Subscription() {
  useViewMode('site');
  useReveal([]);

  const { plans, problem } = usePublicPlans();

  return (
    <SitePage>
      <section className="page-hero is-short">
        <div className="page-hero-inner">
          <span className="eyebrow">Subscription</span>
          <h1>How paying for KSF works</h1>
          <p className="lede">
            A free trial, two ways to pay, full access on all three — and one promise that runs
            through them: your pharmacy&apos;s records are never deleted, whatever happens.
          </p>
        </div>
      </section>

      <section className="band" data-reveal>
        {problem && <Alert tone="warn" title="The live plans could not be loaded">{problem}</Alert>}
        {!plans && !problem && <CardSkeleton count={3} />}
        {plans && (
          <div className="sheet-grid plan-grid">
            {plans.map((plan) => <SheetPlanCard key={plan.key} plan={plan} plans={plans} />)}
          </div>
        )}
        <FullAccessStrip />
      </section>

      <section className="band band-tint" data-reveal>
        <div className="band-head">
          <span className="eyebrow">The lifecycle</span>
          <h2>From choosing a plan to letting it lapse</h2>
        </div>

        <ol className="lifecycle">
          {LIFECYCLE.map((step, index) => (
            <li key={step.title}>
              <span className="lifecycle-step" aria-hidden="true">{index + 1}</span>
              <div>
                <h3><span aria-hidden="true">{step.icon}</span> {step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="band" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Your reference</span>
          <h2>Every subscription has an identifier</h2>
          <p>
            It looks like <code>SUB-2026-X8K42P7</code>, and it is what to quote if you
            telephone about a payment.
          </p>
        </div>

        <StatusNote tone="info" title="A reference, not a password">
          Knowing a subscription reference grants nothing at all. Every endpoint that takes
          one still checks who is asking and whether that pharmacy owns the row. The
          references are unpredictable so that having one does not let anybody guess the next
          — not because they are secret.
        </StatusNote>
      </section>

      <section className="band band-dark" data-reveal>
        <div className="band-head">
          <span className="eyebrow">The statuses</span>
          <h2>What each one means for the counter</h2>
        </div>

        <div className="status-grid">
          {[
            ['Free trial', 'Everything, free, for fifteen days from registration.', 'ok'],
            ['Active', 'Paid and current. Everything is available.', 'ok'],
            ['Grace period', 'A renewal did not go through. Everything still works, and you have days to sort it out.', 'warn'],
            ['Cancelled', 'Auto-renewal is off. The plan runs to the end of the period you already paid for.', 'neutral'],
            ['Ended', 'The trial or the plan has run out. Records can be read and exported; choose a plan to change them again.', 'warn']
          ].map(([label, body, tone]) => (
            <article key={label} className={`status-card tone-${tone}`}>
              <h3>{label}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band" data-reveal>
        <div className="prose">
          <h2>What never happens</h2>
          <ul className="tick-list is-strong">
            <li><Check size={16} /> A trial ending does not delete anything.</li>
            <li><Check size={16} /> A failed payment does not delete anything, and does not lock you out on the day.</li>
            <li><Check size={16} /> Cancelling does not delete anything, and you keep what you paid for until it runs out.</li>
            <li><Check size={16} /> Nothing you can click in the browser can activate a paid plan without the provider confirming it.</li>
            <li><Check size={16} /> You can export everything, at any time — on the trial, on a plan, and after one ends.</li>
          </ul>
        </div>
        <div className="band-actions">
          <Link to="/register" className="btn btn-primary btn-pill">
            Create an account <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <SiteCta />
    </SitePage>
  );
}
