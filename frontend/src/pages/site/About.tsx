/* About, security and support — the three things somebody checks before
   trusting a system with prescription records. */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldCheck, Lock, Eye, Server, FileCheck, LifeBuoy, Mail, MessageSquare } from 'lucide-react';
import { SitePage, SiteCta } from '../../components/SiteChrome';
import { useParallax, useReveal, useViewMode } from '../../hooks/useParallax';
import { useBusiness } from '../../services/business';

const SECURITY = [
  {
    icon: <Lock size={18} />,
    title: 'How your password is stored',
    body: 'It is not. What is stored is a memory-hard hash with a salt unique to your account, which cannot be turned back into the password. If the hashing parameters are strengthened later, your account is upgraded silently the next time you sign in — you are never asked to change anything.'
  },
  {
    icon: <ShieldCheck size={18} />,
    title: 'How a session works',
    body: 'A random token in a cookie the browser will not let JavaScript read. Only a hash of it is stored on the server, so a copy of the database cannot be replayed as a sign-in. It expires when idle, it expires absolutely, and it is replaced outright whenever your password changes.'
  },
  {
    icon: <Eye size={18} />,
    title: 'How devices are recognised',
    body: 'By an identifier the server issues, not by measuring your machine. KSF does not fingerprint: no canvas rendering, no font enumeration, none of the techniques that follow people between accounts. Clearing your cookies simply looks like a new device, which is honest, and you remove the stale one yourself.'
  },
  {
    icon: <FileCheck size={18} />,
    title: 'How the audit trail is protected',
    body: 'Sensitive actions are written to an append-only log where each entry carries the hash of the one before it. Editing or removing any entry breaks every hash after it, and the Security Centre will tell you which entry failed. Nothing in the application ever updates or deletes from that table.'
  },
  {
    icon: <Server size={18} />,
    title: 'Where your data lives',
    body: 'On the computer you installed KSF on. There is no analytics service, no advertising network and no third-party script anywhere in the application, so there is nowhere for your data to be sent. You can export all of it at any time, in a readable format, without asking anybody.'
  }
];

export default function About() {
  const business = useBusiness();
  useViewMode('site');
  useReveal([]);
  const location = useLocation();
  const glow = useParallax<HTMLDivElement>({ speed: 0.24, max: 110 });

  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }, [location.hash]);

  return (
    <SitePage>
      <section className="page-hero is-short">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-blob one" ref={glow} />
        </div>
        <div className="page-hero-inner">
          <span className="eyebrow">About KSF</span>
          <h1>Built in Karachi, for the counters around it</h1>
          <p className="lede">
            KSF exists because the software a Pakistani pharmacy could actually buy was either
            a cash register that did not understand batches, or an imported system priced in
            dollars that did not understand udhaar, DRAP licences or Easypaisa.
          </p>
        </div>
      </section>

      <section className="band" data-reveal>
        <div className="prose">
          <h2>What we set out to build</h2>
          <p>
            A system a pharmacy owner can run without an IT department. It installs on the
            computer already behind the counter, it starts with a double click, and it keeps
            working when the internet does not — because a queue does not wait for a
            connection to come back.
          </p>
          <p>
            The parts that matter most are the ones that cost money when they go wrong. Stock
            is tracked to the batch, so a recall can be answered. Expiry is enforced by the
            till rather than by somebody remembering. Prescription-only medicines cannot leave
            the counter without a pharmacist verifying the prescription. Every sale records
            who served it.
          </p>
          <p>
            And the pharmacy&apos;s records belong to the pharmacy. A trial that ends, a card
            that fails, a subscription cancelled — none of them delete anything. The account
            changes; the history does not. That is a decision, written into the code and
            tested, not a promise in a document.
          </p>
        </div>
      </section>

      <section className="band band-dark" id="security" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Security and privacy</span>
          <h2>The specifics, not the reassurance</h2>
          <p>
            Anybody can write "bank-grade security" on a page. Here is what KSF actually does,
            in enough detail that somebody technical can check it.
          </p>
        </div>

        <div className="security-detail">
          {SECURITY.map((item) => (
            <article key={item.title}>
              <span aria-hidden="true">{item.icon}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="band" data-reveal>
        <div className="band-head">
          <span className="eyebrow">What we collect</span>
          <h2>And what we deliberately do not</h2>
        </div>

        <div className="privacy-columns">
          <div>
            <h3>Collected, because the pharmacy needs it</h3>
            <ul className="tick-list">
              <li>Staff accounts, so people can sign in and their actions can be attributed</li>
              <li>Customer names and phone numbers, to attach a sale or a prescription to a person</li>
              <li>Prescription details, because dispensing a prescription-only medicine legally requires a record</li>
              <li>Sign-in activity and registered devices, so you can tell whether somebody else has been in your account</li>
              <li>Sales, purchases and stock movements, to run the shop and produce accounts</li>
            </ul>
          </div>
          <div>
            <h3>Never collected</h3>
            <ul className="cross-list">
              <li>Browser fingerprints — devices are recognised by an identifier the server issues</li>
              <li>Location beyond the approximate network an address belongs to</li>
              <li>Anything shared with an advertising or analytics service; there are none</li>
              <li>Your customers&apos; data for any purpose other than your pharmacy&apos;s own operation</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="band band-tint" id="support" data-reveal>
        <div className="band-head">
          <span className="eyebrow">Support</span>
          <h2>When something is wrong</h2>
        </div>

        <div className="trio">
          <article>
            <span className="pillar-icon" aria-hidden="true"><LifeBuoy /></span>
            <h3>Read the manual first</h3>
            <p>
              The README that ships with KSF covers installation, backups, restoring, and every
              setting. It is written for a pharmacy owner, not for a developer.
            </p>
          </article>
          <article>
            <span className="pillar-icon" aria-hidden="true"><Mail /></span>
            <h3>Write to us</h3>
            {/* Only offered when a deployment has set an address that somebody
                is actually reading. */}
            {business.supportEmail ? (
              <p>
                <a href={`mailto:${business.supportEmail}`}>{business.supportEmail}</a>. Include
                the correlation ID if the screen showed one — it points straight at the entry in
                the server log.
              </p>
            ) : (
              <p>
                Your installation has not published a support address yet. Whoever set KSF up for
                you is the first person to ask — and if a screen showed a correlation ID, give it
                to them: it points straight at the entry in the server log.
              </p>
            )}
          </article>
          <article>
            <span className="pillar-icon" aria-hidden="true"><MessageSquare /></span>
            <h3>Priority support</h3>
            <p>
              Included on the Monthly and Annual plans.
              {business.supportHours ? ` ${business.supportHours}.` : ' Hours are set by whoever runs your installation.'}
            </p>
          </article>
        </div>
      </section>

      <SiteCta
        title="Start free, decide later"
        body="Open an account in two minutes and run the counter on the free Basic plan for as long as you like. Upgrade when it is worth it — nothing is ever deleted."
      />
    </SitePage>
  );
}
