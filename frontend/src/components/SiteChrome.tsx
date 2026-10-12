/* ==========================================================================
   The header and footer every public page shares.
   --------------------------------------------------------------------------
   Kept in one place so the navigation, the two calls to action and the legal
   footer cannot drift apart across six pages.

   The primary action is always "Start free trial" and the secondary is
   always "Sign in", in that order, in the same position, on every page.
   ========================================================================== */

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowUp, ArrowUpRight, Menu as MenuIcon, X, Mail, Phone, MapPin } from 'lucide-react';
import { BrandLogo } from './Brand';
import { BRAND } from '../brand';
import { useBusiness, placeOf } from '../services/business';
import { onScrollOffset, useScrolledPast } from '../hooks/useParallax';

const LINKS = [
  { to: '/product', label: 'Product' },
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' }
];

export function SiteHeader() {
  /* Off the top of the page, the bar gets a solid, blurred background so
     what scrolls beneath it never shows through the links. */
  const stuck = useScrolledPast(8);
  const [open, setOpen] = useState(false);
  const location = useLocation();

  /* A menu left open across a navigation would cover the page you asked for. */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  /* Escape closes it, because a menu that traps you on a phone is a menu
     people stop trusting. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={`site-nav ${stuck ? 'is-stuck' : ''} ${open ? 'is-open' : ''}`}>
      <Link to="/" aria-label="KSF, home" className="site-brand">
        <BrandLogo size={34} />
      </Link>

      <nav className="site-nav-links" aria-label="Main">
        {LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
            {link.label}
          </NavLink>
        ))}
      </nav>

      <button
        className="icon-btn site-nav-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close the menu' : 'Open the menu'}
        aria-expanded={open}
      >
        {open ? <X /> : <MenuIcon />}
      </button>

      <div className="site-nav-actions hide-sm">
        <Link to="/login" className="btn btn-ghost btn-pill">Sign in</Link>
        <Link to="/register" className="btn btn-primary btn-pill">
          Start free trial
          <span className="arrow"><ArrowUpRight /></span>
        </Link>
      </div>

      {open && (
        <div className="site-nav-drawer">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to}>{link.label}</NavLink>
          ))}
          <Link to="/login">Sign in</Link>
          <Link to="/register" className="btn btn-primary btn-pill" style={{ marginTop: 8 }}>
            Start free trial
          </Link>
        </div>
      )}
    </header>
  );
}

/**
 * The band above the footer. Every public page ends with the same two
 * choices, so nobody has to scroll back up to find out how to begin.
 */
export function SiteCta({
  title = 'Bring your pharmacy onto KSF',
  body = 'Fifteen days of the full system on a referral, or start free on Basic and stay there as long as you like. Your data is yours either way.',
  primary = 'Start free trial',
  secondary = 'Sign in'
}: {
  title?: string; body?: string; primary?: string; secondary?: string;
}) {
  return (
    <section className="site-cta" data-reveal>
      <div className="site-cta-inner">
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="site-cta-actions">
          <Link to="/register" className="btn btn-primary btn-lg btn-pill">
            {primary}
            <span className="arrow"><ArrowUpRight /></span>
          </Link>
          <Link to="/login" className="btn btn-secondary btn-lg btn-pill">{secondary}</Link>
        </div>
        <p className="site-cta-note">
          No card needed to start. Basic is free for as long as you want it.
        </p>
      </div>
    </section>
  );
}

export function SiteFooter() {
  const business = useBusiness();

  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <BrandLogo size={32} />
          {business.edition === 'university' && <span className="edition-tag">University project edition</span>}
          <p>
            Pharmacy management built for Pakistan — in rupees, on the devices you already own,
            with your records staying yours.
          </p>
          {/* Each line appears only when the deployment has configured it. An
              address nobody is at, or a number nobody answers, is worse than
              no line at all. */}
          <ul className="site-footer-contact">
            {placeOf(business) && (
              <li><MapPin size={14} aria-hidden="true" /> {placeOf(business)}</li>
            )}
            {business.salesEmail && (
              <li>
                <Mail size={14} aria-hidden="true" />
                <a href={`mailto:${business.salesEmail}`}>{business.salesEmail}</a>
              </li>
            )}
            {business.phone && (
              <li>
                <Phone size={14} aria-hidden="true" />
                <a href={`tel:${business.phone.replace(/[^\d+]/g, '')}`}>{business.phone}</a>
              </li>
            )}
          </ul>
        </div>

        <div className="site-footer-col">
          <h3>Product</h3>
          <Link to="/product">Overview</Link>
          <Link to="/features">Features</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/subscription">Plans in detail</Link>
        </div>

        <div className="site-footer-col">
          <h3>Getting started</h3>
          <Link to="/register">Create an account</Link>
          <Link to="/login">Sign in</Link>
          <Link to="/features#migration">Bring your data across</Link>
          <Link to="/pricing#referral">Referral programme</Link>
        </div>

        <div className="site-footer-col">
          <h3>Company</h3>
          <Link to="/about">About KSF</Link>
          <Link to="/about#security">How it is secured</Link>
          <Link to="/support">Support</Link>
          <Link to="/pricing#faq">Questions</Link>
        </div>

        <div className="site-footer-col">
          <h3>Legal</h3>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms of service</Link>
          <Link to="/refunds">Refunds and cancellation</Link>
          <Link to="/privacy#cookies">Cookies</Link>
        </div>
      </div>

      <div className="site-footer-base">
        <span>© {new Date().getFullYear()} {business.legalName || BRAND.fullName}. Version {BRAND.version}.</span>
        {/* Where it is made is a fact about the business, not about the
            software. Without a configured city it says only what the product
            itself demonstrably is. */}
        <span>
          {business.city
            ? `Made in ${business.city} for pharmacies across Pakistan.`
            : 'Built for pharmacies across Pakistan.'}
        </span>
      </div>
      <BackToTop />
    </footer>
  );
}

/**
 * Back to the top, once the page is long enough to need it. The ring around
 * the arrow fills as the page is read; the scroll back is smooth unless the
 * visitor has asked for less motion.
 */
export function BackToTop() {
  const shown = useScrolledPast(480);
  const ring = useRef<HTMLButtonElement>(null);

  /* Progress is written straight to a CSS variable on every change, so the
     ring moves with the page without re-rendering anything. */
  useEffect(() => onScrollOffset((offset) => {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    ring.current?.style.setProperty('--progress', String(room > 0 ? Math.min(1, offset / room) : 0));
  }), []);

  const toTop = () => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    document.getElementById('main')?.focus({ preventScroll: true });
  };

  return (
    <button
      ref={ring} type="button" className={`back-to-top ${shown ? 'is-shown' : ''}`} onClick={toTop}
      aria-label="Back to the top" tabIndex={shown ? 0 : -1} aria-hidden={!shown}
    >
      <span><ArrowUp size={20} strokeWidth={2.4} /></span>
    </button>
  );
}

/** The shell each marketing page wraps itself in. */
export function SitePage({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`site ${className}`}>
      <SiteHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  );
}
