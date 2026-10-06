/* ==========================================================================
   Signing in, staying signed in, and signing out
   --------------------------------------------------------------------------
   The order of the checks on sign-in:

     1. throttle          per address and per network, failures only
     2. credentials       constant-time; a missing account costs the same as
                          a wrong password, and gets the same answer
     3. account status    locked, suspended, or the pharmacy suspended
     4. two-step          if it is on, nothing else happens until the code is right
     5. device allowance  a new machine beyond the plan's limit is refused,
                          before a session exists
     6. session           created; access token returned, refresh token set
                          as an HttpOnly cookie
     7. trails            activity, security event, new-device e-mail
   ========================================================================== */

import { env } from '../config/env.js';
import { col } from '../db/mongo.js';
import type { User } from '../db/types.js';
import { bad, HttpError, unauthorised } from '../core/errors.js';
import { auditLog, logActivity, securityEvent } from '../core/trails.js';
import {
  clearRateLimit, isEmail, nowIso, plusMinutes, rateLimit, rateLimitStatus, randomUUID, sha256, toStr
} from '../core/util.js';
import { accountRoute, publicRoute, type SignedInCtx } from '../http/router.js';
import type { AuthUser, Ctx } from '../http/context.js';
import { loadAuthUser } from '../http/authenticate.js';
import { clearRefreshCookie, deviceCookie, refreshCookie } from '../http/cookies.js';
import { hashPassword, passwordProblem, verifyPassword } from '../security/password.js';
import { normaliseRecoveryCode, verifyTotp } from '../security/totp.js';
import { secret } from '../security/crypto.js';
import {
  createSession, elevateSession, isElevated, revokeAllSessions, revokeSession, rotateRefreshToken, signAccessToken
} from '../security/sessions.js';
import { approximate, publicDevice, registerDevice, revokeDevice } from '../security/devices.js';
import { issueCode, PURPOSES, verifyCode } from '../security/otp.js';
import { sendMail, templates } from '../services/mailer.js';
import { avatarUrl } from '../services/avatars.js';
import { subscriptionState } from '../services/subscriptions.js';
import { refreshStockAlerts } from './shared.js';
import { DEFAULT_THEME, THEME_KEYS } from '../domain/permissions.js';

/* ------------------------------------------------- short-lived tickets
   The second half of a two-step sign-in, and permission to tidy devices when
   the limit is reached. They live minutes, in memory, and are useless after
   use; a restart simply asks the person to sign in again. */
interface Ticket { kind: string; userId: string; expiresAt: number; attempts: number }
const tickets = new Map<string, Ticket>();

function issueTicket(kind: string, userId: string, minutes = 5): string {
  const token = secret(24);
  tickets.set(token, { kind, userId, expiresAt: Date.now() + minutes * 60_000, attempts: 0 });
  if (tickets.size > 500) for (const [key, value] of tickets) if (value.expiresAt < Date.now()) tickets.delete(key);
  return token;
}

function readTicket(token: unknown, kind: string): Ticket | null {
  const ticket = tickets.get(String(token || ''));
  if (!ticket) return null;
  if (ticket.expiresAt < Date.now() || ticket.kind !== kind) { tickets.delete(String(token)); return null; }
  return ticket;
}

