/* ==========================================================================
   The medicine directory
   --------------------------------------------------------------------------
   One reference book of medicines for the whole platform: names and other
   names, category, forms, well-known brands and their makers, what each is
   used for, precautions, side effects, interactions and the references it was
   written from. Every signed-in person can search it — a pharmacy's staff at
   the counter, the platform team in the console — and a pharmacy can add an
   entry to its own catalogue in one step.

   It is kept by the KSF team (platform.medicines.manage). An entry is
   "verified" only when a pharmacist on the team has checked it against its
   references and pressed Verify, and changing what an entry says clears the
   verification, so the badge always describes the words on the screen.
   ========================================================================== */

import type { Filter } from 'mongodb';
import { col } from '../db/mongo.js';
import type { DirectoryMedicine } from '../db/types.js';
import { bad, conflict, missing } from '../core/errors.js';
import { logActivity } from '../core/trails.js';
import { contains, escapeRegex, nowIso, sanitiseText, toStr, uid } from '../core/util.js';
import { accountRoute, platformRoute, type SignedInCtx } from '../http/router.js';
import { MEDICINE_CATEGORIES, nameKey, starterFields, type DirectoryFields, type Prescription } from '../domain/medicine-directory.js';
import { pageResult, paging } from './shared.js';

const MANAGE = 'platform.medicines.manage';
const PRESCRIPTION: Record<Prescription, string> = { otc: 'Over the counter', prescription: 'Prescription only', controlled: 'Controlled drug' };
const STATUSES = ['published', 'draft', 'archived'] as const;
/* What an entry says. Changing any of these clears its verification. */
const CLINICAL: ReadonlyArray<keyof DirectoryMedicine> = ['name', 'synonyms', 'forms', 'prescription', 'uses', 'precautions', 'side_effects', 'interactions', 'references'];

const canManage = (ctx: SignedInCtx): boolean => ctx.isPlatformAdmin || ctx.platformPermissions.has(MANAGE);

/* ------------------------------------------------------------------ input */

/** A list typed one item per line, or sent as an array: cleaned, de-duplicated, bounded. */
function list(value: unknown, field: string, { max = 30, length = 400 } = {}): string[] {
  const items = (Array.isArray(value) ? value : String(value ?? '').split('\n'))
    .map((item) => sanitiseText(item, length)).filter(Boolean);
  if (items.length > max) bad(`Keep this to ${max} lines or fewer.`, field);
  return [...new Set(items)];
}

function references(value: unknown): DirectoryMedicine['references'] {
  if (!Array.isArray(value)) bad('References must be a list.', 'references');
  if ((value as unknown[]).length > 10) bad('Keep this to ten references or fewer.', 'references');
  return (value as Array<Record<string, unknown>>).map((row, index) => {
    const url = toStr(row?.url, 500);
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { /* reported below */ }
    /* Only a secure web address: a javascript: or data: link in a reference
       would run in the reader's browser. */
    if (!parsed || parsed.protocol !== 'https:') bad(`Reference ${index + 1} needs a full https:// address.`, 'references');
    const source = sanitiseText(row?.source, 120);
    if (!source) bad(`Reference ${index + 1} needs the name of its source.`, 'references');
    return { source, title: sanitiseText(row?.title, 200) || null, url: parsed!.toString() };
  });
}

function brands(value: unknown): DirectoryMedicine['brands'] {
  if (!Array.isArray(value)) bad('Brands must be a list.', 'brands');
  if ((value as unknown[]).length > 30) bad('Keep this to thirty brands or fewer.', 'brands');
  return (value as Array<Record<string, unknown>>)
    .map((row) => ({ name: sanitiseText(row?.name, 80), manufacturer: sanitiseText(row?.manufacturer, 120) || null }))
    .filter((row) => row.name);
}

