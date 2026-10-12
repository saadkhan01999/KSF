/* Suppliers, purchase orders and stock-in.

   Receiving a purchase is the only place outside a manual adjustment where
   stock increases. It runs in one transaction, so the batches, the movement
   ledger and the order status stay permanently in step. */

import type { Document, Filter } from 'mongodb';
import { col, s, tx } from '../db/mongo.js';
import type { Medicine, Purchase, PurchaseItem, Supplier, SupplierPayment } from '../db/types.js';
import { bad, missing } from '../core/errors.js';
import { logActivity, nextNumber, notify } from '../core/trails.js';
import { contains, isEmail, isPkPhone, nowIso, randomUUID, today, toInt, toStr, uid } from '../core/util.js';
import { lookupField } from '../db/pipeline.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import { pageResult, paging, recordMovement, refreshStockAlerts } from './shared.js';

const rupees = (paisa: number): string => (paisa / 100).toLocaleString('en-PK');

/* Ways a supplier is paid. 'credit' is absent: credit is the unpaid balance. */
const SUPPLIER_METHODS = ['cash', 'bank-transfer', 'cheque', 'card', 'easypaisa', 'jazzcash'];

/**
 * Write a payment to the supplier ledger. The order keeps its running total
 * (paid_paisa); the ledger keeps when each rupee left, which is what the
 * accounts' cash flow is built from. Call it inside the order's transaction.
 */
async function recordSupplierPayment(ctx: PharmacyCtx, purchase: Purchase, amount: number, details: { paidOn?: string; method?: string; reference?: string | null } = {}): Promise<void> {
  if (amount <= 0) return;
  const id = uid('SPY');
  const payment: SupplierPayment = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, supplier_id: purchase.supplier_id, purchase_id: purchase.id, amount_paisa: amount,
    paid_on: details.paidOn || today(), payment_method: details.method || 'cash', reference: details.reference ?? null,
    created_by: ctx.user.id, created_at: nowIso()
  };
  await col.supplierPayments().insertOne(payment, s());
}

/** The payment details a request may carry, checked. */
function paymentDetails(ctx: PharmacyCtx): { paidOn: string; method: string; reference: string | null } {
  const paidOn = toStr(ctx.body.paidOn, 10) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > today()) bad('Give the payment date as YYYY-MM-DD, not in the future.', 'paidOn');
  const method = toStr(ctx.body.paymentMethod, 20) || 'cash';
  if (!SUPPLIER_METHODS.includes(method)) bad('Choose how the supplier was paid.', 'paymentMethod');
  return { paidOn, method, reference: toStr(ctx.body.paymentReference, 80) || null };
}

/* =============================== SUPPLIERS =============================== */

route('GET', '/api/v1/suppliers', 'suppliers.read', async (ctx) => {
  const search = toStr(ctx.query.get('q'), 80);
  const match: Filter<Supplier> = { pharmacy_id: ctx.pharmacyId };
  if (search) {
    const pattern = contains(search);
    match.$or = [{ name: pattern }, { contact_person: pattern }, { city: pattern }, { phone: pattern }];
  }
  /* What is owed is computed, never stored: the figure brought across at the
     migration plus every received order not yet paid for. */
  const rows = await col.suppliers().aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'purchases', localField: '_id', foreignField: 'supplier_id', as: '__p',
        pipeline: [
          { $match: { status: 'received' } },
          { $group: { _id: null, orders: { $sum: 1 }, spend: { $sum: '$total_paisa' }, unpaid: { $sum: { $subtract: ['$total_paisa', '$paid_paisa'] } }, last: { $max: '$purchase_date' } } }
        ]
      }
    },
    {
      $set: {
        order_count: { $ifNull: [{ $first: '$__p.orders' }, 0] },
        total_spend_paisa: { $ifNull: [{ $first: '$__p.spend' }, 0] },
        opening_balance_paisa: { $ifNull: ['$opening_balance_paisa', 0] },
        unpaid_orders_paisa: { $ifNull: [{ $first: '$__p.unpaid' }, 0] },
        last_order: { $ifNull: [{ $first: '$__p.last' }, null] }
      }
    },
    { $set: { payable_paisa: { $add: ['$opening_balance_paisa', '$unpaid_orders_paisa'] } } },
    { $unset: '__p' },
    { $sort: { name: 1 } }
  ]).toArray();
  return { data: rows };
});

