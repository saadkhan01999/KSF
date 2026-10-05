/* Internal messaging between staff.

   Pharmacy staff talk all day — about a batch that looks wrong, a price that
   changed, a prescription that needs a second opinion. Keeping that inside
   KSF puts the conversation next to the record it is about and inside the
   same audit boundary as everything else.

     - You only ever see a conversation you are a member of. Membership is
       resolved on the server from the thread, never from the request.
     - Addressing a role resolves to the people holding it, and keeps
       resolving: somebody promoted into Pharmacist tomorrow joins the
       Pharmacist threads that are still open.
     - Announcing to a role or the whole team needs messages.broadcast.
     - Bodies are sanitised before storage, because the audit trail and
       exports are read outside the browser.
     - Sending is rate limited per person. */

import type { Document } from 'mongodb';
import { col, s, tx } from '../db/mongo.js';
import type { Conversation, ConversationMember, Message } from '../db/types.js';
import { bad, forbid, missing, tooMany } from '../core/errors.js';
import { logActivity, notify } from '../core/trails.js';
import { contains, nowIso, randomUUID, rateLimit, sanitiseText, toStr, uid } from '../core/util.js';
import { lookupField } from '../db/pipeline.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { pageResult, paging } from './shared.js';

export const MAX_BODY = 4000;
export const MAX_SUBJECT = 140;
const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 60_000;

const memberOf = (conversation: Conversation, userId: string): ConversationMember | undefined =>
  conversation.members.find((member) => member.user_id === userId);

async function requireMember(ctx: PharmacyCtx, conversationId: string): Promise<Conversation> {
  const conversation = await col.conversations().findOne({ _id: conversationId, pharmacy_id: ctx.pharmacyId });
  /* The same wording as "not found": whether a thread exists is itself
     information a non-member should not have. */
  if (!conversation || !memberOf(conversation, ctx.user.id)) return missing('That conversation could not be found.');
  return conversation;
}

const newMember = (userId: string, roleId: string | null, at: string): ConversationMember =>
  ({ user_id: userId, role_id: roleId, joined_at: at, last_read_at: null, is_muted: 0 });

/** Add people to a thread in one atomic step; anyone already in is left alone. */
async function addMembers(conversationId: string, people: ConversationMember[]): Promise<void> {
  if (!people.length) return;
  await col.conversations().updateOne({ _id: conversationId }, [{
    $set: {
      members: {
        $concatArrays: ['$members', { $filter: { input: people, as: 'p', cond: { $not: { $in: ['$$p.user_id', '$members.user_id'] } } } }]
      }
    }
  }], s());
}

/* Role and broadcast threads stay open to their audience, so anyone who
   joins later is folded in the next time the thread is listed or opened. */
async function syncAudience(conversation: Pick<Conversation, '_id' | 'pharmacy_id' | 'kind' | 'audience_role_id' | 'members'>, at: string): Promise<void> {
  if (conversation.kind === 'direct') return;
  if (conversation.kind === 'role' && !conversation.audience_role_id) return;
  const filter: Document = { pharmacy_id: conversation.pharmacy_id, status: 'active' };
  if (conversation.kind === 'role') filter.role_id = conversation.audience_role_id;
  const known = new Set(conversation.members.map((member) => member.user_id));
  const people = (await col.users().find(filter, { projection: { _id: 1, role_id: 1 } }).toArray())
    .filter((person) => !known.has(person._id))
    .map((person) => newMember(person._id, person.role_id, at));
  await addMembers(conversation._id, people);
}

/** Unread messages for one person, as pipeline stages on conversations. */
const unreadStages = (userId: string): Document[] => [
  { $set: { __me: { $first: { $filter: { input: '$members', cond: { $eq: ['$$this.user_id', userId] } } } } } },
  {
    $lookup: {
      from: 'messages', let: { cid: '$_id', since: { $ifNull: ['$__me.last_read_at', ''] } }, as: '__unread',
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$conversation_id', '$$cid'] }, { $eq: ['$deleted_at', null] }, { $ne: ['$sender_id', userId] }, { $gt: ['$created_at', '$$since'] }] } } },
        { $count: 'n' }
      ]
    }
  },
  { $set: { unread: { $ifNull: [{ $first: '$__unread.n' }, 0] }, last_read_at: '$__me.last_read_at', is_muted: { $ifNull: ['$__me.is_muted', 0] } } },
  { $unset: ['__unread', '__me'] }
];

