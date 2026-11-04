/* ==========================================================================
   Registration, password recovery, two-step sign-in, devices, sessions,
   privacy and the Security Centre.
   --------------------------------------------------------------------------
   Registration is two steps: your details, then the code that proves the
   address. Both are stored on the server against an HttpOnly cookie, so a
   closed tab costs nothing. The password is hashed the moment it is chosen;
   the draft never holds it. The step the browser claims to be on is never
   trusted — each endpoint checks the draft is really at that point.

   The account exists the moment the code is accepted: a pharmacy with its
   own Admin, its built-in roles, a main branch and the 15-day free trial. The
   name, address and licences are asked for afterwards by the setup
   checklist, where they can be skipped and returned to.
   ========================================================================== */

import { env, BUSINESS, IS_PROD } from '../config/env.js';
import { col, tx, s } from '../db/mongo.js';
import type { Pharmacy, Registration, User } from '../db/types.js';
import { bad, conflict, HttpError, missing, tooMany } from '../core/errors.js';
import { auditLog, logActivity, notify, securityEvent, verifyAuditChain } from '../core/trails.js';
import {
  isEmail, isPkPhone, maskEmail, nowIso, plusHours, randomUUID, sanitiseText, sha256, slugify, toInt, toStr, uid
} from '../core/util.js';
import { hit, peek } from '../security/throttle.js';
import { accountRoute, publicRoute, route } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { deviceCookie, refreshCookie } from '../http/cookies.js';
import { loadAuthUser } from '../http/authenticate.js';
import { hashPassword, passwordProblem, passwordStrength, PASSWORD_MIN_LENGTH } from '../security/password.js';
import { secret } from '../security/crypto.js';
import { issueCode, pendingCode, PURPOSES, verifyCode } from '../security/otp.js';
import { generateRecoveryCodes, generateSecret, normaliseRecoveryCode, otpauthUrl, consumeTotp } from '../security/totp.js';
import { createSession, listSessions, revokeAllSessions, revokeDeviceSessions, revokeSession, signAccessToken } from '../security/sessions.js';
import { approximate, deviceLimits, listDevices, publicDevice, registerDevice, renameDevice, revokeDevice } from '../security/devices.js';
import { isDevMailbox, mailHealth, readDevOutbox, sendMail, templates } from '../services/mailer.js';
import { listPlans, startTrial, subscriptionState, trialLength, trialPlan } from '../services/subscriptions.js';
import { claimReferral, completeReferral, referralPrices, referralSummary, validateCode } from '../services/referrals.js';
import { installRoles } from './people.js';
import { publicUser } from './auth.js';
import { PHARMACY_ADMIN_ROLE } from '../domain/permissions.js';

const REG_COOKIE = 'ksf_reg';
const REG_HOURS = 48;
const PHARMACY_TYPES = ['retail', 'chain', 'hospital', 'clinic', 'wholesale', 'online', 'compounding'];
const when = () => new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });

/* --------------------------------------------------------------- the draft */
function regCookie(value: string, seconds = REG_HOURS * 3600): string {
  const bits = [`${REG_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${seconds}`];
  if (env.COOKIE_SECURE) bits.push('Secure');
  return bits.join('; ');
}

async function loadDraft(ctx: Ctx): Promise<Registration | null> {
  const token = ctx.cookies?.[REG_COOKIE];
  if (!token) return null;
  const draft = await col.registrations().findOne({ token_hash: sha256(token), status: 'in_progress' });
  if (!draft || new Date(draft.expires_at).getTime() < Date.now()) return null;
  return draft;
}

async function draftView(draft: Registration | null) {
  if (!draft) return { step: 1, started: false };
  const payload = draft.payload as Record<string, string>;
  return {
    started: true, step: draft.step, email: maskEmail(draft.email ?? ''), emailVerified: !!draft.email_verified,
    firstName: payload.firstName ?? '', lastName: payload.lastName ?? '', mobile: payload.mobile ?? '',
    hasPassword: !!payload.passwordHash,
    referral: draft.referral_code ? { code: draft.referral_code, trialDays: trialLength(await trialPlan()), prices: await referralPrices() } : null,
    expiresAt: draft.expires_at,
    pending: draft.email_verified ? null : await pendingCode(PURPOSES.EMAIL_VERIFY, draft.email ?? '')
  };
}

/* ========================= PUBLIC: SIGNING UP ============================ */
publicRoute('GET', '/api/v1/public/brand', async () => ({ business: BUSINESS, edition: env.KSF_EDITION }));