function supplierPayload(ctx: PharmacyCtx, existing: Supplier | null) {
  const body = ctx.body;
  const text = (key: string, max: number, current: string | null | undefined) =>
    body[key] !== undefined ? toStr(body[key], max) || null : current ?? null;
  const name = toStr(body.name, 140) || existing?.name;
  if (!name) return bad('Enter the supplier or distributor name.', 'name');
  const email = text('email', 160, existing?.email);
  if (email && !isEmail(email)) bad('That email address does not look right.', 'email');
  const phone = text('phone', 40, existing?.phone);
  if (phone && !isPkPhone(phone)) bad('Enter a valid Pakistani phone number, for example +92 21 3456 7890.', 'phone');
  const status = toStr(body.status, 20) || existing?.status || 'active';
  if (!['active', 'inactive'].includes(status)) bad('Choose active or inactive.', 'status');
  return {
    name, email, phone,
    contact_person: text('contactPerson', 120, existing?.contact_person),
    address: text('address', 300, existing?.address),
    city: text('city', 80, existing?.city),
    ntn: text('ntn', 40, existing?.ntn),
    payment_terms: toStr(body.paymentTerms, 80) || existing?.payment_terms || 'Cash on delivery',
    rating: Math.min(5, Math.max(1, toInt(body.rating, existing?.rating ?? 4))),
    notes: text('notes', 500, existing?.notes),
    status
  };
}

route('POST', '/api/v1/suppliers', 'suppliers.write', async (ctx) => {
  const payload = supplierPayload(ctx, null);
  const id = uid('SUP');
  const at = nowIso();
  const supplier: Supplier = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, ...payload, balance_paisa: 0,
    opening_balance_paisa: Math.max(0, toInt(ctx.body.openingBalancePaisa, 0)), created_at: at, updated_at: at
  };
  await col.suppliers().insertOne(supplier);
  await logActivity(ctx, { action: 'supplier.created', entity: 'supplier', entityId: id, summary: `Supplier "${payload.name}" added` });
  return { data: supplier, __status: 201 };
});

route('PATCH', '/api/v1/suppliers/:id', 'suppliers.write', async (ctx) => {
  const existing = await col.suppliers().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That supplier could not be found.');
  const payload = supplierPayload(ctx, existing);
  const updated = await col.suppliers().findOneAndUpdate({ _id: existing.id }, { $set: { ...payload, updated_at: nowIso() } }, { returnDocument: 'after' });
  await logActivity(ctx, { action: 'supplier.updated', entity: 'supplier', entityId: existing.id, summary: `Supplier "${payload.name}" updated` });
  return { data: updated };
});

route('DELETE', '/api/v1/suppliers/:id', 'suppliers.write', async (ctx) => {
  const existing = await col.suppliers().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That supplier could not be found.');
  const orders = await col.purchases().countDocuments({ supplier_id: existing.id });
  if (orders > 0) {
    await col.suppliers().updateOne({ _id: existing.id }, { $set: { status: 'inactive', updated_at: nowIso() } });
    await logActivity(ctx, { action: 'supplier.deactivated', entity: 'supplier', entityId: existing.id, severity: 'warn', summary: `Supplier "${existing.name}" made inactive (${orders} order(s) on record)` });
    return { ok: true, deactivated: true };
  }
  await col.suppliers().deleteOne({ _id: existing.id });
  await logActivity(ctx, { action: 'supplier.deleted', entity: 'supplier', entityId: existing.id, severity: 'warn', summary: `Supplier "${existing.name}" deleted` });
  return { ok: true };
});

/* =============================== PURCHASES =============================== */

