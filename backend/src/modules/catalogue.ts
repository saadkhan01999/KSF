/* Medicine categories and the medicine catalogue itself. */

import type { Document, Filter } from 'mongodb';
import { col } from '../db/mongo.js';
import type { Category, Medicine } from '../db/types.js';
import { bad, missing } from '../core/errors.js';
import { getSetting, logActivity } from '../core/trails.js';
import { addDays, contains, nowIso, toInt, toStr, uid } from '../core/util.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { lookupField } from '../db/pipeline.js';
import { expiryState, onHand, pageResult, paging, sortBy, stockStages, stockState, stockStateExpr } from './shared.js';

/* ============================== CATEGORIES ============================== */

route('GET', '/api/v1/categories', 'medicines.read', async (ctx) => {
  const rows = await col.categories().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId } },
    {
      $lookup: {
        from: 'medicines', localField: '_id', foreignField: 'category_id', as: '__used',
        pipeline: [{ $match: { status: 'active' } }, { $count: 'n' }]
      }
    },
    { $set: { medicine_count: { $ifNull: [{ $first: '$__used.n' }, 0] } } },
    { $unset: '__used' },
    { $sort: { name: 1 } }
  ]).toArray();
  return { data: rows };
});

async function nameTaken(pharmacyId: string, name: string, exceptId?: string): Promise<boolean> {
  const filter: Filter<Category> = { pharmacy_id: pharmacyId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
  if (exceptId) filter._id = { $ne: exceptId };
  return !!(await col.categories().findOne(filter, { projection: { _id: 1 } }));
}

route('POST', '/api/v1/categories', 'categories.manage', async (ctx) => {
  const name = toStr(ctx.body.name, 80);
  if (!name) bad('Give the category a name.', 'name');
  if (await nameTaken(ctx.pharmacyId, name)) bad('A category with that name already exists.', 'name');
  const id = uid('CAT');
  const at = nowIso();
  const category: Category = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, name, description: toStr(ctx.body.description, 300) || null,
    colour: toStr(ctx.body.colour, 20) || 'brand', requires_prescription: ctx.body.requiresPrescription ? 1 : 0,
    status: 'active', created_at: at, updated_at: at
  };
  await col.categories().insertOne(category);
  await logActivity(ctx, { action: 'category.created', entity: 'category', entityId: id, summary: `Category "${name}" created` });
  return { data: category, __status: 201 };
});

route('PATCH', '/api/v1/categories/:id', 'categories.manage', async (ctx) => {
  const existing = await col.categories().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That category could not be found.');
  const name = toStr(ctx.body.name, 80) || existing.name;
  if (name.toLowerCase() !== existing.name.toLowerCase() && await nameTaken(ctx.pharmacyId, name, existing.id)) {
    bad('A category with that name already exists.', 'name');
  }
  const status = toStr(ctx.body.status, 20) || existing.status;
  if (!['active', 'archived'].includes(status)) bad('Choose active or archived.', 'status');
  const updated = await col.categories().findOneAndUpdate({ _id: existing.id }, {
    $set: {
      name,
      description: ctx.body.description === undefined ? existing.description : toStr(ctx.body.description, 300) || null,
      colour: toStr(ctx.body.colour, 20) || existing.colour,
      requires_prescription: ctx.body.requiresPrescription === undefined ? existing.requires_prescription : ctx.body.requiresPrescription ? 1 : 0,
      status, updated_at: nowIso()
    }
  }, { returnDocument: 'after' });
  await logActivity(ctx, { action: 'category.updated', entity: 'category', entityId: existing.id, summary: `Category "${name}" updated` });
  return { data: updated };
});

route('DELETE', '/api/v1/categories/:id', 'categories.manage', async (ctx) => {
  const existing = await col.categories().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That category could not be found.');
  const used = await col.medicines().countDocuments({ category_id: existing.id, status: 'active' });
  if (used > 0) bad(`${used} medicine(s) still use this category. Move them first, or archive the category instead.`);
  await col.categories().deleteOne({ _id: existing.id });
  await col.medicines().updateMany({ category_id: existing.id }, { $set: { category_id: null, updated_at: nowIso() } });
  await logActivity(ctx, { action: 'category.deleted', entity: 'category', entityId: existing.id, severity: 'warn', summary: `Category "${existing.name}" deleted` });
  return { ok: true };
});

/* =============================== MEDICINES =============================== */

