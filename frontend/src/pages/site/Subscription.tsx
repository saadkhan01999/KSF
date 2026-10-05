/* The subscription page: what a plan actually means once you are on it —
   how renewal works, what happens when a payment fails, and exactly what
   does and does not happen to your data. */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock, CreditCard, RefreshCw, ShieldCheck, Database } from 'lucide-react';
import { SitePage, SiteCta } from '../../components/SiteChrome';
import { PlanCard, StatusNote } from '../../components/account-ui';
import { CardSkeleton, Alert } from '../../components/ui';
import { useReveal, useViewMode } from '../../hooks/useParallax';
import { api } from '../../services/api';
import { FEATURE_NAMES } from './content';
import type { Plan } from '../../types';

const LIFECYCLE = [
  {
    icon: <CreditCard size={16} />,
    title: 'You choose a plan',
    body: 'The subscription is created at once, marked as waiting for payment. Nothing about the pharmacy changes yet, and the free feature set stays available while it waits.'
  },
  {
    icon: <ShieldCheck size={16} />,
    title: 'The payment provider confirms it',
    body: 'Not your browser — the provider, server to server, over a signed message. Nothing the front end can do makes a subscription active. That is deliberate.'
  },
  {
    icon: <RefreshCw size={16} />,
    title: 'It renews on its own',
    body: 'On the day the period ends, if auto-renewal is on. Each renewal is recorded with its own reference, and a delivery arriving twice extends the period exactly once.'
  },
  {
    icon: <Clock size={16} />,
    title: 'If a payment fails',
    body: 'A grace period starts and you are told immediately, by e-mail and in the app. The pharmacy carries on working normally throughout. Nothing is switched off the moment a card is declined.'
  },
  {
    icon: <Database size={16} />,
    title: 'If it is never paid',
    body: 'The account moves to the free Basic plan. Every medicine, batch, sale, purchase and prescription stays exactly where it is. The premium features stop being reachable; your records are untouched.'
  }
];

export default function Subscription() {
  useViewMode('site');
  useReveal([]);

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.get<{ data: Plan[] }>('/public/plans')
      .then((reply) => { if (live) setPlans(reply.data); })
      .catch((error: Error) => { if (live) setProblem(error.message); });
    return () => { live = false; };
  }, []);

  return (
    <SitePage>
      <section className="page-hero is-short">
        <div className="page-hero-inner">
          <span className="eyebrow">Subscription</span>
          <h1>How paying for KSF works</h1>
          <p className="lede">
            Four levels, a permanent free one, and one promise that runs through all of them:
            your pharmacy&apos;s records are never used as leverage.
          </p>
        </div>
      </section>

      <section className="band" data-reveal>
        {problem && <Alert tone="warn" title="The live plans could not be loaded">{problem}</Alert>}
        {!plans && !problem && <CardSkeleton count={4} />}
        {plans && (
          <div className="plan-grid">
            {plans.map((plan) => <PlanCard key={plan.key} plan={plan} featureNames={FEATURE_NAMES} />)}
          </div>
        )}
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
            ['Trial', 'The full premium feature set, free, for fifteen days.', 'ok'],
            ['Active', 'Paid and current. Everything on the plan is available.', 'ok'],
            ['Waiting for payment', 'A plan has been chosen but not yet paid for. The free feature set applies meanwhile.', 'warn'],
            ['Grace period', 'A payment did not go through. Everything still works, and you have days to sort it out.', 'warn'],
            ['Cancelled', 'Auto-renewal is off. The plan runs to the end of the period you already paid for.', 'neutral'],
            ['Basic', 'The free plan. Reachable from any other state, and nothing is lost getting here.', 'ok']
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
            <li><Check size={16} /> You can export everything, at any time, on any plan including the free one.</li>
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