route('GET', '/api/v1/purchases', 'purchases.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const status = toStr(ctx.query.get('status'), 20);
  const search = toStr(ctx.query.get('q'), 80);

  const match: Filter<Document> = { pharmacy_id: ctx.pharmacyId };
  if (status && status !== 'all') match.status = status;
  const searchStage: Document[] = [];
  if (search) {
    const pattern = contains(search);
    searchStage.push({ $match: { $or: [{ reference: pattern }, { invoice_no: pattern }, { supplier_name: pattern }] } });
  }

  const [[result], [summary]] = await Promise.all([
    col.purchases().aggregate<{ rows: Document[]; total: { n: number }[] }>([
      { $match: match },
      { $lookup: { from: 'suppliers', localField: 'supplier_id', foreignField: '_id', as: '__s', pipeline: [{ $project: { name: 1, city: 1 } }] } },
      { $set: { supplier_name: { $first: '$__s.name' }, supplier_city: { $first: '$__s.city' }, line_count: { $size: '$items' }, unit_count: { $sum: '$items.quantity' } } },
      { $unset: '__s' },
      ...searchStage,
      { $sort: { purchase_date: -1, created_at: -1 } },
      { $facet: { rows: [{ $skip: skip }, { $limit: size }, { $project: { items: 0 } }], total: [{ $count: 'n' }] } }
    ]).toArray(),
    col.purchases().aggregate([
      { $match: { pharmacy_id: ctx.pharmacyId } },
      {
        $group: {
          _id: null, orders: { $sum: 1 },
          received_value: { $sum: { $cond: [{ $eq: ['$status', 'received'] }, '$total_paisa', 0] } },
          pending_value: { $sum: { $cond: [{ $in: ['$status', ['draft', 'ordered']] }, '$total_paisa', 0] } },
          payable: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'received'] }, { $ne: ['$payment_status', 'paid'] }] }, { $subtract: ['$total_paisa', '$paid_paisa'] }, 0] } }
        }
      },
      { $project: { _id: 0 } }
    ]).toArray()
  ]);
  return {
    ...pageResult(result?.rows ?? [], result?.total[0]?.n ?? 0, { page, size }),
    summary: summary ?? { orders: 0, received_value: 0, pending_value: 0, payable: 0 }
  };
});

route('GET', '/api/v1/purchases/:id', 'purchases.read', async (ctx) => {
  const [purchase] = await col.purchases().aggregate([
    { $match: { _id: ctx.params.id, pharmacy_id: ctx.pharmacyId } },
    {
      $lookup: {
        from: 'suppliers', localField: 'supplier_id', foreignField: '_id', as: '__s',
        pipeline: [{ $project: { name: 1, contact_person: 1, phone: 1, email: 1, address: 1, city: 1, payment_terms: 1 } }]
      }
    },
    {
      $set: {
        supplier_name: { $first: '$__s.name' }, contact_person: { $first: '$__s.contact_person' }, supplier_phone: { $first: '$__s.phone' },
        supplier_email: { $first: '$__s.email' }, supplier_address: { $first: '$__s.address' }, supplier_city: { $first: '$__s.city' },
        payment_terms: { $first: '$__s.payment_terms' }
      }
    },
    ...lookupField('branches', 'branch_id', 'name', 'branch_name'),
    ...lookupField('users', 'created_by', 'full_name', 'created_by_name'),
    ...lookupField('users', 'received_by', 'full_name', 'received_by_name'),
    { $unset: '__s' }
  ]).toArray();
  if (!purchase) return missing('That purchase order could not be found.');
  const ids = (purchase.items as PurchaseItem[]).map((item) => item.medicine_id);
  const medicines = new Map((await col.medicines().find({ _id: { $in: ids } }, { projection: { form: 1, strength: 1, pack_size: 1 } }).toArray()).map((m) => [m._id, m]));
  const items = (purchase.items as PurchaseItem[]).map((item) => {
    const medicine = medicines.get(item.medicine_id);
    return { ...item, purchase_id: purchase._id, form: medicine?.form ?? null, strength: medicine?.strength ?? null, pack_size: medicine?.pack_size ?? null };
  });
  return { data: { ...purchase, items } };
});