const lastMessageStages = (): Document[] => [
  {
    $lookup: {
      from: 'messages', localField: '_id', foreignField: 'conversation_id', as: '__last',
      pipeline: [{ $match: { deleted_at: null } }, { $sort: { created_at: -1 } }, { $limit: 1 }, { $project: { body: 1, sender_name: 1 } }]
    }
  },
  { $set: { last_body: { $ifNull: [{ $first: '$__last.body' }, null] }, last_sender: { $ifNull: [{ $first: '$__last.sender_name' }, null] } } },
  { $unset: '__last' }
];

/* ============================== SUMMARY ============================== */
/* Cheap enough for the sidebar badge to call on every navigation. */
route('GET', '/api/v1/messages/summary', 'messages.read', async (ctx) => {
  const [row] = await col.conversations().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId, 'members.user_id': ctx.user.id } },
    ...unreadStages(ctx.user.id),
    { $group: { _id: null, threads: { $sum: 1 }, unread: { $sum: '$unread' } } }
  ]).toArray();
  return { threads: row?.threads ?? 0, unread: row?.unread ?? 0 };
});

/* The top-bar dropdown: the last five threads, with a one-line preview. */
route('GET', '/api/v1/messages/recent', 'messages.read', async (ctx) => {
  const rows = await col.conversations().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId, 'members.user_id': ctx.user.id } },
    { $sort: { last_message_at: -1 } },
    { $limit: 5 },
    ...unreadStages(ctx.user.id),
    ...lastMessageStages(),
    { $project: { _id: 1, id: 1, subject: 1, kind: 1, priority: 1, status: 1, last_message_at: 1, last_body: 1, last_sender: 1, unread: 1 } }
  ]).toArray();
  /* Trimmed here, so the whole message body stays off the wire. */
  return { data: rows.map((row) => ({ ...row, last_body: row.last_body ? String(row.last_body).replace(/\s+/g, ' ').slice(0, 120) : null })) };
});

/* Who this person may write to: everyone active in the pharmacy, built on
   the server so it never includes archived accounts. */
route('GET', '/api/v1/messages/directory', 'messages.write', async (ctx) => {
  const now = nowIso();
  const people = await col.users().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId, status: 'active', _id: { $ne: ctx.user.id }, role_id: { $ne: null } } },
    { $lookup: { from: 'roles', localField: 'role_id', foreignField: '_id', as: '__r', pipeline: [{ $project: { name: 1, key: 1, level: 1 } }] } },
    ...lookupField('branches', 'branch_id', 'name', 'branch_name'),
    {
      $lookup: {
        from: 'sessions', localField: '_id', foreignField: 'user_id', as: '__s',
        pipeline: [{ $match: { revoked_at: null, expires_at: { $gt: now } } }, { $count: 'n' }]
      }
    },
    {
      $project: {
        _id: 0, id: '$_id', full_name: 1, email: 1, role_id: 1, role_name: { $first: '$__r.name' }, role_key: { $first: '$__r.key' },
        branch_name: 1, online: { $ifNull: [{ $first: '$__s.n' }, 0] }, __level: { $first: '$__r.level' }
      }
    },
    { $sort: { __level: -1, full_name: 1 } },
    { $unset: '__level' }
  ]).toArray();
  const roles = await col.roles().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId } },
    { $lookup: { from: 'users', localField: '_id', foreignField: 'role_id', as: '__u', pipeline: [{ $match: { status: 'active' } }, { $count: 'n' }] } },
    { $project: { _id: 0, id: '$_id', name: 1, key: 1, level: 1, member_count: { $ifNull: [{ $first: '$__u.n' }, 0] } } },
    { $match: { member_count: { $gt: 0 } } },
    { $sort: { level: -1 } }
  ]).toArray();
  return { people, roles, canBroadcast: ctx.can('messages.broadcast') };
});