/** The fields of an entry from a request, over what it holds already. */
function readEntry(body: Record<string, any>, existing?: DirectoryMedicine): DirectoryFields {
  const has = (key: string) => body[key] !== undefined;
  const name = has('name') ? sanitiseText(body.name, 120) : existing?.name ?? '';
  if (!name) bad('Give the medicine its generic name.', 'name');
  const category = has('category') ? sanitiseText(body.category, 60) : existing?.category ?? '';
  if (!category) bad('Choose a category.', 'category');
  const prescription = (has('prescription') ? toStr(body.prescription, 20) : existing?.prescription ?? 'prescription') as Prescription;
  if (!(prescription in PRESCRIPTION)) bad('Choose over the counter, prescription only or controlled.', 'prescription');
  const status = (has('status') ? toStr(body.status, 20) : existing?.status ?? 'published') as DirectoryMedicine['status'];
  if (!STATUSES.includes(status)) bad('Choose published, draft or archived.', 'status');
  const fields = {
    name, name_key: nameKey(name), category, prescription, status,
    synonyms: has('synonyms') ? list(body.synonyms, 'synonyms', { max: 15, length: 80 }) : existing?.synonyms ?? [],
    forms: has('forms') ? list(body.forms, 'forms', { max: 20, length: 80 }) : existing?.forms ?? [],
    brands: has('brands') ? brands(body.brands) : existing?.brands ?? [],
    uses: has('uses') ? list(body.uses, 'uses') : existing?.uses ?? [],
    precautions: has('precautions') ? list(body.precautions, 'precautions') : existing?.precautions ?? [],
    side_effects: has('sideEffects') ? list(body.sideEffects, 'sideEffects') : existing?.side_effects ?? [],
    interactions: has('interactions') ? list(body.interactions, 'interactions') : existing?.interactions ?? [],
    references: has('references') ? references(body.references) : existing?.references ?? []
  };
  if (!fields.uses.length) bad('Say what the medicine is used for.', 'uses');
  return fields;
}

/** Changing what an entry says means it has to be checked again. */
const clinicalChange = (before: DirectoryMedicine, after: DirectoryFields): boolean =>
  CLINICAL.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key as keyof DirectoryFields]));

/**
 * Store one entry by its name: a new one is added unverified; an existing
 * one is updated, and loses its verification if what it says changed.
 */
async function saveEntry(fields: DirectoryFields, by: string, source: DirectoryMedicine['source']): Promise<'added' | 'updated'> {
  const at = nowIso();
  const existing = await col.directory().findOne({ name_key: fields.name_key });
  if (existing) {
    const unverify = existing.verified_at && clinicalChange(existing, fields);
    await col.directory().updateOne({ _id: existing.id }, {
      $set: { ...fields, updated_by: by, updated_at: at, ...(unverify ? { verified_by: null, verified_by_name: null, verified_at: null } : {}) }
    });
    return 'updated';
  }
  const id = uid('DIR');
  await col.directory().insertOne({
    _id: id, id, ...fields, source, verified_by: null, verified_by_name: null, verified_at: null,
    created_by: by, created_at: at, updated_by: by, updated_at: at
  });
  return 'added';
}

const trail = (ctx: SignedInCtx) => ({ pharmacyId: null, user: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent });

/* ================================== READ ================================== */

const LIST_FIELDS = {
  _id: 0, id: 1, name: 1, synonyms: 1, category: 1, prescription: 1, forms: { $slice: ['$forms', 3] }, brands: 1, status: 1,
  verified_at: 1, verified_by_name: 1, uses: { $slice: ['$uses', 1] }
};

