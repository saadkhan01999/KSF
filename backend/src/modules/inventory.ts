/* Stock levels, batch records, manual adjustments and expiry control.

   Two rules are enforced here and nowhere else, so they cannot be bypassed:
     1. Stock is never allowed to fall below zero.
     2. An expired or quarantined batch is not sellable stock. */

import type { Document, Filter } from 'mongodb';
import { col, s, tx } from '../db/mongo.js';
import type { Batch, StockMovement } from '../db/types.js';
import { bad, missing } from '../core/errors.js';
import { getSetting, logActivity, notify } from '../core/trails.js';
import { contains, nowIso, today, toInt, toStr, uid } from '../core/util.js';
import { lookupField } from '../db/pipeline.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { expiryState, pageResult, paging, recordMovement, refreshStockAlerts, stockStateExpr } from './shared.js';

const warnDaysFor = async (pharmacyId: string): Promise<number> => Number(await getSetting(pharmacyId, 'expiry.warn_days') || 90);

/** A batch with its medicine's name, scoped to the pharmacy. */
async function batchFor(ctx: PharmacyCtx, id: string): Promise<(Batch & { medicine_name: string }) | null> {
  const [batch] = await col.batches().aggregate<Batch & { medicine_name: string }>([
    { $match: { _id: id, pharmacy_id: ctx.pharmacyId } },
    ...lookupField('medicines', 'medicine_id', 'name', 'medicine_name')
  ]).toArray();
  return batch ?? null;
}

/* =============================== INVENTORY =============================== */

