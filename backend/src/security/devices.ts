/* ==========================================================================
   Registered devices
   --------------------------------------------------------------------------
   A device is registered by the server, not fingerprinted. The browser is
   handed an opaque `<id>.<secret>` cookie the first time it signs in and
   presents it afterwards; only the secret's hash is stored. Platform and
   browser are recorded so a person can tell one row from another.

   Each pharmacy's plan sets how many computers and how many phones/tablets
   one person may use. A new machine beyond the limit is refused here, before
   any session exists. Clearing cookies looks like a new device, which is the
   honest behaviour: the old row is removed from the Security Centre, or by
   the pharmacy Admin or the Super Admin from their dashboard.
   ========================================================================== */

import { env } from '../config/env.js';
import { col } from '../db/mongo.js';
import type { Device } from '../db/types.js';
import { nowIso, sha256, toStr, uid } from '../core/util.js';
import { secret } from './crypto.js';

export const DEVICE_COOKIE_SEPARATOR = '.';

export function deviceCategory(userAgent = ''): Device['category'] {
  const ua = String(userAgent);
  if (/\b(iPad|Tablet|PlayBook|Silk)\b/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/\b(Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry)\b/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function describeAgent(userAgent = ''): { platform: string; browser: string; browserVersion: string; label: string } {
  const ua = String(userAgent);
  const platform = /Windows/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X/.test(ua) ? 'macOS'
        : /Android/.test(ua) ? 'Android'
          : /Linux/.test(ua) ? 'Linux'
            : 'Unknown device';
  const pick = (pattern: RegExp, name: string): [string, string] | null => {
    const match = pattern.exec(ua);
    return match ? [name, match[1]] : null;
  };
  const [browser, version] = pick(/Edg\/([\d.]+)/, 'Edge') ?? pick(/OPR\/([\d.]+)/, 'Opera')
    ?? pick(/Firefox\/([\d.]+)/, 'Firefox') ?? pick(/Chrome\/([\d.]+)/, 'Chrome')
    ?? pick(/Version\/([\d.]+).*Safari/, 'Safari') ?? ['Browser', ''];
  return { platform, browser, browserVersion: version.split('.')[0] ?? '', label: `${browser} on ${platform}` };
}

const bucketOf = (category: Device['category']): 'desktop' | 'mobile' => (category === 'desktop' ? 'desktop' : 'mobile');

/** How many devices of each kind one person in this pharmacy may register. */
export async function deviceLimits(pharmacyId: string | null): Promise<{ desktop: number; mobile: number }> {
  if (!pharmacyId) return { desktop: 0, mobile: 0 }; // the Super Admin: no limit
  const pharmacy = await col.pharmacies().findOne({ _id: pharmacyId }, { projection: { device_limit_desktop: 1, device_limit_mobile: 1, plan_key: 1 } });
  const plan = pharmacy?.plan_key ? await col.plans().findOne({ key: pharmacy.plan_key }) : null;
  return {
    desktop: pharmacy?.device_limit_desktop ?? plan?.max_desktop_devices ?? env.DEVICE_LIMIT_DESKTOP,
    mobile: pharmacy?.device_limit_mobile ?? plan?.max_mobile_devices ?? env.DEVICE_LIMIT_MOBILE
  };
}

export async function recogniseDevice(cookieValue: string | undefined, userId: string): Promise<Device | null> {
  if (!cookieValue) return null;
  const [id, key] = String(cookieValue).split(DEVICE_COOKIE_SEPARATOR);
  if (!id || !key) return null;
  const device = await col.devices().findOne({ _id: id, status: 'active' });
  if (!device || device.user_id !== userId || device.secret_hash !== sha256(key)) return null;
  return device;
}

export const publicDevice = (device: Device) => ({
  id: device.id,
  label: device.label || `${device.browser} on ${device.platform}`,
  category: device.category,
  platform: device.platform,
  browser: device.browser,
  browserVersion: device.browser_version,
  registeredAt: device.registered_at,
  lastActiveAt: device.last_active_at,
  lastSeenFrom: approximate(device.last_ip),
  trusted: !!device.trusted,
  status: device.status
});

export type DeviceRegistration =
  | { ok: true; device: Device; cookie: string; isNew: boolean }
  | { ok: false; category: 'desktop' | 'mobile'; limit: number; devices: ReturnType<typeof publicDevice>[] };

/** Register the machine somebody is signing in from, within their limit. */
export async function registerDevice(input: {
  pharmacyId: string | null; userId: string; userAgent: string; ip: string | null; existingCookie?: string;
}): Promise<DeviceRegistration> {
  const known = await recogniseDevice(input.existingCookie, input.userId);
  if (known) {
    await col.devices().updateOne({ _id: known.id }, { $set: { last_active_at: nowIso(), last_ip: input.ip, updated_at: nowIso() } });
    return { ok: true, device: known, cookie: input.existingCookie!, isNew: false };
  }

  const category = deviceCategory(input.userAgent);
  const bucket = bucketOf(category);
  const limits = await deviceLimits(input.pharmacyId);
  const allowed = limits[bucket];
  const active = await col.devices().find({ user_id: input.userId, status: 'active' }, { sort: { registered_at: 1 } }).toArray();
  if (allowed > 0 && active.filter((device) => bucketOf(device.category) === bucket).length >= allowed) {
    return { ok: false, category: bucket, limit: allowed, devices: active.map(publicDevice) };
  }

  const agent = describeAgent(input.userAgent);
  const key = secret(24);
  const at = nowIso();
  const id = uid('DEV');
  const device: Device = {
    _id: id, id, pharmacy_id: input.pharmacyId, user_id: input.userId, secret_hash: sha256(key), category,
    label: agent.label, platform: agent.platform, browser: agent.browser, browser_version: agent.browserVersion,
    first_ip: input.ip, last_ip: input.ip, trusted: 0, status: 'active', registered_at: at, last_active_at: at,
    revoked_at: null, revoked_by: null, revoke_reason: null, created_at: at, updated_at: at
  };
  await col.devices().insertOne(device);
  return { ok: true, device, cookie: `${id}${DEVICE_COOKIE_SEPARATOR}${key}`, isNew: true };
}

/** The network an address belongs to, not the address itself. */
export function approximate(ip: string | null | undefined): string {
  const value = String(ip || '');
  if (!value) return 'Unknown';
  if (value === '::1' || value === '127.0.0.1' || value.startsWith('::ffff:127.')) return 'This computer';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value) || /^::ffff:(10\.|192\.168\.)/.test(value)) return 'Local network';
  if (value.includes(':')) return `${value.split(':').slice(0, 2).join(':')}:…`;
  const parts = value.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'Unknown';
}

export const listDevices = async (userId: string) =>
  (await col.devices().find({ user_id: userId, status: 'active' }, { sort: { last_active_at: -1 } }).toArray()).map(publicDevice);

/** Remove a device. The caller has already proved who is authorising it. */
export async function revokeDevice(input: { deviceId: string; userId: string; revokedBy: string; reason?: string }): Promise<Device | null> {
  const device = await col.devices().findOneAndUpdate(
    { _id: input.deviceId, user_id: input.userId, status: 'active' },
    { $set: { status: 'revoked', revoked_at: nowIso(), revoked_by: input.revokedBy, revoke_reason: toStr(input.reason ?? 'removed-by-user', 120), updated_at: nowIso() } },
    { returnDocument: 'before' }
  );
  return device ?? null;
}

export async function renameDevice(deviceId: string, userId: string, label: unknown): Promise<Device | null> {
  const clean = toStr(label, 60);
  if (!clean) return null;
  return col.devices().findOneAndUpdate(
    { _id: deviceId, user_id: userId, status: 'active' },
    { $set: { label: clean, updated_at: nowIso() } },
    { returnDocument: 'after' }
  );
}