accountRoute('GET', '/api/v1/medicine-directory', async (ctx) => {
  const { page, size, skip } = paging(ctx, 30);
  const manager = canManage(ctx);
  const filter: Filter<DirectoryMedicine> = {};
  const status = toStr(ctx.query.get('status'), 12);
  /* Pharmacies read published entries; the team can also see drafts and archived ones. */
  if (manager && status === 'any') filter.status = { $ne: 'archived' };
  else filter.status = manager && (STATUSES as readonly string[]).includes(status) ? status as DirectoryMedicine['status'] : 'published';
  const category = toStr(ctx.query.get('category'), 60);
  if (category) filter.category = category;
  const letter = toStr(ctx.query.get('letter'), 1).toLowerCase();
  if (/^[a-z]$/.test(letter)) filter.name_key = new RegExp(`^${letter}`);
  const verified = toStr(ctx.query.get('verified'), 3);
  if (verified === 'yes') filter.verified_at = { $ne: null };
  if (verified === 'no') filter.verified_at = null;
  const search = toStr(ctx.query.get('q'), 80);
  if (search) {
    const pattern = contains(search);
    filter.$or = [{ name: pattern }, { synonyms: pattern }, { 'brands.name': pattern }, { category: pattern }];
  }

  const [rows, total, categories] = await Promise.all([
    col.directory().aggregate([
      { $match: filter },
      /* An exact or leading match first: typing "para" should find Paracetamol before anything that merely mentions it. */
      { $set: { __rank: search ? { $cond: [{ $regexMatch: { input: '$name_key', regex: `^${escapeRegex(search.toLowerCase())}` } }, 0, 1] } : 0 } },
      { $sort: { __rank: 1, name_key: 1 } }, { $skip: skip }, { $limit: size },
      { $project: LIST_FIELDS }
    ]).toArray(),
    col.directory().countDocuments(filter),
    col.directory().aggregate<{ category: string; count: number }>([
      { $match: { status: filter.status } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $project: { _id: 0, category: '$_id', count: 1 } },
      { $sort: { category: 1 } }
    ]).toArray()
  ]);
  /* `categories` are those in use, with counts; `suggested` the usual ones, for the editor. */
  return { ...pageResult(rows, total, { page, size }), categories, suggested: MEDICINE_CATEGORIES, canManage: manager };
});

accountRoute('GET', '/api/v1/medicine-directory/:id', async (ctx) => {
  const entry = await col.directory().findOne({ _id: toStr(ctx.params.id, 40) });
  if (!entry || (entry.status !== 'published' && !canManage(ctx))) return missing('That medicine is not in the directory.');
  return { data: { ...entry, prescription_label: PRESCRIPTION[entry.prescription] }, canManage: canManage(ctx) };
});

/* ================================= KEEP ================================== */

platformRoute('POST', '/api/v1/platform/medicine-directory', MANAGE, async (ctx) => {
  const fields = readEntry(ctx.body);
  if (await col.directory().findOne({ name_key: fields.name_key }, { projection: { _id: 1 } })) conflict(`${fields.name} is already in the directory.`);
  const id = uid('DIR');
  const at = nowIso();
  const entry: DirectoryMedicine = {
    _id: id, id, ...fields, source: 'team', verified_by: null, verified_by_name: null, verified_at: null,
    created_by: ctx.user.id, created_at: at, updated_by: ctx.user.id, updated_at: at
  };
  await col.directory().insertOne(entry);
  await logActivity(trail(ctx), { action: 'directory.created', entity: 'medicine-directory', entityId: id, summary: `${fields.name} added to the medicine directory` });
  return { data: entry, __status: 201 };
});

platformRoute('PATCH', '/api/v1/platform/medicine-directory/:id', MANAGE, async (ctx) => {
  const existing = await col.directory().findOne({ _id: toStr(ctx.params.id, 40) });
  if (!existing) return missing('That medicine is not in the directory.');
  const fields = readEntry(ctx.body, existing);
  if (fields.name_key !== existing.name_key && await col.directory().findOne({ name_key: fields.name_key, _id: { $ne: existing.id } }, { projection: { _id: 1 } })) {
    conflict(`${fields.name} is already in the directory.`);
  }
  const unverify = existing.verified_at && clinicalChange(existing, fields);
  const updated = await col.directory().findOneAndUpdate({ _id: existing.id }, {
    $set: {
      ...fields, updated_by: ctx.user.id, updated_at: nowIso(),
      ...(unverify ? { verified_by: null, verified_by_name: null, verified_at: null } : {})
    }
  }, { returnDocument: 'after' });
  await logActivity(trail(ctx), {
    action: 'directory.updated', entity: 'medicine-directory', entityId: existing.id,
    summary: `${fields.name} updated in the medicine directory${unverify ? ' — needs verifying again' : ''}`
  });
  return { data: updated, unverified: !!unverify };
});

