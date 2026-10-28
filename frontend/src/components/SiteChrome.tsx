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
import { onScrollOffset, useReveal, useScrolledPast } from '../hooks/useParallax';
import { glideTo } from '../utils/glide';

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
        <BrandLogo size={42} />
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
          <BrandLogo size={48} showStrapline />
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
      <SiteScrollbar />
      <SiteMotion />
    </footer>
  );
}

/** Every public page: its sections fade up as they scroll into view, and the
    cards inside them follow one after another (base.css). Sections that
    render later — plans fetched from the server — are picked up as they come. */
function SiteMotion() {
  const { pathname } = useLocation();
  useReveal([pathname]);
  return null;
}

/**
 * The website's scrollbar: a green pill on the right edge that the hand can
 * hold — the pointer turns to a grabbing hand over it, the page follows the
 * drag, and a click on the rail above or below it glides a screen at a time.
 * A browser's own scrollbar cannot change the pointer, so on a mouse or
 * trackpad this replaces it (the page still scrolls with the wheel, the keys
 * and the touchpad exactly as before). On a touch screen the browser's own
 * overlay is better, and stays.
 */
export function SiteScrollbar() {
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const [fine] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches);

  useEffect(() => {
    if (!fine) return undefined;
    const root = document.documentElement;
    root.classList.add('has-site-scroll');
    let frame = 0;
    let idle = 0;
    const place = () => {
      frame = 0;
      const bar = rail.current;
      const pill = thumb.current;
      if (!bar || !pill) return;
      const view = window.innerHeight;
      const room = root.scrollHeight - view;
      bar.classList.toggle('is-needless', room <= 1);
      if (room <= 1) return;
      const height = Math.max(56, (view * view) / root.scrollHeight);
      pill.style.height = `${height}px`;
      pill.style.transform = `translateY(${(window.scrollY / room) * (view - height)}px)`;
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(place); };
    const onScroll = () => {
      schedule();
      rail.current?.classList.add('is-moving');
      window.clearTimeout(idle);
      idle = window.setTimeout(() => rail.current?.classList.remove('is-moving'), 900);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule);
    const grows = new ResizeObserver(schedule);
    grows.observe(document.body);
    schedule();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      grows.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
      root.classList.remove('has-site-scroll', 'is-dragging-scroll');
    };
  }, [fine]);

  if (!fine) return null;

  /* Hold and drag: the page follows the pill, one to one. */
  const grab = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pill = event.currentTarget;
    const root = document.documentElement;
    const startY = event.clientY;
    const startTop = window.scrollY;
    const room = root.scrollHeight - window.innerHeight;
    const travel = Math.max(1, window.innerHeight - pill.offsetHeight);
    pill.setPointerCapture(event.pointerId);
    root.classList.add('is-dragging-scroll');
    const move = (next: PointerEvent) => window.scrollTo(0, startTop + ((next.clientY - startY) * room) / travel);
    const release = () => {
      root.classList.remove('is-dragging-scroll');
      pill.removeEventListener('pointermove', move);
      pill.removeEventListener('pointerup', release);
      pill.removeEventListener('pointercancel', release);
    };
    pill.addEventListener('pointermove', move);
    pill.addEventListener('pointerup', release);
    pill.addEventListener('pointercancel', release);
  };

  /* A click on the rail: a screen up or down, gliding. */
  const page = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !thumb.current) return;
    const pill = thumb.current.getBoundingClientRect();
    const down = event.clientY > pill.bottom;
    glideTo(window.scrollY + (down ? 1 : -1) * window.innerHeight * 0.9);
  };

  return (
    <div ref={rail} className="site-scroll" aria-hidden="true" onClick={page}>
      <div ref={thumb} className="site-scroll-thumb" onPointerDown={grab} />
    </div>
  );
}

/**
 * Back to the top, once the page is long enough to need it. The ring around
 * the arrow fills as the page is read; the way back is a slow, eased glide
 * unless the visitor has asked for less motion.
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

  /* A calm glide to the top, over about a second (utils/glide.ts). */
  const toTop = () => {
    glideTo(0);
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
