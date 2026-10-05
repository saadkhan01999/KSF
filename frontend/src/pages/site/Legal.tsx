/* ==========================================================================
   Privacy, terms, refunds and support
   --------------------------------------------------------------------------
   Four documents, one component, because they share a shape and because
   keeping them together is how the four of them stay consistent with each
   other.

   What is written here is what the software actually does. Every factual claim
   below — where data is stored, which cookies exist, what happens when a
   subscription lapses, who can see a patient's allergies — is a statement about
   code that exists in this repository, and where the code changes this page has
   to change with it.

   What is NOT written here is anything this software cannot know: the legal
   name of the business selling it, its address, its jurisdiction, its support
   hours. Those come from configuration, and where a deployment has not set
   them the page says so plainly rather than printing an invention. A policy
   that names a company that does not exist is not a policy.

   Before publishing: the commercial figures in the refund document and the
   liability wording in the terms need the business's own sign-off. They are
   listed in docs/CREDENTIALS_REQUIRED.md under "three decisions".
   ========================================================================== */

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ShieldCheck, FileText, Undo2, LifeBuoy, Mail, MessageSquare, Phone,
  Clock, AlertTriangle, Download
} from 'lucide-react';
import { SitePage } from '../../components/SiteChrome';
import { useReveal, useViewMode } from '../../hooks/useParallax';
import { useBusiness, placeOf, type Business } from '../../services/business';
import { BRAND } from '../../brand';

/* The day this wording was last changed. Updated by hand, because "today" on a
   policy page is a lie that makes the document worthless. */
const LAST_UPDATED = '11 September 2026';

type Doc = 'privacy' | 'terms' | 'refunds' | 'support';

const TITLES: Record<Doc, { eyebrow: string; title: string; lead: string; icon: React.ReactNode }> = {
  privacy: {
    eyebrow: 'Privacy',
    title: 'What KSF holds, and who can see it',
    lead: 'A pharmacy system holds medicine records, customer names and, in places, health information. This is what happens to all of it.',
    icon: <ShieldCheck size={18} />
  },
  terms: {
    eyebrow: 'Terms of service',
    title: 'The agreement, in plain words',
    lead: 'What you are paying for, what happens if you stop, and what each side is responsible for.',
    icon: <FileText size={18} />
  },
  refunds: {
    eyebrow: 'Refunds and cancellation',
    title: 'Cancelling, and getting money back',
    lead: 'Cancel whenever you like. What you get back depends on when, and this page says exactly how.',
    icon: <Undo2 size={18} />
  },
  support: {
    eyebrow: 'Support',
    title: 'Getting help',
    lead: 'Where to ask, what to include, and what you can sort out yourself in two minutes.',
    icon: <LifeBuoy size={18} />
  }
};

export default function Legal({ doc }: { doc: Doc }) {
  const business = useBusiness();
  useViewMode('site');
  useReveal([doc]);
  const location = useLocation();
  const head = TITLES[doc];

  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }, [location.hash]);

  return (
    <SitePage>
      <section className="page-hero is-short">
        <div className="page-hero-inner">
          <span className="eyebrow">{head.eyebrow}</span>
          <h1>{head.title}</h1>
          <p className="lede">{head.lead}</p>
          <p className="t-sm t-dim">Last updated {LAST_UPDATED} · KSF {BRAND.version}</p>
        </div>
      </section>

      <section className="band">
        <div className="prose" data-reveal>
          {doc === 'privacy' && <Privacy business={business} />}
          {doc === 'terms' && <Terms business={business} />}
          {doc === 'refunds' && <Refunds business={business} />}
          {doc === 'support' && <Support business={business} />}
        </div>
      </section>
    </SitePage>
  );
}

/* ------------------------------------------------------------------ parts -- */

