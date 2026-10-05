/* ==========================================================================
   Creating an account — two steps.
   --------------------------------------------------------------------------
   This asks for four things — your name, your e-mail, a password — and then
   the six digits that prove the address is yours. The account exists the
   moment the code is accepted, and everything else is asked for afterwards by
   the setup checklist at /setup, where it can be skipped and returned to.

   The password is hashed on the server the moment it is
   chosen and the draft never holds it, and closing this tab half way through
   costs nothing — /register/state re-opens it at the step you reached.
   ========================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Gift, Mail, RefreshCw, UserPlus } from 'lucide-react';
import {
  AuthScreen, AuthCard, AuthBack, TrustRow, ThemeToggle
} from '../../components/auth-ui';
import type { AuthPoint } from '../../components/auth-ui';
import { PasswordField, OtpInput, StatusNote, Stepper } from '../../components/account-ui';
import { Button, TextInput, Alert, PageLoader } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { api, ApiError } from '../../services/api';
import { useViewMode } from '../../hooks/useParallax';
import { BRAND } from '../../brand';
import type { RegistrationState, ReferralCheck } from '../../types';

const POINTS: AuthPoint[] = [
  {
    icon: <UserPlus />,
    title: 'Four fields, then you are in',
    body: 'Your name, an e-mail address and a password. The pharmacy details can wait until you are inside.'
  },
  {
    icon: <Mail />,
    title: 'One code, once',
    body: 'A six-digit code proves the address is yours. It expires in ten minutes and cannot be reused.'
  },
  {
    icon: <Gift />,
    title: 'Nothing to pay, ever, on Basic',
    body: 'No card is asked for. Basic is a permanent free plan, not a trial with a clock on it.'
  }
];

/* "e‑mail" and "Six‑digit" use a non-breaking hyphen (U+2011), so a narrow
   screen wraps between words rather than inside them. */
const STEPS = [
  { key: 'details', label: 'Your details', hint: 'Name, e‑mail, password' },
  { key: 'verify', label: 'Confirm e‑mail', hint: 'Six‑digit code' },
  { key: 'done', label: 'Ready', hint: 'Open your pharmacy' }
];

interface Created {
  pharmacyName: string;
  subscriptionId: string;
  planName: string;
  trial: { daysLeft: number; expiresAt: string } | null;
}

