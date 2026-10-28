/* ==========================================================================
   Forgotten password, and setting a new one.
   --------------------------------------------------------------------------
   Both halves live here because they are one journey: ask for a code, then
   use it. The screen moves from one to the other without a navigation, so a
   code that is already on screen is not lost.

   The answer to "does this address have an account?" is the same either way,
   deliberately. Telling somebody an address is unknown turns this page into
   a way of finding out who is a customer.
   ========================================================================== */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Mail, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../../components/Brand';
import { AuthScreen, AuthCard, AuthBack, ThemeToggle } from '../../components/auth-ui';
import { Button, TextInput, Alert } from '../../components/ui';
import { PasswordField, OtpInput, StatusNote } from '../../components/account-ui';
import { useApp } from '../../context/AppContext';
import { api, ApiError } from '../../services/api';
import { useViewMode } from '../../hooks/useParallax';

type Stage = 'ask' | 'reset' | 'done';

export default function ForgotPassword() {
  useViewMode('site');
  const navigate = useNavigate();
  const { ok } = useApp();

  const [stage, setStage] = useState<Stage>('ask');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const request = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const reply = await api.post<{ message: string }>('/auth/forgot-password', { email: email.trim() });
      setNotice(reply.message);
      setStage('reset');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setFieldError({});

    if (password !== confirm) {
      setFieldError({ confirm: 'The two passwords do not match.' });
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/reset-password', { email: email.trim(), code, password });
      setStage('done');
      ok('Your password has been changed');
    } catch (problem) {
      if (problem instanceof ApiError && problem.field) setFieldError({ [problem.field]: problem.message });
      else setError(problem instanceof Error ? problem.message : 'That could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen single>
      <div className="auth-top-row">
        <AuthBack to="/login">Back to sign in</AuthBack>
        <ThemeToggle />
      </div>

      <div className="auth-mark"><BrandLogo size={72} stacked showStrapline /></div>

      {/* -------------------------------- ask ---------------------------- */}
      {stage === 'ask' && (
        <AuthCard
          icon={<Mail size={22} />}
          title="Forgotten your password"
          subtitle="Give us the address you sign in with and we will send a six-digit code to it."
          error={error}
        >
          <form className="auth-form" onSubmit={request}>
            <TextInput
              label="E-mail address" type="email" required autoFocus autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!email.trim()}>
              Send me a code
            </Button>
          </form>

          <p className="auth-alt">
            Already have a code?{' '}
            <button type="button" className="link-button" onClick={() => setStage('reset')}>
              Enter it here
            </button>
          </p>
        </AuthCard>
      )}

      {/* ------------------------------- reset --------------------------- */}
      {stage === 'reset' && (
        <AuthCard
          icon={<ShieldCheck size={22} />}
          title="Set a new password"
          subtitle="Enter the code from your e-mail, then choose a password you have not used before."
          error={error}
        >
          {notice && <StatusNote tone="info">{notice}</StatusNote>}

          <form className="auth-form" onSubmit={reset}>
            {!email && (
              <TextInput
                label="E-mail address" type="email" required autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            )}

            <div className="field">
              <span className="label" id="reset-code-label">Six-digit code</span>
              <OtpInput value={code} onChange={setCode} error={fieldError.code} disabled={busy} />
            </div>

            <PasswordField
              label="New password" required value={password}
              onChange={setPassword} error={fieldError.password}
            />
            <PasswordField
              label="Type it again" required value={confirm} showRules={false}
              onChange={setConfirm} error={fieldError.confirm}
            />

            <StatusNote tone="warn" title="This signs you out everywhere">
              Changing your password ends every session on every device, which is the point —
              if somebody else had got in, this is what removes them.
            </StatusNote>

            <Button
              type="submit" variant="primary" size="lg" block loading={busy}
              disabled={code.length !== 6 || !password || !confirm}
            >
              Change my password
            </Button>
          </form>

          <p className="auth-alt">
            <button type="button" className="link-button" onClick={() => setStage('ask')}>
              Send the code again
            </button>
          </p>
        </AuthCard>
      )}

      {/* -------------------------------- done --------------------------- */}
      {stage === 'done' && (
        <AuthCard
          icon={<Check size={22} />}
          iconTone="ok"
          title="That is done"
          subtitle="Your password has been changed and every other session has been signed out."
        >
          <Alert tone="ok" title="If this was not you">
            Somebody with access to your e-mail has just changed your password. Sign in, open
            Settings, Security Centre, and check the recent activity and registered devices.
          </Alert>

          <Button variant="primary" size="lg" block onClick={() => navigate('/login', { replace: true })}>
            Sign in with your new password
          </Button>
        </AuthCard>
      )}
    </AuthScreen>
  );
}
