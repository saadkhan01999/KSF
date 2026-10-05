/* ==========================================================================
   Account and onboarding components: a step indicator, a password field that explains itself, a code entry box,
   plan cards, a file drop zone, and the upgrade prompt.

   They follow the same rules as the rest of the library. Every control is at
   least 44px on a touch screen, every state is announced to a screen reader
   rather than only shown, and nothing depends on colour alone.
   ========================================================================== */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import {
  Check, Copy, Eye, EyeOff, Lock, ShieldCheck, Sparkles, Upload, X,
  CircleAlert, ArrowUpRight, Info
} from 'lucide-react';
import { Button, Badge } from './ui';
import type { Plan } from '../types';
import { rupees } from '../utils/format';

/* ============================== THE STEPPER ============================== */

export interface Step {
  key: string;
  label: string;
  hint?: string;
}

/**
 * Where you are in a multi-step form.
 *
 * Finished steps carry a tick, the current one a ring, and the line between
 * two steps fills in once the first is done. When the stepper itself is too
 * narrow for the labels (a phone, or a slim column) it collapses to the
 * current label, "Step 2 of 3" and a segmented bar — decided by the width of
 * the stepper, not of the window.
 */
export function Stepper({ steps, current }: { steps: Step[]; current: number }) {
  const active = steps[current] ?? steps[0];

  return (
    <nav className="stepper" aria-label="Progress">
      <ol className="stepper-list">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo';
          return (
            <li key={step.key} className={`stepper-step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="stepper-marker" aria-hidden="true">
                {state === 'done' ? <Check size={14} strokeWidth={3} /> : index + 1}
              </span>
              <span className="stepper-text">
                <span className="stepper-label">{step.label}</span>
                {step.hint && <span className="stepper-hint">{step.hint}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="stepper-compact" aria-hidden="true">
        <div className="stepper-compact-head">
          <strong>{active?.label}</strong>
          <span>Step {current + 1} of {steps.length}</span>
        </div>
        <div className="stepper-segments">
          {steps.map((step, index) => <span key={step.key} className={index <= current ? 'is-filled' : ''} />)}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        Step {current + 1} of {steps.length}: {active?.label}
      </p>
    </nav>
  );
}

/* =========================== THE PASSWORD FIELD ========================== */

const RULES: { key: string; label: string; test: (v: string) => boolean }[] = [
  { key: 'length', label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { key: 'lower', label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { key: 'upper', label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { key: 'digit', label: 'A number', test: (v) => /\d/.test(v) },
  { key: 'symbol', label: 'A special character', test: (v) => /[^A-Za-z0-9]/.test(v) }
];

/** Advisory only — the server decides, and says so if it disagrees. */
function localStrength(value: string): { score: number; label: string } {
  if (!value) return { score: 0, label: 'Empty' };
  let score = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  if (new Set(value).size >= 10) score += 1;
  const clamped = Math.min(4, score);
  return { score: clamped, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][clamped] };
}

export function PasswordField({
  label = 'Password',
  value,
  onChange,
  error,
  hint,
  autoComplete = 'new-password',
  showRules = true,
  required,
  autoFocus,
  name
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  autoComplete?: string;
  showRules?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  name?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const strength = useMemo(() => localStrength(value), [value]);

  return (
    <div className="field password-field">
      <label className="label" htmlFor={id}>
        {label}{required && <span className="req" aria-hidden="true">*</span>}
      </label>

      <div className="input-wrap">
        <Lock size={16} className="input-icon" aria-hidden="true" />
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          className={`input ${error ? 'is-invalid' : ''}`}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={showRules ? `${id}-rules` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="input-action"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide the password' : 'Show the password'}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {value && (
        <div className="strength" aria-hidden="true">
          <div className={`strength-bar tone-${strength.score}`}>
            <span style={{ width: `${((strength.score + 1) / 5) * 100}%` }} />
          </div>
          <span className="strength-label">{strength.label}</span>
        </div>
      )}
      {value && <span className="sr-only" aria-live="polite">Password strength: {strength.label}</span>}

      {showRules && (
        <ul className="password-rules" id={`${id}-rules`}>
          {RULES.map((rule) => {
            const met = rule.test(value);
            return (
              <li key={rule.key} className={met ? 'is-met' : ''}>
                <span aria-hidden="true">{met ? <Check size={13} /> : <X size={13} />}</span>
                {rule.label}
                <span className="sr-only">{met ? ' — met' : ' — not yet met'}</span>
              </li>
            );
          })}
        </ul>
      )}

      {error
        ? <span className="err"><CircleAlert /> {error}</span>
        : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/* ============================== CODE ENTRY =============================== */

/**
 * Six boxes for a verification code.
 *
 * Pasting the whole code into any box fills them all, because that is what
 * people actually do with a code from an e-mail. Backspace moves back a box
 * when the current one is empty.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  error,
  onComplete
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  error?: string;
  onComplete?: (value: string) => void;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  const set = useCallback((index: number, digit: string) => {
    const next = value.padEnd(length, ' ').split('');
    next[index] = digit;
    const joined = next.join('').replace(/\s/g, '');
    onChange(joined);
    if (joined.length === length) onComplete?.(joined);
  }, [value, length, onChange, onComplete]);

  return (
    <div className="field">
      <div className={`otp ${error ? 'is-invalid' : ''}`} role="group" aria-label={`${length}-digit verification code`}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => { inputs.current[index] = element; }}
            className="otp-box"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            disabled={disabled}
            aria-label={`Digit ${index + 1}`}
            value={digit.trim()}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const typed = event.target.value.replace(/\D/g, '');
              if (!typed) { set(index, ' '); return; }
              if (typed.length > 1) {
                const whole = typed.slice(0, length);
                onChange(whole);
                if (whole.length === length) onComplete?.(whole);
                inputs.current[Math.min(whole.length, length - 1)]?.focus();
                return;
              }
              set(index, typed);
              if (index < length - 1) inputs.current[index + 1]?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && !digit.trim() && index > 0) {
                inputs.current[index - 1]?.focus();
              }
              if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus();
              if (event.key === 'ArrowRight' && index < length - 1) inputs.current[index + 1]?.focus();
            }}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
              if (!pasted) return;
              onChange(pasted);
              if (pasted.length === length) onComplete?.(pasted);
              inputs.current[Math.min(pasted.length, length - 1)]?.focus();
            }}
          />
        ))}
      </div>
      {error && <span className="err"><CircleAlert /> {error}</span>}
    </div>
  );
}

/* =============================== COPY FIELD ============================== */

export function CopyField({
  label, value, hint, monospace = true
}: { label: string; value: string; hint?: ReactNode; monospace?: boolean }) {
  const id = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* Clipboard access can be refused. Selecting the text still works, and
         the field is deliberately not disabled so it can be copied by hand. */
      setCopied(false);
    }
  };

  return (
    <div className="field copy-field">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          className={`input ${monospace ? 'is-mono' : ''}`}
          value={value}
          readOnly
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="input-action" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <span className="hint" aria-live="polite">{copied ? 'Copied.' : hint}</span>
    </div>
  );
}

/* ================================ PLANS ================================== */

const PERIOD_LABEL: Record<string, string> = {
  perpetual: 'for ever',
  week: 'per week',
  month: 'per month',
  year: 'per year'
};

export function PlanCard({
  plan,
  current,
  selected,
  onChoose,
  featureNames,
  busy,
  featured,
  flag,
  equivalent,
  action
}: {
  plan: Plan;
  current?: boolean;
  selected?: boolean;
  onChoose?: (key: string) => void;
  featureNames?: Record<string, string>;
  busy?: boolean;
  /** Overrides the default emphasis. The pricing page uses it so the plan the
      billing toggle is set to is the one that stands out. */
  featured?: boolean;
  flag?: string;
  /** "About Rs 1,250 a month", under an annual price. */
  equivalent?: string;
  /** Replaces the built-in button — the marketing page wants a link, not a
      handler, so the card is useful on a page with no session. */
  action?: ReactNode;
}) {
  const highlight = featured ?? plan.key === 'monthly';

  return (
    <article
      className={`plan-card ${selected ? 'is-selected' : ''} ${highlight ? 'is-featured' : ''}`}
      aria-current={current ? 'true' : undefined}
    >
      {highlight && <span className="plan-flag"><Sparkles size={12} /> {flag ?? 'Most chosen'}</span>}
      {current && <span className="plan-flag is-current"><Check size={12} /> Your plan</span>}

      <h3 className="plan-name">{plan.name}</h3>
      {plan.tagline && <p className="plan-tagline">{plan.tagline}</p>}

      <p className="plan-price">
        {plan.pricePaisa === 0
          ? <span className="plan-free">Free</span>
          : <><span className="plan-amount">{rupees(plan.pricePaisa)}</span> <span className="plan-period">{PERIOD_LABEL[plan.period] ?? ''}</span></>}
      </p>

      {equivalent && <p className="plan-equivalent">{equivalent}</p>}

      {plan.annualDiscountPercent > 0 && (
        <p className="plan-saving">Saves about {Math.round(plan.annualDiscountPercent)}% against paying monthly</p>
      )}

      {plan.description && <p className="plan-description">{plan.description}</p>}

      <ul className="plan-features">
        {plan.features.map((feature) => (
          <li key={feature}><Check size={14} aria-hidden="true" /> {featureNames?.[feature] ?? feature}</li>
        ))}
      </ul>

      <dl className="plan-limits">
        <div><dt>Computers</dt><dd>{plan.limits.desktopDevices}</dd></div>
        <div><dt>Phones and tablets</dt><dd>{plan.limits.mobileDevices}</dd></div>
        <div><dt>Staff accounts</dt><dd>{plan.limits.users < 0 ? 'Unlimited' : plan.limits.users}</dd></div>
        <div><dt>Branches</dt><dd>{plan.limits.branches < 0 ? 'Unlimited' : plan.limits.branches}</dd></div>
        <div><dt>Medicines</dt><dd>{plan.limits.medicines < 0 ? 'Unlimited' : plan.limits.medicines.toLocaleString('en-PK')}</dd></div>
      </dl>

      {action ?? (onChoose && (
        <Button
          variant={selected || highlight ? 'primary' : 'secondary'}
          onClick={() => onChoose(plan.key)}
          disabled={current || busy}
          block
        >
          {current ? 'This is your plan' : selected ? 'Selected' : `Choose ${plan.name}`}
        </Button>
      ))}
    </article>
  );
}

/* =========================== THE UPGRADE PROMPT ========================== */

/**
 * Shown where a premium feature would be.
 *
 * It says what the feature is and that the pharmacy's data is untouched,
 * because the moment somebody sees a locked screen the first thing they
 * wonder is whether they have lost something.
 */
export function UpgradeNotice({
  feature,
  plan,
  onUpgrade,
  compact
}: {
  feature: string;
  plan?: string;
  onUpgrade?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`upgrade-notice ${compact ? 'is-compact' : ''}`} role="note">
      <span className="upgrade-icon" aria-hidden="true"><Lock size={compact ? 16 : 20} /></span>
      <div className="upgrade-body">
        <strong>{feature} is part of the paid plans</strong>
        <p>
          Everything you already have is still here and still working — nothing is hidden or deleted.
          {plan ? ` Your pharmacy is on the ${plan} plan.` : ''}
        </p>
      </div>
      {onUpgrade && (
        <Button variant="primary" onClick={onUpgrade} icon={<ArrowUpRight size={15} />}>
          See the plans
        </Button>
      )}
    </div>
  );
}

/* ============================== FILE DROP ================================ */

export function FileDrop({
  accept = '.csv,.xlsx,.json',
  maxMb = 9,
  onFile,
  busy,
  hint
}: {
  accept?: string;
  maxMb?: number;
  onFile: (file: File) => void;
  busy?: boolean;
  hint?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const take = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (file.size > maxMb * 1_000_000) {
      setProblem(`That file is ${(file.size / 1_048_576).toFixed(1)} MB. The limit is ${maxMb} MB — split it and bring the parts across one at a time.`);
      return;
    }
    if (file.size === 0) { setProblem('That file is empty.'); return; }
    onFile(file);
  };

  return (
    <div className="field">
      <div
        className={`file-drop ${over ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
        onDragOver={(event: DragEvent) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files?.[0]);
        }}
      >
        <Upload size={26} aria-hidden="true" />
        <p className="file-drop-title">Drop your file here, or choose one</p>
        <p className="file-drop-hint">{hint ?? `CSV, Excel (.xlsx) or JSON, up to ${maxMb} MB`}</p>
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          loading={busy}
        >
          Choose a file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label="Choose a file to import"
          tabIndex={-1}
          onChange={(event) => { take(event.target.files?.[0]); event.target.value = ''; }}
        />
      </div>
      {problem && <span className="err"><CircleAlert /> {problem}</span>}
    </div>
  );
}

/* ============================== STEP UP ================================== */

/**
 * "Confirm it is you" before a security-relevant action.
 *
 * The server enforces this independently — an endpoint that needs a recent
 * verification refuses without one whatever the interface did. This exists so
 * the person is asked BEFORE the work rather than watching it fail, and so
 * the same wording is used everywhere it happens.
 */
export function StepUpDialog({
  open, onClose, onVerified, needsCode, reason
}: {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
  needsCode?: boolean;
  reason?: string;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setCode('');
    setError('');
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const { api } = await import('../services/api');
      await api.post('/auth/verify-identity', { password, code: code || undefined });
      onVerified();
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="stepup-backdrop" role="dialog" aria-modal="true" aria-label="Confirm your identity">
      <div className="stepup-card">
        <h3><Lock size={17} aria-hidden="true" /> Confirm it is you</h3>
        <p>{reason ?? 'This changes something security-related, so your password is needed again even though you are signed in.'}</p>

        {error && <div className="auth-error" role="alert"><CircleAlert size={15} /> <span>{error}</span></div>}

        <PasswordField
          label="Your password" value={password} onChange={setPassword}
          showRules={false} autoComplete="current-password" autoFocus
        />

        {needsCode && (
          <div className="field">
            <label className="label" htmlFor="stepup-code">Authenticator code</label>
            <input
              id="stepup-code"
              className="input"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            <span className="hint">The six digits showing in your app right now.</span>
          </div>
        )}

        <div className="stepup-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} loading={busy} disabled={!password}>Confirm</Button>
        </div>
      </div>
    </div>
  );
}

/* ============================== SMALL PIECES ============================= */

export function DetailRow({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className={`detail-row ${tone ? `tone-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function StatusNote({
  tone = 'info', icon, title, children
}: { tone?: 'info' | 'ok' | 'warn' | 'danger'; icon?: ReactNode; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`status-note tone-${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
      <span className="status-note-icon" aria-hidden="true">
        {icon ?? (tone === 'ok' ? <ShieldCheck size={17} /> : tone === 'warn' || tone === 'danger' ? <CircleAlert size={17} /> : <Info size={17} />)}
      </span>
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** A subscription or trial state, in the same words everywhere. */
export function SubscriptionBadge({ status }: { status: string }) {
  const map: Record<string, { tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'; label: string }> = {
    trial: { tone: 'info', label: 'Free trial' },
    active: { tone: 'ok', label: 'Active' },
    payment_pending: { tone: 'warn', label: 'Waiting for payment' },
    past_due: { tone: 'warn', label: 'Payment overdue' },
    grace: { tone: 'warn', label: 'Grace period' },
    cancelled: { tone: 'neutral', label: 'Cancelled' },
    expired: { tone: 'neutral', label: 'Expired' },
    suspended: { tone: 'danger', label: 'Suspended' }
  };
  const entry = map[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
