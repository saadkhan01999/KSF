/* ==========================================================================
   The pieces every screen outside the workspace is built from: sign in,
   forgotten password, reset, verify.
   --------------------------------------------------------------------------
   They live here rather than inside Login.tsx because five screens share
   them, and because a shared component is the only way the sign-in card and
   the password-reset card can be guaranteed to look like the same product.
   ========================================================================== */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Lock, Moon, ShieldCheck, Sun, UserCheck } from 'lucide-react';
import { BrandLogo } from './Brand';
import { BRAND } from '../brand';
import { useApp } from '../context/AppContext';
import { useBusiness, placeOf } from '../services/business';
import { initials } from '../utils/format';

/* --------------------------------------------------------------- shell -- */

export interface AuthPoint {
  icon: ReactNode;
  title: string;
  body: string;
}

/**
 * The split screen: what the product is on the left, the form on the right.
 *
 * `single` drops the brand panel, for the screens that are a single step in a
 * flow the person is already in the middle of — resetting a password is not
 * the moment to sell them the product.
 */
export function AuthScreen({
  points,
  headline,
  lede,
  single = false,
  children
}: {
  points?: AuthPoint[];
  headline?: ReactNode;
  lede?: ReactNode;
  single?: boolean;
  children: ReactNode;
}) {
  /* "Karachi, Pakistan" under the brand panel — but only when a deployment
     has actually said so. Nothing on this screen is invented. */
  const place = placeOf(useBusiness());

  return (
    <div className={`auth ${single ? 'is-single' : ''}`}>
      {!single && (
        <aside className="auth-brand">
          <div className="auth-brand-top">
            <Link to="/" aria-label={`${BRAND.name}, home`}>
              <BrandLogo size={42} tone="invert" showStrapline />
            </Link>
            <ThemeToggle />
          </div>

          <div className="auth-brand-body">
            <h1>{headline}</h1>
            {lede && <p>{lede}</p>}

            {points && points.length > 0 && (
              <ul className="auth-points">
                {points.map((point) => (
                  <li key={point.title}>
                    <span aria-hidden="true">{point.icon}</span>
                    <div>
                      <strong>{point.title}</strong>
                      <span>{point.body}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="auth-brand-foot">
            <span>{BRAND.name} {BRAND.version}</span>
            {place && (
              <>
                <span aria-hidden="true">·</span>
                <span>{place}</span>
              </>
            )}
          </p>
        </aside>
      )}

      <main className="auth-main" id="main">
        <div className="auth-main-inner">{children}</div>
      </main>
    </div>
  );
}

/** Light / dark, on a screen that has no sidebar to put it in. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useApp();
  /* Derived from the preference rather than read off <html>, which is only
     written after the render that changed it and would leave the icon one
     click behind. */
  const dark = theme === 'dark'
    || (theme === 'system'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      type="button"
      className={`icon-btn auth-theme ${className}`}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Use the light theme' : 'Use the dark theme'}
      title={theme === 'system' ? 'Following your device' : undefined}
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

/* ---------------------------------------------------------------- card -- */

export function AuthCard({
  icon,
  iconTone,
  title,
  subtitle,
  error,
  children
}: {
  icon?: ReactNode;
  iconTone?: 'warn' | 'ok';
  title: ReactNode;
  subtitle?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <section className="auth-card">
      <header className="auth-head">
        {icon && (
          <span className={`auth-icon ${iconTone ? `is-${iconTone}` : ''}`} aria-hidden="true">
            {icon}
          </span>
        )}
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>

      {error && <AuthError>{error}</AuthError>}

      {children}
    </section>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div className="auth-error" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function AuthBack({ to = '/', children = 'Back to the website' }: { to?: string; children?: ReactNode }) {
  return (
    <Link to={to} className="auth-back">
      <ArrowLeft size={15} aria-hidden="true" /> {children}
    </Link>
  );
}

/* --------------------------------------------------------------- trust -- */

/**
 * Three claims under the sign-in button.
 *
 * Each one is true of this build and can be checked: the session cookie is
 * HttpOnly and SameSite so no script can read it, every workspace endpoint
 * re-checks the role on the server, and the deployment terminates TLS at
 * Nginx. They are not decoration — if any of them stopped being true, the
 * line would have to come off this card.
 */
export function TrustRow() {
  return (
    <div className="auth-trust">
      <span><Lock aria-hidden="true" /> Encrypted connection</span>
      <span><ShieldCheck aria-hidden="true" /> Session cookie unreadable by scripts</span>
      <span><UserCheck aria-hidden="true" /> Access checked on the server</span>
    </div>
  );
}

/* ------------------------------------------------------ returning user -- */

/** Somebody who has signed in on this machine before. The password is still
    required — this saves typing an address, and nothing else. */
export function KnownUser({ email, name, onForget }: { email: string; name?: string; onForget: () => void }) {
  return (
    <div className="auth-known">
      <span className="avatar" aria-hidden="true">{initials(name || email)}</span>
      <span className="auth-known-meta">
        <strong>{name || 'Welcome back'}</strong>
        <span>{email}</span>
      </span>
      <button type="button" className="link-button" onClick={onForget}>Not you?</button>
    </div>
  );
}