/* --------------------------------------------------------- what we send */
export async function publicUser(user: AuthUser, permissions: Set<string>, extra: { supportMode?: boolean; pharmacyId?: string | null } = {}) {
  const branch = user.branch_id ? await col.branches().findOne({ _id: user.branch_id }, { projection: { name: 1 } }) : null;
  const pharmacyId = extra.pharmacyId ?? user.pharmacy_id;
  const pharmacy = pharmacyId ? await col.pharmacies().findOne({ _id: pharmacyId }, { projection: { name: 1 } }) : null;
  return {
    id: user.id, fullName: user.full_name, email: user.email, phone: user.phone, cnic: user.cnic,
    pharmacistRegNo: user.pharmacist_reg_no, roleKey: user.role_key, roleName: user.role_name, roleLevel: user.role_level,
    branchId: user.branch_id, branchName: branch?.name ?? null, pharmacyId, pharmacyName: pharmacy?.name ?? null,
    status: user.status, isOwner: !!user.is_owner, isPlatformAdmin: !!user.is_platform_admin, isPlatformStaff: !!user.is_platform_staff,
    jobTitle: user.job_title ?? null, avatarUrl: avatarUrl(user.avatar_id), supportMode: !!extra.supportMode,
    mustChangePassword: !!user.must_change_password, emailVerified: !!user.email_verified_at,
    twoFactorEnabled: !!user.totp_enabled, lastLoginAt: user.last_login_at, theme: user.theme ?? null,
    permissions: [...permissions]
  };
}

const recordAttempt = (email: string, ip: string, ok: boolean) => {
  const id = randomUUID();
  return col.loginAttempts().insertOne({ _id: id, id, email, ip, ok: ok ? 1 : 0, created_at: nowIso() });
};

const when = () => new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });

/** The password and any second factor are right: device, session, trails. */
async function completeSignIn(ctx: Ctx, user: User, method: string) {
  const loaded = await loadAuthUser(user.id);
  if (!loaded) {
    throw new HttpError(403, user.is_platform_staff
      ? 'This account has no team role. Please ask the KSF Super Admin.'
      : 'This account has no role. Please contact your pharmacy Admin.');
  }

  const registration = await registerDevice({
    pharmacyId: user.pharmacy_id, userId: user.id, userAgent: ctx.userAgent, ip: ctx.ip,
    existingCookie: ctx.cookies[env.DEVICE_COOKIE_NAME]
  });

  if (!registration.ok) {
    await securityEvent({
      pharmacyId: user.pharmacy_id, userId: user.id, emailHint: user.email, type: 'device.limit-reached',
      severity: 'warn', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent,
      detail: `${registration.category} limit of ${registration.limit} reached`
    });
    const error = new HttpError(409, registration.category === 'desktop'
      ? `This account may be used on ${registration.limit} computer(s). Remove one below to use this machine instead.`
      : `This account may be used on ${registration.limit} phone(s) or tablet(s). Remove one below to use this one instead.`,
    undefined, 'device_limit');
    error.details = {
      limit: registration.limit, category: registration.category, devices: registration.devices,
      releaseTicket: issueTicket('device-release', user.id, 10)
    };
    throw error;
  }

  const { session, refreshToken } = await createSession({ userId: user.id, deviceId: registration.device.id, ip: ctx.ip, userAgent: ctx.userAgent });
  const access = signAccessToken(session, user.pharmacy_id);

  await col.users().updateOne({ _id: user.id }, { $set: { failed_attempts: 0, locked_until: null, last_login_at: nowIso() } });
  clearRateLimit(`login:${user.email.toLowerCase()}`);

  const trailCtx = { pharmacyId: user.pharmacy_id, user: { id: user.id, full_name: user.full_name, role_name: loaded.user.role_name }, ip: ctx.ip, userAgent: ctx.userAgent };
  await logActivity(trailCtx, { action: 'auth.login', entity: 'user', entityId: user.id, summary: `${user.full_name} signed in` });
  await securityEvent({
    pharmacyId: user.pharmacy_id, userId: user.id, emailHint: user.email, type: 'auth.login', ip: ctx.ip,
    userAgent: ctx.userAgent, deviceId: registration.device.id, detail: `${method}${registration.isNew ? ', new device registered' : ''}`
  });
  if (user.pharmacy_id) await refreshStockAlerts(user.pharmacy_id);

  if (registration.isNew) {
    sendMail({
      to: user.email, template: 'securityAlert',
      ...templates.securityAlert({ name: user.full_name, what: 'A new device signed in', when: when(), where: `${registration.device.label} — ${approximate(ctx.ip)}` })
    }).catch((error) => console.warn('[KSF] could not send the new-device notice:', (error as Error).message));
  }

  ctx.setCookie.push(refreshCookie(refreshToken));
  if (registration.cookie !== ctx.cookies[env.DEVICE_COOKIE_NAME]) ctx.setCookie.push(deviceCookie(registration.cookie));

  return {
    user: await publicUser(loaded.user, loaded.permissions),
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    subscription: await subscriptionState(user.pharmacy_id),
    device: publicDevice(registration.device)
  };
}

