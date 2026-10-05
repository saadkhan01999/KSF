/* Session, permissions, workspace data, toasts and theme.

   One provider keeps the wiring small: every screen needs the signed-in
   person and a way to say "did that work?", and almost every screen needs
   the pharmacy name or a permission check.

   The session starts from the refresh cookie: on load the app asks
   /auth/refresh for an access token, and if there is none the visitor sees
   the public site. The access token itself only ever lives in memory. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  api, ApiError, refreshAccessToken, setAccessToken, setSessionLostHandler, setStepUpHandler, setSupportPharmacy, supportPharmacy
} from '../services/api';
import type { Bootstrap, SessionUser, SubscriptionState, LoginOutcome, Device } from '../types';

/* ------------------------------- toasts ------------------------------- */

export type ToastTone = 'ok' | 'error' | 'warn' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

/* ------------------------------- theme -------------------------------- */

/** Light or dark — each person's own choice, kept on this device. */
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORE = 'ksf-theme';
export const BRAND_STORE = 'ksf-brand';
export const DEFAULT_BRAND = 'ksf-green';

const prefersDark = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * Put the resolved mode on <html>, never the preference: the stylesheet
 * declares dark exactly once, under [data-theme='dark'].
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  const resolved = preference === 'system' ? (prefersDark() ? 'dark' : 'light') : preference;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-pref', preference);
  root.style.colorScheme = resolved;
}

/** The brand colours (one of five themes) — chosen by the pharmacy, or by the person when allowed. */
export function applyBrand(brand: string | null | undefined): void {
  const key = brand || DEFAULT_BRAND;
  document.documentElement.setAttribute('data-brand', key);
  try { localStorage.setItem(BRAND_STORE, key); } catch { /* remembered for this tab only */ }
}

/* ------------------------------ the context --------------------------- */

interface SessionReply { user: SessionUser; accessToken: string; subscription?: SubscriptionState | null }

interface AppValue {
  /* session */
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<LoginOutcome>;
  completeTwoFactor: (challenge: string, code: string, recoveryCode?: string) => Promise<void>;
  adoptSession: (reply: SessionReply) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  /** Why the last session ended, for the sign-in screen to explain. */
  endedBecause: string | null;

  /* the platform */
  isPlatform: boolean;
  enterSupport: (pharmacyId: string) => Promise<void>;
  leaveSupport: () => Promise<void>;

  /* authorisation */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;

  /* what the subscription allows — answered by the server, never guessed */
  subscription: SubscriptionState | null;
  hasFeature: (key: string) => boolean;
  refreshSubscription: () => Promise<void>;

  /* workspace */
  workspace: Bootstrap | null;
  refreshWorkspace: () => Promise<void>;
  setting: (key: string, fallback?: string) => string;

  /* feedback */
  toasts: Toast[];
  toast: (tone: ToastTone, title: string, body?: string) => void;
  ok: (title: string, body?: string) => void;
  fail: (error: unknown, fallback?: string) => void;
  dismissToast: (id: number) => void;

  /* appearance */
  theme: ThemePreference;
  setTheme: (preference: ThemePreference) => void;
  brand: string;
  previewBrand: (brand: string | null) => void;

