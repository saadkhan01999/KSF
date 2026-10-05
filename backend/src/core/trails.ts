/* ==========================================================================
   The three trails, notifications, settings and document numbers
   --------------------------------------------------------------------------
     activity_logs     what happened in the shop today (Activity screen)
     security_events   who signed in, from where, and how (Security Centre)
     audit_logs        append-only and hash-chained: actions that must be
                       provable later — permission changes, subscription
                       changes, imports, deletions, financial corrections
   ========================================================================== */

import { col, s } from '../db/mongo.js';
import type { AuditLog } from '../db/types.js';
import { auditHash } from '../security/crypto.js';
import { DEFAULT_SETTINGS } from '../domain/permissions.js';
import { nowIso, randomUUID } from './util.js';
import type { Ctx } from '../http/context.js';

type TrailCtx = Pick<Ctx, 'pharmacyId' | 'ip' | 'userAgent'> & {
  user: { id: string; full_name: string; role_name?: string } | null;
  supportMode?: boolean;
};

const actorRole = (ctx: TrailCtx): string =>
  ctx.supportMode ? 'Super Admin (support)' : ctx.user?.role_name ?? 'System';

export async function logActivity(ctx: TrailCtx, entry: {
  action: string; entity?: string | null; entityId?: string | null; summary?: string | null;
  severity?: string; meta?: unknown;
}): Promise<void> {
  const id = randomUUID();
  await col.activityLogs().insertOne({
    _id: id, id, pharmacy_id: ctx.pharmacyId, user_id: ctx.user?.id ?? null,
    actor_name: ctx.user?.full_name ?? 'System', actor_role: actorRole(ctx),
    action: entry.action, entity: entry.entity ?? null, entity_id: entry.entityId ?? null,
    summary: entry.summary ?? null, severity: entry.severity ?? 'info', ip: ctx.ip ?? null,
    user_agent: (ctx.userAgent || '').slice(0, 200), meta: entry.meta ?? null, created_at: nowIso()
  }, s());
}

/**
 * Append a provable entry to a pharmacy's audit chain.
 *
 * Each entry carries the hash of the one before it. The tip of the chain is
 * held in audit_heads and advanced by compare-and-set, so two writes at the
 * same moment can never both claim the same place in the chain: the loser
 * re-reads the tip and tries again.
 */
export async function auditLog(ctx: TrailCtx, entry: {
  action: string; entity?: string | null; entityId?: string | null; summary?: string | null;
  before?: unknown; after?: unknown;
}): Promise<void> {
  const pharmacyId = ctx.pharmacyId;
  if (!pharmacyId) return;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const head = await col.auditHeads().findOne({ _id: pharmacyId });
    const sequence = (head?.sequence ?? 0) + 1;
    const prevHash = head?.hash ?? null;
    const createdAt = nowIso();
    const entryHash = auditHash({
      sequence, prevHash, pharmacyId, userId: ctx.user?.id ?? null, action: entry.action,
      entity: entry.entity ?? null, entityId: entry.entityId ?? null, summary: entry.summary ?? null, createdAt
    });

    let won = false;
    try {
      const claimed = head
        ? await col.auditHeads().updateOne({ _id: pharmacyId, sequence: head.sequence }, { $set: { sequence, hash: entryHash } })
        : await col.auditHeads().updateOne({ _id: pharmacyId }, { $setOnInsert: { sequence, hash: entryHash } }, { upsert: true });
      won = head ? claimed.modifiedCount === 1 : claimed.upsertedCount === 1;
    } catch (error) {
      /* Two first entries at once: the other one created the head. */
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    if (!won) continue;

    const id = randomUUID();
    const doc: AuditLog = {
      _id: id, id, pharmacy_id: pharmacyId, sequence, user_id: ctx.user?.id ?? null,
      actor_name: ctx.user?.full_name ?? 'System', actor_role: actorRole(ctx),
      action: entry.action, entity: entry.entity ?? null, entity_id: entry.entityId ?? null,
      summary: entry.summary ?? null,
      before_json: entry.before ? JSON.stringify(entry.before).slice(0, 8000) : null,
      after_json: entry.after ? JSON.stringify(entry.after).slice(0, 8000) : null,
      ip: ctx.ip ?? null, user_agent: (ctx.userAgent || '').slice(0, 200),
      prev_hash: prevHash, entry_hash: entryHash, created_at: createdAt
    };
    await col.auditLogs().insertOne(doc);
    return;
  }
  throw new Error('The audit trail is too busy to record this change. Please try again.');
}

