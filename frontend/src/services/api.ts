/* The only place the application talks to the server.

   Sign-in gives the browser two things. A short-lived access token, kept
   here in memory and sent as a Bearer header — never in localStorage, where
   any injected script could read it. And a refresh token, which the browser
   never sees at all: it is an HttpOnly cookie scoped to /api/v1/auth, and the
   server replaces it every time it is used.

   When the access token expires the next request is answered 401
   token_expired; this module refreshes once (however many requests were in
   flight at that moment) and repeats them. A refresh that fails means the
   session is over.

   The platform Super Admin works inside a pharmacy by sending its id in
   X-Pharmacy-Id ("support mode"). And a request the server wants a recent
   password for (403 step_up_required) is paused while the person confirms
   it, then sent again — so every screen gets that for free.

   Errors come back as ApiError carrying the server's own wording, which is
   written for pharmacy staff, and the field it refers to. */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const SUPPORT_STORE = 'ksf-support-pharmacy';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
    /** A machine-readable reason, when the server sends one. */
    public code?: string,
    /** The rest of the reply — a device-limit refusal carries the devices. */
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/* ------------------------------------------------------------ the tokens */
let accessToken = '';
let supportPharmacyId = (() => {
  try { return sessionStorage.getItem(SUPPORT_STORE) ?? ''; } catch { return ''; }
})();

export function setAccessToken(token?: string | null): void {
  accessToken = token ?? '';
}

export const hasAccessToken = (): boolean => accessToken !== '';

/** The headers that say who is asking: the token, and the pharmacy in support mode. */
export function identityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (supportPharmacyId) headers['X-Pharmacy-Id'] = supportPharmacyId;
  return headers;
}

/** Work inside one pharmacy as the platform Super Admin, or stop (null). */
export function setSupportPharmacy(pharmacyId: string | null): void {
  supportPharmacyId = pharmacyId ?? '';
  try {
    if (supportPharmacyId) sessionStorage.setItem(SUPPORT_STORE, supportPharmacyId);
    else sessionStorage.removeItem(SUPPORT_STORE);
  } catch { /* storage blocked: support mode lasts until reload */ }
}

export const supportPharmacy = (): string | null => supportPharmacyId || null;

/* --------------------------------------------------------- the handlers */
let onSessionLost: ((reason: 'expired' | 'suspended', message?: string) => void) | null = null;
let onStepUp: (() => Promise<boolean>) | null = null;

/** Called when the session has ended, so the app can go back to sign-in. */
export function setSessionLostHandler(handler: (reason: 'expired' | 'suspended', message?: string) => void): void {
  onSessionLost = handler;
}

/** Called when the server wants the password confirmed; resolves true when it was. */
export function setStepUpHandler(handler: () => Promise<boolean>): void {
  onStepUp = handler;
}

/* ------------------------------------------------------------ refreshing */
export interface RefreshReply {
  user: unknown;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  subscription?: unknown;
}

let refreshing: Promise<RefreshReply | null> | null = null;

/** Exchange the refresh cookie for a new access token. One at a time. */
export function refreshAccessToken(): Promise<RefreshReply | null> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Client': 'ksf-web' }, body: '{}'
      });
      const body = await response.json().catch(() => ({})) as RefreshReply & { code?: string; message?: string };
      if (response.status === 403 && body.code === 'pharmacy_suspended') {
        setAccessToken(null);
        onSessionLost?.('suspended', body.message);
        return null;
      }
      if (!response.ok || !body.accessToken) {
        setAccessToken(null);
        return null;
      }
      setAccessToken(body.accessToken);
      return body;
    } catch {
      return null;
    } finally {
      queueMicrotask(() => { refreshing = null; });
    }
  })();
  return refreshing;
}

/* ------------------------------------------------------------ requesting */
async function send(path: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client': 'ksf-web',
    ...(init.headers as Record<string, string> | undefined)
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  /* Support mode applies to the pharmacy's own endpoints and to "who am I";
     never to the platform console or to signing in and out. */
  const pharmacyScoped = !path.startsWith('/platform/') && (!path.startsWith('/auth/') || path === '/auth/session');
  if (supportPharmacyId && pharmacyScoped) headers['X-Pharmacy-Id'] = supportPharmacyId;
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: 'include', headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the KSF server. Check your internet connection and try again.');
  }
}

/* A reply with no KSF message never reached the KSF server: something in
   between answered — the hosting's firewall, or a proxy that could not get
   through. Say which, because "could not be completed" helps nobody fix it. */
function relayProblem(response: Response): string {
  if (response.headers.get('x-vercel-mitigated')) {
    return `The website's security check (Vercel firewall) blocked this request before it reached KSF (error ${response.status}). `
      + 'The site owner can allow /api in Vercel › Firewall.';
  }
  if (response.status === 429) return 'Too many requests reached the server. Please wait a minute and try again.';
  if (response.status >= 502 && response.status <= 504) return 'The KSF server is not answering right now. Please try again in a minute.';
  return `That request could not be completed (error ${response.status}).`;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const response = await send(path, init);
  const body = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;

  if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : undefined;
    const isAuthPath = path.startsWith('/auth/login') || path.startsWith('/auth/two-factor') || path.startsWith('/auth/device-release') || path.startsWith('/auth/refresh');

    /* The access token ran out: get another and go again, once. */
    if (response.status === 401 && !isAuthPath && attempt === 0 && (code === 'token_expired' || accessToken)) {
      if (await refreshAccessToken()) return apiRequest<T>(path, init, attempt + 1);
    }
    if (response.status === 401 && !isAuthPath) onSessionLost?.('expired');
    if (response.status === 403 && code === 'pharmacy_suspended') onSessionLost?.('suspended', String(body.message ?? ''));

    /* The server wants the password confirmed first. */
    if (response.status === 403 && code === 'step_up_required' && attempt < 2 && onStepUp) {
      if (await onStepUp()) return apiRequest<T>(path, init, attempt + 1);
    }

    throw new ApiError(
      response.status,
      typeof body.message === 'string' ? body.message : relayProblem(response),
      typeof body.field === 'string' ? body.field : undefined,
      code,
      body
    );
  }
  return body as T;
}

/** "?a=1&b=2", skipping anything empty so addresses stay readable. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  get: <T,>(path: string) => apiRequest<T>(path),
  post: <T,>(path: string, body: unknown = {}) => apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T,>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T,>(path: string, body: unknown = {}) => apiRequest<T>(path, { method: 'DELETE', body: JSON.stringify(body) })
};