publicRoute('GET', '/api/v1/public/plans', async () => ({
  data: await listPlans(), trialDays: trialLength(await trialPlan()), passwordMinLength: PASSWORD_MIN_LENGTH, pharmacyTypes: PHARMACY_TYPES
}));

publicRoute('GET', '/api/v1/public/referral/:code', async (ctx) => {
  const limit = await hit(`ref:${ctx.ip}`, 30, 60_000);
  if (!limit.ok) tooMany('Too many referral checks. Please wait a moment.', limit.retryAfter);
  return validateCode(ctx.params.code);
});

publicRoute('GET', '/api/v1/register/state', async (ctx) => ({ data: await draftView(await loadDraft(ctx)) }));

/** The sign-up code for the screen, only while SHOW_SIGNUP_CODE is on for testing. */
const shownCode = (code: string | null): { testCode?: string } =>
  (env.SHOW_SIGNUP_CODE && code ? { testCode: code } : {});

const startingPharmacyName = (firstName: string): string => (firstName.trim() ? `${firstName.trim()}'s Pharmacy` : 'My Pharmacy');

/**
 * Turn a verified draft into a real pharmacy and sign its Admin in. The
 * pharmacy, its roles, its first branch and its Admin are written together;
 * the subscription and any referral trial follow.
 */
