/* Formatting for a Pakistani pharmacy: rupees, local dates and phone numbers.

   Money is held everywhere as paisa (integers) so nothing is ever lost to
   floating-point rounding. It becomes rupees only at the moment it is shown
   or typed. */

const LOCALE = 'en-PK';

/** Rs 12,450 — the everyday form used on cards, tables and the till. */
export function rupees(paisa: number | null | undefined, options?: { decimals?: boolean; sign?: boolean }): string {
  const value = (paisa ?? 0) / 100;
  const decimals = options?.decimals ?? false;
  const text = value.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0
  });
  const prefix = options?.sign && value > 0 ? '+' : '';
  return `${prefix}Rs ${text}`;
}

/** 12,450.00 — no symbol, for table columns that carry their own heading. */
export function amount(paisa: number | null | undefined, decimals = true): string {
  return ((paisa ?? 0) / 100).toLocaleString(LOCALE, {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0
  });
}

/** Rs 1.2 crore / Rs 3.4 lakh / Rs 12.5k — for headline figures where the
    exact rupee does not matter. South Asian units, because that is how the
    numbers are read locally. */
export function rupeesShort(paisa: number | null | undefined): string {
  const value = Math.abs((paisa ?? 0) / 100);
  const sign = (paisa ?? 0) < 0 ? '-' : '';
  if (value >= 10000000) return `${sign}Rs ${(value / 10000000).toFixed(value >= 100000000 ? 0 : 2)} crore`;
  if (value >= 100000) return `${sign}Rs ${(value / 100000).toFixed(value >= 1000000 ? 1 : 2)} lakh`;
  if (value >= 1000) return `${sign}Rs ${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `${sign}Rs ${Math.round(value)}`;
}

export const toPaisa = (rupeeValue: string | number): number => Math.round(Number(rupeeValue || 0) * 100);
export const toRupeeInput = (paisa: number | null | undefined): string =>
  paisa === null || paisa === undefined ? '' : String(paisa / 100);

export function number(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString(LOCALE);
}

export function percent(value: number | null | undefined, decimals = 1): string {
  return `${(value ?? 0).toFixed(decimals)}%`;
}

/* ------------------------------- dates ------------------------------- */

/** 14 Mar 2026 */
export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 14 Mar 2026, 3:42 pm */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return `${parsed.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })}, ${parsed
    .toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()}`;
}

/** 3:42 pm */
export function time(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

/** just now / 12 minutes ago / 3 days ago */
export function ago(value: string | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(months / 12)} year${Math.round(months / 12) === 1 ? '' : 's'} ago`;
}

/** in 24 days / 3 days overdue — used everywhere expiry is shown. */
export function inDays(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 60) return `in ${days} days`;
  if (days < 730) return `in ${Math.round(days / 30)} months`;
  return `in ${Math.round(days / 365)} years`;
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export function isoDaysAgo(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

export function monthLabel(period: string): string {
  // "2026-03" -> "Mar", "2026-03-14" -> "14 Mar"
  if (/^\d{4}-\d{2}$/.test(period)) {
    return new Date(`${period}-01T00:00:00`).toLocaleDateString(LOCALE, { month: 'short' });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return new Date(`${period}T00:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
  }
  return period;
}

/* ------------------------------- people ------------------------------- */

export function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** How to greet someone: "Ayesha", or "Dr. Ayesha" when the name starts
    with a title — never just "Dr." */
export function shortName(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return /^(Dr|Mr|Mrs|Ms|Miss|Prof|Hakeem|Hafiz)\.?$/i.test(parts[0]) && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
}

/** "Nadia Parveen's", "All Cashiers'" — whose figures a screen is showing. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** +92 300 1234567 — the shape Pakistani numbers are normally written in. */
export function phone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/[^\d+]/g, '');
  const local = digits.startsWith('+92') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  if (local.length === 10 && local.startsWith('3')) return `+92 ${local.slice(0, 3)} ${local.slice(3)}`;
  return value;
}

export function cnic(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 13) return value;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/** Formats a CNIC as the user types it into a field. */
export function cnicMask(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/* ------------------------------- labels ------------------------------- */

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Debit / Credit card',
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
  'bank-transfer': 'Bank transfer',
  cheque: 'Cheque',
  credit: 'Loan (udhaar)'
};

/** What the till takes, in the order it offers them: a loan straight after cash. */
export const TILL_METHODS = ['cash', 'credit', 'card', 'easypaisa', 'jazzcash', 'bank-transfer'] as const;

/* Names a subscription payment carries that are not choices at a till. */
const PROVIDER_LABELS: Record<string, string> = {
  transfer: 'Bank transfer', manual: 'Recorded by KSF', stripe: 'Card (Stripe)', gateway: 'Payment gateway'
};

export const payment = (method: string): string => PAYMENT_LABELS[method] ?? PROVIDER_LABELS[method] ?? method;

export const STOCK_LABELS: Record<string, string> = {
  'in-stock': 'In stock',
  'reorder-soon': 'Reorder soon',
  'low-stock': 'Low stock',
  'out-of-stock': 'Out of stock'
};

export const EXPIRY_LABELS: Record<string, string> = {
  safe: 'In date',
  expiring: 'Expiring',
  critical: 'Expires soon',
  expired: 'Expired'
};

export function titleCase(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Downloads an array of rows as a CSV file the user can open in Excel. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    let text = value === null || value === undefined ? '' : String(value);
    /* Typed text that begins like a formula ("=HYPERLINK(...)") would run as
       one when the file is opened in Excel. A quote in front keeps it text. */
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))
  ].join('\r\n');

  // The BOM makes Excel on a Pakistani Windows install read UTF-8 correctly.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A link that came out of the database, reduced to something it is safe to
 * navigate to.
 *
 * Notification links are written by the server and are all literals today, so
 * nothing is currently wrong. This exists so that nothing has to stay true:
 * a stored link is data, and handing data straight to a router is how an open
 * redirect happens. `//evil.example` and `/\evil.example` are read by browsers
 * as protocol-relative URLs to another host, which is the exact trick the
 * React Router advisories describe.
 *
 * Anything that is not a plain internal path falls back.
 */
export function internalPath(value: string | null | undefined, fallback = '/dashboard'): string {
  const text = String(value ?? '').trim();
  if (!text.startsWith('/')) return fallback;
  /* Browsers drop tabs and line breaks from an address, so "/<tab>/evil" is
     "//evil"; and a second slash or a backslash after the first turns it into
     another host. */
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text) || /^\/[/\\]/.test(text)) return fallback;
  return text;
}
