/* ==========================================================================
   The Super Admin's team
   --------------------------------------------------------------------------
   The Super Admin can bring people in to run the platform with them — a help
   desk, a finance desk, an operations manager — each with their own e-mail
   address, their own password and a photo, and each holding one platform
   role. A role is a name and exactly the platform permissions ticked for it
   (domain/platform.ts); there can be as many roles as the business needs.

   Rules, all enforced here whatever the browser sends:
     - Only the Super Admin manages the team and its roles. No role can hold
       that power, so nobody can promote themselves.
     - A member signs in with a temporary password and must replace it.
     - Suspending, removing or resetting a member, or changing their role,
       applies on their very next request: sessions end at once, and roles
       are read fresh on every request.
     - A role in use cannot be deleted; its members move first.
   ========================================================================== */

import { col } from '../db/mongo.js';
import type { PlatformRole, User } from '../db/types.js';
import { bad, conflict, missing } from '../core/errors.js';
import { logActivity } from '../core/trails.js';
import { isEmail, isPkPhone, nowIso, sanitiseText, toStr, uid } from '../core/util.js';
import { clear } from '../security/throttle.js';
import { platformRoute, type SignedInCtx } from '../http/router.js';
import { env } from '../config/env.js';
import { PLATFORM_PERMISSIONS, PLATFORM_ROLE_TEMPLATES, normalisePlatformPermissions } from '../domain/platform.js';
import { hashPassword, passwordProblem } from '../security/password.js';
import { revokeAllSessions } from '../security/sessions.js';
import { avatarUrl, readImage, removeAvatar, replaceAvatar } from '../services/avatars.js';
import { sendMail } from '../services/mailer.js';

const catalogue = PLATFORM_PERMISSIONS.map(([key, label, group]) => ({ key, label, group }));
const trail = (ctx: SignedInCtx) => ({ pharmacyId: null, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent });
const nameKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

/* ------------------------------------------------------------------ views */
type MemberRow = Pick<User, 'id' | 'full_name' | 'email' | 'phone' | 'job_title' | 'status' | 'platform_role_id' | 'avatar_id'
  | 'last_login_at' | 'created_at' | 'totp_enabled' | 'must_change_password' | 'locked_until'>;

const memberView = (user: MemberRow, roles: Map<string, PlatformRole>) => ({
  id: user.id, full_name: user.full_name, email: user.email, phone: user.phone ?? null, job_title: user.job_title ?? null,
  status: user.status, role_id: user.platform_role_id ?? null, role_name: roles.get(user.platform_role_id ?? '')?.name ?? null,
  avatar_url: avatarUrl(user.avatar_id), last_login_at: user.last_login_at, created_at: user.created_at,
  two_factor: !!user.totp_enabled, must_change_password: !!user.must_change_password,
  locked: !!user.locked_until && new Date(user.locked_until).getTime() > Date.now()
});

const roleView = (role: PlatformRole, members: number) => ({
  id: role.id, name: role.name, description: role.description, permissions: role.permissions,
  members, created_at: role.created_at, updated_at: role.updated_at
});

const MEMBER_FIELDS = {
  id: 1, full_name: 1, email: 1, phone: 1, job_title: 1, status: 1, platform_role_id: 1, avatar_id: 1,
  last_login_at: 1, created_at: 1, totp_enabled: 1, must_change_password: 1, locked_until: 1
} as const;

async function memberOr404(id: unknown): Promise<User> {
  /* Only ever a team member: never the Super Admin, never somebody in a pharmacy. */
  const member = await col.users().findOne({ _id: toStr(id, 60), is_platform_staff: 1, status: { $ne: 'archived' } });
  if (!member) return missing('That team member could not be found.');
  return member;
}

async function roleOr400(id: unknown, field = 'roleId'): Promise<PlatformRole> {
  const role = await col.platformRoles().findOne({ _id: toStr(id, 60) });
  if (!role) return bad('Choose the role this person will have.', field);
  return role;
}

/* --------------------------------------------------- shared with the desk */

/** Everybody who may be given a support request: the Super Admin and the team members whose role answers requests. */
export async function supportAgents(): Promise<Array<{ id: string; name: string; role: string; avatar_url: string | null }>> {
  const roles = await col.platformRoles().find({ permissions: 'platform.support' }, { projection: { name: 1 } }).toArray();
  const roleName = new Map(roles.map((role) => [role._id, role.name]));
  const people = await col.users().find({
    status: 'active',
    $or: [{ is_platform_admin: 1 }, { is_platform_staff: 1, platform_role_id: { $in: [...roleName.keys()] } }]
  }, { projection: { full_name: 1, is_platform_admin: 1, platform_role_id: 1, avatar_id: 1 } }).sort({ is_platform_admin: -1, full_name: 1 }).toArray();
  return people.map((person) => ({
    id: person._id, name: person.full_name,
    role: person.is_platform_admin ? 'Super Admin' : roleName.get(person.platform_role_id ?? '') ?? 'Team',
    avatar_url: avatarUrl(person.avatar_id)
  }));
}