interface Line { medicine: Medicine; quantity: number; cost: number; price: number; batchNo: string; expiry: string; lineTotal: number }

async function readLines(ctx: PharmacyCtx): Promise<Line[]> {
  const lines: Record<string, unknown>[] = Array.isArray(ctx.body.items) ? ctx.body.items : [];
  if (!lines.length) bad('Add at least one medicine to the order.', 'items');
  const ids = lines.map((line) => toStr(line.medicineId, 40));
  const found = new Map((await col.medicines().find({ _id: { $in: ids }, pharmacy_id: ctx.pharmacyId }).toArray()).map((m) => [m._id, m]));

  return lines.map((line, index) => {
    const medicine = found.get(toStr(line.medicineId, 40));
    if (!medicine) return bad(`Line ${index + 1}: choose a valid medicine.`, 'items');
    const quantity = toInt(line.quantity, 0);
    const cost = toInt(line.costPaisa, medicine.cost_paisa);
    const price = toInt(line.pricePaisa, medicine.price_paisa);
    const batchNo = toStr(line.batchNo, 40);
    const expiry = toStr(line.expiryDate, 10);
    const label = `Line ${index + 1} (${medicine.name})`;
    if (quantity <= 0) bad(`${label}: enter a quantity above zero.`, 'items');
    if (cost < 0) bad(`${label}: the cost cannot be negative.`, 'items');
    if (!batchNo) bad(`${label}: enter the batch number.`, 'items');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) bad(`${label}: enter the expiry date as YYYY-MM-DD.`, 'items');
    if (expiry <= today()) bad(`${label}: that batch has already expired and must not be received.`, 'items');
    if (price > 0 && cost > price) bad(`${label}: the retail price is below the purchase cost.`, 'items');
    return { medicine, quantity, cost, price, batchNo, expiry, lineTotal: quantity * cost };
  });
}

/* Shared by "create and receive" and by receiving an existing order. */
async function receiveStock(ctx: PharmacyCtx, purchase: { id: string; supplier_id: string }, items: Line[]): Promise<void> {
  const at = nowIso();
  for (const line of items) {
    /* Added in the database, not worked out here. A delivery is often booked
       in while the counter is still selling from the same batch. A batch the
       till finished comes back on sale; one somebody quarantined or wrote off
       keeps that decision. */
    const merged = await col.batches().findOneAndUpdate(
      { pharmacy_id: ctx.pharmacyId, medicine_id: line.medicine.id, batch_no: line.batchNo, expiry_date: line.expiry },
      [{
        $set: {
          quantity: { $add: ['$quantity', line.quantity] }, quantity_in: { $add: ['$quantity_in', line.quantity] },
          cost_paisa: line.cost, price_paisa: line.price, updated_at: at,
          status: { $cond: [{ $eq: ['$status', 'finished'] }, 'active', '$status'] }
        }
      }],
      { returnDocument: 'after', ...s() }
    );
    if (merged) {
      await recordMovement({
        pharmacyId: ctx.pharmacyId, medicineId: line.medicine.id, batchId: merged.id, type: 'purchase', delta: line.quantity,
        balanceAfter: merged.quantity, referenceType: 'purchase', referenceId: purchase.id,
        reason: 'Stock received against purchase order', userId: ctx.user.id, at
      });
    } else {
      const batchId = uid('BAT');
      await col.batches().insertOne({
        _id: batchId, id: batchId, pharmacy_id: ctx.pharmacyId, medicine_id: line.medicine.id, branch_id: ctx.user.branch_id,
        supplier_id: purchase.supplier_id, purchase_id: purchase.id, batch_no: line.batchNo, expiry_date: line.expiry,
        quantity: line.quantity, quantity_in: line.quantity, cost_paisa: line.cost, price_paisa: line.price, status: 'active',
        quarantine_note: null, received_at: at, created_at: at, updated_at: at
      }, s());
      await recordMovement({
        pharmacyId: ctx.pharmacyId, medicineId: line.medicine.id, batchId, type: 'purchase', delta: line.quantity,
        balanceAfter: line.quantity, referenceType: 'purchase', referenceId: purchase.id, reason: 'New batch received', userId: ctx.user.id, at
      });
    }
    /* Keep the catalogue's headline cost and price aligned with the latest buy. */
    await col.medicines().updateOne({ _id: line.medicine.id }, { $set: { cost_paisa: line.cost, price_paisa: line.price, updated_at: at } }, s());
  }
}