async function createPharmacyAccount(ctx: Ctx, draft: Registration) {
  const payload = draft.payload as Record<string, string>;
  const email = draft.email ?? '';
  if (await col.users().findOne({ email }, { projection: { _id: 1 } })) conflict('An account already uses that email address. Please sign in instead.');

  const at = nowIso();
  const pharmacyId = `PH-${randomUUID().slice(0, 8).toUpperCase()}`;
  const userId = uid('USR');
  const branchId = uid('BR');
  const fullName = `${payload.firstName ?? ''} ${payload.lastName ?? ''}`.trim();
  const pharmacyName = startingPharmacyName(payload.firstName ?? '');

  await tx(async () => {
    const pharmacy: Pharmacy = {
      _id: pharmacyId, id: pharmacyId, name: pharmacyName, legal_name: pharmacyName,
      slug: `${slugify(pharmacyName)}-${secret(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'ksf'}`,
      ntn: null, strn: null, drap_licence: null, phone: payload.mobile || null, email, address: null,
      city: 'Karachi', province: 'Sindh', country: 'Pakistan', currency: 'PKR', timezone: 'Asia/Karachi', gst_percent: 0,
      logo_initials: pharmacyName.slice(0, 3).toUpperCase(), status: 'active', pharmacy_type: 'retail',
      subscription_id: null, plan_key: null, owner_user_id: userId, device_limit_desktop: null, device_limit_mobile: null,
      referred_by_code: draft.referral_code, created_at: at, updated_at: at
    };
    await col.pharmacies().insertOne(pharmacy, s());
    const roles = await installRoles(pharmacyId);
    await col.branches().insertOne({
      _id: branchId, id: branchId, pharmacy_id: pharmacyId, name: pharmacyName, code: 'MAIN', address: null, city: 'Karachi',
      province: 'Sindh', phone: payload.mobile || null, drap_licence: null, is_main: 1, status: 'active', created_at: at, updated_at: at
    }, s());
    const user: User = {
      _id: userId, id: userId, pharmacy_id: pharmacyId, branch_id: branchId, role_id: roles.get(PHARMACY_ADMIN_ROLE) ?? null,
      full_name: fullName, email, phone: payload.mobile || null, cnic: null, pharmacist_reg_no: null,
      password_hash: payload.passwordHash, password_changed_at: at, must_change_password: 0, status: 'active',
      failed_attempts: 0, locked_until: null, last_login_at: at, email_verified_at: at, totp_secret: null, totp_enabled: 0,
      totp_confirmed_at: null, recovery_generated_at: null, is_owner: 1, theme: null, created_at: at, updated_at: at
    };
    await col.users().insertOne(user, s());
  });

  /* Every pharmacy starts on the free trial; a referral adds its price on top. */
  const started = await startTrial({ pharmacyId, source: payload.referralId ? 'referral' : 'signup' });
  const trialEnds = started.trial ? started.trial.expires_at.slice(0, 10) : null;
  if (payload.referralId) await completeReferral({ referralId: payload.referralId, pharmacyId, userId });
  const state = await subscriptionState(pharmacyId);
  await col.registrations().updateOne({ _id: draft.id }, { $set: { status: 'completed', pharmacy_id: pharmacyId, step: 3, updated_at: at } });

  const loaded = await loadAuthUser(userId);
  const trail = { pharmacyId, user: loaded!.user, ip: ctx.ip, userAgent: ctx.userAgent };
  await logActivity(trail, { action: 'pharmacy.registered', entity: 'pharmacy', entityId: pharmacyId, summary: `${pharmacyName} registered by ${fullName}` });
  await auditLog(trail, { action: 'pharmacy.registered', entity: 'pharmacy', entityId: pharmacyId, summary: `${pharmacyName} created on the ${state?.planName} plan` });
  await securityEvent({ pharmacyId, userId, emailHint: email, type: 'account.created', ip: ctx.ip, userAgent: ctx.userAgent, detail: `plan ${state?.plan}` });
  await notify(pharmacyId, {
    type: 'system', severity: 'info', title: `Welcome, ${payload.firstName}`,
    body: 'Finish setting up your pharmacy — the name, the address and your licence details take a couple of minutes.', link: '/setup'
  });
  sendMail({ to: email, template: 'welcome', ...templates.welcome({ name: payload.firstName, pharmacy: pharmacyName, subscriptionId: state?.subscriptionId ?? '', trialEnds }) })
    .catch((error) => console.warn('[KSF] welcome e-mail failed:', (error as Error).message));

  /* Sign the new Admin straight in on this machine. */
  const registration = await registerDevice({ pharmacyId, userId, userAgent: ctx.userAgent, ip: ctx.ip, existingCookie: ctx.cookies?.[env.DEVICE_COOKIE_NAME] });
  const { session, refreshToken } = await createSession({ userId, deviceId: registration.ok ? registration.device.id : null, ip: ctx.ip, userAgent: ctx.userAgent });
  const access = signAccessToken(session, pharmacyId);
  ctx.setCookie.push(refreshCookie(refreshToken));
  if (registration.ok && registration.cookie !== ctx.cookies?.[env.DEVICE_COOKIE_NAME]) ctx.setCookie.push(deviceCookie(registration.cookie));
  ctx.setCookie.push(`${REG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

  return {
    account: {
      pharmacyId, pharmacyName, subscriptionId: state?.subscriptionId ?? null, plan: state?.plan, planName: state?.planName, trial: state?.trial ?? null
    },
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    user: await publicUser(loaded!.user, loaded!.permissions),
    subscription: state
  };
}

publicRoute('POST', '/api/v1/register/start', async (ctx) => {
  const limit = await peek(`reg:${ctx.ip}`, env.REGISTER_MAX_PER_IP);
  if (!limit.ok) tooMany('Too many registrations have been started from this connection. Please try again later.', limit.retryAfter);

  const firstName = sanitiseText(ctx.body.firstName, 60);
  const lastName = sanitiseText(ctx.body.lastName, 60);
  const email = toStr(ctx.body.email, 160).toLowerCase();
  const password = String(ctx.body.password || '');
  const mobile = toStr(ctx.body.mobile, 40);
  const referral = toStr(ctx.body.referralCode, 32).toUpperCase();

  if (!firstName) bad('Enter your first name.', 'firstName');
  if (!lastName) bad('Enter your last name.', 'lastName');
  if (!isEmail(email)) bad('Enter a valid email address — this is how you will sign in.', 'email');
  if (mobile && !isPkPhone(mobile)) bad('Enter a valid Pakistani mobile number, for example 0300 1234567.', 'mobile');
  const problem = passwordProblem(password);
  if (problem) bad(problem, 'password');

  /* An address that already has an account is neither confirmed nor denied
     here; the person is told by e-mail, the only place that can safely say so. */
  const existing = await col.users().findOne({ email }, { projection: { _id: 1 } });
  const at = nowIso();
  const token = secret(24);
  const id = randomUUID();
  const base: Record<string, string> = { firstName, lastName, mobile, passwordHash: await hashPassword(password) };
  await col.registrations().insertOne({
    _id: id, id, token_hash: sha256(token), email, step: 2, payload: base, email_verified: 0, verified_at: null,
    referral_code: referral || null, ip: ctx.ip, user_agent: ctx.userAgent.slice(0, 200), status: 'in_progress', pharmacy_id: null,
    expires_at: plusHours(REG_HOURS), created_at: at, updated_at: at
  });
  await hit(`reg:${ctx.ip}`, env.REGISTER_MAX_PER_IP, 3_600_000);

  if (referral) {
    const claim = await claimReferral({ code: referral, email, ip: ctx.ip });
    await col.registrations().updateOne({ _id: id }, claim.ok
      ? { $set: { payload: { ...base, referralId: claim.referralId! } } }
      : { $set: { referral_code: null, payload: { ...base, referralProblem: claim.reason ?? '' } } });
  }

  let issuedCode: string | null = null;
  if (existing) {
    sendMail({
      to: email, subject: 'You already have a KSF account',
      text: 'Assalam-o-alaikum,\n\nSomebody tried to create a KSF account with this address, but you already have one.\n\nIf that was you, just sign in instead — and use "Forgot password" if you cannot remember it.\nIf it was not you, you can safely ignore this message. Nothing has changed.\n\nKSF'
    }).catch(() => { /* never block registration on the mail server */ });
    await securityEvent({ emailHint: email, type: 'register.duplicate', outcome: 'blocked', ip: ctx.ip, userAgent: ctx.userAgent });
  } else {
    const issued = await issueCode({ purpose: PURPOSES.EMAIL_VERIFY, email, ip: ctx.ip });
    if (issued.throttled || !issued.code) tooMany('Too many codes have been sent to that address. Please try again in an hour.');
    issuedCode = issued.code;
    sendMail({ to: email, template: 'verifyEmail', ...templates.verifyEmail({ code: issued.code!, name: firstName, minutes: env.OTP_EXPIRY_MINUTES }) })
      .catch((error) => console.warn('[KSF] verification e-mail failed:', (error as Error).message));
  }

  ctx.setCookie.push(regCookie(token));
  return {
    data: { step: 2, email: maskEmail(email), expiresInMinutes: env.OTP_EXPIRY_MINUTES, ...shownCode(issuedCode) },
    message: `We have sent a six-digit code to ${maskEmail(email)}.`
  };
});

publicRoute('POST', '/api/v1/register/verify-email', async (ctx) => {
  const draft = await loadDraft(ctx);
  if (!draft) return bad('That registration has expired. Please start again.');
  if (draft.email_verified) bad('That address is already confirmed. Please sign in.');
  const limit = await hit(`otp:${draft.email}`, 12, 15 * 60_000);
  if (!limit.ok) tooMany('Too many attempts. Please wait a few minutes.', limit.retryAfter);

  const result = await verifyCode({ purpose: PURPOSES.EMAIL_VERIFY, email: draft.email ?? '', code: toStr(ctx.body.code, 12) });
  if (!result.ok) {
    await securityEvent({ emailHint: draft.email, type: 'register.otp-failed', severity: 'warn', outcome: 'failure', ip: ctx.ip, detail: result.reason });
    if (result.reason === 'expired') bad('That code has expired. Ask for a new one.', 'code');
    if (result.reason === 'attempts') bad('That code has been tried too many times. Ask for a new one.', 'code');
    if (result.reason === 'missing') bad('Ask for a new code — the last one is no longer valid.', 'code');
    bad(`That code is not correct. ${result.attemptsLeft} attempt(s) left.`, 'code');
  }
  await col.registrations().updateOne({ _id: draft.id }, { $set: { step: 3, email_verified: 1, verified_at: nowIso(), updated_at: nowIso() } });
  await securityEvent({ emailHint: draft.email, type: 'register.verified', ip: ctx.ip, userAgent: ctx.userAgent });

  const created = await createPharmacyAccount(ctx, { ...draft, email_verified: 1 });
  return {
    data: created.account, accessToken: created.accessToken, accessTokenExpiresAt: created.accessTokenExpiresAt,
    user: created.user, subscription: created.subscription, message: 'Your account is ready.', __status: 201
  };
});

publicRoute('POST', '/api/v1/register/resend', async (ctx) => {
  const draft = await loadDraft(ctx);
  if (!draft) return bad('That registration has expired. Please start again.');
  if (draft.email_verified) return { ok: true };
  const limit = await hit(`resend:${draft.email}`, 3, 10 * 60_000);
  if (!limit.ok) tooMany(`Please wait ${Math.ceil(limit.retryAfter / 60)} minute(s) before asking for another code.`, limit.retryAfter);
  const issued = await issueCode({ purpose: PURPOSES.EMAIL_VERIFY, email: draft.email ?? '', ip: ctx.ip });
  if (issued.throttled || !issued.code) tooMany('Too many codes have been sent to that address. Please try again in an hour.');
  sendMail({ to: draft.email ?? '', template: 'verifyEmail', ...templates.verifyEmail({ code: issued.code!, name: String((draft.payload as Record<string, string>).firstName ?? ''), minutes: env.OTP_EXPIRY_MINUTES }) })
    .catch((error) => console.warn('[KSF] verification e-mail failed:', (error as Error).message));
  return { ok: true, message: `A new code is on its way to ${maskEmail(draft.email ?? '')}.`, expiresInMinutes: env.OTP_EXPIRY_MINUTES, ...shownCode(issued.code) };
});

publicRoute('POST', '/api/v1/public/password-strength', async (ctx) => {
  const password = String(ctx.body.password || '');
  return { ...passwordStrength(password), problem: passwordProblem(password), minLength: PASSWORD_MIN_LENGTH };
});

publicRoute('POST', '/api/v1/register/cancel', async (ctx) => {
  const draft = await loadDraft(ctx);
  if (draft) await col.registrations().updateOne({ _id: draft.id }, { $set: { status: 'abandoned', updated_at: nowIso() } });
  ctx.setCookie.push(`${REG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return { ok: true };
});

/* ========================== PUBLIC: PASSWORD RESET ========================
   The answer is the same whether or not the address has an account. */
publicRoute('POST', '/api/v1/auth/forgot-password', async (ctx) => {
  const email = toStr(ctx.body.email, 160).toLowerCase();
  const same = { ok: true, message: 'If that address has a KSF account, a reset code is on its way to it.' };
  if (!isEmail(email)) return same;
  const limit = await hit(`forgot:${ctx.ip}`, 10, 15 * 60_000);
  if (!limit.ok) tooMany('Too many reset requests. Please wait a few minutes.', limit.retryAfter);

  const user = await col.users().findOne({ email });
  if (!user || user.status !== 'active') {
    await securityEvent({ emailHint: email, type: 'auth.reset-requested', outcome: 'ignored', ip: ctx.ip, userAgent: ctx.userAgent });
    return same;
  }
  const issued = await issueCode({ purpose: PURPOSES.PASSWORD_RESET, email, userId: user.id, pharmacyId: user.pharmacy_id, ip: ctx.ip });
  if (!issued.throttled && issued.code) {
    sendMail({ to: email, template: 'passwordReset', ...templates.passwordReset({ code: issued.code, name: user.full_name, minutes: env.OTP_EXPIRY_MINUTES }) })
      .catch((error) => console.warn('[KSF] reset e-mail failed:', (error as Error).message));
  }
  await securityEvent({ pharmacyId: user.pharmacy_id, userId: user.id, emailHint: email, type: 'auth.reset-requested', ip: ctx.ip, userAgent: ctx.userAgent });
  return same;
});

publicRoute('POST', '/api/v1/auth/reset-password', async (ctx) => {
  const email = toStr(ctx.body.email, 160).toLowerCase();
  const password = String(ctx.body.password || '');
  const limit = await hit(`reset:${email}`, 12, 15 * 60_000);
  if (!limit.ok) tooMany('Too many attempts. Please wait a few minutes.', limit.retryAfter);

  const user = await col.users().findOne({ email });
  const result = await verifyCode({ purpose: PURPOSES.PASSWORD_RESET, email, code: toStr(ctx.body.code, 12) });
  if (!result.ok || !user) {
    await securityEvent({ emailHint: email, type: 'auth.reset-failed', severity: 'warn', outcome: 'failure', ip: ctx.ip });
    return bad('That reset code is not correct or has expired. Please ask for a new one.', 'code');
  }
  const problem = passwordProblem(password);
  if (problem) bad(problem, 'password');

  const at = nowIso();
  await col.users().updateOne({ _id: user.id }, {
    $set: { password_hash: await hashPassword(password), password_changed_at: at, must_change_password: 0, failed_attempts: 0, locked_until: null, updated_at: at }
  });
  const ended = await revokeAllSessions(user.id, { reason: 'password-reset' });
  await securityEvent({ pharmacyId: user.pharmacy_id, userId: user.id, emailHint: email, type: 'auth.password-reset', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent, detail: `${ended} session(s) ended` });
  await auditLog({ pharmacyId: user.pharmacy_id, user, ip: ctx.ip, userAgent: ctx.userAgent }, { action: 'auth.password-reset', entity: 'user', entityId: user.id, summary: `${user.full_name} reset their password` });
  sendMail({ to: email, template: 'securityAlert', ...templates.securityAlert({ name: user.full_name, what: 'Your password was reset', when: when(), where: approximate(ctx.ip) }) })
    .catch(() => { /* the reset stands regardless */ });
  return { ok: true, message: 'Your password has been changed. Please sign in with it.' };
});

/* ======================= THE SECURITY CENTRE ============================== */
accountRoute('GET', '/api/v1/account/security', async (ctx) => {
  const [sessions, devices, limits, events, logins, recoveryLeft] = await Promise.all([
    listSessions(ctx.user.id),
    listDevices(ctx.user.id),
    deviceLimits(ctx.user.pharmacy_id),
    col.securityEvents().find({ user_id: ctx.user.id }).sort({ created_at: -1 }).limit(40).toArray(),
    col.loginAttempts().find({ email: ctx.user.email.toLowerCase() }).sort({ created_at: -1 }).limit(20).toArray(),
    col.recoveryCodes().countDocuments({ user_id: ctx.user.id, used_at: null })
  ]);
  const seesMail = ctx.isPlatformAdmin || ctx.can('settings.read');
  return {
    password: { changedAt: ctx.user.password_changed_at, algorithm: 'scrypt', minLength: PASSWORD_MIN_LENGTH, mustChange: !!ctx.user.must_change_password },
    twoFactor: { enabled: !!ctx.user.totp_enabled, confirmedAt: ctx.user.totp_confirmed_at, recoveryCodesLeft: recoveryLeft, recoveryGeneratedAt: ctx.user.recovery_generated_at },
    sessions: sessions.map((session) => ({
      id: session.id, current: session.id === ctx.session.id, createdAt: session.created_at, lastSeenAt: session.last_seen_at,
      expiresAt: session.expires_at, from: approximate(session.ip), device: session.device_label ?? 'Unknown device', category: session.device_category ?? 'desktop'
    })),
    devices, deviceLimits: limits,
    events: events.map((event) => ({ id: event.id, type: event.type, severity: event.severity, outcome: event.outcome, from: approximate(event.ip), detail: event.detail, at: event.created_at })),
    logins: logins.map((attempt) => ({ ok: !!attempt.ok, from: approximate(attempt.ip), at: attempt.created_at })),
    mail: seesMail ? await mailHealth(ctx.isPlatformAdmin && !ctx.pharmacyId ? null : ctx.pharmacyId) : null,
    elevated: ctx.isElevated()
  };
});

route('GET', '/api/v1/account/audit-integrity', 'audit.read', async (ctx) => {
  const result = await verifyAuditChain(ctx.pharmacyId);
  const total = await col.auditLogs().countDocuments({ pharmacy_id: ctx.pharmacyId });
  return {
    ...result, total,
    message: result.ok
      ? `All ${result.checked} audit entries verify against their hash chain.`
      : `The chain breaks at entry ${result.brokenAt}. Somebody has altered or removed a record directly in the database.`
  };
});

route('GET', '/api/v1/account/audit', 'audit.read', async (ctx) => {
  const size = Math.min(200, Math.max(1, toInt(ctx.query.get('size'), 50)));
  const rows = await col.auditLogs().find({ pharmacy_id: ctx.pharmacyId }, {
    projection: { sequence: 1, action: 1, entity: 1, entity_id: 1, summary: 1, actor_name: 1, actor_role: 1, ip: 1, created_at: 1 }
  }).sort({ sequence: -1 }).limit(size).toArray();
  return { data: rows };
});

/* ------------------------------ two-step ------------------------------- */
accountRoute('POST', '/api/v1/account/2fa/start', async (ctx) => {
  ctx.requireRecentVerification();
  if (ctx.user.totp_enabled) bad('Two-factor authentication is already switched on.');
  const key = generateSecret();
  await col.users().updateOne({ _id: ctx.user.id }, { $set: { totp_secret: key, totp_enabled: 0, updated_at: nowIso() } });
  const pharmacy = ctx.user.pharmacy_id ? await col.pharmacies().findOne({ _id: ctx.user.pharmacy_id }, { projection: { name: 1 } }) : null;
  return {
    secret: key,
    otpauthUrl: otpauthUrl({ issuer: `KSF (${pharmacy?.name ?? 'Platform'})`, account: ctx.user.email, secret: key }),
    instructions: 'Scan this in Google Authenticator, Microsoft Authenticator or 1Password, then type the six digits it shows.'
  };
});

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(10);
  const at = nowIso();
  await col.recoveryCodes().deleteMany({ user_id: userId }, s());
  await col.recoveryCodes().insertMany(codes.map((code) => {
    const id = randomUUID();
    return { _id: id, id, user_id: userId, code_hash: sha256(normaliseRecoveryCode(code)), used_at: null, created_at: at };
  }), s());
  return codes;
}

