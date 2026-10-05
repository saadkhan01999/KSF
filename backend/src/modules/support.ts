/* ==========================================================================
   Help & Support — a pharmacy's line to the platform
   --------------------------------------------------------------------------
   When somebody at a pharmacy is stuck — a payment that did not go through,
   an import that will not match, a till that refuses a sale — they raise a
   request here instead of phoning. The platform Super Admin sees every
   pharmacy's requests in one queue, answers in the thread, and can open the
   pharmacy in support mode to fix the problem where it is.

   Rules:
     - A pharmacy only ever sees its own requests. Somebody with
       settings.write (the Admin) sees all of the pharmacy's; anybody else
       sees the ones they raised.
     - Each side has its own unread flag, so both badges are right without
       counting messages.
     - A closed request can be reopened by the pharmacy; a reply to a
       resolved one reopens it automatically, because the problem is clearly
       not resolved.
   ========================================================================== */

import type { Filter } from 'mongodb';
import { col } from '../db/mongo.js';
import type { SupportTicket, TicketMessage } from '../db/types.js';
import { bad, missing, tooMany } from '../core/errors.js';
import { logActivity, notify } from '../core/trails.js';
import { contains, nowIso, randomUUID, rateLimit, sanitiseText, toStr } from '../core/util.js';
import { platformRoute, route, type SignedInCtx } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { secureReference } from '../security/crypto.js';
import { sendMail, templates } from '../services/mailer.js';
import { pageResult, paging } from './shared.js';

export const TICKET_CATEGORIES = ['account', 'billing', 'sales', 'stock', 'data-import', 'technical', 'other'] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
const OPEN = ['open', 'in_progress', 'waiting'];
const MAX_BODY = 5000;

const label = (status: string): string => status.replace('_', ' ');

/** The list shape: no message bodies, just the latest line. */
const summary = (ticket: SupportTicket) => {
  const { messages, ...rest } = ticket;
  const last = messages.at(-1);
  return {
    ...rest, message_count: messages.length,
    last_message: last ? { author_side: last.author_side, author_name: last.author_name, preview: last.body.replace(/\s+/g, ' ').slice(0, 140), created_at: last.created_at } : null
  };
};

const message = (author: { id: string; name: string }, side: TicketMessage['author_side'], body: string): TicketMessage =>
  ({ id: randomUUID(), author_id: author.id, author_name: author.name, author_side: side, body, created_at: nowIso() });

function readBody(raw: unknown): string {
  const body = sanitiseText(raw, MAX_BODY);
  if (!body) bad('Write the message before sending.', 'body');
  return body;
}

/* ============================== PHARMACY SIDE ============================== */

/** Which of this pharmacy's requests the person may see. */
function visible(ctx: PharmacyCtx): Filter<SupportTicket> {
  const filter: Filter<SupportTicket> = { pharmacy_id: ctx.pharmacyId };
  if (!ctx.can('settings.write')) filter.raised_by = ctx.user.id;
  return filter;
}

async function ticketFor(ctx: PharmacyCtx): Promise<SupportTicket> {
  const ticket = await col.supportTickets().findOne({ ...visible(ctx), _id: toStr(ctx.params.id, 60) });
  if (!ticket) return missing('That request could not be found.');
  return ticket;
}

