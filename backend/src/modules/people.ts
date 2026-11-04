/* ==========================================================================
   Staff, roles and branches
   --------------------------------------------------------------------------
   Two seniority rules are enforced on the server:
     - You can never act on someone whose role sits at or above your own,
       except the pharmacy Admin (top of the pharmacy) and the platform Super
       Admin in support mode.
     - You can never grant a permission you do not hold yourself, so nobody
       can quietly promote themselves.

   Removing a person archives them: every invoice they rang up keeps their
   name, and history never loses the person behind a transaction.
   ========================================================================== */

import type { Filter } from 'mongodb';
import { col, tx, s } from '../db/mongo.js';
import type { Branch, Role, User } from '../db/types.js';
import { bad, forbid, missing } from '../core/errors.js';
import { auditLog, logActivity, notify, securityEvent } from '../core/trails.js';
import { contains, isCnic, isEmail, isPkPhone, nowIso, slugify, toInt, toStr, uid } from '../core/util.js';
import { clear } from '../security/throttle.js';
import { PERMISSIONS, PERMISSION_KEYS, PHARMACY_ADMIN_ROLE, SYSTEM_ROLES } from '../domain/permissions.js';
import { hashPassword, passwordProblem } from '../security/password.js';
import { approximate, deviceLimits, listDevices, publicDevice, revokeDevice } from '../security/devices.js';
import { revokeAllSessions, revokeDeviceSessions } from '../security/sessions.js';
import { sendMail, templates } from '../services/mailer.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { currentSubscription } from '../services/subscriptions.js';

/** The pharmacy Admin, or the platform Super Admin helping in support mode. */
export const isTop = (ctx: PharmacyCtx): boolean => ctx.supportMode || ctx.user.role_key === PHARMACY_ADMIN_ROLE;

function assertSeniority(ctx: PharmacyCtx, targetLevel: number, what = 'change'): void {
  if (!isTop(ctx) && targetLevel >= (ctx.user.role_level ?? 0)) forbid(`You cannot ${what} an account at your own level or above.`);
}

async function staffTarget(ctx: PharmacyCtx) {
  const user = await col.users().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!user) return missing('That staff member could not be found.');
  const role = user.role_id ? await col.roles().findOne({ _id: user.role_id }) : null;
  return { ...user, role_key: role?.key ?? '', role_name: role?.name ?? '', role_level: role?.level ?? 0 };
}

/* ================================= STAFF ================================= */
route('GET', '/api/v1/staff', 'staff.read', async (ctx) => {
  const search = toStr(ctx.query.get('q'), 80);
  const filter: Filter<User> = { pharmacy_id: ctx.pharmacyId, status: { $ne: 'archived' } };
  if (search) filter.$or = [{ full_name: contains(search) }, { email: contains(search) }];
  const now = nowIso();

  const rows = await col.users().aggregate([
    { $match: filter },
    { $lookup: { from: 'roles', localField: 'role_id', foreignField: '_id', as: 'role' } },
    { $lookup: { from: 'branches', localField: 'branch_id', foreignField: '_id', as: 'branch' } },
    {
      $lookup: {
        from: 'sessions', let: { uid: '$_id' }, as: 'live',
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$user_id', '$$uid'] }, { $eq: ['$revoked_at', null] }, { $gt: ['$expires_at', now] }] } } }, { $count: 'n' }]
      }
    },
    {
      $lookup: {
        from: 'devices', let: { uid: '$_id' }, as: 'devs',
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$user_id', '$$uid'] }, { $eq: ['$status', 'active'] }] } } }, { $count: 'n' }]
      }
    },
    {
      $lookup: {
        from: 'sales', let: { uid: '$_id' }, as: 'sold',
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$served_by', '$$uid'] }, { $eq: ['$status', 'completed'] }] } } }, { $count: 'n' }]
      }
    },
    {
      $project: {
        id: 1, full_name: 1, email: 1, phone: 1, cnic: 1, pharmacist_reg_no: 1, status: 1, last_login_at: 1, created_at: 1,
        must_change_password: 1, locked_until: 1, is_owner: 1, theme: 1,
        role_id: 1, role_key: { $first: '$role.key' }, role_name: { $first: '$role.name' }, role_level: { $first: '$role.level' },
        role_is_system: { $first: '$role.is_system' },
        branch_id: 1, branch_name: { $first: '$branch.name' },
        active_sessions: { $ifNull: [{ $first: '$live.n' }, 0] },
        devices: { $ifNull: [{ $first: '$devs.n' }, 0] },
        sales_count: { $ifNull: [{ $first: '$sold.n' }, 0] },
        totp_enabled: { $ifNull: ['$totp_enabled', 0] }
      }
    },
    { $sort: { role_level: -1, full_name: 1 } }
  ]).toArray();
  return { data: rows };
});