/** Who to write to. Prints nothing it has not been told. */
function Contact({ business, purpose }: { business: Business; purpose: string }) {
  const lines = [
    business.supportEmail && { icon: <Mail size={15} />, text: business.supportEmail, href: `mailto:${business.supportEmail}` },
    business.phone && { icon: <Phone size={15} />, text: business.phone, href: `tel:${business.phone.replace(/[^\d+]/g, '')}` },
    business.whatsapp && { icon: <MessageSquare size={15} />, text: `${business.whatsapp} (WhatsApp)`, href: `https://wa.me/${business.whatsapp.replace(/[^\d]/g, '')}` }
  ].filter(Boolean) as { icon: React.ReactNode; text: string; href: string }[];

  if (!lines.length) {
    return (
      <div className="legal-note">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          This installation has not published a contact address yet, so there is nowhere for this
          page to point you. Whoever set KSF up can add one — it is a setting, not a code change.
        </span>
      </div>
    );
  }

  return (
    <>
      <p>{purpose}</p>
      <ul className="legal-contact">
        {lines.map((line) => (
          <li key={line.text}>
            {line.icon}
            <a href={line.href}>{line.text}</a>
          </li>
        ))}
        {business.supportHours && (
          <li><Clock size={15} aria-hidden="true" /> {business.supportHours}</li>
        )}
      </ul>
    </>
  );
}

/** The name the document is an agreement with. */
function Party({ business }: { business: Business }) {
  if (business.legalName) {
    return (
      <>
        <b>{business.legalName}</b>
        {placeOf(business) ? `, ${placeOf(business)}` : ''}
        {business.ntn ? ` (NTN ${business.ntn})` : ''}
      </>
    );
  }
  return (
    <>
      <b>the business operating this installation of KSF</b> (it has not published
      a legal name here yet)
    </>
  );
}

/* ---------------------------------------------------------------- privacy -- */

function Privacy({ business }: { business: Business }) {
  return (
    <>
      <h2>Who holds what</h2>
      <p>
        There are two different answers, and the difference matters.
      </p>
      <p>
        <b>Your pharmacy's records belong to your pharmacy.</b> Medicines, batches, suppliers,
        customers, prescriptions, sales, staff accounts — all of it is created by you and held in
        your installation's database. If KSF is installed on a computer in your shop, that data has
        never left the building. If you use a hosted installation, it is held on that server on your
        behalf, and <Party business={business} /> holds it for you rather than owning it.
      </p>
      <p>
        <b>The account that signs in</b> — a name, an e-mail address, a password hash, which devices
        have been registered, and a record of sign-ins — exists so that access can be controlled and
        so that a sensitive action can be traced to a person.
      </p>

      <h2 id="health">Health information</h2>
      <p>
        Some of what a pharmacy records is health information about identifiable people: a customer's
        allergies, their long-term conditions, the prescriptions dispensed to them, and what they
        bought. KSF treats it as the most sensitive thing it holds.
      </p>
      <p>
        It is visible to the staff of your pharmacy, according to the role you gave each of them, and
        to nobody else. There is no cross-pharmacy view, no aggregate dataset, and no research use.
        A second pharmacy using the same software cannot see any of it — every query is scoped to one
        pharmacy, and that is tested rather than assumed.
      </p>

      <h2>What KSF does not do</h2>
      <p>
        There is no analytics service, no advertising network, no session recorder and no third-party
        script anywhere in the application. Nothing is sent anywhere when you use it, because there is
        nowhere for it to be sent. You can verify that: the built interface loads only files from the
        installation that served it.
      </p>
      <p>
        KSF does not fingerprint your machine. A device is recognised by an identifier the server
        issued and stored in a cookie, not by measuring your browser's fonts or graphics. Clearing
        your cookies looks like a new device, which is the honest outcome.
      </p>

      <h2 id="cookies">Cookies</h2>
      <p>
        Two cookies, both necessary for the application to work, neither for tracking — and one token that is not stored at all:
      </p>
      <ul className="legal-list">
        <li>
          <b>The sign-in cookie.</b> A refresh token the browser will not let JavaScript read, sent
          only to the sign-in service. It is replaced every time it is used, and only a hash of it is
          stored on the server, so a stolen copy of the database cannot be replayed as a sign-in. If an
          old one is ever presented again, that session is ended at once.
        </li>
        <li>
          <b>The device cookie.</b> A server-issued identifier, so that a new machine signing in can
          be recognised as new and you can be told about it.
        </li>
        <li>
          <b>The access token</b> is not a cookie at all: it lives only in the open page's memory,
          lasts fifteen minutes, and is never written to the disk.
        </li>
      </ul>
      <p>
        Because both cookies are strictly necessary, there is no cookie banner to click through. There
        is nothing optional to consent to.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Until you delete it. KSF does not expire your records, and it never deletes data because a
        payment was missed or a trial ended — an unpaid subscription suspends access, and the data is
        exactly where you left it when you come back. A pharmacy record you archive is hidden from
        the till and kept in your history, so your own reports stay true.
      </p>
      <p>
        The audit trail is append-only by design. Entries in it are never edited or removed, because a
        log that can be quietly changed is not evidence of anything.
      </p>

      <h2>Taking it with you, and having it removed</h2>
      <p>
        Every list in KSF exports to CSV from the screen you are looking at, without asking anybody's
        permission, and the database itself is a single file you can copy (
        <Link to="/features#migration">how that works</Link>). There is no export fee and no notice
        period: leaving is a file copy.
      </p>
      <p>
        To have an account or a customer record deleted rather than archived, ask. A deletion that
        would break your own accounting — an invoice, an audit entry — is explained rather than done
        silently, so you can decide.
      </p>

      <h2>Breaches</h2>
      <p>
        If data held on a hosted installation is exposed, you will be told: what happened, what was
        reachable, when, and what to do. Not a press release months later.
      </p>

      <h2>Asking about your data</h2>
      <Contact business={business} purpose="For anything on this page — a copy of your data, a deletion, or a question about how something works:" />
    </>
  );
}