route('POST', '/api/v1/purchases', 'purchases.write', async (ctx) => {
  const supplier = await col.suppliers().findOne({ _id: toStr(ctx.body.supplierId, 40), pharmacy_id: ctx.pharmacyId });
  if (!supplier) return bad('Choose the supplier this order is going to.', 'supplierId');

  const lines = await readLines(ctx);
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discount = Math.min(subtotal, Math.max(0, toInt(ctx.body.discountPaisa, 0)));
  const gst = Math.max(0, toInt(ctx.body.gstPaisa, 0));
  const total = subtotal - discount + gst;
  const receiveNow = ctx.body.receiveNow === true;
  const paidNow = receiveNow && ctx.body.markPaid === true;
  const status = receiveNow ? 'received' : toStr(ctx.body.status, 20) || 'ordered';
  if (!['draft', 'ordered', 'received'].includes(status)) bad('Choose draft or ordered.', 'status');

  const id = uid('PUR');
  const at = nowIso();
  const reference = await nextNumber(ctx.pharmacyId, 'purchase', 'KSF-PO');
  const purchase: Purchase = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, branch_id: ctx.user.branch_id, supplier_id: supplier.id, reference,
    invoice_no: toStr(ctx.body.invoiceNo, 60) || null, purchase_date: toStr(ctx.body.purchaseDate, 10) || today(),
    expected_date: toStr(ctx.body.expectedDate, 10) || null, status,
    items: lines.map((line) => ({
      id: randomUUID(), medicine_id: line.medicine.id, medicine_name: line.medicine.name, batch_no: line.batchNo, expiry_date: line.expiry,
      quantity: line.quantity, cost_paisa: line.cost, price_paisa: line.price, line_total_paisa: line.lineTotal
    })),
    subtotal_paisa: subtotal, discount_paisa: discount, gst_paisa: gst, total_paisa: total,
    paid_paisa: paidNow ? total : 0, payment_status: paidNow ? 'paid' : 'unpaid', notes: toStr(ctx.body.notes, 500) || null,
    created_by: ctx.user.id, received_by: receiveNow ? ctx.user.id : null, received_at: receiveNow ? at : null,
    approved_by: null, approved_at: null, created_at: at, updated_at: at
  };

  const paidWith = paidNow ? paymentDetails(ctx) : null;
  await tx(async () => {
    await col.purchases().insertOne(purchase, s());
    if (receiveNow) await receiveStock(ctx, purchase, lines);
    if (paidWith) await recordSupplierPayment(ctx, purchase, total, paidWith);
  });
  await logActivity(ctx, {
    action: receiveNow ? 'purchase.received' : 'purchase.created', entity: 'purchase', entityId: id,
    summary: `${reference} ${receiveNow ? 'received' : 'raised'} for ${supplier.name} — Rs ${rupees(total)}`
  });
  if (receiveNow) await refreshStockAlerts(ctx.pharmacyId);
  return { data: purchase, __status: 201 };
});

