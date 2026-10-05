/* ==========================================================================
   Helpers shared by the business modules: paging, the "whose figures" rule,
   discount reasons, and the stock and expiry rules several screens rely on.
   ========================================================================== */

import type { Document, Filter } from 'mongodb';
import { col, s } from '../db/mongo.js';
import type { Batch, Sale } from '../db/types.js';
import { missing } from '../core/errors.js';
import { addDays, daysFromNow, nowIso, randomUUID, today, toStr } from '../core/util.js';
import { getSetting, notify } from '../core/trails.js';
import type { PharmacyCtx } from '../http/context.js';

/* ------------------------------------------------------------------ paging */
export function paging(ctx: PharmacyCtx | { query: URLSearchParams }, defaultSize = 50) {
  const page = Math.max(1, Number(ctx.query.get('page') || 1));
  const size = Math.min(200, Math.max(1, Number(ctx.query.get('size') || defaultSize)));
  return { page, size, skip: (page - 1) * size };
}

export function pageResult<R>(rows: R[], total: number, { page, size }: { page: number; size: number }) {
  return { data: rows, page, size, total, pages: Math.max(1, Math.ceil(total / size)) };
}

/** Whitelisted sorting — the field never comes straight from the query. */
export function sortBy(ctx: { query: URLSearchParams }, allowed: Record<string, string>, fallback: string): Record<string, 1 | -1> {
  const requested = ctx.query.get('sort') ?? '';
  const direction = ctx.query.get('dir') === 'asc' ? 1 : -1;
  return { [allowed[requested] ?? fallback]: direction };
}

/* ============================== WHOSE FIGURES ==============================
   Somebody without `reports.everyone` sees the invoices they rang up — on the
   dashboard, in sales history and in reports. Somebody with it (the pharmacy
   Admin by default, and the platform Super Admin) sees the whole pharmacy,
   one person with ?staff=<user id>, or everybody in one role together with
   ?staff=role:<role id>. A role means the people who hold it now.
   ========================================================================== */
export interface SalesScope {
  everyone: boolean;
  pharmacyWide: boolean;
  pharmacyId: string;
  userId: string | null;
  roleId: string | null;
  userIds: string[] | null;
  person: { id: string; name: string; role: string | null; group?: boolean } | null;
}

/** "Cashier" → "Cashiers", "Branch Manager" → "Branch Managers". */
export function plural(name: string): string {
  const text = String(name ?? '').trim();
  if (/(s|x|ch|sh)$/i.test(text)) return `${text}es`;
  if (/[^aeiou]y$/i.test(text)) return `${text.slice(0, -1)}ies`;
  return `${text}s`;
}

export async function salesScope(ctx: PharmacyCtx): Promise<SalesScope> {
  const base = { pharmacyId: ctx.pharmacyId, userId: null, roleId: null, userIds: null };
  if (!ctx.can('reports.everyone')) {
    return {
      ...base, everyone: false, pharmacyWide: false, userId: ctx.user.id,
      person: { id: ctx.user.id, name: ctx.user.full_name, role: ctx.user.role_name }
    };
  }
  const requested = toStr(ctx.query.get('staff'), 80);
  if (!requested || requested === 'all') return { ...base, everyone: true, pharmacyWide: true, person: null };

  if (requested.startsWith('role:')) {
    const role = await col.roles().findOne({ _id: requested.slice(5), pharmacy_id: ctx.pharmacyId });
    if (!role) missing('That role could not be found.');
    const members = await col.users().find(
      { pharmacy_id: ctx.pharmacyId, role_id: role!.id }, { projection: { _id: 1, status: 1 } }
    ).toArray();
    const people = members.filter((member) => member.status !== 'archived').length;
    return {
      ...base, everyone: true, pharmacyWide: false, roleId: role!.id, userIds: members.map((m) => m._id),
      person: { id: `role:${role!.id}`, name: `All ${plural(role!.name)}`, role: `${people} ${people === 1 ? 'person' : 'people'}`, group: true }
    };
  }

  const person = await col.users().findOne({ _id: requested, pharmacy_id: ctx.pharmacyId });
  if (!person) missing('That staff member could not be found.');
  const role = person!.role_id ? await col.roles().findOne({ _id: person!.role_id }) : null;
  return {
    ...base, everyone: true, pharmacyWide: false, userId: person!.id,
    person: { id: person!.id, name: person!.full_name, role: role?.name ?? null }
  };
}

