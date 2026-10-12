/* ==========================================================================
   The public landing page.
   --------------------------------------------------------------------------
   This is where the parallax lives. Three layers of motion, each doing a job
   rather than decorating:

     1. The hero blobs drift slower than the page, which gives the headline
        depth without moving anything you are reading.
     2. The product screenshot rises out of the hero and OVERLAPS the section
        beneath it. That single overlap is what makes the page read as
        layered rather than as a stack of bands.
     3. Sections fade up once as they arrive.

   Three rules the motion obeys, and they are why it is only here:

     - Nothing that has to be READ moves. Text is placed; only background
       shapes and the illustration have parallax on them.
     - An animation is never what makes content appear. The reveal is armed
       by JavaScript and released by a timer if the observer never fires, so
       a browser that blocks it shows the page rather than a blank screen.
     - prefers-reduced-motion switches all of it off, and the page still
       reads correctly because none of the meaning was in the movement.

   None of this runs anywhere near the till. The workspace has no parallax at
   all: a cashier serving a queue does not need the screen to breathe.
   ========================================================================== */

import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, ShieldCheck, Boxes, CalendarClock, Receipt,
  MessagesSquare, BarChart3, Users, Sparkles, Check, Truck, Database,
  Gift, Pill, Lock, Smartphone
} from 'lucide-react';
import { SiteHeader, SiteFooter, SiteCta } from '../../components/SiteChrome';
import { DashboardPreview, TillPreview, ExpiryPreview } from '../../components/AppPreview';
import { BRAND } from '../../brand';
import { useParallax, useReveal, useViewMode } from '../../hooks/useParallax';
import { PLAN_SUMMARY, FAQ } from './content';

const PARTNERS = [
  'Getz Pharma', 'Searle', 'Abbott', 'GSK Pakistan', 'Highnoon',
  'Muller & Phipps', 'Hilton Pharma', 'Sanofi'
];

const PILLARS = [
  {
    icon: <Receipt />,
    title: 'A till built for a busy counter',
    body: 'Search or scan, take cash, card, Easypaisa or JazzCash, and print the receipt. Stock moves the moment the sale completes.'
  },
  {
    icon: <Boxes />,
    title: 'Batch-level stock control',
    body: 'Every pack is tracked to its batch. What the screen says is on the shelf is what is actually on the shelf.'
  },
  {
    icon: <CalendarClock />,
    title: 'Expiry handled before it costs you',
    body: 'Near-expiry stock is flagged ninety days out, and anything past its date is blocked from the till automatically.'
  },
  {
    icon: <ShieldCheck />,
    title: 'Roles you decide',
    body: 'Owner, pharmacist, manager, cashier — or build your own role by ticking exactly what it may do.'
  },
  {
    icon: <MessagesSquare />,
    title: 'The team talks inside the system',
    body: 'Questions about a batch or a price stay next to the record, inside the pharmacy, and inside the audit trail.'
  },
  {
    icon: <BarChart3 />,
    title: 'Numbers you can act on',
    body: 'Daily takings, gross margin, what sold, who sold it, and what the stock is worth. Every figure traces to an invoice.'
  }
];