export default function Register() {
  useViewMode('site');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { adoptSession, ok, fail } = useApp();
  const [session, setSession] = useState<Parameters<typeof adoptSession>[0] | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'details' | 'verify' | 'done'>('details');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<RegistrationState | null>(null);

  const [you, setYou] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  /* Only sent while the server runs with SHOW_SIGNUP_CODE for testing. */
  const [testCode, setTestCode] = useState<string | null>(null);
  const [referral, setReferral] = useState<ReferralCheck | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const referralCode = params.get('ref') ?? '';

  /* ------------------------------------------------------------ resume -- */
  useEffect(() => {
    let live = true;
    api.get<{ data: RegistrationState }>('/register/state')
      .then((reply) => {
        if (!live) return;
        setDraft(reply.data);
        if (reply.data.started && !reply.data.emailVerified) {
          setYou((current) => ({
            ...current,
            firstName: reply.data.firstName ?? '',
            lastName: reply.data.lastName ?? ''
          }));
          setStep('verify');
        }
      })
      .catch((problem) => { if (live) fail(problem, 'The sign-up page could not be prepared.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [fail]);

  /* A referral link should say who referred you before you type anything. */
  useEffect(() => {
    if (!referralCode) return;
    let live = true;
    api.get<ReferralCheck>(`/public/referral/${encodeURIComponent(referralCode)}`)
      .then((reply) => { if (live) setReferral(reply); })
      .catch(() => { if (live) setReferral({ valid: false, reason: 'That referral code could not be checked.' }); });
    return () => { live = false; };
  }, [referralCode]);

  const send = useCallback(async <T,>(path: string, body: unknown): Promise<T | null> => {
    setBusy(true);
    setErrors({});
    setNotice(null);
    try {
      return await api.post<T>(path, body);
    } catch (problem) {
      if (problem instanceof ApiError) {
        if (problem.field) setErrors({ [problem.field]: problem.message });
        else setNotice(problem.message);
      } else {
        fail(problem);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [fail]);

  /* ------------------------------------------------------------- steps -- */

  const startSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (you.password !== confirm) {
      setErrors({ confirm: 'The two passwords do not match.' });
      return;
    }
    const reply = await send<{ data: { email: string; testCode?: string } }>('/register/start', {
      ...you,
      referralCode: referral?.valid ? referral.code : undefined
    });
    if (!reply) return;
    setTestCode(reply.data.testCode ?? null);
    setNotice(`We have sent a six-digit code to ${reply.data.email}. It expires in ten minutes.`);
    setStep('verify');
    void api.get<{ data: RegistrationState }>('/register/state').then((r) => setDraft(r.data));
  };

  const verify = async (value: string) => {
    const reply = await send<{ data: Created } & Parameters<typeof adoptSession>[0]>('/register/verify-email', { code: value });
    if (!reply) { setCode(''); return; }
    setCreated(reply.data);
    setSession({ user: reply.user, accessToken: reply.accessToken, subscription: reply.subscription });
    setStep('done');
    ok('Your account is ready');
  };

  const resend = async () => {
    const reply = await send<{ message?: string; testCode?: string }>('/register/resend', {});
    if (!reply) return;
    setCode('');
    setTestCode(reply.testCode ?? null);
    setNotice(reply.message ?? 'A new code is on its way.');
  };

  /* The account was signed in the moment the code was accepted; this hands
     the session to the app and opens the setup checklist. */
  const enterWorkspace = async () => {
    if (session) await adoptSession(session);
    navigate('/setup', { replace: true });
  };

  /* ------------------------------------------------------------ render -- */

  if (loading) return <PageLoader message="Preparing your sign-up…" />;

  return (
    <AuthScreen
      points={POINTS}
      headline={<>Start running your pharmacy on {BRAND.name}</>}
      lede="Creating an account takes about a minute. The pharmacy's details, your staff and your stock can all be added afterwards."
    >
      <div className="auth-top-row">
        <AuthBack />
        <ThemeToggle />
      </div>

      {/* Two steps is few enough that a stepper could be decoration. It is
          here because the second one is a code from an e-mail: people need to
          know before they start that they will have to go and fetch it. */}
      <Stepper steps={STEPS} current={STEPS.findIndex((entry) => entry.key === step)} />

      {referral?.valid && step !== 'done' && (
        <StatusNote tone="ok" icon={<Gift size={17} />} title={`${referral.pharmacyName} referred you`}>
          You will get {referral.trialDays} days of the full premium feature set, free, starting
          the moment you confirm your e-mail address. No card is needed and nothing is charged
          when it ends.
        </StatusNote>
      )}
      {referral && !referral.valid && step === 'details' && (
        <StatusNote tone="warn" title="That referral code did not work">
          {referral.reason} You can still create your account — it will start on the free Basic
          plan.
        </StatusNote>
      )}

      {notice && <Alert tone="info">{notice}</Alert>}

      {/* ------------------------------ details ------------------------- */}
      {step === 'details' && (
        <>
          <AuthCard
            title="Create your account"
            subtitle="Four things now. Everything about the pharmacy itself comes later, inside the application."
          >
            <form className="auth-form" onSubmit={startSignUp} noValidate>
              <div className="grid-2">
                <TextInput
                  label="First name" required autoFocus autoComplete="given-name"
                  value={you.firstName} error={errors.firstName}
                  onChange={(e) => setYou({ ...you, firstName: e.target.value })}
                />
                <TextInput
                  label="Last name" required autoComplete="family-name"
                  value={you.lastName} error={errors.lastName}
                  onChange={(e) => setYou({ ...you, lastName: e.target.value })}
                />
              </div>

              <TextInput
                label="E-mail address" type="email" required autoComplete="email"
                placeholder="you@yourpharmacy.pk"
                hint="This is how you will sign in, and where security notices go."
                value={you.email} error={errors.email}
                onChange={(e) => setYou({ ...you, email: e.target.value })}
              />

              <PasswordField
                label="Password" required autoComplete="new-password"
                value={you.password} error={errors.password}
                onChange={(value) => setYou({ ...you, password: value })}
              />
              <PasswordField
                label="Type it again" required showRules={false} autoComplete="new-password"
                value={confirm} error={errors.confirm}
                onChange={setConfirm}
              />

              <Button
                type="submit" variant="primary" size="lg" block loading={busy}
                iconRight={<ArrowRight size={16} />}
                disabled={!you.firstName || !you.lastName || !you.email || !you.password || !confirm}
              >
                Create my account
              </Button>
            </form>

            <TrustRow />
          </AuthCard>

          <p className="auth-alt">
            Already have an account? <Link to="/login">Sign in instead</Link>
          </p>
          <p className="auth-legal">
            By creating an account you agree that this pharmacy's records are stored on this
            installation, that you can export or delete them at any time, and that sensitive
            actions are written to an audit trail.
          </p>
        </>
      )}

      {/* ------------------------------ verify -------------------------- */}
      {step === 'verify' && (
        <AuthCard
          icon={<Mail size={22} />}
          title="Check your e-mail"
          subtitle={<>We sent a six-digit code to <strong>{draft?.email ?? 'your address'}</strong>. It expires in ten minutes and can only be used once.</>}
        >
          <OtpInput
            value={code}
            onChange={setCode}
            error={errors.code}
            disabled={busy}
            onComplete={(value) => { void verify(value); }}
          />

          <Button
            variant="primary" size="lg" block loading={busy} disabled={code.length !== 6}
            onClick={() => { void verify(code); }}
          >
            Confirm and open my account
          </Button>

          {testCode && (
            <StatusNote tone="warn" title="Testing mode: your code is">
              <strong className="signup-test-code">{testCode}</strong>
              Type it in above. The e-mail address is not checked while the server shows codes on screen.
            </StatusNote>
          )}

          <Button variant="ghost" block onClick={() => { void resend(); }} disabled={busy} icon={<RefreshCw size={15} />}>
            Send the code again
          </Button>

          {draft?.pending && (
            <p className="auth-alt">{draft.pending.attemptsLeft} attempt(s) left on this code.</p>
          )}
          <p className="auth-alt">
            Wrong address?{' '}
            <button type="button" className="link-button" onClick={() => { setStep('details'); setCode(''); setTestCode(null); }}>
              Go back and change it
            </button>
          </p>
        </AuthCard>
      )}

      {/* ------------------------------- done --------------------------- */}
      {step === 'done' && created && (
        <AuthCard
          icon={<Gift size={22} />}
          iconTone="ok"
          title="Your account is ready"
          subtitle={<>You are signed in already. Your subscription reference is <code>{created.subscriptionId}</code> — quote it if you ever telephone about a payment.</>}
        >
          {created.trial && (
            <StatusNote tone="ok" icon={<Gift size={17} />} title="Your premium trial is running">
              {created.trial.daysLeft} days of the full feature set, until{' '}
              {new Date(created.trial.expiresAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })}.
              When it ends the pharmacy moves to the free Basic plan and every record stays
              exactly where it is.
            </StatusNote>
          )}

          <p className="auth-note">
            Your pharmacy is called <strong>{created.pharmacyName}</strong> for now, on the{' '}
            {created.planName} plan. The next screen asks for its real name, where it is, and
            your licence details — none of which you have to finish today.
          </p>

          <Button variant="primary" size="lg" block onClick={() => { void enterWorkspace(); }} iconRight={<ArrowRight size={16} />}>
            Finish setting up
          </Button>
        </AuthCard>
      )}
    </AuthScreen>
  );
}
