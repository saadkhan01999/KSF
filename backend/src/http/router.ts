/* ==========================================================================
   Route registry
   --------------------------------------------------------------------------
   Each module registers its endpoints at import time with a single call that
   states, in one line, who may use it:

     publicRoute(...)      anybody, signed in or not (registration, plans)
     accountRoute(...)     any signed-in person, pharmacy or platform
     platformRoute(...)    the platform Super Admin only
     route(..., 'perm')    pharmacy endpoints — signed in, inside a pharmacy,
                           and holding the named permission

   Authorisation is never a matter of which buttons the web app drew: the
   check happens in http/app.ts before the handler runs, for every request.
   ========================================================================== */

import type { Ctx, Handler, PharmacyCtx } from './context.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Access = 'public' | 'account' | 'platform' | 'pharmacy';

export interface RouteOptions {
  /** Public POSTs are refused from other origins unless this is set (webhooks). */
  allowCrossOrigin?: boolean;
}

export interface RouteDef {
  method: Method;
  path: string;
  access: Access;
  permission: string | null;
  handler: Handler<any>;
  options: RouteOptions;
}

export const routes: RouteDef[] = [];

/** A pharmacy endpoint guarded by one permission (or null for any member). */
export function route(method: Method, path: string, permission: string | null, handler: Handler<PharmacyCtx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'pharmacy', permission, handler, options });
}

export function publicRoute(method: Method, path: string, handler: Handler<Ctx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'public', permission: null, handler, options });
}

export function accountRoute(method: Method, path: string, handler: Handler<SignedInCtx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'account', permission: null, handler, options });
}

export function platformRoute(method: Method, path: string, handler: Handler<SignedInCtx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'platform', permission: null, handler, options });
}

/** Signed in, but not necessarily inside a pharmacy. */
export interface SignedInCtx extends Ctx {
  user: NonNullable<Ctx['user']>;
  session: NonNullable<Ctx['session']>;
}