/* ========================== LIST CONVERSATIONS ========================== */
route('GET', '/api/v1/messages/conversations', 'messages.read', async (ctx) => {
  const { page, size, skip } = paging(ctx, 30);
  const filter = toStr(ctx.query.get('filter'), 20);
  const search = toStr(ctx.query.get('q'), 80);

  const at = nowIso();
  const open = await col.conversations().find(
    { pharmacy_id: ctx.pharmacyId, status: 'open', kind: { $in: ['role', 'broadcast'] } },
    { projection: { _id: 1, pharmacy_id: 1, kind: 1, audience_role_id: 1, members: 1 } }
  ).toArray();
  for (const conversation of open) await syncAudience(conversation, at);

  const match: Document = { pharmacy_id: ctx.pharmacyId, 'members.user_id': ctx.user.id };
  if (filter === 'open') match.status = 'open';
  if (filter === 'resolved') match.status = 'resolved';
  if (filter === 'urgent') match.priority = { $in: ['high', 'urgent'] };
  if (search) {
    const pattern = contains(search);
    const inBody = await col.messages().distinct('conversation_id', { pharmacy_id: ctx.pharmacyId, deleted_at: null, body: pattern });
    match.$or = [{ subject: pattern }, { _id: { $in: inBody } }];
  }

  const [rows, total, [counts]] = await Promise.all([
    col.conversations().aggregate([
      { $match: match },
      { $sort: { last_message_at: -1 } },
      { $skip: skip },
      { $limit: size },
      ...unreadStages(ctx.user.id),
      ...lastMessageStages(),
      ...lookupField('roles', 'audience_role_id', 'name', 'audience_role_name'),
      ...lookupField('users', 'created_by', 'full_name', 'created_by_name'),
      { $lookup: { from: 'messages', localField: '_id', foreignField: 'conversation_id', as: '__m', pipeline: [{ $match: { deleted_at: null } }, { $count: 'n' }] } },
      { $set: { member_count: { $size: '$members' }, message_count: { $ifNull: [{ $first: '$__m.n' }, 0] } } },
      { $project: { members: 0, __m: 0 } }
    ]).toArray(),
    col.conversations().countDocuments(match),
    col.conversations().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId, 'members.user_id': ctx.user.id } },
      {
        $group: {
          _id: null, total: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
          urgent: { $sum: { $cond: [{ $in: ['$priority', ['high', 'urgent']] }, 1, 0] } }
        }
      },
      { $project: { _id: 0 } }
    ]).toArray()
  ]);
  return { ...pageResult(rows, total, { page, size }), counts: counts ?? { total: 0, open: 0, resolved: 0, urgent: 0 } };
});

/* =========================== ONE CONVERSATION =========================== */
route('GET', '/api/v1/messages/conversations/:id', 'messages.read', async (ctx) => {
  let conversation = await requireMember(ctx, ctx.params.id);
  if (conversation.kind !== 'direct') {
    await syncAudience(conversation, nowIso());
    conversation = (await col.conversations().findOne({ _id: conversation.id }))!;
  }
  const userIds = conversation.members.map((member) => member.user_id);
  const roleIds = conversation.members.map((member) => member.role_id).filter((id): id is string => !!id);
  if (conversation.audience_role_id) roleIds.push(conversation.audience_role_id);

  const [messages, users, roles, author] = await Promise.all([
    col.messages().find({ conversation_id: conversation.id, deleted_at: null }, {
      projection: { _id: 0, id: 1, sender_id: 1, sender_name: 1, sender_role: 1, body: 1, created_at: 1, edited_at: 1 }
    }).sort({ created_at: 1 }).limit(500).toArray(),
    col.users().find({ _id: { $in: userIds } }, { projection: { full_name: 1, status: 1 } }).toArray(),
    col.roles().find({ _id: { $in: roleIds } }, { projection: { name: 1, key: 1 } }).toArray(),
    conversation.created_by ? col.users().findOne({ _id: conversation.created_by }, { projection: { full_name: 1 } }) : null
  ]);
  const userById = new Map(users.map((user) => [user._id, user]));
  const roleById = new Map(roles.map((role) => [role._id, role]));
  const members = conversation.members.map((member) => ({
    user_id: member.user_id, last_read_at: member.last_read_at, is_muted: member.is_muted,
    full_name: userById.get(member.user_id)?.full_name ?? 'Former staff member', status: userById.get(member.user_id)?.status ?? 'archived',
    role_name: member.role_id ? roleById.get(member.role_id)?.name ?? null : null, role_key: member.role_id ? roleById.get(member.role_id)?.key ?? null : null
  })).sort((a, b) => a.full_name.localeCompare(b.full_name));

  const { members: _members, ...thread } = conversation;
  return {
    data: {
      ...thread,
      audience_role_name: conversation.audience_role_id ? roleById.get(conversation.audience_role_id)?.name ?? null : null,
      created_by_name: author?.full_name ?? null,
      messages, members,
      my_last_read_at: memberOf(conversation, ctx.user.id)?.last_read_at ?? null
    }
  };
});