accountRoute('POST', '/api/v1/account/2fa/enable', async (ctx) => {
  ctx.requireRecentVerification();
  const user = await col.users().findOne({ _id: ctx.user.id }, { projection: { totp_secret: 1 } });
  if (!user?.totp_secret) bad('Start the setup again — there is no key waiting to be confirmed.');
  if (await consumeTotp(ctx.user.id, user!.totp_secret, toStr(ctx.body.code, 10)) !== 'accepted') {
    await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: '2fa.enable-failed', severity: 'warn', outcome: 'failure', ip: ctx.ip });
    bad('That code is not correct. Check the time on your phone and try the next one.', 'code');
  }
  const at = nowIso();
  const codes = await tx(async () => {
    await col.users().updateOne({ _id: ctx.user.id }, { $set: { totp_enabled: 1, totp_confirmed_at: at, recovery_generated_at: at, updated_at: at } }, s());
    return replaceRecoveryCodes(ctx.user.id);
  });
  await auditLog(ctx, { action: '2fa.enabled', entity: 'user', entityId: ctx.user.id, summary: `${ctx.user.full_name} switched two-factor on` });
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: '2fa.enabled', ip: ctx.ip, userAgent: ctx.userAgent });
  return { ok: true, recoveryCodes: codes, message: 'Two-factor is on. Save these recovery codes somewhere safe — they are the way back in if you lose your phone, and they will not be shown again.' };
});