/* ------------------------------------------------------------- sign in */
publicRoute('POST', '/api/v1/auth/login', async (ctx) => {
  const email = toStr(ctx.body.email, 160).toLowerCase();
  const password = String(ctx.body.password || '');
  if (!email || !password) bad('Enter your email address and password.');

  const perEmail = rateLimitStatus(`login:${email}`, env.LOGIN_MAX_ATTEMPTS * 3);
  const perIp = rateLimitStatus(`login-ip:${ctx.ip}`, env.LOGIN_MAX_PER_IP);
  if (!perEmail.ok || !perIp.ok) {
    await securityEvent({ emailHint: email, type: 'auth.throttled', severity: 'warn', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent });
    const error = new HttpError(429, `Too many attempts. Please wait ${Math.ceil((perEmail.retryAfter || perIp.retryAfter) / 60)} minute(s) and try again.`);
    error.retryAfter = perEmail.retryAfter || perIp.retryAfter;
    throw error;
  }
  const countFailure = () => {
    rateLimit(`login:${email}`, env.LOGIN_MAX_ATTEMPTS * 3, env.LOGIN_LOCK_MINUTES * 60_000);
    rateLimit(`login-ip:${ctx.ip}`, env.LOGIN_MAX_PER_IP, 15 * 60_000);
  };

  const user = await col.users().findOne({ email });
  if (!user) {
    countFailure();
    await recordAttempt(email, ctx.ip, false);
    await verifyPassword(password, '');
    await securityEvent({ emailHint: email, type: 'auth.failed', severity: 'warn', outcome: 'failure', ip: ctx.ip, userAgent: ctx.userAgent, detail: 'no such account' });
    unauthorised('Those sign-in details are not correct.', 'invalid_credentials');
  }
  const account = user!;

  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    countFailure();
    await recordAttempt(email, ctx.ip, false);
    await securityEvent({ pharmacyId: account.pharmacy_id, userId: account.id, emailHint: email, type: 'auth.locked', severity: 'warn', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent });
    const minutes = Math.ceil((new Date(account.locked_until).getTime() - Date.now()) / 60_000);
    throw new HttpError(423, `This account is locked for another ${minutes} minute(s).`, undefined, 'account_locked');
  }

  if (account.status !== 'active') {
    countFailure();
    await recordAttempt(email, ctx.ip, false);
    await securityEvent({ pharmacyId: account.pharmacy_id, userId: account.id, emailHint: email, type: 'auth.suspended', severity: 'warn', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent });
    throw new HttpError(403, account.is_platform_staff
      ? 'This account has been suspended. Please contact the KSF Super Admin.'
      : 'This account has been suspended. Please contact your pharmacy Admin.', undefined, 'account_suspended');
  }

  const check = await verifyPassword(password, account.password_hash);
  if (!check.ok) {
    countFailure();
    await recordAttempt(email, ctx.ip, false);
    const attempts = (account.failed_attempts || 0) + 1;
    const lockUntil = attempts >= env.LOGIN_MAX_ATTEMPTS ? plusMinutes(env.LOGIN_LOCK_MINUTES) : null;
    await col.users().updateOne({ _id: account.id }, { $set: { failed_attempts: attempts, locked_until: lockUntil } });
    if (account.pharmacy_id) {
      await logActivity({ pharmacyId: account.pharmacy_id, user: null, ip: ctx.ip, userAgent: ctx.userAgent },
        { action: 'auth.failed', entity: 'user', entityId: account.id, severity: 'warn', summary: `Failed sign-in for ${email}` });
    }
    await securityEvent({
      pharmacyId: account.pharmacy_id, userId: account.id, emailHint: email, type: 'auth.failed', severity: 'warn',
      outcome: 'failure', ip: ctx.ip, userAgent: ctx.userAgent, detail: `attempt ${attempts} of ${env.LOGIN_MAX_ATTEMPTS}`
    });
    unauthorised(lockUntil
      ? `Those details are not correct. The account is now locked for ${env.LOGIN_LOCK_MINUTES} minutes.`
      : `Those sign-in details are not correct. ${env.LOGIN_MAX_ATTEMPTS - attempts} attempt(s) left.`, 'invalid_credentials');
  }

  await recordAttempt(email, ctx.ip, true);
  if (check.needsRehash) {
    await col.users().updateOne({ _id: account.id }, { $set: { password_hash: await hashPassword(password), updated_at: nowIso() } });
  }

  /* A pharmacy the platform has suspended cannot be signed in to. */
  if (account.pharmacy_id) {
    const pharmacy = await col.pharmacies().findOne({ _id: account.pharmacy_id }, { projection: { status: 1 } });
    if (pharmacy && pharmacy.status !== 'active') {
      throw new HttpError(403, 'This pharmacy account is suspended. Please contact KSF support.', undefined, 'pharmacy_suspended');
    }
  }

  if (account.totp_enabled && account.totp_secret) {
    await securityEvent({ pharmacyId: account.pharmacy_id, userId: account.id, emailHint: email, type: 'auth.2fa-challenge', outcome: 'pending', ip: ctx.ip, userAgent: ctx.userAgent });
    return { twoFactorRequired: true, challenge: issueTicket('two-factor', account.id, 5), message: 'Enter the six-digit code from your authenticator app.' };
  }

  return completeSignIn(ctx, account, 'password');
});