/** Edit a purchase that has not been received yet: lines, dates, notes. */
route('PATCH', '/api/v1/purchases/:id', 'purchases.write', async (ctx) => {
  const purchase = await col.purchases().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!purchase) return missing('That purchase order could not be found.');
  if (!['draft', 'ordered'].includes(purchase.status)) bad('Only a draft or ordered purchase can be edited.');

  const set: Partial<Purchase> = { updated_at: nowIso() };
  if (ctx.body.supplierId !== undefined) {
    const supplier = await col.suppliers().findOne({ _id: toStr(ctx.body.supplierId, 40), pharmacy_id: ctx.pharmacyId });
    if (!supplier) bad('Choose the supplier this order is going to.', 'supplierId');
    set.supplier_id = supplier!.id;
  }
  if (ctx.body.invoiceNo !== undefined) set.invoice_no = toStr(ctx.body.invoiceNo, 60) || null;
  if (ctx.body.purchaseDate !== undefined) set.purchase_date = toStr(ctx.body.purchaseDate, 10) || purchase.purchase_date;
  if (ctx.body.expectedDate !== undefined) set.expected_date = toStr(ctx.body.expectedDate, 10) || null;
  if (ctx.body.notes !== undefined) set.notes = toStr(ctx.body.notes, 500) || null;
  if (Array.isArray(ctx.body.items)) {
    const lines = await readLines(ctx);
    set.items = lines.map((line) => ({
      id: randomUUID(), medicine_id: line.medicine.id, medicine_name: line.medicine.name, batch_no: line.batchNo, expiry_date: line.expiry,
      quantity: line.quantity, cost_paisa: line.cost, price_paisa: line.price, line_total_paisa: line.lineTotal
    }));
    set.subtotal_paisa = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  }
  const subtotal = set.subtotal_paisa ?? purchase.subtotal_paisa;
  set.discount_paisa = Math.min(subtotal, Math.max(0, toInt(ctx.body.discountPaisa, purchase.discount_paisa)));
  set.gst_paisa = Math.max(0, toInt(ctx.body.gstPaisa, purchase.gst_paisa));
  set.total_paisa = subtotal - set.discount_paisa + set.gst_paisa;

  const updated = await col.purchases().findOneAndUpdate(
    { _id: purchase.id, status: { $in: ['draft', 'ordered'] } }, { $set: set }, { returnDocument: 'after' }
  );
  if (!updated) bad('That order was received or cancelled while you were editing it.');
  await logActivity(ctx, { action: 'purchase.updated', entity: 'purchase', entityId: purchase.id, summary: `${purchase.reference} updated — Rs ${rupees(set.total_paisa)}` });
  return { data: updated };
});

route('POST', '/api/v1/purchases/:id/receive', 'purchases.write', async (ctx) => {
  const purchase = await col.purchases().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!purchase) return missing('That purchase order could not be found.');
  if (purchase.status === 'received') bad('That order has already been received.');
  if (purchase.status === 'cancelled') bad('A cancelled order cannot be received.');
  if (!purchase.items.length) bad('That order has no lines to receive.');

  const medicines = new Map((await col.medicines().find({ _id: { $in: purchase.items.map((item) => item.medicine_id) } }).toArray()).map((m) => [m._id, m]));
  const lines: Line[] = purchase.items.map((row) => {
    const medicine = medicines.get(row.medicine_id);
    if (!medicine) return bad(`"${row.medicine_name}" is no longer in the catalogue.`);
    if (row.expiry_date <= today()) bad(`"${row.medicine_name}" batch ${row.batch_no} has expired and must not be taken into stock.`);
    return { medicine, quantity: row.quantity, cost: row.cost_paisa, price: row.price_paisa, batchNo: row.batch_no, expiry: row.expiry_date, lineTotal: row.line_total_paisa };
  });

  const at = nowIso();
  const markPaid = ctx.body.markPaid === true;
  const paidWith = markPaid ? paymentDetails(ctx) : null;
  const updated = await tx(async () => {
    /* Claim the order first: two people pressing Receive at once cannot both
       take the stock in. */
    const claimed = await col.purchases().findOneAndUpdate(
      { _id: purchase.id, status: { $in: ['draft', 'ordered'] } },
      {
        $set: {
          status: 'received', received_by: ctx.user.id, received_at: at, updated_at: at,
          paid_paisa: markPaid ? purchase.total_paisa : purchase.paid_paisa,
          payment_status: markPaid ? 'paid' : purchase.payment_status
        }
      },
      { returnDocument: 'after', ...s() }
    );
    if (!claimed) bad('That order has already been received.');
    await receiveStock(ctx, purchase, lines);
    if (paidWith) await recordSupplierPayment(ctx, purchase, purchase.total_paisa - purchase.paid_paisa, paidWith);
    return claimed;
  });

  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  await logActivity(ctx, { action: 'purchase.received', entity: 'purchase', entityId: purchase.id, summary: `${purchase.reference} received — ${units} units taken into stock` });
  await notify(ctx.pharmacyId, {
    type: 'purchase', severity: 'success', title: `Stock received: ${purchase.reference}`,
    body: `${units} units added across ${lines.length} medicine(s).`, link: '/purchases'
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return { data: updated };
});

route('POST', '/api/v1/purchases/:id/approve', 'purchases.approve', async (ctx) => {
  const at = nowIso();
  const updated = await col.purchases().findOneAndUpdate(
    { _id: ctx.params.id, pharmacy_id: ctx.pharmacyId, status: { $in: ['draft', 'ordered'] } },
    { $set: { status: 'ordered', approved_by: ctx.user.id, approved_at: at, updated_at: at } },
    { returnDocument: 'after' }
  );
  if (!updated) {
    if (!await col.purchases().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId }, { projection: { _id: 1 } })) missing('That purchase order could not be found.');
    bad('Only a draft or ordered purchase can be approved.');
  }
  await logActivity(ctx, { action: 'purchase.approved', entity: 'purchase', entityId: updated!.id, summary: `${updated!.reference} approved for ordering` });
  return { data: updated };
});