route('POST', '/api/v1/staff', 'staff.invite', async (ctx) => {
  const fullName = toStr(ctx.body.fullName, 120);
  const email = toStr(ctx.body.email, 160).toLowerCase();
  const roleId = toStr(ctx.body.roleId, 60);
  const password = String(ctx.body.password || '');

  if (!fullName) bad('Enter the staff member full name.', 'fullName');
  if (!isEmail(email)) bad('Enter a valid email address — this is how they sign in.', 'email');
  if (await col.users().findOne({ email }, { projection: { _id: 1 } })) bad('Someone already uses that email address.', 'email');
  const phone = toStr(ctx.body.phone, 40);
  if (phone && !isPkPhone(phone)) bad('Enter a valid Pakistani mobile number.', 'phone');
  const cnic = toStr(ctx.body.cnic, 20);
  if (cnic && !isCnic(cnic)) bad('Enter the CNIC as 12345-1234567-1.', 'cnic');

  const role = await col.roles().findOne({ _id: roleId, pharmacy_id: ctx.pharmacyId });
  if (!role) return bad('Choose the role this person will have.', 'roleId');
  if (role.key === PHARMACY_ADMIN_ROLE && !isTop(ctx)) forbid('Only the pharmacy Admin can add another Admin.');
  assertSeniority(ctx, role.level, 'create');

  /* The plan's limit on people, so the price of a plan means something. */
  const subscription = await currentSubscription(ctx.pharmacyId);
  if (subscription && subscription.max_users > 0) {
    const people = await col.users().countDocuments({ pharmacy_id: ctx.pharmacyId, status: { $ne: 'archived' } });
    if (people >= subscription.max_users) {
      bad(`Your ${subscription.plan_name} plan allows ${subscription.max_users} people. Upgrade under Settings › Billing to add more.`);
    }
  }

  const problem = passwordProblem(password);
  if (problem) bad(problem, 'password');

  const branchId = toStr(ctx.body.branchId, 40) || null;
  if (branchId && !(await col.branches().findOne({ _id: branchId, pharmacy_id: ctx.pharmacyId }))) bad('That branch could not be found.', 'branchId');
  /* A pharmacist must carry a registration number — a legal requirement. */
  const regNo = toStr(ctx.body.pharmacistRegNo, 40);
  if (role.key === 'pharmacist' && !regNo) bad('A pharmacist account needs their Pharmacy Council registration number.', 'pharmacistRegNo');

  const id = uid('USR');
  const at = nowIso();
  const user: User = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: branchId, role_id: role.id, full_name: fullName, email,
    phone: phone || null, cnic: cnic || null, pharmacist_reg_no: regNo || null, password_hash: await hashPassword(password),
    password_changed_at: at, must_change_password: 1, status: 'active', failed_attempts: 0, locked_until: null,
    last_login_at: null, email_verified_at: null, totp_secret: null, totp_enabled: 0, totp_confirmed_at: null,
    recovery_generated_at: null, is_owner: 0, theme: null, created_at: at, updated_at: at
  };
  await col.users().insertOne(user);

  await logActivity(ctx, { action: 'staff.created', entity: 'user', entityId: id, severity: 'warn', summary: `${fullName} added as ${role.name}`, meta: { email, role: role.key } });
  await notify(ctx.pharmacyId, { type: 'staff', severity: 'info', title: `${fullName} joined as ${role.name}`, body: 'They must change their password the first time they sign in.', link: '/staff' });
  return { data: { id, full_name: fullName, email, status: 'active' }, __status: 201 };
});