/* ========================== START A CONVERSATION ========================== */
route('POST', '/api/v1/messages/conversations', 'messages.write', async (ctx) => {
  const subject = sanitiseText(ctx.body.subject, MAX_SUBJECT);
  const body = sanitiseText(ctx.body.body, MAX_BODY);
  if (!subject) bad('Give the conversation a subject, so people can find it later.', 'subject');
  if (!body) bad('Write the first message.', 'body');

  const priority = ['normal', 'high', 'urgent'].includes(ctx.body.priority) ? ctx.body.priority : 'normal';
  const recipientIds: string[] = Array.isArray(ctx.body.userIds) ? [...new Set<string>(ctx.body.userIds.map((v: unknown) => toStr(v, 40)).filter(Boolean))] : [];
  const roleId = toStr(ctx.body.roleId, 60);
  const broadcast = ctx.body.broadcast === true;
  if (broadcast && !ctx.can('messages.broadcast')) forbid('You do not have permission to announce to the whole team.');
  if (roleId && !ctx.can('messages.broadcast')) forbid('You do not have permission to message a whole role. Pick the people instead.');
  if (!broadcast && !roleId && recipientIds.length === 0) bad('Choose who this is going to.', 'userIds');

  let kind: Conversation['kind'] = 'direct';
  let audienceRoleId: string | null = null;
  if (broadcast) {
    kind = 'broadcast';
  } else if (roleId) {
    const role = await col.roles().findOne({ _id: roleId, pharmacy_id: ctx.pharmacyId });
    if (!role) return bad('That role could not be found.', 'roleId');
    if (!await col.users().countDocuments({ pharmacy_id: ctx.pharmacyId, role_id: role.id, status: 'active' })) {
      bad(`Nobody currently holds the ${role.name} role, so there is no one to send this to.`, 'roleId');
    }
    kind = 'role';
    audienceRoleId = role.id;
  }

  const at = nowIso();
  const members = [newMember(ctx.user.id, ctx.user.role_id, at)];
  members[0].last_read_at = at;
  if (kind === 'direct') {
    const people = await col.users().find(
      { _id: { $in: recipientIds.filter((id) => id !== ctx.user.id) }, pharmacy_id: ctx.pharmacyId, status: 'active' },
      { projection: { _id: 1, role_id: 1 } }
    ).toArray();
    if (people.length !== recipientIds.filter((id) => id !== ctx.user.id).length) bad('One of the people you chose is no longer active.', 'userIds');
    if (!people.length) bad('Choose somebody other than yourself.', 'userIds');
    members.push(...people.map((person) => newMember(person._id, person.role_id, at)));
  }

  const id = uid('CONV');
  const conversation: Conversation = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, subject, kind, priority, audience_role_id: audienceRoleId,
    linked_entity: toStr(ctx.body.linkedEntity, 40) || null, linked_entity_id: toStr(ctx.body.linkedEntityId, 60) || null,
    origin_system: 'ksf', status: 'open', members, created_by: ctx.user.id, created_at: at, updated_at: at, last_message_at: at
  };
  const messageId = randomUUID();
  await tx(async () => {
    await col.conversations().insertOne(conversation, s());
    await syncAudience(conversation, at);
    await col.messages().insertOne({
      _id: messageId, id: messageId, conversation_id: id, pharmacy_id: ctx.pharmacyId, sender_id: ctx.user.id,
      sender_name: ctx.user.full_name, sender_role: ctx.user.role_name, body, created_at: at, edited_at: null, deleted_at: null
    }, s());
  });

  const saved = await col.conversations().findOne({ _id: id });
  const recipients = (saved?.members.length ?? 1) - 1;
  await logActivity(ctx, {
    action: 'message.started', entity: 'conversation', entityId: id,
    summary: `${ctx.user.full_name} started "${subject}" with ${recipients} recipient(s)`, meta: { kind, priority, recipients }
  });
  if (priority === 'urgent') {
    await notify(ctx.pharmacyId, { type: 'message', severity: 'warn', title: `Urgent: ${subject}`, body: `${ctx.user.full_name} marked a conversation urgent.`, link: '/messages' });
  }
  const { members: _members, ...thread } = saved ?? conversation;
  return { data: { ...thread, member_count: recipients + 1 }, __status: 201 };
});