/** The part of a sales filter that limits it to the scope's people. */
export function scopeMatch(scope: SalesScope, field = 'served_by'): Filter<Sale> {
  if (scope.userId) return { [field]: scope.userId } as Filter<Sale>;
  if (scope.userIds) return { [field]: { $in: scope.userIds } } as Filter<Sale>;
  return {};
}

/* =============================== DISCOUNTS =============================== */
export const DISCOUNT_REASONS: Record<string, string> = {
  family: 'Family or relative',
  neighbour: 'Neighbour or friend',
  staff: 'Staff member',
  regular: 'Regular customer',
  senior: 'Senior citizen',
  other: 'Other'
};

/* ================================ STOCK ================================== */

/** Live, sellable stock for one medicine: active batches that have not expired. */
export async function onHand(medicineId: string): Promise<number> {
  const [row] = await col.batches().aggregate<{ n: number }>([
    { $match: { medicine_id: medicineId, status: 'active', expiry_date: { $gt: today() } } },
    { $group: { _id: null, n: { $sum: '$quantity' } } }
  ], s()).toArray();
  return row?.n ?? 0;
}

/** On-hand for many medicines at once, keyed by medicine id. */
export async function onHandMap(pharmacyId: string, medicineIds?: string[]): Promise<Map<string, number>> {
  const match: Filter<Batch> = { pharmacy_id: pharmacyId, status: 'active', expiry_date: { $gt: today() } };
  if (medicineIds) match.medicine_id = { $in: medicineIds };
  const rows = await col.batches().aggregate<{ _id: string; n: number }>([
    { $match: match },
    { $group: { _id: '$medicine_id', n: { $sum: '$quantity' } } }
  ]).toArray();
  return new Map(rows.map((row) => [row._id, row.n]));
}

/** Every batch that may legally be sold, oldest expiry first (FEFO). */
export async function sellableBatches(medicineId: string): Promise<Batch[]> {
  return col.batches().find(
    { medicine_id: medicineId, status: 'active', quantity: { $gt: 0 }, expiry_date: { $gt: today() } },
    { sort: { expiry_date: 1, received_at: 1 }, ...s() }
  ).toArray();
}

export function stockState(onHandQty: number, minStock: number): string {
  if (onHandQty <= 0) return 'out-of-stock';
  if (onHandQty <= minStock) return 'low-stock';
  if (onHandQty <= minStock * 2) return 'reorder-soon';
  return 'in-stock';
}

