/* The request context every handler receives. It is built once per request
   by the router (http/router.ts) after authentication, and is the only thing
   a handler needs: who is asking, for which pharmacy, with what rights, and
   what they sent. */

import type { IncomingHttpHeaders } from 'node:http';
import type { Session, User } from '../db/types.js';

/** The signed-in person, with their role flattened onto them. */
export interface AuthUser extends User {
  role_key: string;
  role_name: string;
  role_level: number;
  role_is_system: 0 | 1;
}

export interface Ctx {
  user: AuthUser | null;
  session: Session | null;
  /** The pharmacy this request acts on. For the platform Super Admin it is
      the pharmacy they opened in support mode, or null. */
  pharmacyId: string | null;
  permissions: Set<string>;
  isPlatformAdmin: boolean;
  /** The Super Admin acting inside one pharmacy. */
  supportMode: boolean;

  can(permission: string): boolean;
  require(permission: string): void;
  requireRecentVerification(): void;
  isElevated(): boolean;

  ip: string;
  userAgent: string;
  query: URLSearchParams;
  body: Record<string, any>;
  rawBody: string;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  cookies: Record<string, string>;
  /** Cookies to set on the reply, already serialised. */
  setCookie: string[];
}

/** A handler for a pharmacy endpoint, where pharmacyId is always present. */
export interface PharmacyCtx extends Ctx {
  user: AuthUser;
  session: Session;
  pharmacyId: string;
}

/** What a handler may return. `__status` and `__redirect` are read by the
    router and stripped from the reply. */
export type HandlerResult = (Record<string, any> & { __status?: number; __redirect?: string }) | void;

export type Handler<C extends Ctx = PharmacyCtx> = (ctx: C) => Promise<HandlerResult> | HandlerResult;