route('GET', '/api/v1/support/tickets', 'support.raise', async (ctx) => {
  const { page, size, skip } = paging(ctx, 25);
  const status = toStr(ctx.query.get('status'), 20);
  const filter = visible(ctx);
  if (status === 'open') filter.status = { $in: OPEN as SupportTicket['status'][] };
  else if (status && status !== 'all') filter.status = status as SupportTicket['status'];
  const [rows, total, counted] = await Promise.all([
    col.supportTickets().find(filter).sort({ last_activity_at: -1 }).skip(skip).limit(size).toArray(),
    col.supportTickets().countDocuments(filter),
    col.supportTickets().aggregate<{ _id: string; n: number }>([{ $match: visible(ctx) }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray()
  ]);
  const counts = Object.fromEntries(TICKET_STATUSES.map((key) => [key, counted.find((row) => row._id === key)?.n ?? 0]));
  return { ...pageResult(rows.map(summary), total, { page, size }), counts, categories: TICKET_CATEGORIES, priorities: TICKET_PRIORITIES };
});

route('POST', '/api/v1/support/tickets', 'support.raise', async (ctx) => {
  const limit = rateLimit(`ticket:${ctx.user.id}`, 10, 60 * 60_000);
  if (!limit.ok) tooMany('You have raised a lot of requests in the last hour. Add to an open one instead, or try again later.', limit.retryAfter);
  const subject = sanitiseText(ctx.body.subject, 140);
  if (!subject) bad('Give the request a short subject — what is the problem?', 'subject');
  const category = toStr(ctx.body.category, 20) || 'other';
  if (!(TICKET_CATEGORIES as readonly string[]).includes(category)) bad('Choose what the request is about.', 'category');
  const priority = toStr(ctx.body.priority, 10) || 'normal';
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) bad('Choose how urgent it is.', 'priority');
  const body = readBody(ctx.body.body);

  const pharmacy = await col.pharmacies().findOne({ _id: ctx.pharmacyId }, { projection: { name: 1 } });
  const at = nowIso();
  const id = randomUUID();
  const ticket: SupportTicket = {
    _id: id, id, reference: secureReference('KSF-SUP', { length: 6 }), pharmacy_id: ctx.pharmacyId, pharmacy_name: pharmacy?.name ?? 'Pharmacy',
    raised_by: ctx.user.id, raised_by_name: ctx.user.full_name, raised_by_role: ctx.user.role_name, subject, category,
    priority: priority as SupportTicket['priority'], status: 'open', messages: [message({ id: ctx.user.id, name: ctx.user.full_name }, 'pharmacy', body)],
    assigned_to: null, resolved_at: null, created_at: at, updated_at: at, last_activity_at: at, unread_by_pharmacy: 0, unread_by_platform: 1
  };
  await col.supportTickets().insertOne(ticket);
  await logActivity(ctx, { action: 'support.raised', entity: 'support-ticket', entityId: id, summary: `Support request ${ticket.reference} raised: ${subject}` });
  await notify(null, {
    type: 'support', severity: priority === 'urgent' || priority === 'high' ? 'warn' : 'info',
    title: `${ticket.pharmacy_name}: ${subject}`, body: `${ctx.user.full_name} (${ctx.user.role_name}) raised ${ticket.reference}.`, link: `/platform/support/${id}`
  });
  return { data: ticket, message: `Request ${ticket.reference} has been sent to KSF support.`, __status: 201 };
});

route('GET', '/api/v1/support/tickets/:id', 'support.raise', async (ctx) => {
  const ticket = await ticketFor(ctx);
  if (ticket.unread_by_pharmacy) await col.supportTickets().updateOne({ _id: ticket.id }, { $set: { unread_by_pharmacy: 0 } });
  return { data: { ...ticket, unread_by_pharmacy: 0 } };
});

route('POST', '/api/v1/support/tickets/:id/messages', 'support.raise', async (ctx) => {
  const ticket = await ticketFor(ctx);
  if (ticket.status === 'closed') bad('This request is closed. Reopen it to add to it.');
  const body = readBody(ctx.body.body);
  const entry = message({ id: ctx.user.id, name: ctx.user.full_name }, 'pharmacy', body);
  /* A reply to a resolved request means it is not resolved. */
  const status = ticket.status === 'resolved' || ticket.status === 'waiting' ? 'open' : ticket.status;
  const updated = await col.supportTickets().findOneAndUpdate(
    { _id: ticket.id, status: { $ne: 'closed' } },
    { $push: { messages: entry }, $set: { status, resolved_at: null, unread_by_platform: 1, unread_by_pharmacy: 0, last_activity_at: entry.created_at, updated_at: entry.created_at } },
    { returnDocument: 'after' }
  );
  if (!updated) bad('This request was closed a moment ago. Reopen it to add to it.');
  await notify(null, { type: 'support', severity: 'info', title: `${ticket.pharmacy_name} replied on ${ticket.reference}`, body: body.slice(0, 160), link: `/platform/support/${ticket.id}` });
  return { data: updated, __status: 201 };
});

route('POST', '/api/v1/support/tickets/:id/close', 'support.raise', async (ctx) => {
  const ticket = await ticketFor(ctx);
  if (ticket.status === 'closed') return { data: ticket };
  const at = nowIso();
  const updated = await col.supportTickets().findOneAndUpdate(
    { _id: ticket.id },
    { $set: { status: 'closed', resolved_at: ticket.resolved_at ?? at, updated_at: at, last_activity_at: at }, $push: { messages: message({ id: ctx.user.id, name: ctx.user.full_name }, 'pharmacy', 'Closed by the pharmacy — the problem is sorted.') } },
    { returnDocument: 'after' }
  );
  await logActivity(ctx, { action: 'support.closed', entity: 'support-ticket', entityId: ticket.id, summary: `Support request ${ticket.reference} closed` });
  return { data: updated };
});

route('POST', '/api/v1/support/tickets/:id/reopen', 'support.raise', async (ctx) => {
  const ticket = await ticketFor(ctx);
  if (OPEN.includes(ticket.status)) return { data: ticket };
  const reason = sanitiseText(ctx.body.reason, 500) || 'Reopened by the pharmacy — the problem is back.';
  const at = nowIso();
  const updated = await col.supportTickets().findOneAndUpdate(
    { _id: ticket.id },
    { $set: { status: 'open', resolved_at: null, unread_by_platform: 1, updated_at: at, last_activity_at: at }, $push: { messages: message({ id: ctx.user.id, name: ctx.user.full_name }, 'pharmacy', reason) } },
    { returnDocument: 'after' }
  );
  await notify(null, { type: 'support', severity: 'warn', title: `${ticket.pharmacy_name} reopened ${ticket.reference}`, body: reason.slice(0, 160), link: `/platform/support/${ticket.id}` });
  return { data: updated };
});

/* ============================== PLATFORM SIDE ============================== */

async function platformTicket(ctx: SignedInCtx): Promise<SupportTicket> {
  const ticket = await col.supportTickets().findOne({ _id: toStr(ctx.params.id, 60) });
  if (!ticket) return missing('That request could not be found.');
  return ticket;
}

platformRoute('GET', '/api/v1/platform/support/tickets', async (ctx) => {
  const { page, size, skip } = paging(ctx, 30);
  const status = toStr(ctx.query.get('status'), 20);
  const priority = toStr(ctx.query.get('priority'), 10);
  const pharmacyId = toStr(ctx.query.get('pharmacy'), 60);
  const search = toStr(ctx.query.get('q'), 80);
  const filter: Filter<SupportTicket> = {};
  if (status === 'open') filter.status = { $in: OPEN as SupportTicket['status'][] };
  else if (status === 'unread') filter.unread_by_platform = 1;
  else if (status && status !== 'all') filter.status = status as SupportTicket['status'];
  if (priority && priority !== 'all') filter.priority = priority as SupportTicket['priority'];
  if (pharmacyId) filter.pharmacy_id = pharmacyId;
  if (search) {
    const pattern = contains(search);
    filter.$or = [{ reference: pattern }, { subject: pattern }, { pharmacy_name: pattern }, { raised_by_name: pattern }];
  }
  const [rows, total, counted, unread] = await Promise.all([
    col.supportTickets().find(filter).sort({ unread_by_platform: -1, last_activity_at: -1 }).skip(skip).limit(size).toArray(),
    col.supportTickets().countDocuments(filter),
    col.supportTickets().aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    col.supportTickets().countDocuments({ unread_by_platform: 1 })
  ]);
  const counts = { ...Object.fromEntries(TICKET_STATUSES.map((key) => [key, counted.find((row) => row._id === key)?.n ?? 0])), unread };
  return { ...pageResult(rows.map(summary), total, { page, size }), counts, categories: TICKET_CATEGORIES, priorities: TICKET_PRIORITIES, statuses: TICKET_STATUSES };
});

platformRoute('GET', '/api/v1/platform/support/tickets/:id', async (ctx) => {
  const ticket = await platformTicket(ctx);
  if (ticket.unread_by_platform) await col.supportTickets().updateOne({ _id: ticket.id }, { $set: { unread_by_platform: 0 } });
  const [pharmacy, raisedBy] = await Promise.all([
    col.pharmacies().findOne({ _id: ticket.pharmacy_id }, { projection: { name: 1, status: 1, phone: 1, email: 1, city: 1, plan_key: 1 } }),
    ticket.raised_by ? col.users().findOne({ _id: ticket.raised_by }, { projection: { full_name: 1, email: 1, phone: 1, status: 1 } }) : null
  ]);
  return { data: { ...ticket, unread_by_platform: 0 }, pharmacy, raisedBy };
});

platformRoute('POST', '/api/v1/platform/support/tickets/:id/messages', async (ctx) => {
  const ticket = await platformTicket(ctx);
  const body = readBody(ctx.body.body);
  const requested = toStr(ctx.body.status, 20);
  if (requested && !(TICKET_STATUSES as readonly string[]).includes(requested)) bad('Choose a valid status.', 'status');
  /* Answering puts the ball in the pharmacy's court unless a status is chosen. */
  const status = (requested || (ticket.status === 'closed' ? 'closed' : 'waiting')) as SupportTicket['status'];
  const entry = message({ id: ctx.user.id, name: 'KSF Support' }, 'platform', body);
  const at = entry.created_at;
  const updated = await col.supportTickets().findOneAndUpdate({ _id: ticket.id }, {
    $push: { messages: entry },
    $set: {
      status, resolved_at: status === 'resolved' || status === 'closed' ? ticket.resolved_at ?? at : null, assigned_to: ticket.assigned_to ?? ctx.user.id,
      unread_by_pharmacy: 1, unread_by_platform: 0, last_activity_at: at, updated_at: at
    }
  }, { returnDocument: 'after' });

  await notify(ticket.pharmacy_id, { type: 'support', severity: 'info', title: `KSF support replied: ${ticket.subject}`, body: body.slice(0, 160), link: `/support/${ticket.id}` });
  const raiser = ticket.raised_by ? await col.users().findOne({ _id: ticket.raised_by }, { projection: { email: 1, full_name: 1 } }) : null;
  if (raiser?.email) {
    sendMail({ to: raiser.email, pharmacyId: ticket.pharmacy_id, template: 'supportReply', ...templates.supportReply({ name: raiser.full_name, reference: ticket.reference, subject: ticket.subject, reply: body, status: label(status) }) })
      .catch((error) => console.warn('[KSF] support reply e-mail failed:', (error as Error).message));
  }
  await logActivity({ pharmacyId: ticket.pharmacy_id, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent }, {
    action: 'support.replied', entity: 'support-ticket', entityId: ticket.id, summary: `KSF support replied on ${ticket.reference} (${label(status)})`
  });
  return { data: updated, __status: 201 };
});

platformRoute('PATCH', '/api/v1/platform/support/tickets/:id', async (ctx) => {
  const ticket = await platformTicket(ctx);
  const set: Partial<SupportTicket> = { updated_at: nowIso() };
  if (ctx.body.status !== undefined) {
    const status = toStr(ctx.body.status, 20);
    if (!(TICKET_STATUSES as readonly string[]).includes(status)) bad('Choose a valid status.', 'status');
    set.status = status as SupportTicket['status'];
    set.resolved_at = status === 'resolved' || status === 'closed' ? ticket.resolved_at ?? nowIso() : null;
    if (status !== ticket.status) set.unread_by_pharmacy = 1;
  }
  if (ctx.body.priority !== undefined) {
    const priority = toStr(ctx.body.priority, 10);
    if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) bad('Choose a valid priority.', 'priority');
    set.priority = priority as SupportTicket['priority'];
  }
  if (ctx.body.category !== undefined) {
    const category = toStr(ctx.body.category, 20);
    if (!(TICKET_CATEGORIES as readonly string[]).includes(category)) bad('Choose a valid category.', 'category');
    set.category = category;
  }
  const updated = await col.supportTickets().findOneAndUpdate({ _id: ticket.id }, { $set: set }, { returnDocument: 'after' });
  if (set.status && set.status !== ticket.status) {
    await notify(ticket.pharmacy_id, { type: 'support', severity: 'info', title: `${ticket.reference} is now ${label(set.status)}`, body: ticket.subject, link: `/support/${ticket.id}` });
  }
  return { data: updated };
});