route('PATCH', '/api/v1/staff/:id', 'staff.manage', async (ctx) => {
  const target = await staffTarget(ctx);
  if (target.id !== ctx.user.id) assertSeniority(ctx, target.role_level, 'edit');

  let roleId = target.role_id;
  if (ctx.body.roleId && ctx.body.roleId !== target.role_id) {
    const role = await col.roles().findOne({ _id: toStr(ctx.body.roleId, 60), pharmacy_id: ctx.pharmacyId });
    if (!role) return bad('That role could not be found.', 'roleId');
    if (role.key === PHARMACY_ADMIN_ROLE && !isTop(ctx)) forbid('Only the pharmacy Admin can grant the Admin role.');
    assertSeniority(ctx, role.level, 'promote to');
    if (target.is_owner && !ctx.supportMode) forbid('The account that owns the pharmacy keeps the Admin role. Transfer ownership first.');
    roleId = role.id;
  }

  /* A field that is not sent keeps what is stored. "Suspend access" sends
     only the status, and must not wipe a phone number or a registration. */
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(ctx.body, key);
  const fullName = toStr(ctx.body.fullName, 120) || target.full_name;
  const phone = sent('phone') ? toStr(ctx.body.phone, 40) : (target.phone ?? '');
  if (phone && !isPkPhone(phone)) bad('Enter a valid Pakistani mobile number.', 'phone');
  const cnic = sent('cnic') ? toStr(ctx.body.cnic, 20) : (target.cnic ?? '');
  if (cnic && !isCnic(cnic)) bad('Enter the CNIC as 12345-1234567-1.', 'cnic');
  const regNo = sent('pharmacistRegNo') ? toStr(ctx.body.pharmacistRegNo, 40) : (target.pharmacist_reg_no ?? '');

  const status = (toStr(ctx.body.status, 20) || target.status) as User['status'];
  if (!['active', 'suspended'].includes(status)) bad('Status must be active or suspended.', 'status');
  if (status !== target.status && target.is_owner) forbid('The account that owns the pharmacy cannot be suspended.');
  const branchId = sent('branchId') ? (toStr(ctx.body.branchId, 40) || null) : target.branch_id;
  if (branchId && branchId !== target.branch_id && !(await col.branches().findOne({ _id: branchId, pharmacy_id: ctx.pharmacyId }))) {
    bad('That branch could not be found.', 'branchId');
  }

  await col.users().updateOne({ _id: target.id }, {
    $set: {
      full_name: fullName, phone: phone || null, cnic: cnic || null, pharmacist_reg_no: regNo || null,
      branch_id: branchId, role_id: roleId, status, updated_at: nowIso()
    }
  });
  /* Suspending somebody takes effect immediately, not at their next sign-in. */
  if (status !== 'active') await revokeAllSessions(target.id, { reason: 'account-suspended' });

  await logActivity(ctx, {
    action: 'staff.updated', entity: 'user', entityId: target.id, severity: 'warn',
    summary: `${fullName} updated${status !== target.status ? ` — status now ${status}` : ''}${roleId !== target.role_id ? ' — role changed' : ''}`
  });
  return { data: { id: target.id, full_name: fullName, email: target.email, status, role_id: roleId } };
});

route('POST', '/api/v1/staff/:id/reset-password', 'staff.manage', async (ctx) => {
  const target = await staffTarget(ctx);
  assertSeniority(ctx, target.role_level, 'reset the password of');
  const password = String(ctx.body.password || '');
  const problem = passwordProblem(password);
  if (problem) bad(problem, 'password');

  const at = nowIso();
  await col.users().updateOne({ _id: target.id }, {
    $set: { password_hash: await hashPassword(password), password_changed_at: at, must_change_password: 1, failed_attempts: 0, locked_until: null, updated_at: at }
  });
  /* A reset password must not leave old sessions alive on other machines. */
  await revokeAllSessions(target.id, { reason: 'password-reset' });
  await clear(`login:${target.email.toLowerCase()}`);
  await logActivity(ctx, { action: 'staff.password-reset', entity: 'user', entityId: target.id, severity: 'danger', summary: `Password reset for ${target.full_name} by ${ctx.user.full_name}` });
  return { ok: true };
});

route('POST', '/api/v1/staff/:id/unlock', 'staff.manage', async (ctx) => {
  const target = await staffTarget(ctx);
  await col.users().updateOne({ _id: target.id }, { $set: { failed_attempts: 0, locked_until: null, updated_at: nowIso() } });
  /* And the in-memory sign-in throttle for their address. */
  await clear(`login:${target.email.toLowerCase()}`);
  await logActivity(ctx, { action: 'staff.unlocked', entity: 'user', entityId: target.id, severity: 'warn', summary: `${target.full_name} unlocked` });
  return { ok: true };
});

