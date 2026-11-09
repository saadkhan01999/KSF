/* ==========================================================================
   Counting the public website's visitors (Super Admin › Website traffic)
   --------------------------------------------------------------------------
   One small beacon per page of the public website — never the signed-in
   application. It carries a random number this browser keeps in its own
   storage (not a cookie), the page's address and, for the first page, the
   site the visitor came from. The server keeps only a keyed hash of the
   number and counts the browser once a day. A browser that asks not to be
   tracked (Do Not Track, Global Privacy Control) sends nothing.
   ========================================================================== */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE_URL } from './api';

const KEY = 'ksf-visitor';
let memoryVisitor: string | null = null;

const randomId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

function visitorId(): string {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored;
    const fresh = randomId();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    /* Storage blocked (a private window): one number for this page's life. */
    memoryVisitor ??= randomId();
    return memoryVisitor;
  }
}

const optedOut = (): boolean => {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.msDoNotTrack === '1';
};

let firstPage = true;

/** Count this page of the public website. Never throws, never waits. */
export function countVisit(path: string): void {
  if (typeof window === 'undefined' || optedOut()) return;
  const body = JSON.stringify({ visitor: visitorId(), path, referrer: firstPage ? document.referrer : '' });
  firstPage = false;
  fetch(`${API_BASE_URL}/public/visit`, {
    method: 'POST', body, keepalive: true, credentials: 'omit',
    headers: { 'Content-Type': 'application/json', 'X-Client': 'ksf-web' }
  }).catch(() => undefined);
}

/** On the public website: count each page as it is opened. */
export function useSiteVisits(): void {
  const { pathname } = useLocation();
  useEffect(() => { countVisit(pathname); }, [pathname]);
}
