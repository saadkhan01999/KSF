/* ==========================================================================
   Who is asking
   --------------------------------------------------------------------------
   For every protected request, in this order:

     1. Bearer access token   signature, issuer, audience and expiry
     2. Session               still live: not revoked, idle or past its
                              absolute expiry (so sign-out, a password
                              change or a removed device bites at once)
     3. Person                still active
     4. Device                still registered, if the session has one
     5. Pharmacy              not suspended by the platform
     6. Role                  permissions loaded fresh, so a role change
                              applies on the very next request

   The platform Super Admin belongs to no pharmacy. They may open one in
   support mode with the X-Pharmacy-Id header; inside it they hold every
   pharmacy permission, and everything they do is logged as "Super Admin
   (support)".

   A member of the Super Admin's team belongs to no pharmacy either. Their
   platform role is read fresh on every request like a pharmacy role, so a
   change of role applies at once. They may open a pharmacy in support mode
   only if the role holds platform.pharmacies.enter, and what they do there
   is logged under their own name and "KSF team".
   ========================================================================== */

import type { Request } from 'express';
import { col } from '../db/mongo.js';
import type { Pharmacy, Session } from '../db/types.js';
import { PERMISSION_KEYS } from '../domain/permissions.js';
import { PLATFORM_PERMISSION_KEYS, TEAM_MANAGE } from '../domain/platform.js';
import { liveSession, revokeSession, touchSession, verifyAccessToken } from '../security/sessions.js';
import type { AuthUser } from './context.js';

export const PLATFORM_ROLE = { key: 'super-admin', name: 'Super Admin', level: 1000 } as const;
/** Every team member's role key; the role's own name is what people read. */
export const PLATFORM_TEAM_ROLE = { key: 'platform-team', level: 500 } as const;

/** Everything the Super Admin may do in the platform console. */
const SUPER_ADMIN_PLATFORM = new Set([...PLATFORM_PERMISSION_KEYS, TEAM_MANAGE]);

export type AuthOutcome =
  | {
    ok: true; user: AuthUser; session: Session; permissions: Set<string>; platformPermissions: Set<string>;
    pharmacyId: string | null; supportMode: boolean; isPlatformAdmin: boolean; isPlatformStaff: boolean;
  }
  | { ok: false; status: number; code: string; message: string };

const SESSION_ENDED = { ok: false as const, status: 401, code: 'session_expired', message: 'Your session has ended. Please sign in again.' };

/* Pharmacy status is read on every request, so it is cached briefly. */
const pharmacyCache = new Map<string, { status: Pharmacy['status']; at: number }>();
export const forgetPharmacyStatus = (pharmacyId: string): void => { pharmacyCache.delete(pharmacyId); };

async function pharmacyStatus(pharmacyId: string): Promise<Pharmacy['status'] | null> {
  const cached = pharmacyCache.get(pharmacyId);
  if (cached && Date.now() - cached.at < 15_000) return cached.status;
  const row = await col.pharmacies().findOne({ _id: pharmacyId }, { projection: { status: 1 } });
  if (!row) return null;
  pharmacyCache.set(pharmacyId, { status: row.status, at: Date.now() });
  return row.status;
}

/**
 * Load a person with their role flattened on, or null. `permissions` is what
 * they may do where they work: inside their pharmacy, or — for the Super
 * Admin and the team — in the platform console.
 */
export async function loadAuthUser(userId: string): Promise<{ user: AuthUser; permissions: Set<string> } | null> {
  const user = await col.users().findOne({ _id: userId });
  if (!user) return null;
  if (user.is_platform_admin) {
    return {
      user: { ...user, role_key: PLATFORM_ROLE.key, role_name: PLATFORM_ROLE.name, role_level: PLATFORM_ROLE.level, role_is_system: 1 },
      permissions: new Set(SUPER_ADMIN_PLATFORM)
    };
  }
  if (user.is_platform_staff) {
    const role = user.platform_role_id ? await col.platformRoles().findOne({ _id: user.platform_role_id }) : null;
    if (!role) return null;
    return {
      user: { ...user, role_key: PLATFORM_TEAM_ROLE.key, role_name: role.name, role_level: PLATFORM_TEAM_ROLE.level, role_is_system: 0 },
      /* Only keys a role may hold: a stored key that is not one is ignored. */
      permissions: new Set(role.permissions.filter((key) => PLATFORM_PERMISSION_KEYS.includes(key)))
    };
  }
  const role = user.role_id ? await col.roles().findOne({ _id: user.role_id }) : null;
  if (!role) return null;
  return {
    user: { ...user, role_key: role.key, role_name: role.name, role_level: role.level, role_is_system: role.is_system },
    permissions: new Set(role.permissions)
  };
}

export async function authenticate(req: Request, ip: string): Promise<AuthOutcome | null> {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;

  const claims = verifyAccessToken(header.slice(7).trim());
  if (claims === 'expired') return { ok: false, status: 401, code: 'token_expired', message: 'Your access token has expired.' };
  if (claims === 'invalid') return SESSION_ENDED;

  const session = await liveSession(claims.sid);
  if (!session || session.user_id !== claims.sub) return SESSION_ENDED;

  const loaded = await loadAuthUser(session.user_id);
  if (!loaded || loaded.user.status !== 'active') {
    await revokeSession(session.id, 'account-inactive');
    return SESSION_ENDED;
  }
  const { user } = loaded;
  let { permissions } = loaded;

  if (session.device_id) {
    const device = await col.devices().findOne({ _id: session.device_id, status: 'active' }, { projection: { _id: 1 } });
    if (!device) {
      await revokeSession(session.id, 'device-removed');
      return SESSION_ENDED;
    }
  }

  let pharmacyId = user.pharmacy_id;
  let supportMode = false;
  const isPlatformAdmin = !!user.is_platform_admin;
  const isPlatformStaff = !isPlatformAdmin && !!user.is_platform_staff;
  /* Kept apart from `permissions`, which becomes the pharmacy's in support mode. */
  const platformPermissions = isPlatformAdmin || isPlatformStaff ? new Set(permissions) : new Set<string>();

  if (isPlatformAdmin || isPlatformStaff) {
    const requested = String(req.headers['x-pharmacy-id'] ?? '').trim();
    if (requested) {
      if (isPlatformStaff && !platformPermissions.has('platform.pharmacies.enter')) {
        return { ok: false, status: 403, code: 'support_mode_forbidden', message: 'Your team role does not include working inside a pharmacy.' };
      }
      if (!(await pharmacyStatus(requested))) {
        return { ok: false, status: 404, code: 'pharmacy_not_found', message: 'That pharmacy could not be found.' };
      }
      pharmacyId = requested;
      supportMode = true;
      permissions = new Set(PERMISSION_KEYS);
    }
  } else if (pharmacyId) {
    const status = await pharmacyStatus(pharmacyId);
    if (status === 'suspended' || status === 'closed') {
      return {
        ok: false, status: 403, code: 'pharmacy_suspended',
        message: 'This pharmacy account is suspended. Please contact KSF support.'
      };
    }
  }

  await touchSession(session, ip);
  return { ok: true, user, session, permissions, platformPermissions, pharmacyId, supportMode, isPlatformAdmin, isPlatformStaff };
}