route('POST', '/api/v1/staff/:id/sign-out', 'staff.manage', async (ctx) => {
  const target = await staffTarget(ctx);
  const ended = await revokeAllSessions(target.id, { reason: 'signed-out-by-admin' });
  await logActivity(ctx, { action: 'staff.signed-out', entity: 'user', entityId: target.id, severity: 'warn', summary: `${target.full_name} signed out of all devices` });
  return { ok: true, sessions: ended };
});

route('DELETE', '/api/v1/staff/:id', 'staff.manage', async (ctx) => {
  const target = await staffTarget(ctx);
  if (target.id === ctx.user.id) bad('You cannot remove your own account.');
  if (target.is_owner) forbid('The account that owns the pharmacy cannot be removed. Transfer ownership first.');
  assertSeniority(ctx, target.role_level, 'remove');
  await col.users().updateOne({ _id: target.id }, { $set: { status: 'archived', updated_at: nowIso() } });
  await revokeAllSessions(target.id, { reason: 'account-archived' });
  await logActivity(ctx, { action: 'staff.archived', entity: 'user', entityId: target.id, severity: 'danger', summary: `${target.full_name} removed from the team` });
  return { ok: true };
});

/* ============================ HELPING STAFF ==============================
   "Sir, I cannot sign in." The reason is already on the Admin's dashboard and
   the fix is one click away. Everything is read from what sign-in already
   records; a problem disappears once the person signs in or it is fixed. */
const HELP_WINDOW_HOURS = 24;

export const canHelp = (ctx: PharmacyCtx, roleLevel: number): boolean => isTop(ctx) || roleLevel < (ctx.user.role_level ?? 0);