/** Names of platform people by id, for "assigned to" and "resolved by". */
export async function platformNames(ids: Array<string | null | undefined>): Promise<Map<string, { name: string; avatar_url: string | null }>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();
  const people = await col.users().find({ _id: { $in: wanted } }, { projection: { full_name: 1, avatar_id: 1 } }).toArray();
  return new Map(people.map((person) => [person._id, { name: person.full_name, avatar_url: avatarUrl(person.avatar_id) }]));
}

/* ================================== TEAM ================================== */

platformRoute('GET', '/api/v1/platform/team', 'owner', async () => {
  const [roles, members] = await Promise.all([
    col.platformRoles().find({}).sort({ name: 1 }).toArray(),
    col.users().find({ is_platform_staff: 1, status: { $ne: 'archived' } }, { projection: MEMBER_FIELDS }).sort({ status: 1, full_name: 1 }).toArray()
  ]);
  const byId = new Map(roles.map((role) => [role.id, role]));
  const counts = new Map<string, number>();
  for (const member of members) counts.set(member.platform_role_id ?? '', (counts.get(member.platform_role_id ?? '') ?? 0) + 1);
  return {
    data: members.map((member) => memberView(member, byId)),
    roles: roles.map((role) => roleView(role, counts.get(role.id) ?? 0)),
    catalogue, templates: PLATFORM_ROLE_TEMPLATES
  };
});

platformRoute('POST', '/api/v1/platform/team', 'owner', async (ctx) => {
  const fullName = sanitiseText(ctx.body.fullName, 120);
  const email = toStr(ctx.body.email, 160).toLowerCase();
  const phone = toStr(ctx.body.phone, 40);
  const jobTitle = sanitiseText(ctx.body.jobTitle, 80);
  const password = String(ctx.body.password || '');

  if (!fullName) bad('Enter their full name.', 'fullName');
  if (!isEmail(email)) bad('Enter a valid e-mail address — this is how they sign in.', 'email');
  if (phone && !isPkPhone(phone)) bad('Enter a valid Pakistani mobile number, for example 0300 1234567.', 'phone');
  const role = await roleOr400(ctx.body.roleId);
  const problem = passwordProblem(password);
  if (problem) bad(problem, 'password');
  /* A bad photo stops the whole thing before anybody is created. */
  if (ctx.body.image) readImage(ctx.body.image);
  if (await col.users().findOne({ email }, { projection: { _id: 1 } })) bad('Somebody already signs in with that e-mail address.', 'email');

  const id = uid('USR');
  const at = nowIso();
  const member: User = {
    _id: id, id, pharmacy_id: null, branch_id: null, role_id: null, is_platform_staff: 1, platform_role_id: role.id,
    job_title: jobTitle || null, avatar_id: null, full_name: fullName, email, phone: phone || null, cnic: null, pharmacist_reg_no: null,
    password_hash: await hashPassword(password), password_changed_at: at, must_change_password: 1, status: 'active',
    failed_attempts: 0, locked_until: null, last_login_at: null, email_verified_at: null, totp_secret: null, totp_enabled: 0,
    totp_confirmed_at: null, recovery_generated_at: null, is_owner: 0, theme: null, created_at: at, updated_at: at
  };
  try {
    await col.users().insertOne(member);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) bad('Somebody already signs in with that e-mail address.', 'email');
    throw error;
  }
  if (ctx.body.image) await replaceAvatar(id, ctx.body.image);

  await logActivity(trail(ctx), {
    action: 'platform.team-member-added', entity: 'user', entityId: id, severity: 'warn',
    summary: `${fullName} joined the KSF team as ${role.name}`, meta: { email, role: role.name }
  });
  /* The password is never e-mailed: the Super Admin hands it over in person. */
  sendMail({
    to: email, subject: 'You have been added to the KSF team',
    text: `Assalam-o-alaikum ${fullName},\n\nYou have been added to the KSF platform team as ${role.name}.\n\nSign in at ${env.PUBLIC_APP_URL} with this e-mail address and the temporary password the KSF Super Admin gives you. You will be asked to choose your own password straight away.\n\nIf you were not expecting this, you can ignore this message.\n\nKSF`
  }).catch((error) => console.warn('[KSF] team welcome e-mail failed:', (error as Error).message));

  const created = await col.users().findOne({ _id: id }, { projection: MEMBER_FIELDS });
  return { data: memberView(created!, new Map([[role.id, role]])), message: `${fullName} can now sign in as ${role.name}.`, __status: 201 };
});

