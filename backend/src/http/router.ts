/* ==========================================================================
   Route registry
   --------------------------------------------------------------------------
   Each module registers its endpoints at import time with a single call that
   states, in one line, who may use it:

     publicRoute(...)              anybody, signed in or not (registration, plans)
     accountRoute(...)             any signed-in person, pharmacy or platform
     platformRoute(..., access)    the platform console: the Super Admin, and
                                   team members whose platform role holds the
                                   access named ('owner' keeps it to the
                                   Super Admin alone)
     route(..., 'perm')            pharmacy endpoints — signed in, inside a
                                   pharmacy, and holding the named permission

   Authorisation is never a matter of which buttons the web app drew: the
   check happens in http/app.ts before the handler runs, for every request.
   ========================================================================== */

import type { Ctx, Handler, PharmacyCtx } from './context.js';
import type { PlatformAccess } from '../domain/platform.js';

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
  /** Platform routes: who in the platform console may use it. */
  platform: PlatformAccess | null;
  handler: Handler<any>;
  options: RouteOptions;
}

export const routes: RouteDef[] = [];

/** A pharmacy endpoint guarded by one permission (or null for any member). */
export function route(method: Method, path: string, permission: string | null, handler: Handler<PharmacyCtx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'pharmacy', permission, platform: null, handler, options });
}

export function publicRoute(method: Method, path: string, handler: Handler<Ctx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'public', permission: null, platform: null, handler, options });
}

export function accountRoute(method: Method, path: string, handler: Handler<SignedInCtx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'account', permission: null, platform: null, handler, options });
}

export function platformRoute(method: Method, path: string, access: PlatformAccess, handler: Handler<SignedInCtx>, options: RouteOptions = {}): void {
  routes.push({ method, path, access: 'platform', permission: null, platform: access, handler, options });
}

/** Signed in, but not necessarily inside a pharmacy. */
export interface SignedInCtx extends Ctx {
  user: NonNullable<Ctx['user']>;
  session: NonNullable<Ctx['session']>;
}