/* ------------------------------------------------------------------ terms -- */

function Terms({ business }: { business: Business }) {
  return (
    <>
      <h2>Who this is between</h2>
      <p>
        This is an agreement between <Party business={business} /> and the pharmacy whose owner
        created the account.
      </p>

      <h2>What you are paying for</h2>
      <p>
        A licence to use KSF for your pharmacy, for the period you have paid for, with the features
        of the plan you chose. Prices are shown on the <Link to="/pricing">pricing page</Link>, in
        rupees, inclusive of the taxes stated there. The Basic plan is free and stays free.
      </p>

      <h2 id="billing">Billing, renewal and what happens if you stop paying</h2>
      <ul className="legal-list">
        <li>
          A paid plan is billed for the cycle you choose, monthly or yearly, in advance.
        </li>
        <li>
          <b>A subscription renews automatically</b> at the end of each cycle, at the price then
          published, until you cancel. You can cancel at any time from Settings → Billing, and you
          keep what you have already paid for until the end of that cycle.
        </li>
        <li>
          If a renewal payment fails you are given a <b>grace period</b>, not a cut-off. The pharmacy
          keeps working, the owner is told, and the payment can be retried.
        </li>
        <li>
          If it is still unpaid after the grace period, the account is <b>suspended</b>: nobody can
          sign in until it is settled. <b>Nothing is deleted.</b> Your medicines, stock, customers,
          sales and audit trail are exactly where you left them.
        </li>
        <li>
          A payment is only ever treated as made when the payment provider confirms it to the server,
          or when a person at the business confirms a bank transfer against the statement. A browser
          returning from a payment page does not activate anything.
        </li>
      </ul>

      <h2>Trials</h2>
      <p>
        A referral trial gives you the full system for the period stated on the{' '}
        <Link to="/pricing#referral">pricing page</Link>. No payment method is required to start one,
        and it does not turn into a paid subscription by itself. When it ends you choose: pay, or drop
        to Basic. Either way your data stays.
      </p>

      <h2>What you are responsible for</h2>
      <ul className="legal-list">
        <li>
          <b>Your licences and your law.</b> KSF records what you dispense; it does not make you
          compliant. DRAP licensing, controlled-drug rules, the presence of a qualified pharmacist,
          tax registration and filing remain yours.
        </li>
        <li>
          <b>Your accounts.</b> One account per person, a real password, and two-factor
          authentication on the owner and manager accounts. Sharing a login makes the audit trail
          worthless, which is the one thing it cannot be.
        </li>
        <li>
          <b>Your backups</b>, if you run KSF on your own computer. It writes them for you; keeping a
          copy somewhere other than that computer is yours (
          <Link to="/features">how</Link>).
        </li>
        <li>
          <b>What you put in it.</b> Patient data you are not entitled to hold does not become
          lawful by being in KSF.
        </li>
      </ul>

      <h2>What we are responsible for</h2>
      <ul className="legal-list">
        <li>The software working as described on these pages, and being fixed when it does not.</li>
        <li>Not looking at your pharmacy's data except when you ask us to, to help with a problem.</li>
        <li>Telling you about a breach that affects you, promptly and specifically.</li>
        <li>Not holding your data hostage. Export is built in and always available.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Do not attempt to break into other pharmacies' data, resell access, or use KSF to do
        something illegal. Any of those ends the agreement.
      </p>

      <h2>Ending it</h2>
      <p>
        You can stop whenever you like: cancel the subscription, export your data, and keep the file.
        We can end the agreement for non-payment after the grace period and suspension described
        above, or for the acceptable-use breaches above — and if we ever withdraw the product
        entirely you will be given notice and the means to get your data out.
      </p>

      <h2>Limits</h2>
      <p>
        KSF is a record-keeping system. It is not a clinical decision tool and it does not replace a
        pharmacist's judgement: an allergy warning on a screen is a reminder of something you
        recorded, not advice. Decisions about what to dispense remain the pharmacist's.
      </p>
      <p>
        Nothing in these terms limits any liability that the law of {business.country || 'the country this business operates in'}{' '}
        does not allow to be limited.
      </p>

      <h2>Changes</h2>
      <p>
        If these terms change in a way that affects you, you will be told before the change takes
        effect — not by a quietly updated date on a page. The date at the top of this page is the day
        the wording last changed.
      </p>

      <h2>Questions</h2>
      <Contact business={business} purpose="About anything on this page:" />
    </>
  );
}