const MEDICINE_SORTS = { name: 'name', price: 'price_paisa', stock: 'on_hand', created: 'created_at', category: 'category_name' };

function searchFilter(search: string): Filter<Medicine> {
  if (!search) return {};
  const pattern = contains(search);
  return { $or: [{ name: pattern }, { generic_name: pattern }, { barcode: pattern }, { sku: pattern }, { manufacturer: pattern }] };
}

const withCategory = (): Document[] => [
  { $lookup: { from: 'categories', localField: 'category_id', foreignField: '_id', as: '__cat', pipeline: [{ $project: { name: 1, colour: 1 } }] } },
  { $set: { category_name: { $ifNull: [{ $first: '$__cat.name' }, null] }, category_colour: { $ifNull: [{ $first: '$__cat.colour' }, null] } } },
  { $unset: '__cat' }
];

route('GET', '/api/v1/medicines', 'medicines.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const search = toStr(ctx.query.get('q'), 80);
  const categoryId = toStr(ctx.query.get('category'), 40);
  const state = toStr(ctx.query.get('state'), 24);
  const rx = ctx.query.get('rx');

  const match: Filter<Medicine> = { pharmacy_id: ctx.pharmacyId, status: { $ne: 'retired' }, ...searchFilter(search) };
  if (categoryId) match.category_id = categoryId;
  if (rx === 'true') match.requires_prescription = 1;
  if (rx === 'false') match.requires_prescription = 0;

  const sort = sortBy(ctx, MEDICINE_SORTS, 'name');
  if (!ctx.query.get('sort')) sort.name = 1;
  const [result] = await col.medicines().aggregate<{ rows: Document[]; total: { n: number }[] }>([
    { $match: match },
    ...stockStages(),
    { $set: { stock_state: stockStateExpr() } },
    ...(state ? [{ $match: { stock_state: state } }] : []),
    ...withCategory(),
    { $sort: { ...sort, _id: 1 } },
    { $facet: { rows: [{ $skip: skip }, { $limit: size }], total: [{ $count: 'n' }] } }
  ]).toArray();
  return pageResult(result?.rows ?? [], result?.total[0]?.n ?? 0, { page, size });
});

route('GET', '/api/v1/medicines/:id', 'medicines.read', async (ctx) => {
  const [medicine] = await col.medicines().aggregate([
    { $match: { _id: ctx.params.id, pharmacy_id: ctx.pharmacyId } },
    ...withCategory()
  ]).toArray();
  if (!medicine) return missing('That medicine could not be found.');

  const warnDays = Number(await getSetting(ctx.pharmacyId, 'expiry.warn_days') || 90);
  const [batches, movements, sales, stock] = await Promise.all([
    col.batches().aggregate([
      { $match: { medicine_id: medicine._id } },
      ...lookupField('suppliers', 'supplier_id', 'name', 'supplier_name'),
      { $sort: { expiry_date: 1 } }
    ]).toArray(),
    col.stockMovements().find({ medicine_id: medicine._id }).sort({ created_at: -1 }).limit(40).toArray(),
    col.sales().aggregate<{ units: number; revenue: number }>([
      { $match: { pharmacy_id: ctx.pharmacyId, status: 'completed', sold_at: { $gt: addDays(-30) }, 'items.medicine_id': medicine._id } },
      { $unwind: '$items' },
      { $match: { 'items.medicine_id': medicine._id } },
      { $group: { _id: null, units: { $sum: '$items.quantity' }, revenue: { $sum: '$items.line_total_paisa' } } }
    ]).toArray(),
    onHand(medicine._id)
  ]);
  return {
    data: {
      ...medicine,
      on_hand: stock,
      stock_state: stockState(stock, medicine.min_stock),
      batches: batches.map((batch) => ({ ...batch, ...expiryState(batch.expiry_date, warnDays) })),
      movements,
      sales_30d: { units: sales[0]?.units ?? 0, revenue: sales[0]?.revenue ?? 0 }
    }
  };
});