platformRoute('PATCH', '/api/v1/platform/team/:id', 'owner', async (ctx) => {
  const member = await memberOr404(ctx.params.id);
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(ctx.body, key);

  const fullName = sent('fullName') ? sanitiseText(ctx.body.fullName, 120) : member.full_name;
  if (!fullName) bad('Enter their full name.', 'fullName');
  const phone = sent('phone') ? toStr(ctx.body.phone, 40) : (member.phone ?? '');
  if (phone && !isPkPhone(phone)) bad('Enter a valid Pakistani mobile number, for example 0300 1234567.', 'phone');
  const jobTitle = sent('jobTitle') ? sanitiseText(ctx.body.jobTitle, 80) : (member.job_title ?? '');
  const role = sent('roleId') ? await roleOr400(ctx.body.roleId) : null;
  const status = (sent('status') ? toStr(ctx.body.status, 20) : member.status) as User['status'];
  if (!['active', 'suspended'].includes(status)) bad('Status must be active or suspended.', 'status');

  await col.users().updateOne({ _id: member.id }, {
    $set: {
      full_name: fullName, phone: phone || null, job_title: jobTitle || null,
      platform_role_id: role?.id ?? member.platform_role_id, status, updated_at: nowIso()
    }
  });
  /* A suspension takes effect now, not at their next sign-in. */
  if (status !== 'active' && member.status === 'active') await revokeAllSessions(member.id, { reason: 'account-suspended' });

  const changes = [
    role && role.id !== member.platform_role_id ? `role now ${role.name}` : null,
    status !== member.status ? (status === 'active' ? 'reactivated' : 'suspended') : null
  ].filter(Boolean);
  await logActivity(trail(ctx), {
    action: 'platform.team-member-updated', entity: 'user', entityId: member.id, severity: changes.length ? 'warn' : 'info',
    summary: `${fullName} updated${changes.length ? ` — ${changes.join(', ')}` : ''}`
  });
  const updated = await col.users().findOne({ _id: member.id }, { projection: MEMBER_FIELDS });
  const roles = new Map((await col.platformRoles().find({}).toArray()).map((row) => [row.id, row]));
  return { data: memberView(updated!, roles) };
});

platformRoute('POST', '/api/v1/platform/team/:id/reset-password', 'owner', async (ctx) => {
  const member = await memberOr404(ctx.params.id);
  const password = String(ctx.body.password || '');
  const problem = passwordProblem(password);
  if (problem) bad(problem, 'password');
  const at = nowIso();
  await col.users().updateOne({ _id: member.id }, {
    $set: { password_hash: await hashPassword(password), password_changed_at: at, must_change_password: 1, failed_attempts: 0, locked_until: null, updated_at: at }
  });
  await revokeAllSessions(member.id, { reason: 'password-reset' });
  await clear(`login:${member.email.toLowerCase()}`);
  await logActivity(trail(ctx), { action: 'platform.team-password-reset', entity: 'user', entityId: member.id, severity: 'danger', summary: `Password reset for ${member.full_name}` });
  return { ok: true, message: `${member.full_name} must choose a new password when they next sign in.` };
});

platformRoute('POST', '/api/v1/platform/team/:id/sign-out', 'owner', async (ctx) => {
  const member = await memberOr404(ctx.params.id);
  const ended = await revokeAllSessions(member.id, { reason: 'signed-out-by-super-admin' });
  await logActivity(trail(ctx), { action: 'platform.team-signed-out', entity: 'user', entityId: member.id, severity: 'warn', summary: `${member.full_name} signed out of every device` });
  return { ok: true, sessions: ended };
});

platformRoute('DELETE', '/api/v1/platform/team/:id', 'owner', async (ctx) => {
  const member = await memberOr404(ctx.params.id);
  /* Kept, not deleted: their name stays on every reply and record they made. */
  await col.users().updateOne({ _id: member.id }, { $set: { status: 'archived', updated_at: nowIso() } });
  await revokeAllSessions(member.id, { reason: 'account-archived' });
  await col.supportTickets().updateMany({ assigned_to: member.id, status: { $in: ['open', 'in_progress', 'waiting'] } }, { $set: { assigned_to: null } });
  await removeAvatar(member.id);
  await logActivity(trail(ctx), { action: 'platform.team-member-removed', entity: 'user', entityId: member.id, severity: 'danger', summary: `${member.full_name} removed from the KSF team` });
  return { ok: true };
});

