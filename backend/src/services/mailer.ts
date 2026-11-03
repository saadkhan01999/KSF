/* ==========================================================================
   Outbound e-mail
   --------------------------------------------------------------------------
   MAIL_TRANSPORT decides where a message goes:
     console  (development default) prints it and saves a copy in .data/outbox
     file     saves to .data/outbox only
     smtp     a real SMTP conversation (STARTTLS or TLS) over node:net/tls
     none     discards — for automated tests

   Codes and resets are never stored and never retried: the person is waiting
   and presses the button again. Notices (renewal reminders, receipts) are
   stored and retried on a widening schedule until sent or given up on, and
   either way they stay visible in the Security Centre.
   ========================================================================== */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env, IS_PROD, OUTBOX_FOLDER } from '../config/env.js';
import { col } from '../db/mongo.js';
import { nowIso, plusMinutes } from '../core/util.js';

const TRANSPORT = (env.MAIL_TRANSPORT ?? (IS_PROD ? 'smtp' : 'console'));
const APP_URL = env.PUBLIC_APP_URL;

export const mailTransport = (): string => TRANSPORT;
export const isDevMailbox = (): boolean => TRANSPORT === 'console' || TRANSPORT === 'file';

export interface Mail { to: string; subject: string; text: string; html?: string | null }