route('GET', '/api/v1/inventory', 'inventory.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const search = toStr(ctx.query.get('q'), 80);
  const state = toStr(ctx.query.get('state'), 24);
  const day = today();

  const match: Filter<Document> = { pharmacy_id: ctx.pharmacyId, status: 'active' };
  if (search) {
    const pattern = contains(search);
    match.$or = [{ name: pattern }, { generic_name: pattern }, { shelf_location: pattern }];
  }

  const rows = await col.medicines().aggregate([
    { $match: match },
    {
      $project: {
        _id: 1, id: 1, name: 1, generic_name: 1, form: 1, strength: 1, pack_size: 1, shelf_location: 1, min_stock: 1,
        max_stock: 1, cost_paisa: 1, price_paisa: 1, requires_prescription: 1, category_id: 1
      }
    },
    {
      $lookup: {
        from: 'batches', localField: '_id', foreignField: 'medicine_id', as: '__b',
        pipeline: [
          { $match: { quantity: { $gt: 0 } } },
          {
            $group: {
              _id: null,
              live: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiry_date', day] }] }, '$quantity', 0] } },
              batches: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiry_date', day] }] }, 1, 0] } },
              next: { $min: { $cond: [{ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiry_date', day] }] }, '$expiry_date', null] } },
              blocked: { $sum: { $cond: [{ $or: [{ $in: ['$status', ['quarantined', 'expired']] }, { $lte: ['$expiry_date', day] }] }, '$quantity', 0] } }
            }
          }
        ]
      }
    },
    {
      $set: {
        on_hand: { $ifNull: [{ $first: '$__b.live' }, 0] }, blocked_qty: { $ifNull: [{ $first: '$__b.blocked' }, 0] },
        batch_count: { $ifNull: [{ $first: '$__b.batches' }, 0] }, next_expiry: { $ifNull: [{ $first: '$__b.next' }, null] }
      }
    },
    { $set: { stock_value_paisa: { $multiply: ['$on_hand', '$cost_paisa'] }, stock_state: stockStateExpr(), __low: { $cond: [{ $lte: ['$on_hand', '$min_stock'] }, 1, 0] } } },
    { $lookup: { from: 'categories', localField: 'category_id', foreignField: '_id', as: '__c', pipeline: [{ $project: { name: 1, colour: 1 } }] } },
    { $set: { category_name: { $ifNull: [{ $first: '$__c.name' }, null] }, category_colour: { $ifNull: [{ $first: '$__c.colour' }, null] } } },
    { $sort: { __low: -1, name: 1 } },
    { $unset: ['__b', '__c', '__low'] }
  ]).toArray();

  const filtered = state ? rows.filter((row) => row.stock_state === state) : rows;
  const summary = {
    tracked: rows.length,
    inStock: rows.filter((row) => row.stock_state === 'in-stock').length,
    lowStock: rows.filter((row) => row.stock_state === 'low-stock' || row.stock_state === 'reorder-soon').length,
    outOfStock: rows.filter((row) => row.stock_state === 'out-of-stock').length,
    stockValuePaisa: rows.reduce((sum, row) => sum + row.stock_value_paisa, 0),
    retailValuePaisa: rows.reduce((sum, row) => sum + row.on_hand * row.price_paisa, 0),
    blockedUnits: rows.reduce((sum, row) => sum + row.blocked_qty, 0)
  };
  return { ...pageResult(filtered.slice(skip, skip + size), filtered.length, { page, size }), summary };
});

route('GET', '/api/v1/inventory/batches', 'inventory.read', async (ctx) => {
  const medicineId = toStr(ctx.query.get('medicine'), 40);
  const warnDays = await warnDaysFor(ctx.pharmacyId);
  const match: Filter<Batch> = { pharmacy_id: ctx.pharmacyId };
  if (medicineId) match.medicine_id = medicineId;
  const rows = await col.batches().aggregate<Batch & Document>([
    { $match: match },
    { $sort: { expiry_date: 1 } },
    { $limit: 400 },
    { $lookup: { from: 'medicines', localField: 'medicine_id', foreignField: '_id', as: '__m', pipeline: [{ $project: { name: 1, form: 1, strength: 1 } }] } },
    { $set: { medicine_name: { $first: '$__m.name' }, form: { $first: '$__m.form' }, strength: { $first: '$__m.strength' } } },
    ...lookupField('suppliers', 'supplier_id', 'name', 'supplier_name'),
    { $unset: '__m' }
  ]).toArray();
  return { data: rows.map((batch) => ({ ...batch, ...expiryState(batch.expiry_date, warnDays) })) };
});

/* Manual correction after a physical count, breakage or theft. */
route('POST', '/api/v1/inventory/adjust', 'inventory.adjust', async (ctx) => {
  const reason = toStr(ctx.body.reason, 200);
  const counted = toInt(ctx.body.quantity, -1);
  if (!reason) bad('A reason is required for every stock adjustment.', 'reason');
  if (counted < 0) bad('Enter the counted quantity. It cannot be negative.', 'quantity');

  const batch = await batchFor(ctx, toStr(ctx.body.batchId, 40));
  if (!batch) return missing('That batch could not be found.');
  if (counted === batch.quantity) bad('The counted quantity matches the system. No adjustment is needed.', 'quantity');

  /* A count is the one place an absolute quantity is the right thing to
     write: the shelf is the authority. The difference recorded on the ledger
     is measured against what the database held at the moment of the write,
     not the screen the person was looking at — a sale may have gone through
     while they were counting. A finished batch found to have stock is back on
     sale; one counted down to nothing is finished. A quarantined or
     written-off batch keeps its status. */
  let delta = 0;
  await tx(async () => {
    const before = await col.batches().findOneAndUpdate(
      { _id: batch.id },
      [{
        $set: {
          quantity: counted, updated_at: nowIso(),
          status: {
            $switch: {
              branches: [
                { case: { $and: [{ $gt: [counted, 0] }, { $eq: ['$status', 'finished'] }] }, then: 'active' },
                { case: { $and: [{ $eq: [counted, 0] }, { $eq: ['$status', 'active'] }] }, then: 'finished' }
              ],
              default: '$status'
            }
          }
        }
      }],
      { returnDocument: 'before', ...s() }
    );
    delta = counted - (before?.quantity ?? batch.quantity);
    await recordMovement({
      pharmacyId: ctx.pharmacyId, medicineId: batch.medicine_id, batchId: batch.id, type: 'adjustment', delta,
      balanceAfter: counted, referenceType: 'manual', referenceId: batch.id, reason, userId: ctx.user.id
    });
  });

  await logActivity(ctx, {
    action: 'inventory.adjusted', entity: 'batch', entityId: batch.id, severity: 'warn',
    summary: `${batch.medicine_name} batch ${batch.batch_no} adjusted from ${counted - delta} to ${counted} — ${reason}`,
    meta: { before: counted - delta, after: counted, delta }
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return { data: await col.batches().findOne({ _id: batch.id }) };
});

/* Adding a batch by hand, for opening stock or a direct counter purchase. */
route('POST', '/api/v1/inventory/batches', 'inventory.adjust', async (ctx) => {
  const medicine = await col.medicines().findOne({ _id: toStr(ctx.body.medicineId, 40), pharmacy_id: ctx.pharmacyId });
  if (!medicine) return bad('Choose a medicine.', 'medicineId');

  const batchNo = toStr(ctx.body.batchNo, 40);
  const expiryDate = toStr(ctx.body.expiryDate, 10);
  const quantity = toInt(ctx.body.quantity, 0);
  if (!batchNo) bad('Enter the batch number printed on the pack.', 'batchNo');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) bad('Enter the expiry date as YYYY-MM-DD.', 'expiryDate');
  if (quantity <= 0) bad('Enter how many units were received.', 'quantity');
  if (expiryDate <= today()) bad('That batch has already expired and cannot be added to sellable stock.', 'expiryDate');
  if (await col.batches().findOne({ medicine_id: medicine.id, batch_no: batchNo }, { projection: { _id: 1 } })) {
    bad('That batch number already exists for this medicine.', 'batchNo');
  }
  const supplierId = toStr(ctx.body.supplierId, 40) || null;
  if (supplierId && !await col.suppliers().findOne({ _id: supplierId, pharmacy_id: ctx.pharmacyId }, { projection: { _id: 1 } })) {
    bad('That supplier could not be found.', 'supplierId');
  }

  const id = uid('BAT');
  const at = nowIso();
  const batch: Batch = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, medicine_id: medicine.id, branch_id: ctx.user.branch_id, supplier_id: supplierId,
    purchase_id: null, batch_no: batchNo, expiry_date: expiryDate, quantity, quantity_in: quantity,
    cost_paisa: toInt(ctx.body.costPaisa, medicine.cost_paisa), price_paisa: toInt(ctx.body.pricePaisa, medicine.price_paisa),
    status: 'active', quarantine_note: null, received_at: at, created_at: at, updated_at: at
  };
  await tx(async () => {
    await col.batches().insertOne(batch, s());
    await recordMovement({
      pharmacyId: ctx.pharmacyId, medicineId: medicine.id, batchId: id, type: 'stock-in', delta: quantity, balanceAfter: quantity,
      referenceType: 'manual', reason: toStr(ctx.body.reason, 200) || 'Batch added manually', userId: ctx.user.id, at
    });
  });
  await logActivity(ctx, { action: 'batch.created', entity: 'batch', entityId: id, summary: `${quantity} units of ${medicine.name} added as batch ${batchNo}` });
  await refreshStockAlerts(ctx.pharmacyId);
  return { data: batch, __status: 201 };
});

/* ============================ EXPIRY CONTROL ============================ */

route('GET', '/api/v1/expiry', 'inventory.read', async (ctx) => {
  const warnDays = await warnDaysFor(ctx.pharmacyId);
  const filter = toStr(ctx.query.get('state'), 20);

  const rows = (await col.batches().aggregate<Batch & { value_paisa: number }>([
    { $match: { pharmacy_id: ctx.pharmacyId, quantity: { $gt: 0 }, status: { $ne: 'written-off' } } },
    { $sort: { expiry_date: 1 } },
    { $lookup: { from: 'medicines', localField: 'medicine_id', foreignField: '_id', as: '__m', pipeline: [{ $project: { name: 1, form: 1, strength: 1, pack_size: 1, category_id: 1 } }] } },
    { $set: { medicine_name: { $first: '$__m.name' }, form: { $first: '$__m.form' }, strength: { $first: '$__m.strength' }, pack_size: { $first: '$__m.pack_size' }, __cat: { $first: '$__m.category_id' } } },
    ...lookupField('categories', '__cat', 'name', 'category_name'),
    ...lookupField('suppliers', 'supplier_id', 'name', 'supplier_name'),
    { $set: { value_paisa: { $multiply: ['$quantity', '$cost_paisa'] } } },
    { $unset: ['__m', '__cat'] }
  ]).toArray()).map((batch) => ({ ...batch, ...expiryState(batch.expiry_date, warnDays) }));

  const summary = {
    expired: rows.filter((row) => row.state === 'expired').length,
    critical: rows.filter((row) => row.state === 'critical').length,
    expiring: rows.filter((row) => row.state === 'expiring').length,
    quarantined: rows.filter((row) => row.status === 'quarantined').length,
    expiredValuePaisa: rows.filter((row) => row.state === 'expired').reduce((sum, row) => sum + row.value_paisa, 0),
    atRiskValuePaisa: rows.filter((row) => row.state === 'critical' || row.state === 'expiring').reduce((sum, row) => sum + row.value_paisa, 0)
  };
  const visible = filter && filter !== 'all'
    ? rows.filter((row) => (filter === 'quarantined' ? row.status === 'quarantined' : row.state === filter))
    : rows.filter((row) => row.state !== 'safe' || row.status === 'quarantined');
  return { data: visible, summary, warnDays };
});

route('POST', '/api/v1/expiry/:id/quarantine', 'expiry.manage', async (ctx) => {
  const batch = await batchFor(ctx, ctx.params.id);
  if (!batch) return missing('That batch could not be found.');
  if (batch.status === 'quarantined') bad('That batch is already quarantined.');
  if (batch.status === 'written-off') bad('That batch has been written off.');

  const note = toStr(ctx.body.note, 200) || 'Quarantined pending disposal';
  const updated = await col.batches().findOneAndUpdate({ _id: batch.id }, { $set: { status: 'quarantined', quarantine_note: note, updated_at: nowIso() } }, { returnDocument: 'after' });
  await logActivity(ctx, {
    action: 'batch.quarantined', entity: 'batch', entityId: batch.id, severity: 'warn',
    summary: `${batch.medicine_name} batch ${batch.batch_no} (${batch.quantity} units) quarantined — ${note}`
  });
  await notify(ctx.pharmacyId, {
    type: 'expiry', severity: 'warn', title: `${batch.medicine_name} batch ${batch.batch_no} quarantined`,
    body: `${batch.quantity} units removed from sale. ${note}`, link: '/expiry'
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return { data: updated };
});

route('POST', '/api/v1/expiry/:id/release', 'expiry.manage', async (ctx) => {
  const batch = await batchFor(ctx, ctx.params.id);
  if (!batch) return missing('That batch could not be found.');
  if (batch.status !== 'quarantined') bad('Only a quarantined batch can be released.');
  if (batch.expiry_date <= today()) bad('An expired batch can never be released back for sale. Write it off instead.');
  const updated = await col.batches().findOneAndUpdate(
    { _id: batch.id },
    { $set: { status: batch.quantity > 0 ? 'active' : 'finished', quarantine_note: null, updated_at: nowIso() } },
    { returnDocument: 'after' }
  );
  await logActivity(ctx, {
    action: 'batch.released', entity: 'batch', entityId: batch.id, severity: 'warn',
    summary: `${batch.medicine_name} batch ${batch.batch_no} released back to sellable stock`
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return { data: updated };
});

route('POST', '/api/v1/expiry/:id/write-off', 'expiry.manage', async (ctx) => {
  const batch = await batchFor(ctx, ctx.params.id);
  if (!batch) return missing('That batch could not be found.');
  if (batch.quantity <= 0) bad('That batch has no stock left to write off.');

  const reason = toStr(ctx.body.reason, 200) || 'Expired stock destroyed';
  let units = 0;
  await tx(async () => {
    /* Whatever is on the shelf at the moment of writing goes, not the figure
       on the screen. */
    const before = await col.batches().findOneAndUpdate(
      { _id: batch.id, quantity: { $gt: 0 } },
      { $set: { quantity: 0, status: 'written-off', quarantine_note: reason, updated_at: nowIso() } },
      { returnDocument: 'before', ...s() }
    );
    if (!before) bad('That batch has no stock left to write off.');
    units = before!.quantity;
    await recordMovement({
      pharmacyId: ctx.pharmacyId, medicineId: batch.medicine_id, batchId: batch.id, type: 'write-off', delta: -units,
      balanceAfter: 0, referenceType: 'expiry', referenceId: batch.id, reason, userId: ctx.user.id
    });
  });
  const lost = units * batch.cost_paisa;
  await logActivity(ctx, {
    action: 'batch.written-off', entity: 'batch', entityId: batch.id, severity: 'danger',
    summary: `${units} units of ${batch.medicine_name} (batch ${batch.batch_no}) written off — Rs ${(lost / 100).toLocaleString('en-PK')} — ${reason}`,
    meta: { units, valuePaisa: lost, reason }
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return { ok: true, writtenOff: units, valuePaisa: lost };
});

/* One click to quarantine every batch that is already past its expiry date. */
route('POST', '/api/v1/expiry/quarantine-expired', 'expiry.manage', async (ctx) => {
  const expired = await col.batches().aggregate<{ _id: string; batch_no: string; medicine_name: string }>([
    { $match: { pharmacy_id: ctx.pharmacyId, quantity: { $gt: 0 }, status: 'active', expiry_date: { $lte: today() } } },
    ...lookupField('medicines', 'medicine_id', 'name', 'medicine_name'),
    { $project: { batch_no: 1, medicine_name: 1 } }
  ]).toArray();
  if (!expired.length) bad('There are no expired batches on the shelf right now.');

  await col.batches().updateMany(
    { _id: { $in: expired.map((batch) => batch._id) }, status: 'active' },
    { $set: { status: 'quarantined', quarantine_note: 'Automatically quarantined: past expiry date', updated_at: nowIso() } }
  );
  await logActivity(ctx, {
    action: 'expiry.bulk-quarantine', entity: 'batch', severity: 'warn',
    summary: `${expired.length} expired batch(es) quarantined in one action`,
    meta: { batches: expired.map((batch) => `${batch.medicine_name} ${batch.batch_no}`) }
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return { ok: true, quarantined: expired.length };
});

/* Stock movement ledger — the audit trail behind every quantity on screen. */
route('GET', '/api/v1/stock-movements', 'inventory.read', async (ctx) => {
  const { page, size, skip } = paging(ctx, 60);
  const medicineId = toStr(ctx.query.get('medicine'), 40);
  const match: Filter<StockMovement> = { pharmacy_id: ctx.pharmacyId };
  if (medicineId) match.medicine_id = medicineId;

  const [rows, total] = await Promise.all([
    col.stockMovements().aggregate([
      { $match: match },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: size },
      ...lookupField('medicines', 'medicine_id', 'name', 'medicine_name'),
      ...lookupField('batches', 'batch_id', 'batch_no', 'batch_no'),
      ...lookupField('users', 'created_by', 'full_name', 'actor_name')
    ]).toArray(),
    col.stockMovements().countDocuments(match)
  ]);
  return pageResult(rows, total, { page, size });
});