publicRoute('POST', '/api/v1/auth/two-factor', async (ctx) => {
  const ticket = readTicket(ctx.body.challenge, 'two-factor');
  if (!ticket) unauthorised('That verification has expired. Please sign in again.');
  ticket!.attempts += 1;
  if (ticket!.attempts > 5) {
    tickets.delete(String(ctx.body.challenge));
    throw new HttpError(429, 'Too many incorrect codes. Please sign in again.');
  }
  const user = await col.users().findOne({ _id: ticket!.userId });
  if (!user) { tickets.delete(String(ctx.body.challenge)); unauthorised('Please sign in again.'); }

  let method: string | null = null;
  const code = toStr(ctx.body.code, 20);
  const recovery = toStr(ctx.body.recoveryCode, 32);
  if (code && verifyTotp(user!.totp_secret, code)) {
    method = 'authenticator app';
  } else if (recovery) {
    const match = await col.recoveryCodes().findOneAndUpdate(
      { user_id: user!.id, code_hash: sha256(normaliseRecoveryCode(recovery)), used_at: null },
      { $set: { used_at: nowIso() } }
    );
    if (match) {
      const left = await col.recoveryCodes().countDocuments({ user_id: user!.id, used_at: null });
      method = `recovery code (${left} left)`;
    }
  }

  if (!method) {
    await securityEvent({ pharmacyId: user!.pharmacy_id, userId: user!.id, emailHint: user!.email, type: 'auth.2fa-failed', severity: 'warn', outcome: 'failure', ip: ctx.ip, userAgent: ctx.userAgent });
    unauthorised('That code is not correct. Check your authenticator app and try again.', 'invalid_code');
  }
  tickets.delete(String(ctx.body.challenge));
  return completeSignIn(ctx, user!, `password and ${method}`);
});