async function medicinePayload(ctx: PharmacyCtx, existing: Medicine | null) {
  const body = ctx.body;
  const has = (key: string) => body[key] !== undefined;
  const text = (key: string, max: number, current: string | null | undefined) =>
    has(key) ? toStr(body[key], max) || null : current ?? null;

  const name = toStr(body.name, 140) || existing?.name;
  if (!name) return bad('Enter the medicine name.', 'name');

  const price = toInt(body.pricePaisa, existing?.price_paisa ?? 0);
  const cost = toInt(body.costPaisa, existing?.cost_paisa ?? 0);
  if (price < 0 || cost < 0) bad('Prices cannot be negative.', 'pricePaisa');
  if (price > 0 && cost > price) bad('The selling price is below the purchase cost. Check the figures before saving.', 'pricePaisa');
  const minStock = toInt(body.minStock, existing?.min_stock ?? 10);
  const maxStock = toInt(body.maxStock, existing?.max_stock ?? Math.max(50, minStock * 10));
  if (minStock < 0) bad('Minimum stock cannot be negative.', 'minStock');
  if (maxStock > 0 && maxStock < minStock) bad('Maximum stock must be higher than minimum stock.', 'maxStock');

  const categoryId = has('categoryId') ? toStr(body.categoryId, 40) || null : existing?.category_id ?? null;
  if (categoryId && !await col.categories().findOne({ _id: categoryId, pharmacy_id: ctx.pharmacyId }, { projection: { _id: 1 } })) {
    bad('That category does not exist.', 'categoryId');
  }
  const gst = has('gstPercent') ? Number(body.gstPercent) || 0 : existing?.gst_percent ?? 0;
  if (gst < 0 || gst > 100) bad('GST must be between 0 and 100 per cent.', 'gstPercent');
  const status = (toStr(body.status, 20) || existing?.status || 'active') as Medicine['status'];
  if (!['active', 'inactive', 'retired'].includes(status)) bad('Choose a valid status.', 'status');

  return {
    category_id: categoryId,
    name,
    generic_name: text('genericName', 140, existing?.generic_name),
    manufacturer: text('manufacturer', 120, existing?.manufacturer),
    form: toStr(body.form, 40) || existing?.form || 'Tablet',
    strength: text('strength', 60, existing?.strength),
    pack_size: text('packSize', 60, existing?.pack_size),
    sku: text('sku', 40, existing?.sku),
    barcode: text('barcode', 40, existing?.barcode),
    drap_reg_no: text('drapRegNo', 60, existing?.drap_reg_no),
    shelf_location: text('shelfLocation', 40, existing?.shelf_location),
    storage_note: text('storageNote', 200, existing?.storage_note),
    cost_paisa: cost, price_paisa: price, gst_percent: gst, min_stock: minStock, max_stock: maxStock,
    requires_prescription: (has('requiresPrescription') ? (body.requiresPrescription ? 1 : 0) : existing?.requires_prescription ?? 0) as 0 | 1,
    is_controlled: (has('isControlled') ? (body.isControlled ? 1 : 0) : existing?.is_controlled ?? 0) as 0 | 1,
    status
  };
}

async function barcodeTaken(pharmacyId: string, barcode: string | null, exceptId?: string): Promise<boolean> {
  if (!barcode) return false;
  const filter: Filter<Medicine> = { pharmacy_id: pharmacyId, barcode, status: { $ne: 'retired' } };
  if (exceptId) filter._id = { $ne: exceptId };
  return !!(await col.medicines().findOne(filter, { projection: { _id: 1 } }));
}

route('POST', '/api/v1/medicines', 'medicines.write', async (ctx) => {
  const payload = await medicinePayload(ctx, null);
  if (await barcodeTaken(ctx.pharmacyId, payload.barcode)) bad('Another medicine already uses that barcode.', 'barcode');
  const id = uid('KSF');
  const at = nowIso();
  const medicine: Medicine = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, ...payload, sku: payload.sku || `KSF-${id.slice(-4)}`, created_at: at, updated_at: at
  };
  await col.medicines().insertOne(medicine);
  await logActivity(ctx, { action: 'medicine.created', entity: 'medicine', entityId: id, summary: `Medicine "${payload.name}" added to the catalogue` });
  return { data: medicine, __status: 201 };
});