/** Who in one pharmacy is stuck, and what fixes it. Used by the platform too. */
export async function helpItems(pharmacyId: string, viewer: { id: string; level: number; top: boolean }) {
  const now = nowIso();
  const since = new Date(Date.now() - HELP_WINDOW_HOURS * 3_600_000).toISOString();
  const users = await col.users().aggregate<User & { role_name: string; role_level: number }>([
    { $match: { pharmacy_id: pharmacyId, status: { $ne: 'archived' }, _id: { $ne: viewer.id } } },
    { $lookup: { from: 'roles', localField: 'role_id', foreignField: '_id', as: 'role' } },
    { $set: { role_name: { $first: '$role.name' }, role_level: { $first: '$role.level' } } },
    { $unset: 'role' }
  ]).toArray();
  if (!users.length) return [];

  const events = await col.securityEvents().aggregate<{ _id: { user: string; type: string }; at: string }>([
    {
      $match: {
        user_id: { $in: users.map((user) => user._id) },
        type: { $in: ['auth.login', 'auth.failed', 'device.limit-reached', 'device.removed', 'auth.2fa-failed', 'auth.suspended'] }
      }
    },
    { $group: { _id: { user: '$user_id', type: '$type' }, at: { $max: '$created_at' } } }
  ]).toArray();
  const last = (userId: string, type: string) => events.find((event) => event._id.user === userId && event._id.type === type)?.at ?? null;
  const devices = await col.devices().aggregate<{ _id: string; n: number }>([
    { $match: { user_id: { $in: users.map((user) => user._id) }, status: 'active' } }, { $group: { _id: '$user_id', n: { $sum: 1 } } }
  ]).toArray();

  const recent = (at: string | null) => !!at && at >= since;
  const unresolved = (at: string | null, ...settledBy: Array<string | null>) => recent(at) && settledBy.every((later) => !later || at! > later);

  const items: Array<Record<string, unknown>> = [];
  for (const user of users) {
    if (!viewer.top && (user.role_level ?? 0) >= viewer.level) continue;
    const who = { userId: user.id, name: user.full_name, role: user.role_name, pharmacyId };
    const signedIn = last(user.id, 'auth.login');
    const failedAt = last(user.id, 'auth.failed');
    const locked = !!user.locked_until && user.locked_until > now;
    const deviceCount = devices.find((row) => row._id === user.id)?.n ?? 0;

    if (locked) {
      items.push({ ...who, kind: 'locked', fix: 'unlock', at: failedAt ?? now, title: 'Locked out', detail: 'Typed the wrong password too many times, so the account is locked for a while.' });
    } else if (user.failed_attempts >= 2 && unresolved(failedAt, signedIn)) {
      items.push({ ...who, kind: 'wrong-password', fix: 'reset-password', at: failedAt, title: 'Wrong password', detail: `Typed the wrong password ${user.failed_attempts} times. If they have forgotten it, give them a new one.` });
    }
    const limitAt = last(user.id, 'device.limit-reached');
    if (unresolved(limitAt, signedIn, last(user.id, 'device.removed'))) {
      items.push({ ...who, kind: 'device-limit', fix: 'devices', at: limitAt, title: 'Cannot sign in on a new computer', detail: `Already uses ${deviceCount} device${deviceCount === 1 ? '' : 's'}, the most allowed. Remove one they no longer use.` });
    }
    const twoStepAt = last(user.id, 'auth.2fa-failed');
    if (user.totp_enabled && unresolved(twoStepAt, signedIn)) {
      items.push({ ...who, kind: 'two-step', fix: 'reset-2fa', at: twoStepAt, title: 'Stuck at two-step sign-in', detail: 'The code from their phone is not accepted (a new or lost phone?). Switch it off so they can sign in, then they can set it up again.' });
    }
    const suspendedAt = last(user.id, 'auth.suspended');
    if (user.status === 'suspended' && recent(suspendedAt)) {
      items.push({ ...who, kind: 'suspended', fix: 'restore', at: suspendedAt, title: 'Tried to sign in while suspended', detail: 'Their access is suspended. Restore it if they should be working.' });
    }
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return items.map((item) => ({ ...item, id: `${item.userId}:${item.kind}` }));
}

route('GET', '/api/v1/staff/help', 'staff.manage', async (ctx) => ({
  data: await helpItems(ctx.pharmacyId, { id: ctx.user.id, level: ctx.user.role_level, top: isTop(ctx) }),
  checkedAt: nowIso()
}));

/** The staff member a help action is for — never yourself, never a senior. */
async function helpTarget(ctx: PharmacyCtx, what: string) {
  const target = await staffTarget(ctx);
  if (target.id === ctx.user.id) bad('This is your own account. Use Settings › Security Centre instead.');
  if (!canHelp(ctx, target.role_level)) forbid(`You cannot ${what} an account at your own level or above.`);
  return target;
}

route('GET', '/api/v1/staff/:id/devices', 'staff.manage', async (ctx) => {
  const target = await helpTarget(ctx, 'look after the devices of');
  return {
    data: await listDevices(target.id),
    limits: await deviceLimits(ctx.pharmacyId),
    person: { id: target.id, name: target.full_name, role: target.role_name }
  };
});

route('DELETE', '/api/v1/staff/:id/devices/:deviceId', 'staff.manage', async (ctx) => {
  const target = await helpTarget(ctx, 'remove a device of');
  const device = await revokeDevice({ deviceId: toStr(ctx.params.deviceId, 60), userId: target.id, revokedBy: ctx.user.id, reason: `removed by ${ctx.user.full_name}` });
  if (!device) return missing('That device could not be found.');
  const label = publicDevice(device).label;
  const ended = await revokeDeviceSessions(device.id, 'device-removed');
  /* Recorded against the staff member, so their problem counts as settled. */
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: target.id, emailHint: target.email, type: 'device.removed', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent, deviceId: device.id, detail: `removed by ${ctx.user.full_name}` });
  await auditLog(ctx, { action: 'staff.device-removed', entity: 'device', entityId: device.id, summary: `${label} removed from ${target.full_name}'s account by ${ctx.user.full_name}` });
  await logActivity(ctx, { action: 'staff.device-removed', entity: 'user', entityId: target.id, severity: 'warn', summary: `${label} removed from ${target.full_name}'s devices, ${ended} session(s) ended` });
  return { ok: true, sessionsEnded: ended, message: `${label} has been removed. ${target.full_name} can now sign in on another computer.` };
});

/* Switching off someone else's two-step sign-in is the most sensitive fix
   here, so the person doing it confirms their own password first. */