accountRoute('POST', '/api/v1/account/2fa/disable', async (ctx) => {
  ctx.requireRecentVerification();
  if (!ctx.user.totp_enabled) return { ok: true };
  await tx(async () => {
    await col.users().updateOne({ _id: ctx.user.id }, { $set: { totp_enabled: 0, totp_secret: null, totp_confirmed_at: null, updated_at: nowIso() } }, s());
    await col.recoveryCodes().deleteMany({ user_id: ctx.user.id }, s());
  });
  await auditLog(ctx, { action: '2fa.disabled', entity: 'user', entityId: ctx.user.id, summary: `${ctx.user.full_name} switched two-factor off` });
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: '2fa.disabled', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent });
  sendMail({ to: ctx.user.email, template: 'securityAlert', ...templates.securityAlert({ name: ctx.user.full_name, what: 'Two-factor authentication was switched off', when: when(), where: approximate(ctx.ip) }) })
    .catch(() => { /* the change stands regardless */ });
  return { ok: true, message: 'Two-factor authentication is off.' };
});

accountRoute('POST', '/api/v1/account/2fa/recovery-codes', async (ctx) => {
  ctx.requireRecentVerification();
  if (!ctx.user.totp_enabled) bad('Switch two-factor on first.');
  const codes = await tx(async () => {
    const fresh = await replaceRecoveryCodes(ctx.user.id);
    await col.users().updateOne({ _id: ctx.user.id }, { $set: { recovery_generated_at: nowIso(), updated_at: nowIso() } }, s());
    return fresh;
  });
  await auditLog(ctx, { action: '2fa.recovery-regenerated', entity: 'user', entityId: ctx.user.id, summary: 'New recovery codes generated' });
  return { ok: true, recoveryCodes: codes, message: 'The old codes no longer work. Save these somewhere safe.' };
});