/** Remove a device while the limit is blocking sign-in (password asked again). */
publicRoute('POST', '/api/v1/auth/device-release', async (ctx) => {
  const ticket = readTicket(ctx.body.ticket, 'device-release');
  if (!ticket) unauthorised('That request has expired. Please sign in again.');
  const user = await col.users().findOne({ _id: ticket!.userId });
  if (!user) unauthorised('Please sign in again.');

  const check = await verifyPassword(String(ctx.body.password || ''), user!.password_hash);
  if (!check.ok) {
    ticket!.attempts += 1;
    if (ticket!.attempts > 3) tickets.delete(String(ctx.body.ticket));
    unauthorised('That password is not correct.', 'invalid_credentials');
  }
  const device = await revokeDevice({ deviceId: toStr(ctx.body.deviceId, 60), userId: user!.id, revokedBy: user!.id, reason: 'released to make room for a new device' });
  if (!device) throw new HttpError(404, 'That device could not be found.');

  await securityEvent({
    pharmacyId: user!.pharmacy_id, userId: user!.id, emailHint: user!.email, type: 'device.removed', severity: 'warn',
    ip: ctx.ip, userAgent: ctx.userAgent, deviceId: device.id, detail: 'removed from the device-limit screen'
  });
  await auditLog({ pharmacyId: user!.pharmacy_id, user: { id: user!.id, full_name: user!.full_name }, ip: ctx.ip, userAgent: ctx.userAgent },
    { action: 'device.removed', entity: 'device', entityId: device.id, summary: `${device.label} removed` });
  return { ok: true, message: 'That device has been removed. Please sign in again on this machine.' };
});

/* --------------------------------------------------------------- refresh
   The web app calls this on load (the access token lives in memory only)
   and whenever an access token expires. It is a public route because the
   access token is exactly what is missing; the HttpOnly, SameSite=Strict
   refresh cookie and the same-origin check are the credentials. */
publicRoute('POST', '/api/v1/auth/refresh', async (ctx) => {
  const token = ctx.cookies[env.REFRESH_COOKIE_NAME];
  if (!token) return { user: null };
  const rotated = await rotateRefreshToken(token);
  if (!rotated || 'reused' in rotated) {
    ctx.setCookie.push(clearRefreshCookie());
    if (rotated && 'reused' in rotated) {
      await securityEvent({ type: 'auth.refresh-reuse', severity: 'danger', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent, detail: 'a used refresh token was presented; the session was ended' });
    }
    return { user: null };
  }
  const loaded = await loadAuthUser(rotated.session.user_id);
  if (!loaded || loaded.user.status !== 'active') {
    await revokeSession(rotated.session.id, 'account-inactive');
    ctx.setCookie.push(clearRefreshCookie());
    return { user: null };
  }
  if (loaded.user.pharmacy_id) {
    const pharmacy = await col.pharmacies().findOne({ _id: loaded.user.pharmacy_id }, { projection: { status: 1 } });
    if (pharmacy && pharmacy.status !== 'active') {
      ctx.setCookie.push(clearRefreshCookie());
      throw new HttpError(403, 'This pharmacy account is suspended. Please contact KSF support.', undefined, 'pharmacy_suspended');
    }
  }
  const access = signAccessToken(rotated.session, loaded.user.pharmacy_id);
  ctx.setCookie.push(refreshCookie(rotated.refreshToken));
  return {
    user: await publicUser(loaded.user, loaded.permissions),
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    subscription: await subscriptionState(loaded.user.pharmacy_id),
    elevated: isElevated(rotated.session),
    elevatedUntil: rotated.session.elevated_until
  };
});

publicRoute('POST', '/api/v1/auth/logout', async (ctx) => {
  const token = ctx.cookies[env.REFRESH_COOKIE_NAME];
  ctx.setCookie.push(clearRefreshCookie());
  if (!token) return { ok: true };
  const rotated = await rotateRefreshToken(token);
  if (rotated && !('reused' in rotated)) {
    await revokeSession(rotated.session.id, 'signed-out');
    const loaded = await loadAuthUser(rotated.session.user_id);
    if (loaded) {
      await logActivity({ pharmacyId: loaded.user.pharmacy_id, user: loaded.user, ip: ctx.ip, userAgent: ctx.userAgent },
        { action: 'auth.logout', entity: 'user', entityId: loaded.user.id, summary: `${loaded.user.full_name} signed out` });
      await securityEvent({ pharmacyId: loaded.user.pharmacy_id, userId: loaded.user.id, type: 'auth.logout', ip: ctx.ip, userAgent: ctx.userAgent, sessionId: rotated.session.id });
    }
  }
  return { ok: true };
});