route('POST', '/api/v1/staff/:id/reset-2fa', 'staff.manage', async (ctx) => {
  const target = await helpTarget(ctx, 'switch off two-step sign-in for');
  ctx.requireRecentVerification();
  if (!target.totp_enabled) return { ok: true, message: `Two-step sign-in is already off for ${target.full_name}.` };

  await tx(async () => {
    await col.users().updateOne({ _id: target.id }, { $set: { totp_enabled: 0, totp_secret: null, totp_confirmed_at: null, updated_at: nowIso() } }, s());
    await col.recoveryCodes().deleteMany({ user_id: target.id }, s());
  });
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: target.id, emailHint: target.email, type: '2fa.disabled', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent, detail: `switched off by ${ctx.user.full_name}` });
  await auditLog(ctx, { action: 'staff.2fa-reset', entity: 'user', entityId: target.id, summary: `Two-step sign-in switched off for ${target.full_name} by ${ctx.user.full_name}` });
  await logActivity(ctx, { action: 'staff.2fa-reset', entity: 'user', entityId: target.id, severity: 'danger', summary: `Two-step sign-in switched off for ${target.full_name}` });
  sendMail({
    to: target.email, template: 'securityAlert',
    ...templates.securityAlert({ name: target.full_name, what: `Two-step sign-in was switched off by ${ctx.user.full_name}`, when: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }), where: approximate(ctx.ip) })
  }).catch(() => { /* the change stands regardless */ });
  return { ok: true, message: `Two-step sign-in is off for ${target.full_name}. They can sign in with their password and set it up again.` };
});

/* ================================= ROLES ================================= */
const catalogue = PERMISSIONS.map(([key, label, group]) => ({ key, label, group }));

route('GET', '/api/v1/roles', 'roles.read', async (ctx) => {
  const roles = await col.roles().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId } },
    {
      $lookup: {
        from: 'users', let: { rid: '$_id' }, as: 'members',
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$role_id', '$$rid'] }, { $eq: ['$status', 'active'] }] } } }, { $count: 'n' }]
      }
    },
    { $set: { member_count: { $ifNull: [{ $first: '$members.n' }, 0] } } },
    { $unset: 'members' },
    { $sort: { level: -1, name: 1 } }
  ]).toArray();
  return {
    data: roles, catalogue,
    templates: SYSTEM_ROLES.map((role) => ({ key: role.key, name: role.name, description: role.description, permissions: role.permissions })),
    myLevel: ctx.user.role_level,
    myPermissions: [...ctx.permissions]
  };
});

function validatePermissions(ctx: PharmacyCtx, requested: unknown): string[] {
  const list = Array.isArray(requested) ? [...new Set(requested.map((p) => String(p)))] : [];
  if (!list.length) bad('Choose at least one permission for this role.', 'permissions');
  const unknown = list.filter((p) => !PERMISSION_KEYS.includes(p));
  if (unknown.length) bad(`Unknown permission: ${unknown[0]}`, 'permissions');
  /* You cannot hand out access you do not have. */
  if (!isTop(ctx)) {
    const overreach = list.filter((p) => !ctx.permissions.has(p));
    if (overreach.length) {
      const label = PERMISSIONS.find((p) => p[0] === overreach[0])?.[1] ?? overreach[0];
      bad(`You cannot grant "${label}" because you do not hold that permission yourself.`, 'permissions');
    }
  }
  return list;
}

/** A custom role always sits below its creator so it cannot outrank them. */
const capLevel = (ctx: PharmacyCtx, requested: number): number =>
  Math.max(1, Math.min(requested, isTop(ctx) ? 99 : (ctx.user.role_level ?? 10) - 1));

async function roleOut(id: string): Promise<Role | null> {
  return col.roles().findOne({ _id: id });
}

route('POST', '/api/v1/roles', 'roles.manage', async (ctx) => {
  const name = toStr(ctx.body.name, 60);
  if (!name) bad('Give the role a name, for example "Stock Controller".', 'name');
  const key = slugify(name);
  if (!key) bad('That role name cannot be used. Try something with letters in it.', 'name');
  if (key === PHARMACY_ADMIN_ROLE || await col.roles().findOne({ pharmacy_id: ctx.pharmacyId, key })) bad('A role with that name already exists.', 'name');

  const permissions = validatePermissions(ctx, ctx.body.permissions);
  const id = uid('ROLE');
  const at = nowIso();
  const role: Role = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, key, name, description: toStr(ctx.body.description, 300) || null,
    icon: toStr(ctx.body.icon, 30) || 'shield', level: capLevel(ctx, toInt(ctx.body.level, 40)), is_system: 0,
    permissions, created_by: ctx.user.id, created_at: at, updated_at: at
  };
  await col.roles().insertOne(role);
  await logActivity(ctx, { action: 'role.created', entity: 'role', entityId: id, severity: 'warn', summary: `Role "${name}" created with ${permissions.length} permission(s)`, meta: { permissions } });
  await auditLog(ctx, { action: 'role.created', entity: 'role', entityId: id, summary: `Role "${name}" created`, after: { permissions } });
  return { data: { ...role, member_count: 0 }, __status: 201 };
}, { feature: 'staff.roles' });

