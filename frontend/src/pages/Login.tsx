/* ==========================================================================
   Sign in.
   --------------------------------------------------------------------------
   Everything visual comes from auth.css and the shared pieces in
   auth-ui.tsx. The same screen signs in the platform Super Admin and every
   pharmacy's people; where they land afterwards is decided by the account.

   Signing in can end in three places, and this screen handles all three
   without ever becoming a dead end:

     straight in      the ordinary case
     two-factor       the password was right; now the six digits
     device limit     the password was right, and this machine would be one
                      device too many. Rather than a refusal, the screen lists
                      the registered devices and offers to remove one — asking
                      for the password again, because removing a device is
                      itself a security action.

   "Continue as ..." is the remembered address on this machine, not a
   remembered session. The password is always required. A saved session that
   is still valid never reaches this screen at all: App.tsx sends it to the
   workspace.
   ========================================================================== */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ShieldCheck, Boxes, CalendarClock, Receipt, Mail, Smartphone,
  Monitor, KeyRound, Trash2, ArrowRight
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Button, TextInput, Checkbox, Alert } from '../components/ui';
import { PasswordField, OtpInput, StatusNote } from '../components/account-ui';
import {
  AuthScreen, AuthCard, AuthBack, TrustRow, KnownUser, ThemeToggle
} from '../components/auth-ui';
import type { AuthPoint } from '../components/auth-ui';
import { api, ApiError } from '../services/api';
import { BRAND } from '../brand';
import { ago } from '../utils/format';
import type { Device } from '../types';

const REMEMBERED = 'ksf-last-email';

const POINTS: AuthPoint[] = [
  {
    icon: <Receipt />,
    title: 'A till built for a busy counter',
    body: 'Scan or search, take payment by cash, card, Easypaisa or JazzCash, and print the receipt.'
  },
  {
    icon: <Boxes />,
    title: 'Batch-level stock control',
    body: 'Every pack is tracked to its batch, so what you sell is what is actually on the shelf.'
  },
  {
    icon: <CalendarClock />,
    title: 'Expiry handled before it costs you',
    body: 'Near-expiry stock is flagged early and expired batches are blocked from sale automatically.'
  },
  {
    icon: <ShieldCheck />,
    title: 'Roles you decide',
    body: 'Admin, pharmacist, manager, cashier — or build your own by ticking exactly what it can do.'
  }
];

type Stage =
  | { name: 'credentials' }
  | { name: 'two-factor'; challenge: string; message: string }
  | { name: 'device-limit'; limit: number; category: string; devices: Device[]; ticket: string; message: string };