/* ------------------------------------------------------------------ photos */
platformRoute('PUT', '/api/v1/platform/team/:id/avatar', 'owner', async (ctx) => {
  const member = await memberOr404(ctx.params.id);
  const id = await replaceAvatar(member.id, ctx.body.image);
  return { ok: true, avatar_url: avatarUrl(id) };
});

platformRoute('DELETE', '/api/v1/platform/team/:id/avatar', 'owner', async (ctx) => {
  const member = await memberOr404(ctx.params.id);
  await removeAvatar(member.id);
  return { ok: true, avatar_url: null };
});

/* Anybody in the platform console — the Super Admin included — sets their own. */
platformRoute('PUT', '/api/v1/platform/me/avatar', 'any', async (ctx) => {
  const id = await replaceAvatar(ctx.user.id, ctx.body.image);
  return { ok: true, avatar_url: avatarUrl(id) };
});

platformRoute('DELETE', '/api/v1/platform/me/avatar', 'any', async (ctx) => {
  await removeAvatar(ctx.user.id);
  return { ok: true, avatar_url: null };
});

/* ================================== ROLES ================================== */

function readRole(body: Record<string, unknown>, existing?: PlatformRole) {
  const name = sanitiseText(body.name ?? existing?.name, 60);
  if (!name) bad('Give the role a name, for example Help desk.', 'name');
  const description = sanitiseText(body.description ?? existing?.description ?? '', 300);
  const permissions = body.permissions === undefined && existing ? existing.permissions : normalisePlatformPermissions(body.permissions);
  if (!permissions.length) bad('Tick at least one thing this role may do.', 'permissions');
  return { name, name_key: nameKey(name), description: description || null, permissions };
}

async function nameTaken(key: string, except?: string): Promise<boolean> {
  return !!(await col.platformRoles().findOne({ name_key: key, ...(except ? { _id: { $ne: except } } : {}) }, { projection: { _id: 1 } }));
}

platformRoute('POST', '/api/v1/platform/team/roles', 'owner', async (ctx) => {
  const values = readRole(ctx.body);
  if (await nameTaken(values.name_key)) bad('There is already a role with that name.', 'name');
  const id = uid('PRL');
  const at = nowIso();
  const role: PlatformRole = { _id: id, id, ...values, created_by: ctx.user.id, created_at: at, updated_at: at };
  try {
    await col.platformRoles().insertOne(role);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) bad('There is already a role with that name.', 'name');
    throw error;
  }
  await logActivity(trail(ctx), {
    action: 'platform.team-role-created', entity: 'platform-role', entityId: id, severity: 'warn',
    summary: `Team role ${role.name} created`, meta: { permissions: role.permissions }
  });
  return { data: roleView(role, 0), __status: 201 };
});

platformRoute('PATCH', '/api/v1/platform/team/roles/:id', 'owner', async (ctx) => {
  const existing = await col.platformRoles().findOne({ _id: toStr(ctx.params.id, 60) });
  if (!existing) return missing('That role could not be found.');
  const values = readRole(ctx.body, existing);
  if (await nameTaken(values.name_key, existing.id)) bad('There is already a role with that name.', 'name');
  const updated = await col.platformRoles().findOneAndUpdate({ _id: existing.id }, { $set: { ...values, updated_at: nowIso() } }, { returnDocument: 'after' });
  const members = await col.users().countDocuments({ platform_role_id: existing.id, status: { $ne: 'archived' } });
  const added = values.permissions.filter((key) => !existing.permissions.includes(key));
  const removed = existing.permissions.filter((key) => !values.permissions.includes(key));
  await logActivity(trail(ctx), {
    action: 'platform.team-role-updated', entity: 'platform-role', entityId: existing.id, severity: added.length || removed.length ? 'warn' : 'info',
    summary: `Team role ${values.name} updated${added.length || removed.length ? ` — ${added.length} permission(s) added, ${removed.length} removed` : ''}`,
    meta: { added, removed }
  });
  return { data: roleView(updated!, members) };
});

platformRoute('DELETE', '/api/v1/platform/team/roles/:id', 'owner', async (ctx) => {
  const role = await col.platformRoles().findOne({ _id: toStr(ctx.params.id, 60) });
  if (!role) return missing('That role could not be found.');
  const members = await col.users().countDocuments({ platform_role_id: role.id, status: { $ne: 'archived' } });
  if (members) conflict(`${members} team member(s) hold ${role.name}. Give them another role first.`);
  await col.platformRoles().deleteOne({ _id: role.id });
  await logActivity(trail(ctx), { action: 'platform.team-role-deleted', entity: 'platform-role', entityId: role.id, severity: 'warn', summary: `Team role ${role.name} deleted` });
  return { ok: true };
});