route('PATCH', '/api/v1/roles/:id', 'roles.manage', async (ctx) => {
  const role = await col.roles().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!role) return missing('That role could not be found.');
  if (role.key === PHARMACY_ADMIN_ROLE) forbid('The Admin role always holds every permission and cannot be edited.');
  if (role.level >= (ctx.user.role_level ?? 0) && !isTop(ctx)) forbid('You cannot edit a role at your own level or above.');

  const name = role.is_system ? role.name : (toStr(ctx.body.name, 60) || role.name);
  if (!role.is_system && name !== role.name) {
    const key = slugify(name);
    if (await col.roles().findOne({ pharmacy_id: ctx.pharmacyId, key, _id: { $ne: role.id } })) bad('A role with that name already exists.', 'name');
  }
  const permissions = ctx.body.permissions ? validatePermissions(ctx, ctx.body.permissions) : null;
  await col.roles().updateOne({ _id: role.id }, {
    $set: {
      name, description: ctx.body.description !== undefined ? toStr(ctx.body.description, 300) || null : role.description,
      icon: toStr(ctx.body.icon, 30) || role.icon,
      level: role.is_system ? role.level : capLevel(ctx, toInt(ctx.body.level, role.level)),
      ...(permissions ? { permissions } : {}), updated_at: nowIso()
    }
  });
  await logActivity(ctx, { action: 'role.updated', entity: 'role', entityId: role.id, severity: 'warn', summary: `Role "${name}" updated${permissions ? ` — now ${permissions.length} permission(s)` : ''}`, meta: { permissions } });
  if (permissions) await auditLog(ctx, { action: 'role.permissions-changed', entity: 'role', entityId: role.id, summary: `Permissions of "${name}" changed`, before: { permissions: role.permissions }, after: { permissions } });
  return { data: await roleOut(role.id) };
}, { feature: 'staff.roles' });

route('DELETE', '/api/v1/roles/:id', 'roles.manage', async (ctx) => {
  const role = await col.roles().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!role) return missing('That role could not be found.');
  if (role.is_system) bad('Built-in roles cannot be deleted. You can create your own role instead.');
  if (role.level >= (ctx.user.role_level ?? 0) && !isTop(ctx)) forbid('You cannot delete a role at your own level or above.');
  const members = await col.users().countDocuments({ role_id: role.id, status: { $ne: 'archived' } });
  if (members > 0) bad(`${members} staff member(s) still use this role. Move them to another role first.`);
  await col.roles().deleteOne({ _id: role.id });
  await logActivity(ctx, { action: 'role.deleted', entity: 'role', entityId: role.id, severity: 'danger', summary: `Role "${role.name}" deleted` });
  await auditLog(ctx, { action: 'role.deleted', entity: 'role', entityId: role.id, summary: `Role "${role.name}" deleted`, before: { permissions: role.permissions } });
  return { ok: true };
}, { feature: 'staff.roles' });

route('POST', '/api/v1/roles/:id/duplicate', 'roles.manage', async (ctx) => {
  const source = await col.roles().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!source) return missing('That role could not be found.');
  const name = toStr(ctx.body.name, 60) || `${source.name} (copy)`;
  const key = slugify(name);
  if (await col.roles().findOne({ pharmacy_id: ctx.pharmacyId, key })) bad('A role with that name already exists.', 'name');
  const permissions = validatePermissions(ctx, source.permissions);
  const id = uid('ROLE');
  const at = nowIso();
  const role: Role = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, key, name, description: source.description, icon: source.icon,
    level: capLevel(ctx, Math.min(source.level, 99)), is_system: 0, permissions, created_by: ctx.user.id, created_at: at, updated_at: at
  };
  await col.roles().insertOne(role);
  await logActivity(ctx, { action: 'role.duplicated', entity: 'role', entityId: id, severity: 'warn', summary: `Role "${name}" created from "${source.name}"` });
  return { data: { ...role, member_count: 0 }, __status: 201 };
}, { feature: 'staff.roles' });