export default function Login() {
  const { signIn, completeTwoFactor, ok, endedBecause } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState('');
  const [remembered, setRemembered] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [stage, setStage] = useState<Stage>({ name: 'credentials' });

  /* two-factor */
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');

  /* device limit */
  const [releasing, setReleasing] = useState<string | null>(null);
  const [releasePassword, setReleasePassword] = useState('');
  const [released, setReleased] = useState<string | null>(null);

  /* Why you were sent here, if you did not arrive on purpose. */
  const reason = params.get('reason');

  /* A shared counter machine usually has one or two regular users. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBERED);
      if (saved) { setEmail(saved); setRemembered(saved); }
    } catch {
      /* Storage blocked. The form still works; it just starts empty. */
    }
  }, []);

  const rememberEmail = (value: string) => {
    try {
      if (remember) localStorage.setItem(REMEMBERED, value);
      else localStorage.removeItem(REMEMBERED);
    } catch { /* nothing to do; it simply will not be remembered */ }
  };

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setErrorCode(undefined);

    if (!email.trim() || !password) {
      setError('Please enter your email address and password.');
      return;
    }

    setBusy(true);
    try {
      const outcome = await signIn(email.trim(), password);

      if (outcome.kind === 'two-factor') {
        setStage({ name: 'two-factor', challenge: outcome.challenge, message: outcome.message });
        return;
      }
      if (outcome.kind === 'device-limit') {
        setStage({
          name: 'device-limit',
          limit: outcome.limit,
          category: outcome.category,
          devices: outcome.devices,
          ticket: outcome.releaseTicket,
          message: outcome.message
        });
        return;
      }

      rememberEmail(email.trim());
      ok('Welcome back');
      navigate('/', { replace: true });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Those sign-in details are not correct.');
      setErrorCode(problem instanceof ApiError ? problem.code : undefined);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const submitSecondFactor = async (value?: string) => {
    if (stage.name !== 'two-factor') return;
    setBusy(true);
    setError('');
    try {
      await completeTwoFactor(stage.challenge, value ?? code, useRecovery ? recoveryCode : undefined);
      rememberEmail(email.trim());
      ok('Welcome back');
      navigate('/', { replace: true });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That code was not accepted.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const releaseDevice = async (deviceId: string) => {
    if (stage.name !== 'device-limit') return;
    setBusy(true);
    setError('');
    try {
      const reply = await api.post<{ message: string }>('/auth/device-release', {
        ticket: stage.ticket, deviceId, password: releasePassword
      });
      setReleased(reply.message);
      setStage({ ...stage, devices: stage.devices.filter((device) => device.id !== deviceId) });
      setReleasing(null);
      setReleasePassword('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That device could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStage({ name: 'credentials' });
    setError('');
    setCode('');
    setReleased(null);
    setPassword('');
  };

  const forget = () => {
    setRemembered('');
    setEmail('');
    setRemember(false);
    try { localStorage.removeItem(REMEMBERED); } catch { /* already gone */ }
  };

  return (
    <AuthScreen
      points={POINTS}
      headline={<>Pharmacy management,<br />built for Pakistan</>}
      lede="The till, the shelf, the expiry dates and the day's numbers — in one place, in rupees, on the devices you already own."
    >
      <div className="auth-top-row">
        <AuthBack />
        <ThemeToggle />
      </div>

      {/* ------------------------ why you are here ------------------------ */}
      {endedBecause && !reason && stage.name === 'credentials' && (
        <StatusNote tone={/suspended/i.test(endedBecause) ? 'warn' : 'info'} title={/suspended/i.test(endedBecause) ? 'Access is paused' : 'Your session ended'}>
          {endedBecause}
        </StatusNote>
      )}
      {reason === 'expired' && stage.name === 'credentials' && (
        <StatusNote tone="info" title="Your session ended">
          You were signed out after a period without activity. That is deliberate — an
          unattended till should not stay open. Sign in again to carry on.
        </StatusNote>
      )}
      {reason === 'locked' && stage.name === 'credentials' && (
        <StatusNote tone="warn" title="That account is temporarily locked">
          Too many incorrect passwords were tried. The lock lifts by itself after a short
          wait; if it was not you, change the password once you are back in.
        </StatusNote>
      )}

      {/* ---------------------------- credentials ------------------------- */}
      {stage.name === 'credentials' && (
        <>
          <AuthCard
            title="Sign in"
            subtitle={`Use the e-mail address your ${BRAND.name} account was set up with.`}
            error={error}
          >
            {errorCode === 'account_locked' && (
              <StatusNote tone="warn" title="What to do now">
                Wait for the lock to lift, or ask your pharmacy Admin to reset your password
                from Settings, Staff.
              </StatusNote>
            )}

            {remembered && remembered === email && (
              <KnownUser email={remembered} onForget={forget} />
            )}

            <form className="auth-form" onSubmit={submitCredentials} noValidate>
              {!(remembered && remembered === email) && (
                <TextInput
                  label="E-mail address"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  placeholder="you@yourpharmacy.pk"
                  icon={<Mail size={16} className="input-icon" aria-hidden="true" />}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}

              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                autoFocus={!!remembered && remembered === email}
                showRules={false}
                required
              />

              <div className="auth-row">
                <Checkbox label="Remember this address" checked={remember} onChange={setRemember} />
                <Link to="/forgot-password" className="auth-link">Forgotten your password?</Link>
              </div>

              <Button type="submit" variant="primary" size="lg" loading={busy} block>
                Sign in
              </Button>
            </form>

            <TrustRow />
          </AuthCard>

          <p className="auth-alt">
            New to {BRAND.name}? <Link to="/register">Create your pharmacy account</Link>
          </p>


          <p className="auth-legal">
            By signing in you agree that this pharmacy's records are stored on this
            installation, and that sensitive actions are written to an audit trail.
          </p>
        </>
      )}

      {/* ----------------------------- two-factor ------------------------- */}
      {stage.name === 'two-factor' && (
        <AuthCard
          icon={<KeyRound size={22} />}
          title="One more step"
          subtitle={stage.message || 'Enter the six-digit code from your authenticator app.'}
          error={error}
        >
          {!useRecovery ? (
            <>
              <OtpInput
                value={code}
                onChange={setCode}
                disabled={busy}
                onComplete={(value) => { void submitSecondFactor(value); }}
              />
              <Button
                variant="primary" size="lg" block loading={busy}
                disabled={code.length !== 6}
                onClick={() => { void submitSecondFactor(); }}
              >
                Verify and sign in
              </Button>
              <p className="auth-alt">
                Lost your phone?{' '}
                <button type="button" className="link-button" onClick={() => setUseRecovery(true)}>
                  Use a recovery code
                </button>
              </p>
            </>
          ) : (
            <>
              <TextInput
                label="Recovery code"
                placeholder="XXXXX-XXXXX"
                autoFocus
                hint="One of the ten codes you saved when two-factor was switched on. Each works once."
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
              />
              <Button
                variant="primary" size="lg" block loading={busy}
                disabled={recoveryCode.trim().length < 8}
                onClick={() => { void submitSecondFactor(); }}
              >
                Use this code
              </Button>
              <p className="auth-alt">
                <button type="button" className="link-button" onClick={() => setUseRecovery(false)}>
                  Back to the authenticator app
                </button>
              </p>
            </>
          )}

          <p className="auth-alt">
            <button type="button" className="link-button" onClick={restart}>Start again</button>
          </p>
        </AuthCard>
      )}

      {/* ---------------------------- device limit ------------------------ */}
      {stage.name === 'device-limit' && (
        <AuthCard
          icon={stage.category === 'desktop' ? <Monitor size={22} /> : <Smartphone size={22} />}
          iconTone="warn"
          title="This machine is not registered"
          subtitle={stage.message}
          error={error}
        >
          <StatusNote tone="info" title="Why this happens">
            {BRAND.name} only allows sign-in from machines you have registered, which is what
            stops a password being passed around. Your password was correct — there is simply
            no allowance left. Remove a device you no longer use and sign in again.
          </StatusNote>

          {released && <Alert tone="ok" title="Device removed">{released}</Alert>}

          <ul className="device-list">
            {stage.devices.map((device) => (
              <li key={device.id} className="device-row">
                <span className="device-icon" aria-hidden="true">
                  {device.category === 'desktop' ? <Monitor size={18} /> : <Smartphone size={18} />}
                </span>
                <div className="device-detail">
                  <strong>{device.label}</strong>
                  <span>
                    Registered {ago(device.registeredAt)} · last used {ago(device.lastActiveAt)} · {device.lastSeenFrom}
                  </span>
                </div>

                {releasing === device.id ? (
                  <div className="device-confirm">
                    <PasswordField
                      label="Confirm your password"
                      value={releasePassword}
                      onChange={setReleasePassword}
                      showRules={false}
                      autoComplete="current-password"
                    />
                    <div className="device-confirm-actions">
                      <Button variant="ghost" onClick={() => { setReleasing(null); setReleasePassword(''); }}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger" loading={busy} disabled={!releasePassword}
                        onClick={() => { void releaseDevice(device.id); }}
                      >
                        Remove this device
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setReleasing(device.id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {released && (
            <Button variant="primary" size="lg" block onClick={restart} iconRight={<ArrowRight size={16} />}>
              Sign in on this machine
            </Button>
          )}

          <p className="auth-alt">
            <button type="button" className="link-button" onClick={restart}>Back to sign in</button>
          </p>
        </AuthCard>
      )}
    </AuthScreen>
  );
}