/* -------------------------------- devices ------------------------------- */
accountRoute('GET', '/api/v1/account/devices', async (ctx) => ({
  data: await listDevices(ctx.user.id), limits: await deviceLimits(ctx.user.pharmacy_id), current: ctx.session.device_id
}));

accountRoute('PATCH', '/api/v1/account/devices/:id', async (ctx) => {
  const device = await renameDevice(ctx.params.id, ctx.user.id, ctx.body.label);
  if (!device) return missing('That device could not be found.');
  return { data: publicDevice(device) };
});

accountRoute('DELETE', '/api/v1/account/devices/:id', async (ctx) => {
  ctx.requireRecentVerification();
  const device = await revokeDevice({ deviceId: ctx.params.id, userId: ctx.user.id, revokedBy: ctx.user.id, reason: toStr(ctx.body.reason, 120) || 'removed by the account holder' });
  if (!device) return missing('That device could not be found.');
  const ended = await revokeDeviceSessions(device.id, 'device-removed');
  await auditLog(ctx, { action: 'device.removed', entity: 'device', entityId: device.id, summary: `${device.label} removed, ${ended} session(s) ended` });
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: 'device.removed', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent, deviceId: device.id });
  return { ok: true, sessionsEnded: ended, message: `${device.label} has been removed.` };
});