route('POST', '/api/v1/purchases/:id/cancel', 'purchases.write', async (ctx) => {
  const purchase = await col.purchases().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!purchase) return missing('That purchase order could not be found.');
  if (purchase.status === 'received') bad('Stock has already been received against this order, so it cannot be cancelled.');
  if (purchase.status === 'cancelled') bad('That order is already cancelled.');
  const reason = toStr(ctx.body.reason, 200) || 'Cancelled by staff';
  const updated = await col.purchases().findOneAndUpdate(
    { _id: purchase.id, status: { $in: ['draft', 'ordered'] } },
    { $set: { status: 'cancelled', notes: `${purchase.notes || ''}\nCancelled: ${reason}`.trim(), updated_at: nowIso() } },
    { returnDocument: 'after' }
  );
  if (!updated) bad('That order was received while you were cancelling it.');
  await logActivity(ctx, { action: 'purchase.cancelled', entity: 'purchase', entityId: purchase.id, severity: 'warn', summary: `${purchase.reference} cancelled — ${reason}` });
  return { data: updated };
});

route('POST', '/api/v1/purchases/:id/payment', 'purchases.write', async (ctx) => {
  const purchase = await col.purchases().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!purchase) return missing('That purchase order could not be found.');
  if (purchase.status === 'cancelled') bad('A cancelled order cannot be paid.');
  const amount = toInt(ctx.body.amountPaisa, 0);
  if (amount <= 0) bad('Enter the amount being paid.', 'amountPaisa');
  const outstanding = purchase.total_paisa - purchase.paid_paisa;
  if (outstanding <= 0) bad('That order is already paid in full.');
  if (amount > outstanding) bad(`Only Rs ${rupees(outstanding)} is outstanding on this order.`, 'amountPaisa');

  const details = paymentDetails(ctx);

  /* Applied against what the database holds now, never what was read. */
  const updated = await tx(async () => {
    const paid = await col.purchases().findOneAndUpdate(
      { _id: purchase.id, paid_paisa: { $lte: purchase.total_paisa - amount } },
      [{
        $set: {
          paid_paisa: { $add: ['$paid_paisa', amount] }, updated_at: nowIso(),
          payment_status: { $cond: [{ $gte: [{ $add: ['$paid_paisa', amount] }, '$total_paisa'] }, 'paid', 'part-paid'] }
        }
      }],
      { returnDocument: 'after', ...s() }
    );
    if (!paid) bad('Another payment was recorded against this order a moment ago. Refresh and check the balance.');
    await recordSupplierPayment(ctx, purchase, amount, details);
    return paid;
  });
  await logActivity(ctx, { action: 'purchase.paid', entity: 'purchase', entityId: purchase.id, summary: `Rs ${rupees(amount)} paid against ${purchase.reference}` });
  return { data: updated };
});