/* A pharmacist on the team confirms the entry matches its references. */
platformRoute('POST', '/api/v1/platform/medicine-directory/:id/verify', MANAGE, async (ctx) => {
  const entry = await col.directory().findOne({ _id: toStr(ctx.params.id, 40) });
  if (!entry) return missing('That medicine is not in the directory.');
  if (!entry.references.length) bad('Add the reference you checked it against before verifying it.');
  if (entry.status === 'archived') bad('Restore the entry before verifying it.');
  const at = nowIso();
  const updated = await col.directory().findOneAndUpdate({ _id: entry.id }, {
    $set: { verified_by: ctx.user.id, verified_by_name: ctx.user.full_name, verified_at: at, updated_at: at }
  }, { returnDocument: 'after' });
  await logActivity(trail(ctx), { action: 'directory.verified', entity: 'medicine-directory', entityId: entry.id, summary: `${entry.name} verified against ${entry.references.length} reference(s)` });
  return { data: updated };
});

/* Archived, never deleted: a pharmacy may have added it to its catalogue from here. */
platformRoute('DELETE', '/api/v1/platform/medicine-directory/:id', MANAGE, async (ctx) => {
  const entry = await col.directory().findOneAndUpdate(
    { _id: toStr(ctx.params.id, 40) }, { $set: { status: 'archived', updated_by: ctx.user.id, updated_at: nowIso() } }, { returnDocument: 'after' }
  );
  if (!entry) return missing('That medicine is not in the directory.');
  await logActivity(trail(ctx), { action: 'directory.archived', entity: 'medicine-directory', entityId: entry.id, severity: 'warn', summary: `${entry.name} archived in the medicine directory` });
  return { data: entry };
});

/**
 * Add or update many entries at once — a spreadsheet the team prepared, or
 * the starter set again (`{ "starter": true }`). Matched by name; imported
 * entries are unverified until checked. Each row is accepted or refused on
 * its own, and the reply says which and why.
 */
platformRoute('POST', '/api/v1/platform/medicine-directory/import', MANAGE, async (ctx) => {
  const starter = ctx.body.starter === true;
  const rows: Record<string, any>[] = starter ? [] : Array.isArray(ctx.body.rows) ? ctx.body.rows : [];
  if (!starter && !rows.length) bad('Send the rows to import, or { "starter": true } for the starter set.', 'rows');
  if (rows.length > 500) bad('Import at most 500 rows at a time.', 'rows');
  const summary = { added: 0, updated: 0, refused: [] as Array<{ row: number; name: string; reason: string }> };
  const entries: Array<() => DirectoryFields> = starter
    ? starterFields().map((fields) => () => fields)
    : rows.map((row) => () => readEntry(row, undefined));
  for (const [index, entry] of entries.entries()) {
    try {
      summary[await saveEntry(entry(), ctx.user.id, starter ? 'starter' : 'team')] += 1;
    } catch (error) {
      summary.refused.push({ row: index + 1, name: String(rows[index]?.name ?? ''), reason: (error as Error).message });
    }
  }
  await logActivity(trail(ctx), { action: 'directory.imported', entity: 'medicine-directory', summary: `Medicine directory import: ${summary.added} added, ${summary.updated} updated, ${summary.refused.length} refused` });
  return { ...summary, categories: MEDICINE_CATEGORIES };
});