/* ------------------------------------------------------- the session now */
accountRoute('GET', '/api/v1/auth/session', async (ctx) => ({
  user: await publicUser(ctx.user, ctx.permissions, { supportMode: ctx.supportMode, pharmacyId: ctx.pharmacyId }),
  subscription: await subscriptionState(ctx.pharmacyId),
  elevated: isElevated(ctx.session),
  elevatedUntil: ctx.session.elevated_until ?? null
}));

/** Step-up: confirm it is really you before a security change. */
accountRoute('POST', '/api/v1/auth/verify-identity', async (ctx) => {
  const check = await verifyPassword(String(ctx.body.password || ''), ctx.user.password_hash);
  const codeOk = ctx.user.totp_enabled && ctx.user.totp_secret ? verifyTotp(ctx.user.totp_secret, toStr(ctx.body.code, 10)) : true;
  if (!check.ok || !codeOk) {
    await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: 'auth.step-up-failed', severity: 'warn', outcome: 'failure', ip: ctx.ip, userAgent: ctx.userAgent });
    throw new HttpError(400, check.ok ? 'That authenticator code is not correct.' : 'That password is not correct.', check.ok ? 'code' : 'password');
  }
  await elevateSession(ctx.session.id);
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: 'auth.step-up', ip: ctx.ip, userAgent: ctx.userAgent });
  return { ok: true, elevatedForMinutes: env.STEP_UP_MINUTES };
});

accountRoute('POST', '/api/v1/auth/change-password', async (ctx: SignedInCtx) => {
  const current = String(ctx.body.currentPassword || '');
  const next = String(ctx.body.newPassword || '');
  if (!(await verifyPassword(current, ctx.user.password_hash)).ok) bad('Your current password is not correct.', 'currentPassword');
  const problem = passwordProblem(next);
  if (problem) bad(problem, 'newPassword');
  if (current === next) bad('The new password must be different from the current one.', 'newPassword');

  const at = nowIso();
  await col.users().updateOne({ _id: ctx.user.id }, {
    $set: { password_hash: await hashPassword(next), password_changed_at: at, must_change_password: 0, updated_at: at }
  });
  /* Every other device is signed out. This one stays. */
  const ended = await revokeAllSessions(ctx.user.id, { except: ctx.session.id, reason: 'password-changed' });

  await logActivity(ctx, { action: 'auth.password-changed', entity: 'user', entityId: ctx.user.id, severity: 'warn', summary: `${ctx.user.full_name} changed their password` });
  await auditLog(ctx, { action: 'auth.password-changed', entity: 'user', entityId: ctx.user.id, summary: `${ctx.user.full_name} changed their password` });
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: 'auth.password-changed', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent });
  sendMail({ to: ctx.user.email, template: 'securityAlert', ...templates.securityAlert({ name: ctx.user.full_name, what: 'Your password was changed', when: when(), where: approximate(ctx.ip) }) })
    .catch(() => { /* the change stands whether or not the notice sends */ });
  return { ok: true, otherSessionsEnded: ended };
});

