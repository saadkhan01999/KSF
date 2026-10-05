/* The shared interface kit: buttons, badges, cards, dialogs, tables and
   feedback. Every screen is assembled from these, so behaviour — focus,
   keyboard, touch targets, loading states — is consistent by construction
   rather than by discipline. */

import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState
} from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown,
  CircleAlert, Info, Search, X, Inbox, CheckCircle2, XCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandMark } from './Brand';
import type { Tone } from '../types';

/* ================================ BUTTON ================================ */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'quiet' | 'danger' | 'danger-soft' | 'gold';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

/** A press ripple is added on click. On a busy counter, instant physical
    feedback matters more than it does on a desktop app. */
export function Button({
  variant = 'secondary', size = 'md', loading = false, block = false,
  icon, iconRight, children, className = '', disabled, onClick, ...rest
}: ButtonProps) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; size: number }[]>([]);
  const seed = useRef(0);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const size = Math.max(box.width, box.height);
    seed.current += 1;
    const id = seed.current;
    setRipples((current) => [...current, {
      id, size,
      x: event.clientX - box.left - size / 2,
      y: event.clientY - box.top - size / 2
    }]);
    window.setTimeout(() => setRipples((current) => current.filter((r) => r.id !== id)), 600);
    onClick?.(event);
  };

  const classes = [
    'btn', `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    loading ? 'is-loading' : '',
    !children ? 'btn-icon' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
      {ripples.map((r) => (
        <span key={r.id} className="ripple" style={{ left: r.x, top: r.y, width: r.size, height: r.size }} />
      ))}
    </button>
  );
}

/* ================================ BADGE ================================= */

const TONE_CLASS: Record<Tone, string> = {
  brand: 'badge-ok', ok: 'badge-ok', warn: 'badge-warn', danger: 'badge-danger',
  info: 'badge-info', purple: 'badge-purple', gold: 'badge-gold', neutral: 'badge-neutral'
};

export function Badge({
  tone = 'neutral', children, dot = true, large = false, icon
}: { tone?: Tone; children: ReactNode; dot?: boolean; large?: boolean; icon?: ReactNode }) {
  return (
    <span className={`badge ${TONE_CLASS[tone]} ${dot ? '' : 'no-dot'} ${large ? 'badge-lg' : ''}`}>
      {icon}
      {children}
    </span>
  );
}

/** Status pills used across stock, expiry, prescriptions, orders and sales.
    Keeping the mapping in one place means "Low stock" is amber everywhere. */
const STATUS_TONES: Record<string, { tone: Tone; label: string }> = {
  'in-stock': { tone: 'ok', label: 'In stock' },
  'reorder-soon': { tone: 'info', label: 'Reorder soon' },
  'low-stock': { tone: 'warn', label: 'Low stock' },
  'out-of-stock': { tone: 'danger', label: 'Out of stock' },
  safe: { tone: 'ok', label: 'In date' },
  expiring: { tone: 'info', label: 'Expiring' },
  critical: { tone: 'warn', label: 'Expires soon' },
  expired: { tone: 'danger', label: 'Expired' },
  active: { tone: 'ok', label: 'Active' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  archived: { tone: 'neutral', label: 'Archived' },
  retired: { tone: 'neutral', label: 'Retired' },
  suspended: { tone: 'danger', label: 'Suspended' },
  quarantined: { tone: 'warn', label: 'Quarantined' },
  'written-off': { tone: 'neutral', label: 'Written off' },
  finished: { tone: 'neutral', label: 'Finished' },
  pending: { tone: 'warn', label: 'Pending' },
  verified: { tone: 'info', label: 'Verified' },
  dispensed: { tone: 'ok', label: 'Dispensed' },
  rejected: { tone: 'danger', label: 'Rejected' },
  completed: { tone: 'ok', label: 'Completed' },
  refunded: { tone: 'danger', label: 'Refunded' },
  draft: { tone: 'neutral', label: 'Draft' },
  ordered: { tone: 'info', label: 'Ordered' },
  received: { tone: 'ok', label: 'Received' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  recorded: { tone: 'info', label: 'Recorded' },
  approved: { tone: 'ok', label: 'Approved' },
  paid: { tone: 'ok', label: 'Paid' },
  'part-paid': { tone: 'warn', label: 'Part paid' },
  unpaid: { tone: 'danger', label: 'Unpaid' },
  /* Support requests */
  open: { tone: 'warn', label: 'Open' },
  in_progress: { tone: 'info', label: 'In progress' },
  waiting: { tone: 'purple', label: 'Waiting for reply' },
  resolved: { tone: 'ok', label: 'Resolved' },
  closed: { tone: 'neutral', label: 'Closed' },
  /* Subscriptions and payments */
  trial: { tone: 'info', label: 'Trial' },
  payment_pending: { tone: 'warn', label: 'Awaiting payment' },
  past_due: { tone: 'danger', label: 'Past due' },
  grace: { tone: 'warn', label: 'Grace period' },
  created: { tone: 'neutral', label: 'Started' },
  succeeded: { tone: 'ok', label: 'Paid' },
  failed: { tone: 'danger', label: 'Failed' },
  low: { tone: 'neutral', label: 'Low' },
  normal: { tone: 'info', label: 'Normal' },
  high: { tone: 'warn', label: 'High' },
  urgent: { tone: 'danger', label: 'Urgent' }
};

export function StatusBadge({ status, large = false }: { status: string; large?: boolean }) {
  const match = STATUS_TONES[status] ?? { tone: 'neutral' as Tone, label: status };
  return <Badge tone={match.tone} large={large}>{match.label}</Badge>;
}

/* ================================= CARD ================================= */

export function Card({
  title, subtitle, actions, icon, children, footer, className = '', pad = true
}: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode;
  children: ReactNode; footer?: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {icon && <span className="card-icon" aria-hidden="true">{icon}</span>}
          <div className="grow">
            {typeof title === 'string' ? <h3>{title}</h3> : title}
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          {actions && <div className="row-tight">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

/* ============================== STAT CARD =============================== */

export function StatCard({
  label, value, unit, icon, tone = 'brand', change, hint, onClick
}: {
  label: string; value: ReactNode; unit?: string; icon?: ReactNode;
  tone?: 'brand' | 'warn' | 'danger' | 'info' | 'gold';
  change?: number | null; hint?: ReactNode; onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      className={`stat tone-${tone}`}
      onClick={onClick}
      style={onClick ? { textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%' } : undefined}
      type={onClick ? 'button' : undefined}
    >
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">
        {unit && <span className="unit">{unit}</span>}
        {value}
      </div>
      {(change !== undefined || hint) && (
        <div className="stat-foot">
          {change !== undefined && change !== null && (
            <span className={`trend ${change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}`}>
              {change > 0 ? '▲' : change < 0 ? '▼' : '■'} {Math.abs(change)}%
            </span>
          )}
          {hint && <span className="t-xs t-dim">{hint}</span>}
        </div>
      )}
    </Wrapper>
  );
}

/* =============================== FORMS ================================== */

export function Field({
  label, required, hint, error, children, className = ''
}: {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: string;
  children: ReactNode; className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="label">
          {label}{required && <span className="req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error
        ? <span className="err"><CircleAlert /> {error}</span>
        : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

interface TextProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: string;
  prefix?: string; suffix?: string; icon?: ReactNode; wrapClass?: string;
}

export function TextInput({
  label, required, hint, error, prefix, suffix, icon, wrapClass, className = '', ...rest
}: TextProps) {
  const id = useId();
  const input = (
    <input
      id={id}
      className={`input ${error ? 'is-invalid' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
  const body = (prefix || suffix || icon)
    ? (
      <div className="input-wrap">
        {icon}
        {prefix && <span className="prefix">{prefix}</span>}
        {input}
        {suffix && <span className="affix">{suffix}</span>}
      </div>
    )
    : input;

  return <Field label={label} required={required} hint={hint} error={error} className={wrapClass}>{body}</Field>;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  wrapClass?: string;
}

export function SelectInput({
  label, required, hint, error, options, placeholder, wrapClass, className = '', ...rest
}: SelectProps) {
  return (
    <Field label={label} required={required} hint={hint} error={error} className={wrapClass}>
      <select className={`select ${error ? 'is-invalid' : ''} ${className}`} {...rest}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
}

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: string; wrapClass?: string;
}

export function TextArea({ label, required, hint, error, wrapClass, className = '', ...rest }: AreaProps) {
  return (
    <Field label={label} required={required} hint={hint} error={error} className={wrapClass}>
      <textarea className={`textarea ${error ? 'is-invalid' : ''} ${className}`} {...rest} />
    </Field>
  );
}

export function Checkbox({
  checked, onChange, label, hint, disabled
}: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="box"><Check strokeWidth={3.5} /></span>
      <span className="txt">{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Switch({
  checked, onChange, label, disabled
}: { checked: boolean; onChange: (value: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span className="txt">{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, label, className = ''
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  /** Names the group for a screen reader — a bare row of tabs says nothing
      about what is being switched. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={`segment ${className}`} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'is-on' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SearchField({
  value, onChange, placeholder = 'Search…', autoFocus
}: { value: string; onChange: (value: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="search">
      <Search />
      <input
        className="input"
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

export function Tabs<T extends string>({
  value, onChange, tabs
}: { value: T; onChange: (value: T) => void; tabs: { value: T; label: string; count?: number; icon?: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          className={value === tab.value ? 'is-on' : ''}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && <span className="pill-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* =============================== DIALOGS ================================ */

/** Traps focus, closes on Escape, and locks the page behind it. On phones the
    CSS turns this into a bottom sheet. */
export function Modal({
  open, onClose, title, subtitle, icon, tone, size = 'md', children, footer, closeOnBackdrop = true
}: {
  open: boolean; onClose: () => void;
  title: ReactNode; subtitle?: ReactNode; icon?: ReactNode;
  tone?: 'danger' | 'warn'; size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode; footer?: ReactNode; closeOnBackdrop?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  /* The latest onClose, read when it is needed, so the effect below runs
     once when the window opens and once when it closes. Depending on onClose
     itself would re-run the focus set-up on every keystroke, because most
     screens pass an inline arrow. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => {
      panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      window.clearTimeout(timer);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
    >
      <div className={`modal sz-${size}`} role="dialog" aria-modal="true" ref={panel}>
        <header className={`modal-head ${tone ? `tone-${tone}` : ''}`}>
          {icon && <span className="ico">{icon}</span>}
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

/** Destructive actions always come through here, never a bare button. */
export function ConfirmDialog({
  open, onCancel, onConfirm, title, message, confirmLabel = 'Confirm',
  tone = 'danger', loading, requireReason, reasonLabel = 'Reason', reasonHint
}: {
  open: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
  title: string; message: ReactNode; confirmLabel?: string;
  tone?: 'danger' | 'warn'; loading?: boolean;
  requireReason?: boolean; reasonLabel?: string; reasonHint?: string;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      tone={tone}
      icon={<AlertTriangle />}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={loading}
            disabled={requireReason && reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ lineHeight: 1.6 }}>{message}</p>
      {requireReason && (
        <div className="mt-4">
          <TextArea
            label={reasonLabel}
            required
            hint={reasonHint ?? 'This is recorded in the audit trail against your name.'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain briefly…"
          />
        </div>
      )}
    </Modal>
  );
}

export function Drawer({
  open, onClose, title, subtitle, children, footer
}: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  /* Same reason as Modal: read the latest onClose rather than re-running the
     set-up on every render. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="drawer-backdrop" aria-hidden="true" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </aside>
    </>,
    document.body
  );
}

/* ============================== FEEDBACK ================================ */

export function EmptyState({
  icon, title, message, action
}: { icon?: ReactNode; title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="ico">{icon ?? <Inbox size={32} />}</span>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Alert({
  tone = 'info', title, children, icon
}: { tone?: 'ok' | 'warn' | 'danger' | 'info'; title?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  const fallback = tone === 'danger' ? <XCircle /> : tone === 'warn' ? <AlertTriangle /> : tone === 'ok' ? <CheckCircle2 /> : <Info />;
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {icon ?? fallback}
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="card-body">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="row" style={{ gap: 16, padding: '10px 0' }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <div
              key={columnIndex}
              className="skeleton line"
              style={{ flex: columnIndex === 0 ? 2 : 1, marginBottom: 0, height: 14 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="stat">
          <div className="skeleton line w-60" />
          <div className="skeleton line" style={{ height: 30, width: '70%', marginTop: 14 }} />
          <div className="skeleton line w-40" style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={`spinner ${large ? 'lg' : ''}`} role="status" aria-label="Loading" />;
}

/** The whole-screen wait: opening the workspace, or a lazily-loaded page.
    It carries the mark, because a blank screen with a spinner on it could
    belong to anything. */
export function PageLoader({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="page-loader">
      <BrandMark size={44} />
      <Spinner large />
      <span className="t-soft">{message}</span>
    </div>
  );
}

/* ============================== TOASTER ================================= */

export function Toaster() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;

  const icons = { ok: <CheckCircle2 />, error: <XCircle />, warn: <AlertTriangle />, info: <Info /> };

  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast ${item.tone}`}>
          <span className="ico">{icons[item.tone]}</span>
          <div className="grow">
            <strong>{item.title}</strong>
            {item.body && <p>{item.body}</p>}
          </div>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => dismissToast(item.id)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

/* ============================= PAGINATION =============================== */

export function Pager({
  page, pages, total, size, onPage
}: { page: number; pages: number; total: number; size: number; onPage: (page: number) => void }) {
  const windowed = useMemo(() => {
    const list: (number | '…')[] = [];
    const push = (n: number | '…') => list.push(n);
    if (pages <= 7) { for (let i = 1; i <= pages; i += 1) push(i); return list; }
    push(1);
    if (page > 3) push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i += 1) push(i);
    if (page < pages - 2) push('…');
    push(pages);
    return list;
  }, [page, pages]);

  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(page * size, total);

  return (
    <div className="table-foot">
      <span>Showing <b>{first}–{last}</b> of <b>{total.toLocaleString('en-PK')}</b></span>
      {pages > 1 && (
        <div className="pager">
          <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
          {windowed.map((entry, index) => (
            entry === '…'
              ? <span key={`gap-${index}`} className="t-dim" style={{ padding: '0 4px' }}>…</span>
              : <button key={entry} className={entry === page ? 'is-on' : ''} onClick={() => onPage(entry)}>{entry}</button>
          ))}
          <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

/* ============================ SORTABLE HEAD ============================= */

export function SortHead({
  label, field, sort, dir, onSort, align
}: {
  label: string; field: string; sort: string; dir: 'asc' | 'desc';
  onSort: (field: string) => void; align?: 'right';
}) {
  const active = sort === field;
  return (
    <th className="sortable" onClick={() => onSort(field)} style={align === 'right' ? { textAlign: 'right' } : undefined}>
      {label}
      <span className="sort-ico">
        {active ? (dir === 'asc' ? <ChevronDown size={12} style={{ transform: 'rotate(180deg)' }} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} opacity={0.4} />}
      </span>
    </th>
  );
}

/* ============================== DROPDOWN ================================ */

/**
 * A dropdown that opens under its trigger — a real menu, keyboard and all:
 *
 *   - the trigger is told to announce itself (aria-haspopup, aria-expanded),
 *     via the props bag handed to the render function;
 *   - Down or Enter on the trigger opens it and lands on the first item;
 *   - Up and Down move between items, Home and End jump to the ends;
 *   - Escape closes it and puts focus back on the trigger, which is what
 *     stops a keyboard user being stranded;
 *   - a click anywhere else, or a scroll of the page behind it, closes it.
 *
 * `panel` widens it and drops the menu role, for the notification and message
 * panels: their contents are a list of links with their own actions, and
 * calling that a menu tells a screen reader the wrong thing.
 */
export function Menu({
  trigger, children, align = 'right', panel = false, label, onOpenChange
}: {
  trigger: (props: {
    open: boolean;
    toggle: () => void;
    props: {
      'aria-haspopup': 'menu' | 'dialog';
      'aria-expanded': boolean;
      onKeyDown: (event: React.KeyboardEvent) => void;
      /* A callback ref rather than an object one: it is assignable to a plain
         <button ref=...> under both the React 18 and React 19 type packages,
         where RefObject is defined differently. */
      ref: (node: HTMLButtonElement | null) => void;
    };
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  panel?: boolean;
  label?: string;
  /** Told every time the menu opens or closes, however it happened — a click
      outside and Escape included. A panel that loads its contents on opening
      needs this; without it, closing by clicking away would leave the panel
      believing it was still open and it would never load again. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const holdTrigger = useCallback((node: HTMLButtonElement | null) => { triggerRef.current = node; }, []);
  const close = useCallback(() => setOpen(false), []);
  /* A plain menu floats above the page, positioned from its trigger, so a
     menu on a table row is never clipped by the table's scroll box. */
  const [place, setPlace] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  useLayoutEffect(() => {
    if (!open || panel) { setPlace(null); return; }
    const anchor = holder.current?.getBoundingClientRect();
    if (!anchor) return;
    const height = surface.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 6;
    const top = height && below + height > window.innerHeight - 8 && anchor.top - height - 6 > 8 ? anchor.top - height - 6 : below;
    setPlace(align === 'left' ? { top, left: anchor.left } : { top, right: Math.max(8, window.innerWidth - anchor.right) });
  }, [open, panel, align]);

  const items = useCallback(
    () => Array.from(
      surface.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ),
    []
  );

  useEffect(() => {
    if (!open) return undefined;

    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (holder.current?.contains(target) || surface.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const list = items();
      if (list.length === 0) return;
      const at = list.indexOf(document.activeElement as HTMLElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        list[at < 0 || at === list.length - 1 ? 0 : at + 1].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        list[at <= 0 ? list.length - 1 : at - 1].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        list[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        list[list.length - 1].focus();
      }
    };
    /* Scrolling the page behind an open menu leaves it hanging in the wrong
       place. Closing is less surprising than following. */
    const onScroll = () => setOpen(false);

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.querySelector('.main')?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.querySelector('.main')?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, items]);

  /* Opening with the keyboard should put you on the first entry; opening with
     the mouse should not steal the pointer's place. */
  const openWithKeyboard = () => {
    setOpen(true);
    window.setTimeout(() => items()[0]?.focus(), 0);
  };

  const onTriggerKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || (event.key === 'Enter' && !open)) {
      event.preventDefault();
      openWithKeyboard();
    }
  };

  return (
    <div ref={holder} className="menu-holder">
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        props: {
          'aria-haspopup': panel ? 'dialog' : 'menu',
          'aria-expanded': open,
          onKeyDown: onTriggerKey,
          ref: holdTrigger
        }
      })}
      {open && panel && (
        <div ref={surface} className="menu menu-panel" role="dialog" aria-label={label}>
          {children(close)}
        </div>
      )}
      {open && !panel && createPortal(
        <div
          ref={surface}
          className="menu is-floating"
          role="menu"
          aria-label={label}
          style={place ? { top: place.top, left: place.left, right: place.right } : { visibility: 'hidden', top: 0, left: 0 }}
        >
          {children(close)}
        </div>,
        document.body
      )}
    </div>
  );
}

export function MenuItem({
  onClick, icon, children, danger, disabled, selected
}: {
  onClick?: () => void; icon?: ReactNode; children: ReactNode;
  danger?: boolean; disabled?: boolean; selected?: boolean;
}) {
  return (
    <button
      className={`menu-item ${danger ? 'danger' : ''} ${selected ? 'is-selected' : ''}`}
      onClick={onClick}
      disabled={disabled}
      /* A tickable entry is a radio in a menu, not a plain item: menuitem with
         aria-checked is a combination screen readers are entitled to ignore. */
      role={selected === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={selected === undefined ? undefined : selected}
    >
      {icon}
      <span className="menu-item-text">{children}</span>
      {selected && <Check size={15} className="menu-item-tick" aria-hidden="true" />}
    </button>
  );
}

/* ============================== PERMISSION ============================== */

/** Hides UI the signed-in role cannot use. The server enforces the same rule,
    so this is about a clean screen, not about security. */
export function Allow({
  permission, any, children, fallback = null
}: { permission?: string; any?: string[]; children: ReactNode; fallback?: ReactNode }) {
  const { can, canAny } = useApp();
  const allowed = permission ? can(permission) : any ? canAny(...any) : true;
  return <>{allowed ? children : fallback}</>;
}

/* =============================== CHARTS ================================= */

export function BarChart({
  data, height = 250, format
}: { data: { label: string; value: number }[]; height?: number; format?: (value: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { label: '', value: 0 });
  /* Thirty days of bars leave no room for thirty dates: label every few,
     counting back from the newest, and half as many on a phone. Each bar
     still shows its own value on hover. */
  const step = data.length > 12 ? Math.ceil(data.length / 10) : 1;
  const narrowStep = data.length > 6 ? step * 2 : 1;

  return (
    <div className="chart" style={{ height }} role="img" aria-label="Bar chart">
      {data.map((point, index) => (
        <div className="chart-col" key={`${point.label}-${index}`}>
          <div
            className={`chart-bar ${point.label === peak.label && data.length > 2 ? 'is-peak' : ''}`}
            style={{
              height: `${Math.max(2, (point.value / max) * 100)}%`,
              animationDelay: `${index * 35}ms`
            }}
            data-value={format ? format(point.value) : point.value.toLocaleString('en-PK')}
          />
          <span className={`chart-label${(data.length - 1 - index) % step ? ' is-minor' : ''}${(data.length - 1 - index) % narrowStep ? ' is-minor-narrow' : ''}`}>{point.label}</span>
        </div>
      ))}
    </div>
  );
}

const DONUT_COLOURS = ['#12996A', '#28C795', '#D9A93C', '#2F6FED', '#7A4AD6', '#E08A1E', '#E04A40', '#6FDDB8'];

export function DonutChart({
  data, centreLabel, centreValue, format
}: {
  data: { label: string; value: number }[];
  centreLabel?: string; centreValue?: string;
  format?: (value: number) => string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let cursor = 0;
  const stops = data.map((slice, index) => {
    const from = (cursor / (total || 1)) * 360;
    cursor += slice.value;
    const to = (cursor / (total || 1)) * 360;
    return `${DONUT_COLOURS[index % DONUT_COLOURS.length]} ${from}deg ${to}deg`;
  });

  return (
    <div className="row" style={{ gap: 28, flexWrap: 'wrap' }}>
      <div className="donut" style={{ background: total ? `conic-gradient(${stops.join(', ')})` : 'var(--surface-3)' }}>
        <div className="donut-mid">
          <strong>{centreValue ?? total.toLocaleString('en-PK')}</strong>
          {centreLabel && <span>{centreLabel}</span>}
        </div>
      </div>
      <div className="legend">
        {data.map((slice, index) => (
          <div className="legend-row" key={slice.label}>
            <span className="swatch" style={{ background: DONUT_COLOURS[index % DONUT_COLOURS.length] }} />
            <span className="name">{slice.label}</span>
            <span className="val">{format ? format(slice.value) : slice.value.toLocaleString('en-PK')}</span>
          </div>
        ))}
        {!data.length && <span className="t-dim t-sm">Nothing to show for this period.</span>}
      </div>
    </div>
  );
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'warn' | 'danger' }) {
  const percent = Math.min(100, Math.max(0, max > 0 ? (value / max) * 100 : 0));
  const level = tone ?? (percent <= 20 ? 'danger' : percent <= 50 ? 'warn' : undefined);
  return (
    <div className={`bar ${level ?? ''}`}>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}