/** Recompute the chain and report the first entry that does not match. */
export async function verifyAuditChain(pharmacyId: string, limit = 5000): Promise<{ ok: boolean; checked: number; brokenAt: number | null }> {
  const rows = await col.auditLogs().find({ pharmacy_id: pharmacyId }).sort({ sequence: 1 }).limit(limit).toArray();
  let previous: string | null = null;
  let expectedSequence = 1;
  for (const row of rows) {
    const expected = auditHash({
      sequence: row.sequence, prevHash: previous, pharmacyId, userId: row.user_id, action: row.action,
      entity: row.entity, entityId: row.entity_id, summary: row.summary, createdAt: row.created_at
    });
    if (row.sequence !== expectedSequence || expected !== row.entry_hash || (row.prev_hash ?? null) !== previous) {
      return { ok: false, checked: rows.length, brokenAt: row.sequence };
    }
    previous = row.entry_hash;
    expectedSequence += 1;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}

/** Something about authentication or account security. Never a secret. */
export async function securityEvent(event: {
  pharmacyId?: string | null; userId?: string | null; emailHint?: string | null; type: string;
  severity?: string; outcome?: string; ip?: string | null; userAgent?: string | null;
  deviceId?: string | null; sessionId?: string | null; detail?: string | null;
}): Promise<void> {
  const id = randomUUID();
  await col.securityEvents().insertOne({
    _id: id, id, pharmacy_id: event.pharmacyId ?? null, user_id: event.userId ?? null,
    email_hint: event.emailHint ?? null, type: event.type, severity: event.severity ?? 'info',
    outcome: event.outcome ?? 'success', ip: event.ip ?? null, user_agent: (event.userAgent || '').slice(0, 200),
    device_id: event.deviceId ?? null, session_id: event.sessionId ?? null,
    detail: event.detail ? String(event.detail).slice(0, 500) : null, created_at: nowIso()
  });
}

export async function notify(pharmacyId: string | null, note: {
  type: string; title: string; body?: string | null; severity?: string; link?: string | null; userId?: string | null;
}): Promise<void> {
  const id = randomUUID();
  await col.notifications().insertOne({
    _id: id, id, pharmacy_id: pharmacyId, user_id: note.userId ?? null, type: note.type,
    severity: note.severity ?? 'info', title: note.title, body: note.body ?? null, link: note.link ?? null,
    is_read: 0, created_at: nowIso()
  }, s());
}

/* ---------------------------------------------------------------- settings */
const settingId = (pharmacyId: string, key: string): string => `${pharmacyId}:${key}`;

export async function getSetting(pharmacyId: string, key: string): Promise<string> {
  const row = await col.settings().findOne({ _id: settingId(pharmacyId, key) }, s());
  return row ? row.value : DEFAULT_SETTINGS[key];
}

export async function getSettings(pharmacyId: string): Promise<Record<string, string>> {
  const rows = await col.settings().find({ pharmacy_id: pharmacyId }).toArray();
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function setSetting(pharmacyId: string, key: string, value: unknown): Promise<void> {
  await col.settings().updateOne(
    { _id: settingId(pharmacyId, key) },
    { $set: { pharmacy_id: pharmacyId, key, value: String(value), updated_at: nowIso() } },
    { upsert: true, ...s() }
  );
}

/* ---------------------------------------------------------- document numbers */
/**
 * Sequential, human-readable numbers: KSF-INV-000123. The increment and the
 * read are one atomic operation, so two tills are never handed the same one.
 */
export async function nextNumber(pharmacyId: string, name: string, prefix: string, width = 6): Promise<string> {
  const row = await col.counters().findOneAndUpdate(
    { _id: `${pharmacyId}:${name}` },
    { $inc: { value: 1 }, $setOnInsert: { pharmacy_id: pharmacyId, name } },
    { upsert: true, returnDocument: 'after', ...s() }
  );
  return `${prefix}-${String(row?.value ?? 1).padStart(width, '0')}`;
}