/* ---------------------------------------------------------- my profile */
accountRoute('PATCH', '/api/v1/me', async (ctx) => {
  const update: Partial<User> = { updated_at: nowIso() };
  if (ctx.body.fullName !== undefined) {
    const name = toStr(ctx.body.fullName, 120);
    if (!name) bad('Enter your name.', 'fullName');
    update.full_name = name;
  }
  if (ctx.body.phone !== undefined) update.phone = toStr(ctx.body.phone, 40) || null;
  if (ctx.body.theme !== undefined) {
    const theme = toStr(ctx.body.theme, 40);
    if (theme && !THEME_KEYS.includes(theme)) bad('That theme does not exist.', 'theme');
    /* The Super Admin, their team and a pharmacy Admin always choose; anyone
       else needs the permission their Admin gave their role. */
    if (!ctx.isPlatformAdmin && !ctx.isPlatformStaff && !ctx.can('appearance.theme') && !ctx.can('settings.write')) {
      throw new HttpError(403, 'Your role cannot change the theme. Ask your pharmacy Admin.');
    }
    update.theme = theme || null;
  }
  await col.users().updateOne({ _id: ctx.user.id }, { $set: update });
  const loaded = await loadAuthUser(ctx.user.id);
  return { user: loaded ? await publicUser(loaded.user, ctx.permissions, { supportMode: ctx.supportMode, pharmacyId: ctx.pharmacyId }) : null };
});

/** Change the sign-in e-mail: password first, then a code sent to the new address. */
accountRoute('POST', '/api/v1/me/email/start', async (ctx) => {
  const email = toStr(ctx.body.email, 160).toLowerCase();
  if (!isEmail(email)) bad('Enter a valid email address.', 'email');
  if (email === ctx.user.email) bad('That is already your sign-in address.', 'email');
  if (!(await verifyPassword(String(ctx.body.password || ''), ctx.user.password_hash)).ok) bad('That password is not correct.', 'password');
  if (await col.users().findOne({ email }, { projection: { _id: 1 } })) bad('Another account already uses that address.', 'email');

  const issued = await issueCode({ purpose: PURPOSES.EMAIL_CHANGE, email, userId: ctx.user.id, pharmacyId: ctx.pharmacyId, ip: ctx.ip });
  if (issued.throttled || !issued.code) throw new HttpError(429, 'Too many codes have been sent to that address. Please wait an hour.');
  await sendMail({ to: email, template: 'emailChange', ...templates.emailChange({ code: issued.code, name: ctx.user.full_name, minutes: env.OTP_EXPIRY_MINUTES }) });
  return { ok: true, message: `We sent a six-digit code to ${email}. Enter it to finish the change.`, expiresAt: issued.expiresAt };
});

accountRoute('POST', '/api/v1/me/email/confirm', async (ctx) => {
  const email = toStr(ctx.body.email, 160).toLowerCase();
  const result = await verifyCode({ purpose: PURPOSES.EMAIL_CHANGE, email, code: ctx.body.code });
  if (!result.ok) {
    bad(result.reason === 'wrong' ? `That code is not correct. ${result.attemptsLeft} attempt(s) left.` : 'That code has expired. Ask for a new one.', 'code');
  }
  if (result.ok && result.record.user_id !== ctx.user.id) bad('That code was not issued to you.', 'code');
  if (await col.users().findOne({ email, _id: { $ne: ctx.user.id } }, { projection: { _id: 1 } })) bad('Another account already uses that address.', 'email');

  const previous = ctx.user.email;
  await col.users().updateOne({ _id: ctx.user.id }, { $set: { email, email_verified_at: nowIso(), updated_at: nowIso() } });
  await auditLog(ctx, { action: 'account.email-changed', entity: 'user', entityId: ctx.user.id, summary: `${ctx.user.full_name} changed their sign-in address`, before: { email: previous }, after: { email } });
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: 'account.email-changed', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent });
  sendMail({ to: previous, template: 'securityAlert', ...templates.securityAlert({ name: ctx.user.full_name, what: `Your sign-in address was changed to ${email}`, when: when(), where: approximate(ctx.ip) }) })
    .catch(() => { /* the change stands */ });
  return { ok: true, email };
});

/** The theme a person sees: their own if they may choose, else the pharmacy's. */
export async function effectiveTheme(user: AuthUser, permissions: Set<string>, pharmacyTheme: string | null): Promise<string> {
  const mayChoose = !!user.is_platform_admin || !!user.is_platform_staff || permissions.has('appearance.theme') || permissions.has('settings.write');
  return (mayChoose && user.theme) || pharmacyTheme || DEFAULT_THEME;
}