/* ============================== REPLY ============================== */
route('POST', '/api/v1/messages/conversations/:id/messages', 'messages.write', async (ctx) => {
  const limit = rateLimit(`msg:${ctx.user.id}`, SEND_LIMIT, SEND_WINDOW_MS);
  if (!limit.ok) tooMany(`You are sending messages very quickly. Please wait ${limit.retryAfter} second(s) and try again.`, limit.retryAfter);
  const conversation = await requireMember(ctx, ctx.params.id);
  if (conversation.status === 'resolved') bad('This conversation has been marked resolved. Reopen it before replying.');
  const body = sanitiseText(ctx.body.body, MAX_BODY);
  if (!body) bad('Write something before sending.', 'body');

  const at = nowIso();
  const id = randomUUID();
  const message: Message = {
    _id: id, id, conversation_id: conversation.id, pharmacy_id: ctx.pharmacyId, sender_id: ctx.user.id,
    sender_name: ctx.user.full_name, sender_role: ctx.user.role_name, body, created_at: at, edited_at: null, deleted_at: null
  };
  await tx(async () => {
    await col.messages().insertOne(message, s());
    await col.conversations().updateOne(
      { _id: conversation.id, 'members.user_id': ctx.user.id },
      { $set: { last_message_at: at, updated_at: at, 'members.$.last_read_at': at } }, s()
    );
  });
  const { _id, pharmacy_id: _p, conversation_id: _c, deleted_at: _d, ...data } = message;
  return { data, __status: 201 };
});

/* ============================ READ RECEIPTS ============================ */
route('POST', '/api/v1/messages/conversations/:id/read', 'messages.read', async (ctx) => {
  const conversation = await requireMember(ctx, ctx.params.id);
  await col.conversations().updateOne({ _id: conversation.id, 'members.user_id': ctx.user.id }, { $set: { 'members.$.last_read_at': nowIso() } });
  return { ok: true };
});

route('POST', '/api/v1/messages/read-all', 'messages.read', async (ctx) => {
  const result = await col.conversations().updateMany(
    { pharmacy_id: ctx.pharmacyId, 'members.user_id': ctx.user.id },
    { $set: { 'members.$[me].last_read_at': nowIso() } },
    { arrayFilters: [{ 'me.user_id': ctx.user.id }] }
  );
  return { ok: true, threads: result.modifiedCount };
});

/* =========================== THREAD LIFECYCLE =========================== */
route('POST', '/api/v1/messages/conversations/:id/resolve', 'messages.write', async (ctx) => {
  const conversation = await requireMember(ctx, ctx.params.id);
  const reopen = conversation.status === 'resolved';
  const at = nowIso();
  const updated = await col.conversations().findOneAndUpdate(
    { _id: conversation.id },
    { $set: { status: reopen ? 'open' : 'resolved', resolved_at: reopen ? null : at, resolved_by: reopen ? null : ctx.user.id, updated_at: at } },
    { returnDocument: 'after', projection: { members: 0 } }
  );
  await logActivity(ctx, {
    action: reopen ? 'message.reopened' : 'message.resolved', entity: 'conversation', entityId: conversation.id,
    summary: `${ctx.user.full_name} ${reopen ? 'reopened' : 'resolved'} "${conversation.subject}"`
  });
  return { data: updated };
});

route('POST', '/api/v1/messages/conversations/:id/mute', 'messages.read', async (ctx) => {
  const conversation = await requireMember(ctx, ctx.params.id);
  const muted = memberOf(conversation, ctx.user.id)?.is_muted ? 0 : 1;
  await col.conversations().updateOne({ _id: conversation.id, 'members.user_id': ctx.user.id }, { $set: { 'members.$.is_muted': muted } });
  return { ok: true, muted: !!muted };
});

/* Withdrawing your own message. Tombstoned rather than deleted, so a thread
   can never be silently rewritten after the fact. */
route('DELETE', '/api/v1/messages/messages/:id', 'messages.write', async (ctx) => {
  const message = await col.messages().findOne({ _id: toStr(ctx.params.id, 60), pharmacy_id: ctx.pharmacyId });
  if (!message || message.deleted_at) return missing('That message could not be found.');
  if (message.sender_id !== ctx.user.id) forbid('You can only withdraw a message you sent yourself.');
  await requireMember(ctx, message.conversation_id);
  await col.messages().updateOne({ _id: message.id }, { $set: { deleted_at: nowIso(), body: '' } });
  await logActivity(ctx, { action: 'message.withdrawn', entity: 'conversation', entityId: message.conversation_id, severity: 'warn', summary: `${ctx.user.full_name} withdrew a message` });
  return { ok: true };
});