/** Give a new pharmacy its built-in roles. */
export async function installRoles(pharmacyId: string): Promise<Map<string, string>> {
  const at = nowIso();
  const ids = new Map<string, string>();
  for (const template of SYSTEM_ROLES) {
    const id = `ROLE-${template.key.toUpperCase()}-${pharmacyId.slice(-8)}`;
    await col.roles().updateOne(
      { pharmacy_id: pharmacyId, key: template.key },
      {
        $setOnInsert: {
          _id: id, id, pharmacy_id: pharmacyId, key: template.key, name: template.name, description: template.description,
          icon: template.icon, level: template.level, is_system: 1, permissions: template.permissions, created_by: null,
          created_at: at, updated_at: at
        }
      },
      { upsert: true, ...s() }
    );
    ids.set(template.key, id);
  }
  return ids;
}

/* ================================ BRANCHES ================================ */
route('GET', '/api/v1/branches', 'settings.read', async (ctx) => {
  const rows = await col.branches().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId } },
    {
      $lookup: {
        from: 'users', let: { bid: '$_id' }, as: 'staff',
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$branch_id', '$$bid'] }, { $eq: ['$status', 'active'] }] } } }, { $count: 'n' }]
      }
    },
    {
      $lookup: {
        from: 'sales', let: { bid: '$_id' }, as: 'sold',
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$branch_id', '$$bid'] }, { $eq: ['$status', 'completed'] }] } } },
          { $group: { _id: null, n: { $sum: 1 }, revenue: { $sum: '$total_paisa' } } }
        ]
      }
    },
    {
      $set: {
        staff_count: { $ifNull: [{ $first: '$staff.n' }, 0] },
        sales_count: { $ifNull: [{ $first: '$sold.n' }, 0] },
        revenue_paisa: { $ifNull: [{ $first: '$sold.revenue' }, 0] }
      }
    },
    { $unset: ['staff', 'sold'] },
    { $sort: { is_main: -1, name: 1 } }
  ]).toArray();
  return { data: rows };
});

route('POST', '/api/v1/branches', 'branches.manage', async (ctx) => {
  const name = toStr(ctx.body.name, 120);
  if (!name) bad('Give the branch a name.', 'name');
  const subscription = await currentSubscription(ctx.pharmacyId);
  if (subscription && subscription.max_branches > 0) {
    const branches = await col.branches().countDocuments({ pharmacy_id: ctx.pharmacyId, status: 'active' });
    if (branches >= subscription.max_branches) bad(`Your ${subscription.plan_name} plan allows ${subscription.max_branches} branch(es). Upgrade under Settings › Billing to open another.`);
  }
  const id = uid('BR');
  const at = nowIso();
  const branch: Branch = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, name, code: toStr(ctx.body.code, 20) || null, address: toStr(ctx.body.address, 300) || null,
    city: toStr(ctx.body.city, 80) || 'Karachi', province: toStr(ctx.body.province, 60) || 'Sindh', phone: toStr(ctx.body.phone, 40) || null,
    drap_licence: toStr(ctx.body.drapLicence, 60) || null, is_main: 0, status: 'active', created_at: at, updated_at: at
  };
  await col.branches().insertOne(branch);
  await logActivity(ctx, { action: 'branch.created', entity: 'branch', entityId: id, summary: `Branch "${name}" opened` });
  return { data: branch, __status: 201 };
});

route('PATCH', '/api/v1/branches/:id', 'branches.manage', async (ctx) => {
  const branch = await col.branches().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!branch) return missing('That branch could not be found.');
  const status = toStr(ctx.body.status, 20) || branch.status;
  if (branch.is_main && status !== 'active') bad('The main branch cannot be closed. Make another branch the main one first.');
  const keep = (key: string, max: number, current: string | null) => (ctx.body[key] !== undefined ? toStr(ctx.body[key], max) || null : current);
  await col.branches().updateOne({ _id: branch.id }, {
    $set: {
      name: toStr(ctx.body.name, 120) || branch.name, code: keep('code', 20, branch.code), address: keep('address', 300, branch.address),
      city: keep('city', 80, branch.city), province: keep('province', 60, branch.province), phone: keep('phone', 40, branch.phone),
      drap_licence: keep('drapLicence', 60, branch.drap_licence), status, updated_at: nowIso()
    }
  });
  await logActivity(ctx, { action: 'branch.updated', entity: 'branch', entityId: branch.id, summary: `Branch "${branch.name}" updated` });
  return { data: await col.branches().findOne({ _id: branch.id }) };
});