/* ------------------------------- sessions ------------------------------- */
accountRoute('GET', '/api/v1/account/sessions', async (ctx) => ({
  data: (await listSessions(ctx.user.id)).map((session) => ({
    id: session.id, current: session.id === ctx.session.id, createdAt: session.created_at, lastSeenAt: session.last_seen_at,
    expiresAt: session.expires_at, from: approximate(session.ip), device: session.device_label ?? 'Unknown device'
  }))
}));

accountRoute('DELETE', '/api/v1/account/sessions/:id', async (ctx) => {
  const target = await col.sessions().findOne({ _id: ctx.params.id, user_id: ctx.user.id, revoked_at: null });
  if (!target) return missing('That session could not be found.');
  if (target.id === ctx.session.id) bad('Use Sign out to end the session you are using now.');
  await revokeSession(target.id, 'ended-by-user');
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: 'session.revoked', ip: ctx.ip, userAgent: ctx.userAgent });
  return { ok: true };
});

accountRoute('POST', '/api/v1/account/sessions/logout-all', async (ctx) => {
  const ended = await revokeAllSessions(ctx.user.id, { except: ctx.session.id, reason: 'signed-out-everywhere' });
  await auditLog(ctx, { action: 'session.logout-all', entity: 'user', entityId: ctx.user.id, summary: `${ended} other session(s) ended` });
  await securityEvent({ pharmacyId: ctx.pharmacyId, userId: ctx.user.id, type: 'session.logout-all', severity: 'warn', ip: ctx.ip, userAgent: ctx.userAgent });
  return { ok: true, ended, message: `${ended} other session(s) have been signed out.` };
});