/* ---------------------------------------------------------------- refunds -- */

function Refunds({ business }: { business: Business }) {
  return (
    <>
      <h2>Cancelling</h2>
      <p>
        Settings → Billing → Cancel. It takes one click and no conversation. You keep the plan until
        the end of the cycle you have paid for, and then drop to Basic, which is free. Your data stays
        either way — cancelling is not deleting.
      </p>

      <h2>When money comes back</h2>
      <ul className="legal-list">
        <li>
          <b>Within 14 days of your first paid subscription:</b> a full refund, for any reason,
          including no reason. If KSF is not what you expected, that is exactly what this is for.
        </li>
        <li>
          <b>A renewal you did not intend:</b> tell us within 14 days of the charge and it is
          refunded in full, provided the new period has not been substantially used.
        </li>
        <li>
          <b>A charge that is wrong</b> — billed twice, billed after cancelling, billed the wrong
          amount: refunded in full, whenever you notice. Mistakes are not a matter of policy.
        </li>
        <li>
          <b>An outage that made the system unusable:</b> the affected days are credited to your next
          cycle, or refunded if you would rather.
        </li>
      </ul>

      <h2>When it does not</h2>
      <ul className="legal-list">
        <li>
          <b>Part-way through a cycle you have used.</b> Cancel and you keep the rest of the period;
          there is no pro-rata refund for the days you have already had.
        </li>
        <li>
          <b>A yearly plan after the first 14 days.</b> The yearly price is a discount for
          committing to the year. It can be cancelled — it stops renewing — but the year is not
          refunded in parts.
        </li>
        <li>
          <b>A free plan or a trial.</b> There is nothing to refund.
        </li>
      </ul>

      <h2>How a refund is made</h2>
      <p>
        To the method it was paid with, because that is the only way it can be traced: a card refund
        to the same card, a wallet payment back to the same wallet, a bank transfer back to the
        account it came from. We cannot send a refund somewhere else, and anyone asking you to accept
        one somewhere else is not us.
      </p>
      <p>
        Once the refund is sent, how long it takes to appear is the provider's or the bank's, not
        ours — usually a few working days, sometimes longer for a card. The refund is recorded
        against the original payment in your Billing screen the moment it is made, so you can see it
        has happened before the money lands.
      </p>

      <h2>Asking for one</h2>
      <Contact business={business} purpose="Include the invoice or payment reference from Settings → Billing, and say what you would like to happen:" />
    </>
  );
}