export function expiryState(expiryDate: string, warnDays = 90): { state: string; days: number } {
  const days = Math.ceil((new Date(`${expiryDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { state: 'expired', days };
  if (days <= 30) return { state: 'critical', days };
  if (days <= warnDays) return { state: 'expiring', days };
  return { state: 'safe', days };
}

export const toPaisa = (rupees: unknown): number => Math.round(Number(rupees || 0) * 100);

/**
 * Rebuild the low-stock and expiry notifications. Cheap enough to run on
 * sign-in and after any stock movement.
 */
export async function refreshStockAlerts(pharmacyId: string): Promise<void> {
  const warnDays = Number(await getSetting(pharmacyId, 'expiry.warn_days') || 90);
  await col.notifications().deleteMany({
    pharmacy_id: pharmacyId, type: { $in: ['low-stock', 'out-of-stock', 'expiry'] }, is_read: 0
  });

  const medicines = await col.medicines().find(
    { pharmacy_id: pharmacyId, status: 'active' }, { projection: { _id: 1, name: 1, min_stock: 1 } }
  ).toArray();
  const stock = await onHandMap(pharmacyId);
  for (const medicine of medicines) {
    const qty = stock.get(medicine._id) ?? 0;
    if (qty > medicine.min_stock) continue;
    await notify(pharmacyId, {
      type: qty === 0 ? 'out-of-stock' : 'low-stock',
      severity: qty === 0 ? 'danger' : 'warn',
      title: qty === 0 ? `${medicine.name} is out of stock` : `${medicine.name} is running low`,
      body: qty === 0 ? 'This medicine cannot be sold until new stock is received.'
        : `Only ${qty} left against a minimum of ${medicine.min_stock}.`,
      link: '/inventory'
    });
  }

  const expiring = await col.batches().aggregate<{ batch_no: string; expiry_date: string; quantity: number; name: string }>([
    { $match: { pharmacy_id: pharmacyId, quantity: { $gt: 0 }, status: { $in: ['active', 'quarantined'] }, expiry_date: { $lte: addDays(warnDays) } } },
    { $sort: { expiry_date: 1 } },
    { $limit: 40 },
    { $lookup: { from: 'medicines', localField: 'medicine_id', foreignField: '_id', as: 'medicine' } },
    { $project: { batch_no: 1, expiry_date: 1, quantity: 1, name: { $ifNull: [{ $first: '$medicine.name' }, 'Medicine'] } } }
  ]).toArray();
  for (const batch of expiring) {
    const left = daysFromNow(batch.expiry_date);
    await notify(pharmacyId, {
      type: 'expiry',
      severity: left < 0 ? 'danger' : left <= 30 ? 'warn' : 'info',
      title: left < 0 ? `${batch.name} batch ${batch.batch_no} has expired`
        : `${batch.name} batch ${batch.batch_no} expires in ${left} days`,
      body: `${batch.quantity} units on the shelf, expiry ${batch.expiry_date}.`,
      link: '/expiry'
    });
  }
}

/**
 * Stages that add `on_hand` (sellable units) and `next_expiry` to medicine
 * documents, straight from their batches.
 */
export function stockStages(): Document[] {
  const day = today();
  return [
    {
      $lookup: {
        from: 'batches', localField: '_id', foreignField: 'medicine_id', as: '__stock',
        pipeline: [
          { $match: { status: 'active', expiry_date: { $gt: day } } },
          { $group: { _id: null, qty: { $sum: '$quantity' }, next: { $min: { $cond: [{ $gt: ['$quantity', 0] }, '$expiry_date', null] } } } }
        ]
      }
    },
    { $set: { on_hand: { $ifNull: [{ $first: '$__stock.qty' }, 0] }, next_expiry: { $ifNull: [{ $first: '$__stock.next' }, null] } } },
    { $unset: '__stock' }
  ];
}

/** The same rule as stockState(), as an aggregation expression. */
export const stockStateExpr = (): Document => ({
  $switch: {
    branches: [
      { case: { $lte: ['$on_hand', 0] }, then: 'out-of-stock' },
      { case: { $lte: ['$on_hand', '$min_stock'] }, then: 'low-stock' },
      { case: { $lte: ['$on_hand', { $multiply: ['$min_stock', 2] }] }, then: 'reorder-soon' }
    ],
    default: 'in-stock'
  }
});

/** One line on the stock ledger: every change of quantity writes one. */
export async function recordMovement(movement: {
  pharmacyId: string; medicineId: string; batchId: string | null; type: string; delta: number; balanceAfter: number;
  referenceType?: string | null; referenceId?: string | null; reason?: string | null; userId?: string | null; at?: string;
}): Promise<void> {
  const id = randomUUID();
  await col.stockMovements().insertOne({
    _id: id, id, pharmacy_id: movement.pharmacyId, medicine_id: movement.medicineId, batch_id: movement.batchId,
    type: movement.type, quantity_delta: movement.delta, balance_after: movement.balanceAfter,
    reference_type: movement.referenceType ?? null, reference_id: movement.referenceId ?? null,
    reason: movement.reason ?? null, created_by: movement.userId ?? null, created_at: movement.at ?? nowIso()
  }, s());
}