export default function Landing() {
  useViewMode('site');
  useReveal([]);

  /* Each layer moves at its own rate; that difference is the whole effect. */
  const blobOne = useParallax<HTMLDivElement>({ speed: 0.35, max: 180 });
  const blobTwo = useParallax<HTMLDivElement>({ speed: -0.22, max: 140 });
  const blobThree = useParallax<HTMLDivElement>({ speed: 0.18, max: 120 });
  const shot = useParallax<HTMLDivElement>({ speed: -0.12, max: 90, scale: 0.02 });
  const tillLayer = useParallax<HTMLDivElement>({ speed: 0.08, max: 46 });
  const expiryLayer = useParallax<HTMLDivElement>({ speed: -0.07, max: 40 });

  return (
    <div className="site">
      <SiteHeader />

      <main id="main" tabIndex={-1}>
        {/* ------------------------------ hero ------------------------------ */}
        <section className="hero">
          <div className="hero-bg" aria-hidden="true">
            <div className="hero-blob one" ref={blobOne} />
            <div className="hero-blob two" ref={blobTwo} />
            <div className="hero-blob three" ref={blobThree} />
          </div>

          <div className="hero-inner">
            <span className="hero-badge">
              <b><Sparkles size={12} /> New</b>
              Version {BRAND.version} — accounts, card payments and a medicine directory
            </span>

            <h1>
              Run your pharmacy,<br />not your <em>paperwork</em>
            </h1>

            <p className="lede">
              KSF keeps the till, the shelf, the expiry dates and the day&apos;s numbers in one place —
              built for pharmacies in Pakistan, in rupees, on any device you already own.
            </p>

            <div className="hero-cta">
              <Link to="/register" className="btn btn-primary btn-lg btn-pill">
                Start free trial
                <span className="arrow"><ArrowRight /></span>
              </Link>
              <Link to="/login" className="btn btn-secondary btn-lg btn-pill">Sign in</Link>
            </div>

            <div className="hero-proof">
              <span className="avatar-stack" aria-hidden="true">
                <span className="avatar sm">SH</span>
                <span className="avatar sm gold">AK</span>
                <span className="avatar sm">BA</span>
              </span>
              <span>
                Free on Basic for as long as you like. No card to begin,
                and nothing is ever deleted if you stop paying.
              </span>
            </div>
          </div>

          {/* The overlap: this rises out of the hero and sits over the band
              below it. Removing the hero's bottom padding is what lets it. */}
          <div className="hero-shot" ref={shot}>
            <DashboardPreview />
          </div>
        </section>

        {/* --------------------------- partners ----------------------------- */}
        <section className="partners" data-reveal>
          <p className="partners-label">Stocked from the distributors you already buy from</p>
          <div className="partners-row">
            {PARTNERS.map((name) => <span key={name}>{name}</span>)}
          </div>
        </section>

        {/* ------------------------ product overview ------------------------ */}
        <section className="band" id="overview" data-reveal>
          <div className="band-head">
            <span className="eyebrow">The whole shop, in one place</span>
            <h2>Everything a pharmacy actually does, and nothing it does not</h2>
            <p>
              KSF was not adapted from a general shop system. Every screen exists because a
              pharmacy in Pakistan needed it: batch numbers, expiry dates, prescription
              records, DRAP licences, udhaar accounts and the day&apos;s cash.
            </p>
          </div>

          <div className="pillars">
            {PILLARS.map((pillar) => (
              <article key={pillar.title} className="pillar">
                <span className="pillar-icon" aria-hidden="true">{pillar.icon}</span>
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ------------------------ medicines + stock ----------------------- */}
        <section className="band band-split" id="medicines" data-reveal>
          <div className="split-text">
            <span className="eyebrow"><Pill size={13} /> Medicine management</span>
            <h2>A catalogue that knows what a medicine is</h2>
            <p>
              Generic name, manufacturer, form, strength, pack size, DRAP registration number
              and shelf location — with the prescription-only flag that stops a controlled
              medicine leaving the counter without a pharmacist&apos;s verification.
            </p>
            <ul className="tick-list">
              <li><Check size={15} /> Barcode and item-code search, or type the first three letters</li>
              <li><Check size={15} /> Cost and retail held separately, so margin is always visible</li>
              <li><Check size={15} /> Reorder levels per medicine, with the alert on the dashboard</li>
              <li><Check size={15} /> Categories you name yourself</li>
            </ul>
            <Link to="/features" className="text-link">See every feature <ArrowUpRight size={14} /></Link>
          </div>
          <div className="split-visual" ref={tillLayer}>
            <TillPreview />
          </div>
        </section>

        <section className="band band-split is-reversed" id="inventory" data-reveal>
          <div className="split-text">
            <span className="eyebrow"><Boxes size={13} /> Inventory and expiry</span>
            <h2>The shelf and the screen agree</h2>
            <p>
              Stock is held per batch, and the till sells the batch that expires first. An
              expired or quarantined batch is invisible to the counter — not merely warned
              about, but impossible to sell.
            </p>
            <ul className="tick-list">
              <li><Check size={15} /> First-expiry-first-out allocation on every sale</li>
              <li><Check size={15} /> Ninety-day expiry warnings, then a hard block</li>
              <li><Check size={15} /> Quarantine, write off, and a credit note trail to the supplier</li>
              <li><Check size={15} /> A stock ledger that explains every movement</li>
            </ul>
            <Link to="/features#expiry" className="text-link">How expiry control works <ArrowUpRight size={14} /></Link>
          </div>
          <div className="split-visual" ref={expiryLayer}>
            <ExpiryPreview />
          </div>
        </section>

        {/* -------------------------- three columns ------------------------- */}
        <section className="band" data-reveal>
          <div className="trio">
            <article>
              <span className="pillar-icon" aria-hidden="true"><Truck /></span>
              <h3>Suppliers and purchasing</h3>
              <p>
                Raise an order, receive it against the delivery note, and the batches land on
                the shelf with their expiry dates already recorded. Supplier balances and
                payment terms sit beside the order.
              </p>
            </article>
            <article>
              <span className="pillar-icon" aria-hidden="true"><BarChart3 /></span>
              <h3>Reporting that traces back</h3>
              <p>
                Profitability by medicine, by category and by staff member. Stock valuation at
                cost and at retail. Every figure can be followed back to the invoice or the
                batch it came from, and exported to CSV.
              </p>
            </article>
            <article>
              <span className="pillar-icon" aria-hidden="true"><Users /></span>
              <h3>Staff and roles</h3>
              <p>
                Six roles ship ready to use. Build your own by ticking permissions — a second
                cashier grade, a stock controller, an accountant who only sees money screens.
                Nobody can grant themselves more than they hold.
              </p>
            </article>
          </div>
        </section>

        {/* ----------------------------- security --------------------------- */}
        <section className="band band-dark" id="security" data-reveal>
          <div className="band-head">
            <span className="eyebrow"><Lock size={13} /> Security</span>
            <h2>Built as if somebody will try</h2>
            <p>
              A pharmacy holds prescription records. That is not ordinary shop data, and KSF
              does not treat it as though it were.
            </p>
          </div>

          <div className="security-grid">
            {[
              ['Passwords are never stored', 'Only a memory-hard hash of them, and an older hash is upgraded silently the next time you sign in.'],
              ['Two-factor, if you want it', 'An authenticator app, with ten printed recovery codes for the day the phone is lost.'],
              ['Only the devices you registered', 'One computer and one phone by default. A new machine is refused until you remove an old one — and removing one needs your password.'],
              ['Every session can be ended', 'See where you are signed in, from what, and when. Sign one out, or all of them, from anywhere.'],
              ['An audit trail that can be proved', 'Sensitive actions are hash-chained. If a record were altered in the database directly, the chain breaks and KSF says which entry.'],
              ['Your data stays yours', 'No fingerprinting, no analytics, no advertising. Export everything whenever you like.']
            ].map(([title, body]) => (
              <article key={title}>
                <ShieldCheck size={18} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------------------- migration --------------------------- */}
        <section className="band band-split" id="migration" data-reveal>
          <div className="split-text">
            <span className="eyebrow"><Database size={13} /> Bringing your data across</span>
            <h2>Fifteen years of records, not retyped</h2>
            <p>
              Export what your old system holds — CSV, Excel, or JSON — and KSF reads it,
              works out which column is which, and shows you exactly what it found before
              anything is written.
            </p>
            <ul className="tick-list">
              <li><Check size={15} /> Column names matched automatically, and correctable by hand</li>
              <li><Check size={15} /> Every problem row listed with the reason, never silently dropped</li>
              <li><Check size={15} /> Correct it, skip it, or merge it into what you already have</li>
              <li><Check size={15} /> A backup taken first, and a one-click rollback afterwards</li>
            </ul>
            <Link to="/features#migration" className="text-link">How migration works <ArrowUpRight size={14} /></Link>
          </div>
          <div className="split-visual">
            <div className="preview preview-migration" aria-hidden="true">
              <div className="preview-till-head">
                <strong>old-system-export.csv</strong>
                <span className="preview-pill">1,284 rows</span>
              </div>
              {[
                ['Product Name', 'Medicine name', 'ok'],
                ['Salt', 'Generic name', 'ok'],
                ['Trade Price', 'Cost price', 'ok'],
                ['MRP', 'Retail price', 'ok'],
                ['Reorder', 'Reorder level', 'ok']
              ].map(([from, to]) => (
                <div key={from} className="preview-map-row">
                  <span>{from}</span>
                  <ArrowRight size={12} />
                  <strong>{to}</strong>
                </div>
              ))}
              <div className="preview-migration-foot">
                <span className="tone-ok">1,246 ready</span>
                <span className="tone-warn">38 need a look</span>
                <span className="tone-info">0 discarded</span>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------ plans ----------------------------- */}
        <section className="band" id="plans" data-reveal>
          <div className="band-head">
            <span className="eyebrow">Subscription</span>
            <h2>Four levels. Basic is free, permanently.</h2>
            <p>
              Every plan includes batch tracking and expiry control, because a pharmacy that
              cannot see an expired batch is a pharmacy that sells one. That is never behind a
              paywall.
            </p>
          </div>

          <div className="plan-strip">
            {PLAN_SUMMARY.map((plan) => (
              <article key={plan.key} className={`plan-strip-card ${plan.featured ? 'is-featured' : ''}`}>
                <h3>{plan.name}</h3>
                <p className="plan-strip-price">{plan.price}</p>
                <p className="plan-strip-note">{plan.note}</p>
                <ul>{plan.points.map((point) => <li key={point}><Check size={13} /> {point}</li>)}</ul>
              </article>
            ))}
          </div>

          <div className="band-actions">
            <Link to="/pricing" className="btn btn-secondary btn-pill">Compare the plans in full</Link>
          </div>
        </section>

        {/* ---------------------------- referrals --------------------------- */}
        <section className="band band-accent" id="referral" data-reveal>
          <div className="referral-panel">
            <span className="referral-icon" aria-hidden="true"><Gift size={22} /></span>
            <div>
              <h2>Fifteen days of everything, on a referral</h2>
              <p>
                Every KSF pharmacy has a referral code. A pharmacy that signs up through it gets
                fifteen days of the full premium feature set, starting when they confirm their
                e-mail address — not when they click the link.
              </p>
              <p className="referral-fineprint">
                One trial per account. When it ends the pharmacy moves to the free Basic plan
                with every medicine, batch, sale and prescription exactly where it was. Nothing
                is deleted when a trial expires — not then, and not later.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------- FAQ ------------------------------ */}
        <section className="band" id="faq" data-reveal>
          <div className="band-head">
            <span className="eyebrow">Questions</span>
            <h2>The things pharmacy owners ask first</h2>
          </div>

          <div className="faq-grid">
            {FAQ.slice(0, 6).map((item) => (
              <details key={item.q} className="faq-item">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>

          <div className="band-actions">
            <Link to="/pricing#faq" className="text-link">Read all the questions <ArrowUpRight size={14} /></Link>
          </div>
        </section>

        {/* ------------------------------ mobile ---------------------------- */}
        <section className="band band-split is-reversed" data-reveal>
          <div className="split-text">
            <span className="eyebrow"><Smartphone size={13} /> On any device</span>
            <h2>The counter PC, and the phone in your pocket</h2>
            <p>
              The same KSF, laid out for whatever you opened it on. Every control on a touch
              screen is large enough to hit while you are holding a box in the other hand, and
              the till works one-handed on a phone.
            </p>
            <ul className="tick-list">
              <li><Check size={15} /> Nothing to install — it opens in the browser you already have</li>
              <li><Check size={15} /> Readable in bright shop lighting, and in dark mode after hours</li>
              <li><Check size={15} /> Works on a modest machine; it does not need a new computer</li>
            </ul>
          </div>
          <div className="split-visual">
            <div className="preview preview-phone" aria-hidden="true">
              <div className="preview-phone-notch" />
              <div className="preview-phone-body">
                <strong>Today</strong>
                <span className="preview-phone-amount">Rs 12,535</span>
                <div className="preview-phone-rows">
                  {[['KSF-INV-004182', 'Rs 1,075'], ['KSF-INV-004181', 'Rs 340'], ['KSF-INV-004180', 'Rs 2,120']].map(([ref, amount]) => (
                    <div key={ref}><span>{ref}</span><strong>{amount}</strong></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <SiteCta />
      </main>

      <SiteFooter />
    </div>
  );
}