/* ---------------------------------------------------------------- support -- */

function Support({ business }: { business: Business }) {
  return (
    <>
      <h2>Two minutes first</h2>
      <p>
        Most of what goes wrong at a counter is one of a handful of things, and the answer is quicker
        than a reply will be:
      </p>
      <ul className="legal-list">
        <li>
          <b>A barcode does not scan.</b> The medicine probably has no barcode saved yet. Medicines →
          find it → paste the digits into the barcode field. Scanning into that field works too.
        </li>
        <li>
          <b>The till says out of stock but it is on the shelf.</b> The batch is expired,
          quarantined, or written off. Look at Expiry Control — expired stock is never sellable, and
          quarantined stock has to be released deliberately.
        </li>
        <li>
          <b>"Another till sold the last of that batch."</b> Somebody on another counter got there a
          moment before you. Nothing was charged. Start the line again.
        </li>
        <li>
          <b>A receipt prints on a huge sheet.</b> The printer driver's paper size is set to A4. Set
          it to 80mm, margins 0, and turn off headers and footers in the browser's print dialog.
        </li>
        <li>
          <b>Nobody can sign in after a power cut.</b> Check the server is running, then run the
          database check. If it reports a problem, restore last night's backup before selling
          anything else.
        </li>
        <li>
          <b>A verification code never arrives.</b> Check spam first. If nothing, the installation's
          mail settings are not finished — that is for whoever set it up, not for you.
        </li>
      </ul>

      <h2>What to include when you do write</h2>
      <p>
        The difference between a reply that helps and four messages of questions:
      </p>
      <ul className="legal-list">
        <li>What you were doing, in the order you did it.</li>
        <li>What you expected, and what happened instead — the exact words on the screen.</li>
        <li>The invoice, batch or reference number, if there is one.</li>
        <li>Which screen, and whether it is one till or all of them.</li>
        <li>A photograph of the screen is worth a paragraph.</li>
      </ul>
      <p>
        <b>Never send a password</b>, and never send a patient's details to demonstrate a problem.
        Nobody supporting this system will ask you for either.
      </p>

      <h2>Something urgent</h2>
      <p>
        If the till cannot sell, say so in the first line. A counter with a queue is a different
        problem from a report that looks wrong, and it gets treated as one.
      </p>
      <p>
        In the meantime: KSF needs no internet to sell, and if the computer itself is down, write the
        sales on paper and enter them afterwards. The procedure, including how to get the figures
        right again, is in the setup notes that came with your installation.
      </p>

      <h2>Where to write</h2>
      <Contact business={business} purpose="Support for this installation:" />

      <h2>Your own copy of everything</h2>
      <p>
        You do not need anybody's help to get your data out. Every list exports to CSV from the
        screen you are on, and the whole database is a file you can copy.
      </p>
      <p className="t-sm t-dim">
        <Download size={14} aria-hidden="true" /> Reports → Export, or the Export button on any list.
      </p>
    </>
  );
}