  /* "confirm it is you" — any request the server wants a fresh password for */
  stepUpOpen: boolean;
  resolveStepUp: (verified: boolean) => void;
}

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspace, setWorkspace] = useState<Bootstrap | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [endedBecause, setEndedBecause] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const stepUpResolver = useRef<((verified: boolean) => void) | null>(null);
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORE);
      return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    } catch {
      return 'system';
    }
  });
  const toastId = useRef(0);

  /* ------------------------------ toasts ------------------------------ */
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  const toast = useCallback((tone: ToastTone, title: string, body?: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current.slice(-3), { id, tone, title, body }]);
    /* Errors stay a little longer, because they usually need reading. */
    window.setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 4200);
  }, [dismissToast]);

  const ok = useCallback((title: string, body?: string) => toast('ok', title, body), [toast]);

  const fail = useCallback((error: unknown, fallback = 'That did not work.') => {
    const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
    toast('error', message);
  }, [toast]);

  /* ------------------------------ session ----------------------------- */
  const refreshWorkspace = useCallback(async () => {
    try {
      const next = await api.get<Bootstrap>('/bootstrap');
      setWorkspace(next);
      applyBrand(next.theme);
    } catch {
      /* A failed refresh never blanks the screen; the last good copy stays. */
    }
  }, []);

  const refreshSubscription = useCallback(async () => {
    if (!supportPharmacy() && user?.isPlatformAdmin) return;
    try {
      setSubscription(await api.get<SubscriptionState>('/billing/entitlements'));
    } catch {
      /* The last known answer stays. */
    }
  }, [user?.isPlatformAdmin]);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setSupportPharmacy(null);
    setUser(null);
    setWorkspace(null);
    setSubscription(null);
  }, []);

  /** Who am I, as the server sees it right now (support mode included). */
  const refreshSession = useCallback(async () => {
    try {
      const reply = await api.get<{ user: SessionUser; subscription?: SubscriptionState | null }>('/auth/session');
      setUser(reply.user);
      setSubscription(reply.subscription ?? null);
      await refreshWorkspace();
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 404 && supportPharmacy()) {
        /* The pharmacy being supported no longer exists: back to the console. */
        setSupportPharmacy(null);
        await refreshSession();
      }
    }
  }, [refreshWorkspace]);

  const adoptSession = useCallback(async (reply: SessionReply) => {
    setAccessToken(reply.accessToken);
    setEndedBecause(null);
    setUser(reply.user);
    setSubscription(reply.subscription ?? null);
    if (reply.user.isPlatformAdmin && supportPharmacy()) await refreshSession();
    else {
      if (!reply.user.isPlatformAdmin) setSupportPharmacy(null);
      await refreshWorkspace();
    }
  }, [refreshSession, refreshWorkspace]);

  /* Signing in ends in one of three places: straight in, waiting for a
     six-digit code, or refused because this machine would be one device too
     many. Anything else throws. */
  const signIn = useCallback(async (email: string, password: string): Promise<LoginOutcome> => {
    try {
      const result = await api.post<Partial<SessionReply> & { twoFactorRequired?: boolean; challenge?: string; message?: string }>('/auth/login', { email, password });
      if (result.twoFactorRequired && result.challenge) return { kind: 'two-factor', challenge: result.challenge, message: result.message ?? '' };
      setSupportPharmacy(null);
      await adoptSession(result as SessionReply);
      return { kind: 'signed-in' };
    } catch (problem) {
      /* 409 means the password was right and the device allowance is full.
         The screen needs the devices to offer a way through. */
      if (problem instanceof ApiError && problem.status === 409 && problem.details) {
        const details = problem.details as { limit: number; category: string; devices: Device[]; releaseTicket: string };
        return {
          kind: 'device-limit', limit: details.limit, category: details.category, devices: details.devices ?? [],
          releaseTicket: details.releaseTicket, message: problem.message
        };
      }
      throw problem;
    }
  }, [adoptSession]);

  const completeTwoFactor = useCallback(async (challenge: string, code: string, recoveryCode?: string) => {
    const reply = await api.post<SessionReply>('/auth/two-factor', recoveryCode ? { challenge, recoveryCode } : { challenge, code });
    setSupportPharmacy(null);
    await adoptSession(reply);
  }, [adoptSession]);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* signed out locally regardless */ }
    clearSession();
  }, [clearSession]);

  /* The platform Super Admin steps into one pharmacy, and back out. */
  const enterSupport = useCallback(async (pharmacyId: string) => {
    setSupportPharmacy(pharmacyId);
    await refreshSession();
  }, [refreshSession]);

  const leaveSupport = useCallback(async () => {
    setSupportPharmacy(null);
    await refreshSession();
  }, [refreshSession]);

  /* First load: is there a session to pick up? */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reply = await refreshAccessToken();
      if (cancelled) return;
      if (reply?.accessToken && reply.user) {
        setUser(reply.user as SessionUser);
        setSubscription((reply.subscription ?? null) as SubscriptionState | null);
        if ((reply.user as SessionUser).isPlatformAdmin && supportPharmacy()) await refreshSession();
        else await refreshWorkspace();
      } else {
        setSupportPharmacy(null);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSessionLostHandler((reason, message) => {
      clearSession();
      setEndedBecause(reason === 'suspended'
        ? message || 'This pharmacy account is suspended. Please contact KSF support.'
        : 'Your session has ended. Please sign in again.');
    });
  }, [clearSession]);

  /* A request that needs the password confirmed waits here for the dialog. */
  useEffect(() => {
    setStepUpHandler(() => new Promise<boolean>((resolve) => {
      stepUpResolver.current = resolve;
      setStepUpOpen(true);
    }));
  }, []);

  const resolveStepUp = useCallback((verified: boolean) => {
    stepUpResolver.current?.(verified);
    stepUpResolver.current = null;
    setStepUpOpen(false);
  }, []);

  /* ----------------------------- appearance ---------------------------- */
  useEffect(() => { applyTheme(theme); }, [theme]);

  /* On "match my device", follow it as it changes. */
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((preference: ThemePreference) => {
    try { localStorage.setItem(THEME_STORE, preference); } catch { /* applies to this tab only */ }
    setThemeState(preference);
  }, []);

  /** Show a brand theme without saving it (the Appearance picker); null puts the saved one back. */
  const previewBrand = useCallback((brand: string | null) => applyBrand(brand ?? workspace?.theme), [workspace?.theme]);

  /* --------------------------- authorisation -------------------------- */
  const features = useMemo(() => new Set(subscription?.features ?? []), [subscription]);
  const hasFeature = useCallback((key: string) => !!user?.supportMode || features.has(key), [features, user?.supportMode]);

  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const can = useCallback((permission: string) => permissions.has(permission), [permissions]);
  const canAny = useCallback((...list: string[]) => list.some((p) => permissions.has(p)), [permissions]);
  const isPlatform = !!user?.isPlatformAdmin && !user.supportMode;

  const setting = useCallback((key: string, fallback = '') => workspace?.settings?.[key] ?? fallback, [workspace]);

  const value = useMemo<AppValue>(() => ({
    user, loading, signIn, completeTwoFactor, adoptSession, signOut, refreshSession, endedBecause,
    isPlatform, enterSupport, leaveSupport,
    can, canAny,
    subscription, hasFeature, refreshSubscription,
    workspace, refreshWorkspace, setting,
    toasts, toast, ok, fail, dismissToast,
    theme, setTheme, brand: workspace?.theme ?? DEFAULT_BRAND, previewBrand,
    stepUpOpen, resolveStepUp
  }), [
    user, loading, signIn, completeTwoFactor, adoptSession, signOut, refreshSession, endedBecause,
    isPlatform, enterSupport, leaveSupport, can, canAny, subscription, hasFeature, refreshSubscription,
    workspace, refreshWorkspace, setting, toasts, toast, ok, fail, dismissToast, theme, setTheme, previewBrand,
    stepUpOpen, resolveStepUp
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>.');
  return value;
}