/* -------------------------------- privacy ------------------------------- */
route('GET', '/api/v1/account/privacy', null, async (ctx) => {
  const [customers, prescriptions, sales, staff] = await Promise.all([
    col.customers().countDocuments({ pharmacy_id: ctx.pharmacyId }),
    col.prescriptions().countDocuments({ pharmacy_id: ctx.pharmacyId }),
    col.sales().countDocuments({ pharmacy_id: ctx.pharmacyId }),
    col.users().countDocuments({ pharmacy_id: ctx.pharmacyId })
  ]);
  return {
    collected: [
      { what: 'Your staff accounts', why: 'To let people sign in and to record who did what', retention: 'While the account exists' },
      { what: 'Customer names and phone numbers', why: 'To attach a sale or a prescription to a person', retention: 'Until you delete the customer' },
      { what: 'Prescription details', why: 'Because dispensing a prescription-only medicine legally requires a record', retention: 'As long as Pakistani pharmacy law requires' },
      { what: 'Sign-in activity and devices', why: 'So you can tell whether somebody else has been in your account', retention: '30 days for expired sessions, longer for security events' },
      { what: 'Sales, purchases and stock movements', why: 'To run the shop and to produce accounts', retention: 'Until you delete them' }
    ],
    notCollected: [
      'Browser fingerprints — devices are recognised by an identifier this server issues, not by measuring the machine',
      'Location beyond the approximate network an address belongs to',
      'Anything shared with an advertising or analytics service — there are none in this application'
    ],
    holdings: { customers, prescriptions, sales, staff },
    export: 'Settings › Privacy › Export my data produces a JSON file of everything held about this pharmacy.',
    deletion: 'Deleting the pharmacy removes every record. It cannot be undone, and it is never done automatically — not when a trial ends, not when a payment fails.'
  };
});

route('GET', '/api/v1/account/export', 'settings.read', async (ctx) => {
  const pharmacyId = ctx.pharmacyId;
  const all = <T extends { pharmacy_id: string | null }>(collection: () => import('mongodb').Collection<T>) =>
    collection().find({ pharmacy_id: pharmacyId } as import('mongodb').Filter<T>).toArray();
  const data = {
    exportedAt: nowIso(),
    pharmacy: await col.pharmacies().findOne({ _id: pharmacyId }),
    branches: await all(col.branches), roles: await all(col.roles),
    staff: (await all(col.users)).map(({ password_hash: _hash, totp_secret: _totp, ...safe }) => safe),
    categories: await all(col.categories), medicines: await all(col.medicines), suppliers: await all(col.suppliers),
    batches: await all(col.batches), customers: await all(col.customers), sales: await all(col.sales),
    purchases: await all(col.purchases), prescriptions: await all(col.prescriptions), expenses: await all(col.expenses),
    settings: await all(col.settings), subscription: await subscriptionState(pharmacyId)
  };
  await auditLog(ctx, { action: 'data.exported', entity: 'pharmacy', entityId: pharmacyId, summary: `${ctx.user.full_name} exported the pharmacy data` });
  return { data };
});

route('GET', '/api/v1/account/referrals', null, async (ctx) => referralSummary(ctx.pharmacyId, ctx.user.id));

/* Development only: the outbox, so registration works without a mail server. */
publicRoute('GET', '/api/v1/dev/outbox', async () => {
  if (IS_PROD || !isDevMailbox()) throw new HttpError(404, 'That endpoint does not exist.');
  return { data: readDevOutbox(10), note: 'Development transport only. Never available when NODE_ENV=production.' };
});