/* ------------------------------------------------------------------- MIME */
const encodeHeader = (value: string): string => (/^[\x20-\x7E]*$/.test(value)
  ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`);
/* A newline in a display name must never be able to add a Bcc of its own. */
const oneLine = (value: unknown): string => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

function buildMessage({ to, subject, text, html }: Mail): string {
  const boundary = `ksf_${randomUUID().replace(/-/g, '')}`;
  const headers = [
    `From: ${encodeHeader(env.MAIL_FROM_NAME)} <${env.MAIL_FROM}>`,
    `To: ${oneLine(to)}`,
    `Subject: ${encodeHeader(oneLine(subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@ksfpharmacy.pk>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n');
  const body = [
    '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encode(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    encode(html ?? `<pre>${text}</pre>`), `--${boundary}--`, ''
  ];
  return `${headers.join('\r\n')}\r\n${body.join('\r\n')}`;
}

/* ------------------------------------------------------------ SMTP client */
function smtpSend(raw: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const host = env.MAIL_HOST;
    const port = env.MAIL_PORT;
    const useTls = env.MAIL_SECURE || port === 465;
    if (!host) { reject(new Error('MAIL_TRANSPORT=smtp needs MAIL_HOST to be set.')); return; }

    let socket: net.Socket = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    socket.setTimeout(Number(process.env.MAIL_TIMEOUT_MS || 15_000));
    let buffer = '';
    let step = 0;
    let finished = false;
    const ehlo = `EHLO ${process.env.MAIL_EHLO || 'ksf-pharmacy'}`;
    const script: Array<{ expect: number; upgrade?: boolean; send: () => string | null }> = [
      { expect: 220, send: () => ehlo },
      { expect: 250, send: () => (useTls || process.env.MAIL_STARTTLS === 'false' ? null : 'STARTTLS') },
      { expect: 220, upgrade: true, send: () => ehlo },
      { expect: 250, send: () => (env.MAIL_USER ? 'AUTH LOGIN' : null) },
      { expect: 334, send: () => Buffer.from(env.MAIL_USER, 'utf8').toString('base64') },
      { expect: 334, send: () => Buffer.from(env.MAIL_PASSWORD, 'utf8').toString('base64') },
      { expect: 235, send: () => `MAIL FROM:<${env.MAIL_FROM}>` },
      { expect: 250, send: () => `RCPT TO:<${oneLine(to)}>` },
      { expect: 250, send: () => 'DATA' },
      { expect: 354, send: () => `${raw.replace(/\r\n\./g, '\r\n..')}\r\n.` },
      { expect: 250, send: () => 'QUIT' }
    ];

    const done = (error: Error | null) => {
      if (finished) return;
      finished = true;
      try { socket.end(); } catch { /* already closed */ }
      if (error) reject(error); else resolve();
    };
    const advance = () => {
      while (step < script.length) {
        const command = script[step].send();
        if (command !== null) { socket.write(`${command}\r\n`); step += 1; return; }
        step += 2;
      }
      done(null);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const last = buffer.split('\r\n').filter((line) => /^\d{3} /.test(line)).pop();
      if (!last) return;
      buffer = '';
      const code = Number(last.slice(0, 3));
      const stage = script[step];
      if (!stage) { done(null); return; }
      if (code >= 400) { done(new Error(`SMTP server refused the message: ${last}`)); return; }
      if (stage.upgrade && code === 220) {
        const upgraded = tls.connect({ socket, servername: host });
        upgraded.on('data', onData);
        upgraded.on('error', done);
        socket = upgraded;
      }
      advance();
    };
    socket.on('data', onData);
    socket.on('error', done);
    socket.on('timeout', () => done(new Error('The mail server did not answer in time.')));
  });
}

/* ------------------------------------------------------------- transports */
function writeToOutbox(message: string, mail: Mail): string {
  const folder = OUTBOX_FOLDER();
  mkdirSync(folder, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${oneLine(mail.to).replace(/[^\w@.-]/g, '_')}.eml`;
  writeFileSync(join(folder, name), message, 'utf8');
  return name;
}

async function deliver(message: string, mail: Mail): Promise<{ ok: true; transport: string; file?: string }> {
  if (TRANSPORT === 'none') return { ok: true, transport: 'none' };
  if (TRANSPORT === 'smtp') {
    await smtpSend(message, mail.to);
    return { ok: true, transport: 'smtp' };
  }
  if (TRANSPORT === 'console' && IS_PROD) throw new Error('MAIL_TRANSPORT=console must not be used in production. Configure SMTP.');
  const file = writeToOutbox(message, mail);
  if (TRANSPORT === 'console') {
    console.log(
      `\n────────────────────────────────────────────────────────\n  E-mail to ${mail.to}\n  ${mail.subject}\n`
      + `────────────────────────────────────────────────────────\n${mail.text}\n`
      + `────────────────────────────────────────────────────────\n  (development transport — saved to .data/outbox/${file})\n`
    );
  }
  return { ok: true, transport: TRANSPORT, file };
}

/* ======================================================= delivery record */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
const safeError = (error: unknown): string => String((error as Error)?.message ?? error ?? 'unknown').replace(/\b\d{6}\b/g, '••••••').slice(0, 300);

async function recordAttempt(id: string, ok: boolean, error: unknown, attempts: number, maxAttempts: number): Promise<void> {
  const at = nowIso();
  if (ok) {
    await col.mailDeliveries().updateOne({ _id: id }, { $set: { status: 'sent', attempts, sent_at: at, updated_at: at, next_attempt_at: null } });
    return;
  }
  const giveUp = attempts >= maxAttempts;
  await col.mailDeliveries().updateOne({ _id: id }, {
    $set: {
      status: giveUp ? 'failed' : 'queued', attempts, last_error: safeError(error), updated_at: at,
      next_attempt_at: giveUp ? null : plusMinutes(BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)])
    }
  });
}

export interface SendOptions extends Mail { noticeKey?: string; pharmacyId?: string | null; template?: string; retry?: boolean }

/** Send one message. Throws when a non-retryable message cannot be sent. */
export async function sendMail(mail: SendOptions): Promise<{ ok: boolean; transport: string; duplicate?: boolean; queued?: boolean }> {
  const message = buildMessage(mail);
  const retry = mail.retry === true;
  const maxAttempts = retry ? BACKOFF_MINUTES.length : 1;
  const id = randomUUID();
  const at = nowIso();

  let recorded = false;
  try {
    await col.mailDeliveries().insertOne({
      _id: id, id, notice_key: mail.noticeKey ?? null, pharmacy_id: mail.pharmacyId ?? null, to: oneLine(mail.to),
      template: mail.template ?? null, subject: oneLine(mail.subject),
      /* A code is never stored. */
      text: retry ? mail.text : '', html: retry ? (mail.html ?? null) : null,
      status: 'queued', attempts: 0, max_attempts: maxAttempts, last_error: null, next_attempt_at: null, sent_at: null,
      created_at: at, updated_at: at
    });
    recorded = true;
  } catch (error) {
    /* The unique notice key: this exact notice is sent or queued already. */
    if ((error as { code?: number }).code === 11000) return { ok: true, transport: TRANSPORT, duplicate: true };
  }

  try {
    const result = await deliver(message, mail);
    if (recorded) await recordAttempt(id, true, null, 1, maxAttempts);
    return result;
  } catch (error) {
    if (recorded) await recordAttempt(id, false, error, 1, maxAttempts);
    if (retry) return { ok: false, transport: TRANSPORT, queued: true };
    throw error;
  }
}

/** Send the messages whose retry is due. Called by the hourly maintenance job. */
export async function drainMailQueue(limit = 50): Promise<{ tried: number; sent: number; failed: number }> {
  const summary = { tried: 0, sent: 0, failed: 0 };
  const due = await col.mailDeliveries().find({ status: 'queued', next_attempt_at: { $ne: null, $lte: nowIso() } })
    .sort({ next_attempt_at: 1 }).limit(limit).toArray();
  for (const row of due) {
    if (!row.text) {
      await col.mailDeliveries().updateOne({ _id: row.id }, { $set: { status: 'failed', next_attempt_at: null, last_error: 'Not retryable: the body was not stored.', updated_at: nowIso() } });
      continue;
    }
    summary.tried += 1;
    const mail = { to: row.to, subject: row.subject, text: row.text, html: row.html };
    const maxAttempts = row.max_attempts ?? BACKOFF_MINUTES.length;
    try {
      await deliver(buildMessage(mail), mail);
      await recordAttempt(row.id, true, null, row.attempts + 1, maxAttempts);
      summary.sent += 1;
    } catch (error) {
      await recordAttempt(row.id, false, error, row.attempts + 1, maxAttempts);
      summary.failed += 1;
    }
  }
  return summary;
}

const maskAddress = (value: string): string => {
  const [name = '', domain] = String(value ?? '').split('@');
  if (!domain) return '—';
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`;
};

/** What has gone out, and what has not — for the Security Centre. */
export async function mailHealth(pharmacyId: string | null = null) {
  const filter = pharmacyId ? { pharmacy_id: pharmacyId } : {};
  const [counts] = await col.mailDeliveries().aggregate<{ total: number; sent: number; queued: number; failed: number }>([
    { $match: filter },
    {
      $group: {
        _id: null, total: { $sum: 1 },
        sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
        queued: { $sum: { $cond: [{ $eq: ['$status', 'queued'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
      }
    }
  ]).toArray();
  const recent = await col.mailDeliveries().find(filter).sort({ created_at: -1 }).limit(20).toArray();
  return {
    transport: TRANSPORT,
    configured: TRANSPORT !== 'smtp' || !!env.MAIL_HOST,
    total: counts?.total ?? 0, sent: counts?.sent ?? 0, queued: counts?.queued ?? 0, failed: counts?.failed ?? 0,
    recent: recent.map((row) => ({
      id: row.id, to_address: maskAddress(row.to), subject: row.subject, template: row.template, status: row.status,
      attempts: row.attempts, last_error: row.last_error, created_at: row.created_at, sent_at: row.sent_at
    }))
  };
}

/** The development outbox, so registration can be finished without a mail server. */
export function readDevOutbox(limit = 10): Array<{ name: string; to: string; subject: string; text: string }> {
  if (IS_PROD || !isDevMailbox()) return [];
  try {
    const folder = OUTBOX_FOLDER();
    return readdirSync(folder)
      .filter((name) => name.endsWith('.eml'))
      .map((name) => ({ name, at: statSync(join(folder, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map(({ name }) => {
        const raw = readFileSync(join(folder, name), 'utf8');
        const subject = /^Subject: (.*)$/m.exec(raw)?.[1] ?? '';
        const to = /^To: (.*)$/m.exec(raw)?.[1] ?? '';
        const encoded = raw.split('Content-Transfer-Encoding: base64')[1] ?? '';
        const text = Buffer.from(encoded.split('\r\n\r\n')[1]?.split('\r\n--')[0]?.replace(/\n/g, '') ?? '', 'base64').toString('utf8');
        return { name, to, subject, text };
      });
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------- messages */
const shell = (heading: string, lines: string[], footer = ''): string => `
<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#F4F7F5;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8E5">
    <div style="background:#FFFFFF;border-bottom:3px solid #14442E;padding:18px 28px;color:#14442E;font-weight:700;font-size:20px;letter-spacing:.02em"><img src="${APP_URL}/brand/ksf-email-logo.png" width="257" height="48" alt="KSF Pharmacy" style="display:block;border:0;height:48px;width:257px;color:#14442E;font-weight:700;font-size:20px"></div>
    <div style="padding:28px">
      <h1 style="margin:0 0 12px;font-size:20px;color:#132A22">${heading}</h1>
      ${lines.map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3A4A44">${line}</p>`).join('')}
    </div>
    <div style="padding:16px 28px;background:#F8FAF9;font-size:12px;color:#6B7C76;border-top:1px solid #E2E8E5">
      ${footer || 'You are receiving this because an account was created with this address at KSF.'}
    </div>
  </div>
</div>`;

const codeBlock = (code: string) =>
  `<span style="display:inline-block;font-size:30px;letter-spacing:.32em;font-weight:700;color:#0E7A50;background:#EAF6F1;padding:12px 20px;border-radius:12px">${code}</span>`;
const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#0E7A50;color:#FFFFFF;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">${label}</a>`;

export const templates = {
  verifyEmail: ({ code, name, minutes }: { code: string; name?: string; minutes: number }) => ({
    subject: 'Your KSF verification code',
    text: `Assalam-o-alaikum ${name || ''},\n\nYour KSF verification code is ${code}\n\nIt expires in ${minutes} minutes and can only be used once.\n\nIf you did not ask to create an account, you can ignore this message — nothing has been set up.\n\nKSF`,
    html: shell('Verify your e-mail address', [
      `Assalam-o-alaikum ${name || ''},`, 'Enter this code to continue setting up your pharmacy:', codeBlock(code),
      `It expires in ${minutes} minutes and can only be used once.`,
      'If you did not ask to create an account, you can ignore this message — nothing has been set up.'
    ])
  }),
  passwordReset: ({ code, name, minutes }: { code: string; name?: string; minutes: number }) => ({
    subject: 'Reset your KSF password',
    text: `Assalam-o-alaikum ${name || ''},\n\nYour KSF password reset code is ${code}\n\nIt expires in ${minutes} minutes.\n\nIf you did not ask for this, your password has not changed and there is nothing you need to do.\n\nKSF`,
    html: shell('Reset your password', [
      `Assalam-o-alaikum ${name || ''},`, 'Use this code to set a new password:', codeBlock(code),
      `It expires in ${minutes} minutes.`, 'If you did not ask for this, your password has not changed and there is nothing you need to do.'
    ])
  }),
  emailChange: ({ code, name, minutes }: { code: string; name?: string; minutes: number }) => ({
    subject: 'Confirm your new KSF e-mail address',
    text: `Assalam-o-alaikum ${name || ''},\n\nEnter this code to make this your KSF sign-in address: ${code}\n\nIt expires in ${minutes} minutes.\n\nKSF`,
    html: shell('Confirm your new e-mail address', [
      `Assalam-o-alaikum ${name || ''},`, 'Enter this code to make this address your KSF sign-in:', codeBlock(code),
      `It expires in ${minutes} minutes.`
    ])
  }),
  securityAlert: ({ name, what, when, where }: { name?: string; what: string; when: string; where: string }) => ({
    subject: `KSF security notice: ${what}`,
    text: `Assalam-o-alaikum ${name || ''},\n\n${what} on your KSF account.\n\nWhen: ${when}\nWhere: ${where}\n\nIf this was you, no action is needed. If it was not, open Settings > Security Centre, sign out of every device and change your password.\n\nKSF`,
    html: shell('Security notice', [
      `Assalam-o-alaikum ${name || ''},`, `<strong>${what}</strong> on your KSF account.`, `When: ${when}<br>Where: ${where}`,
      'If this was you, no action is needed. If it was not, open <strong>Settings &rsaquo; Security Centre</strong>, sign out of every device and change your password.'
    ])
  }),
  welcome: ({ name, pharmacy, subscriptionId, trialEnds }: { name?: string; pharmacy: string; subscriptionId: string; trialEnds?: string | null }) => ({
    subject: `${pharmacy} is ready on KSF`,
    text: `Assalam-o-alaikum ${name || ''},\n\n${pharmacy} is set up and ready to use.\n\nSubscription reference: ${subscriptionId}\n${trialEnds ? `Your free trial — every feature, unlimited data — runs until ${trialEnds}. Then choose Monthly or Yearly; nothing you enter is lost.\n` : ''}\nSign in at ${APP_URL}\n\nKSF`,
    html: shell(`${pharmacy} is ready`, [
      `Assalam-o-alaikum ${name || ''},`,
      'Your pharmacy is set up. The first thing worth doing is adding your opening stock, or importing it from your old system under Settings &rsaquo; Data Migration.',
      `Subscription reference: <strong>${subscriptionId}</strong>`,
      trialEnds ? `Your free trial — every feature, unlimited data — runs until <strong>${trialEnds}</strong>. Then choose the Monthly or Yearly plan; nothing you enter is lost.` : '',
      button(APP_URL, 'Open KSF')
    ].filter(Boolean))
  }),
  paymentFailed: ({ name, pharmacy, graceEnds, reason }: { name?: string; pharmacy: string; graceEnds: string; reason: string }) => ({
    subject: 'KSF payment could not be taken',
    text: `Assalam-o-alaikum ${name || ''},\n\nWe could not take the payment for ${pharmacy}.\n\nReason: ${reason}\n\nYour data is safe and your pharmacy keeps working until ${graceEnds}. Update the payment method under Settings > Billing and Subscription before then.\n\nKSF`,
    html: shell('We could not take your payment', [
      `Assalam-o-alaikum ${name || ''},`, `The payment for <strong>${pharmacy}</strong> did not go through.`, `Reason: ${reason}`,
      `<strong>Nothing has been deleted and your pharmacy keeps working until ${graceEnds}.</strong> Please update the payment method under Settings &rsaquo; Billing and Subscription before then.`
    ])
  }),
  renewalReminder: ({ name, pharmacy, plan, amount, on, days }: { name?: string; pharmacy: string; plan: string; amount: string; on: string; days: number }) => ({
    subject: days === 1 ? `${pharmacy}: your KSF subscription renews tomorrow` : `${pharmacy}: your KSF subscription renews on ${on}`,
    text: `Assalam-o-alaikum ${name || ''},\n\nThe ${plan} subscription for ${pharmacy} renews on ${on} at ${amount}.\n\nIf your payment method is up to date there is nothing to do.\n\nTo change the plan or stop the renewal, open Settings > Billing and Subscription. Cancelling keeps the plan until ${on}; after that you choose a plan again whenever you are ready — nothing is deleted either way.\n\n${APP_URL}\n\nKSF`,
    html: shell(days === 1 ? 'Your subscription renews tomorrow' : 'Your subscription renews soon', [
      `Assalam-o-alaikum ${name || ''},`,
      `The <strong>${plan}</strong> subscription for <strong>${pharmacy}</strong> renews on <strong>${on}</strong> at <strong>${amount}</strong>.`,
      'If your payment method is up to date, there is nothing to do.',
      'To change the plan or stop the renewal, open <strong>Settings &rsaquo; Billing and Subscription</strong>. Nothing is deleted either way.',
      button(`${APP_URL}/settings?tab=billing`, 'Open Billing')
    ])
  }),
  paymentMissed: ({ name, pharmacy, amount, until, daysLeft, attempts, final }: { name?: string; pharmacy: string; amount: string; until: string; daysLeft: number; attempts: number; final: boolean }) => ({
    subject: final ? `${pharmacy}: last few days before your plan changes` : `${pharmacy}: your KSF payment did not go through`,
    text: `Assalam-o-alaikum ${name || ''},\n\nThe subscription payment of ${amount} for ${pharmacy} has not been received${attempts > 1 ? ` after ${attempts} attempts` : ''}.\n\nYour pharmacy is working normally and will keep working until ${until}${daysLeft > 0 ? ` — that is ${daysLeft} more day(s)` : ''}.\n\nAfter that you will be asked to choose a plan. Nothing is deleted, and paying puts everything back as it was.\n\nTo pay now: Settings > Billing and Subscription.\n\n${APP_URL}/settings?tab=billing\n\nKSF`,
    html: shell(final ? 'A few days left on your plan' : 'We could not take your payment', [
      `Assalam-o-alaikum ${name || ''},`,
      `The subscription payment of <strong>${amount}</strong> for <strong>${pharmacy}</strong> has not been received${attempts > 1 ? ` after ${attempts} attempts` : ''}.`,
      `Your pharmacy is working normally and keeps working until <strong>${until}</strong>${daysLeft > 0 ? ` — ${daysLeft} more day(s)` : ''}.`,
      'After that you will be asked to choose a plan. <strong>Nothing is deleted</strong>, and paying puts everything back as it was.',
      button(`${APP_URL}/settings?tab=billing`, 'Pay now')
    ])
  }),
  planEnding: ({ name, pharmacy, what, on, days, choices }: { name?: string; pharmacy: string; what: string; on: string; days: number; choices: string[] }) => ({
    subject: days <= 1 ? `${pharmacy}: your KSF ${what} ends tomorrow` : `${pharmacy}: your KSF ${what} ends on ${on}`,
    text: `Assalam-o-alaikum ${name || ''},\n\nThe ${what} for ${pharmacy} ends on ${on}.\n\nTo carry on without a break, choose a plan under Settings > Billing and Subscription:\n\n${choices.map((line) => `  - ${line}`).join('\n')}\n\nNothing you have entered is lost either way.\n\n${APP_URL}/settings?tab=billing\n\nKSF`,
    html: shell(days <= 1 ? `Your ${what} ends tomorrow` : `Your ${what} ends on ${on}`, [
      `Assalam-o-alaikum ${name || ''},`,
      `The <strong>${what}</strong> for <strong>${pharmacy}</strong> ends on <strong>${on}</strong>.`,
      `To carry on without a break, choose a plan:<br>${choices.map((line) => `&bull; ${line}`).join('<br>')}`,
      '<strong>Nothing you have entered is lost</strong> either way.',
      button(`${APP_URL}/settings?tab=billing`, 'Choose a plan')
    ])
  }),
  paymentReceipt: ({ name, pharmacy, invoiceNo, amount, plan, period, paidOn }: { name?: string; pharmacy: string; invoiceNo: string; amount: string; plan: string; period: string; paidOn: string }) => ({
    subject: `KSF receipt ${invoiceNo} — ${amount} received`,
    text: `Assalam-o-alaikum ${name || ''},\n\nThank you. We received ${amount} for the ${plan} plan of ${pharmacy} on ${paidOn}${period ? ` (${period})` : ''}.\n\nInvoice: ${invoiceNo}\n\nThe receipt can be printed or saved as a PDF under Settings > Billing and Subscription.\n\n${APP_URL}/settings?tab=billing\n\nKSF`,
    html: shell('Payment received — thank you', [
      `Assalam-o-alaikum ${name || ''},`,
      `We received <strong>${amount}</strong> for the <strong>${plan}</strong> plan of <strong>${pharmacy}</strong> on ${paidOn}${period ? ` (${period})` : ''}.`,
      `Invoice number: <strong>${invoiceNo}</strong>`,
      'The receipt can be printed or saved as a PDF under <strong>Settings &rsaquo; Billing and Subscription</strong>.',
      button(`${APP_URL}/settings?tab=billing`, 'View the receipt')
    ], 'You are receiving this because you manage this pharmacy on KSF.')
  }),
  supportReply: ({ name, reference, subject, reply, status }: { name?: string; reference: string; subject: string; reply: string; status: string }) => ({
    subject: `[${reference}] ${subject}`,
    text: `Assalam-o-alaikum ${name || ''},\n\nKSF support has replied to your request "${subject}" (${reference}).\n\n${reply}\n\nStatus: ${status}\n\nOpen it in KSF under Help & Support.\n\n${APP_URL}/support\n\nKSF`,
    html: shell('KSF support has replied', [
      `Assalam-o-alaikum ${name || ''},`, `Your request <strong>${subject}</strong> (${reference}):`,
      `<em>${reply.replace(/</g, '&lt;')}</em>`, `Status: <strong>${status}</strong>`, button(`${APP_URL}/support`, 'Open the request')
    ])
  })
};
