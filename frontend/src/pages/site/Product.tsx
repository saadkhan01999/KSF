/* The product introduction: what KSF is, who it is for, and what a week of
   using it actually looks like. Lighter on motion than the landing page —
   one drifting background layer — because this page is read, not skimmed. */

import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Clock, Sun, Moon } from 'lucide-react';
import { SitePage, SiteCta } from '../../components/SiteChrome';
import { DashboardPreview } from '../../components/AppPreview';
import { useParallax, useReveal, useViewMode } from '../../hooks/useParallax';

const DAY = [
  {
    time: 'Before opening',
    icon: <Sun size={15} />,
    title: 'Check what needs attention',
    body: 'The dashboard opens on what is low, what is expiring, what prescriptions are waiting, and what yesterday took. Two minutes, standing up, before the shutter goes.'
  },
  {
    time: 'Through the day',
    icon: <Clock size={15} />,
    title: 'Serve the counter',
    body: 'Search or scan, take the money, print the receipt. Stock moves as the sale completes and the batch is recorded against the invoice. A prescription-only medicine will not go through without a verified prescription.'
  },
  {
    time: 'When the delivery arrives',
    icon: <Check size={15} />,
    title: 'Receive it against the order',
    body: 'Open the purchase order, check it against the delivery note, and receive it. The batches land on the shelf with their expiry dates already recorded — no second data entry.'
  },
  {
    time: 'At closing',
    icon: <Moon size={15} />,
    title: 'Reconcile and close',
    body: 'The day\'s takings broken down by cash, card, Easypaisa, JazzCash and udhaar. If the drawer is short, the sales list says who served what and when.'
  }
];

export default function Product() {
  useViewMode('site');
  useReveal([]);

  const glow = useParallax<HTMLDivElement>({ speed: 0.28, max: 140 });
  const shot = useParallax<HTMLDivElement>({ speed: -0.1, max: 70, scale: 0.015 });

  return (
    <SitePage>
      <section className="page-hero">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-blob one" ref={glow} />
        </div>
        <div className="page-hero-inner">
          <span className="eyebrow">The product</span>
          <h1>A pharmacy system, not a shop system with medicines in it</h1>
          <p className="lede">
            KSF was written for pharmacies in Pakistan. Batch numbers and expiry dates are not
            an add-on; prescription verification is not a checkbox; and the money is in rupees
            and paisa, counted as whole numbers so nothing drifts.
          </p>
          <div className="hero-cta">
            <Link to="/register" className="btn btn-primary btn-lg btn-pill">
              Start free trial <span className="arrow"><ArrowRight /></span>
            </Link>
            <Link to="/login" className="btn btn-secondary btn-lg btn-pill">Sign in</Link>
          </div>
        </div>
        <div className="page-hero-shot" ref={shot}>
          <DashboardPreview />
        </div>
      </section>

      <section className="band" data-reveal>
        <div className="band-head">
          <span className="eyebrow">A day at the counter</span>
          <h2>What using it actually looks like</h2>
          <p>
            The test of a pharmacy system is not the feature list. It is whether the person on
            the counter can serve a queue with it, and whether the owner can trust the number
            at the end of the day.
          </p>
        </div>

        <ol className="day-list">
          {DAY.map((step) => (
            <li key={step.time}>
              <span className="day-time"><span aria-hidden="true">{step.icon}</span>{step.time}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="band band-dark" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Decisions we made on purpose</span>
          <h2>Why it behaves the way it does</h2>
        </div>

        <div className="reason-grid">
          {[
            ['Money is counted in paisa', 'Every amount is a whole number of paisa. Nothing is stored as a decimal, so a thousand sales cannot add up to a rupee that is not there.'],
            ['Expired stock is blocked, not warned about', 'A warning gets clicked through when there is a queue. The till simply cannot sell a batch that is past its date.'],
            ['Permissions are checked on the server', 'Hiding a button is a convenience for the person using the screen. It is not a control. Every endpoint checks for itself.'],
            ['Your data is never the hostage', 'A trial ending, a card failing, a plan cancelled — none of them delete a record. The account changes; the pharmacy\'s history does not.'],
            ['It runs on the computer you have', 'One process, an embedded database, and no cloud dependency to run the counter. The till works whether or not the internet does.'],
            ['Nothing tracks anybody', 'There is no analytics service, no advertising and no third-party script in the application. There is nowhere for your data to go.']
          ].map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Who it is for</span>
          <h2>From one counter to a small chain</h2>
        </div>
        <div className="trio">
          <article>
            <h3>A single neighbourhood pharmacy</h3>
            <p>
              One counter, two or three staff, a shelf that needs watching. Fifteen days free,
              then Rs 1,500 a month — with batch tracking and expiry control, the two things
              that actually cost money when they go wrong, on every plan.
            </p>
          </article>
          <article>
            <h3>A busy shop with a night shift</h3>
            <p>
              Several staff accounts, roles that differ by shift, and a record of who served
              what. The monthly plan adds full reporting, custom roles and the migration tools.
            </p>
          </article>
          <article>
            <h3>A few branches under one owner</h3>
            <p>
              Stock and reporting across branches, a regional manager role that sees everything
              and changes nothing it should not, and scheduled backups. That is the annual plan.
            </p>
          </article>
        </div>
        <div className="band-actions">
          <Link to="/features" className="btn btn-secondary btn-pill">
            Every feature in detail <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>

      <SiteCta />
    </SitePage>
  );
}