route('PATCH', '/api/v1/medicines/:id', 'medicines.write', async (ctx) => {
  const existing = await col.medicines().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That medicine could not be found.');
  const payload = await medicinePayload(ctx, existing);
  if (await barcodeTaken(ctx.pharmacyId, payload.barcode, existing.id)) bad('Another medicine already uses that barcode.', 'barcode');
  const updated = await col.medicines().findOneAndUpdate({ _id: existing.id }, { $set: { ...payload, updated_at: nowIso() } }, { returnDocument: 'after' });

  const changes: string[] = [];
  if (existing.price_paisa !== payload.price_paisa) changes.push(`price Rs ${existing.price_paisa / 100} to Rs ${payload.price_paisa / 100}`);
  if (existing.min_stock !== payload.min_stock) changes.push(`minimum stock ${existing.min_stock} to ${payload.min_stock}`);
  if (existing.requires_prescription !== payload.requires_prescription) changes.push(payload.requires_prescription ? 'now prescription-only' : 'no longer prescription-only');
  await logActivity(ctx, {
    action: 'medicine.updated', entity: 'medicine', entityId: existing.id,
    summary: `Medicine "${payload.name}" updated${changes.length ? `: ${changes.join(', ')}` : ''}`, meta: { changes }
  });
  return { data: updated };
});

route('DELETE', '/api/v1/medicines/:id', 'medicines.delete', async (ctx) => {
  const existing = await col.medicines().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That medicine could not be found.');
  const stock = await onHand(existing.id);
  if (stock > 0) bad(`There are still ${stock} units in stock. Sell or write off the stock before retiring this medicine.`);
  /* Sales history must survive, so the record is retired rather than removed. */
  await col.medicines().updateOne({ _id: existing.id }, { $set: { status: 'retired', updated_at: nowIso() } });
  await logActivity(ctx, { action: 'medicine.retired', entity: 'medicine', entityId: existing.id, severity: 'warn', summary: `Medicine "${existing.name}" retired from the catalogue` });
  return { ok: true };
});

/**
 * Barcode variants worth trying for one scan. UPC-A on imported stock is 12
 * digits where the same product is listed as a 13-digit EAN with a leading
 * zero, and a code pasted out of a spreadsheet has usually lost its leading
 * zeros. Each candidate is an exact match or not a match at all.
 */
export function barcodeVariants(code: string): string[] {
  const digits = code.replace(/\s/g, '');
  const variants = new Set([digits]);
  if (/^\d+$/.test(digits)) {
    variants.add(digits.replace(/^0+/, ''));
    if (digits.length < 13) variants.add(digits.padStart(13, '0'));
    if (digits.length < 12) variants.add(digits.padStart(12, '0'));
  }
  return [...variants].filter(Boolean);
}

const TILL_FIELDS = {
  _id: 1, id: 1, name: 1, generic_name: 1, form: 1, strength: 1, pack_size: 1, barcode: 1, sku: 1, price_paisa: 1, cost_paisa: 1,
  min_stock: 1, requires_prescription: 1, is_controlled: 1, shelf_location: 1, category_id: 1
};

/* Quick lookup used by the till and by the purchase form. */
route('GET', '/api/v1/medicines-lookup', 'medicines.read', async (ctx) => {
  const search = toStr(ctx.query.get('q'), 60);
  const rows = await col.medicines().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId, status: 'active', ...searchFilter(search) } },
    { $project: TILL_FIELDS },
    ...stockStages(),
    ...withCategory(),
    { $set: { stock_state: stockStateExpr(), __in: { $cond: [{ $gt: ['$on_hand', 0] }, 1, 0] } } },
    { $sort: { __in: -1, name: 1 } },
    { $limit: 60 },
    { $unset: ['__in', 'category_colour'] }
  ]).toArray();
  return { data: rows };
});

/**
 * One scan, resolved exactly. A scanner types the whole code and presses
 * Enter before any debounced search has run, so the till asks one question
 * with no ambiguity: which medicine carries this code? More than one answer
 * is a catalogue problem the cashier should see.
 */
route('GET', '/api/v1/medicines-scan', 'medicines.read', async (ctx) => {
  const code = toStr(ctx.query.get('code'), 40).trim();
  if (!code) bad('Scan or type a barcode.', 'code');
  const variants = barcodeVariants(code);
  const rows = await col.medicines().aggregate([
    { $match: { pharmacy_id: ctx.pharmacyId, status: 'active', $or: [{ barcode: { $in: variants } }, { sku: { $in: variants } }] } },
    { $project: TILL_FIELDS },
    ...stockStages(),
    ...withCategory(),
    { $set: { stock_state: stockStateExpr() } },
    { $unset: 'category_colour' },
    { $sort: { name: 1 } },
    { $limit: 5 }
  ]).toArray();
  return { data: rows, code, tried: variants };
});
