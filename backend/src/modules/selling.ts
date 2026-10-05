/* The till, sales history, customers and prescriptions.

   The checkout rules, written out once:
     - Stock is taken oldest-expiry-first (FEFO), across as many batches as the
       quantity needs.
     - A sale that would take stock below zero is rejected in full; nothing is
       partially committed.
     - Expired and quarantined batches are invisible to the till.
     - A prescription-only medicine needs a prescription a pharmacist has
       verified, unless the pharmacy has switched that check off.
     - Any discount needs pos.discount, a reason, and stays inside the till
       limit unless the person may override it.
     - Everything happens inside one transaction. Where the database cannot
       run transactions (a single standalone server) every stock decrement
       already applied is reversed if a later one fails. */

import type { Document, Filter } from 'mongodb';
import { col, s, supportsTransactions, tx } from '../db/mongo.js';
import type { Batch, Customer, Medicine, Prescription, PrescriptionItem, Sale, SaleItem } from '../db/types.js';
import { bad, forbid, HttpError, missing } from '../core/errors.js';
import { getSetting, logActivity, nextNumber } from '../core/trails.js';
import { contains, escapeRegex, isCnic, isEmail, isPkPhone, nowIso, randomUUID, today, toInt, toStr, uid } from '../core/util.js';
import { lookupField } from '../db/pipeline.js';
import { route } from '../http/router.js';
import type { PharmacyCtx } from '../http/context.js';
import {
  DISCOUNT_REASONS, onHandMap, pageResult, paging, recordMovement, refreshStockAlerts, salesScope, scopeMatch, sellableBatches
} from './shared.js';

const rupees = (paisa: number): string => (paisa / 100).toLocaleString('en-PK');
const PAYMENT_METHODS = ['cash', 'card', 'easypaisa', 'jazzcash', 'bank-transfer', 'credit'];

/* ============================== CHECKOUT ============================== */

interface Take { batch: Batch; take: number }
interface PlannedLine { medicine: Medicine; quantity: number; unitPrice: number; lineTotal: number; gst: number; takes: Take[] }

route('POST', '/api/v1/sales', 'pos.operate', async (ctx) => {
  const lines: Record<string, unknown>[] = Array.isArray(ctx.body.items) ? ctx.body.items : [];
  if (!lines.length) bad('The sale is empty. Add at least one item.', 'items');
  if (lines.length > 200) bad('A single invoice cannot hold more than 200 lines.', 'items');

  const requireRx = await getSetting(ctx.pharmacyId, 'pos.require_prescription_check') !== 'false';
  const allowNegative = await getSetting(ctx.pharmacyId, 'pos.allow_negative_stock') === 'true';

  const customerId = toStr(ctx.body.customerId, 40) || null;
  const customer = customerId ? await col.customers().findOne({ _id: customerId, pharmacy_id: ctx.pharmacyId }) : null;
  if (customerId && !customer) bad('That customer record could not be found.', 'customerId');
  if (customer && customer.status === 'archived') bad(`${customer.name} has been archived. Restore the record before selling to it.`, 'customerId');

  const prescriptionId = toStr(ctx.body.prescriptionId, 40) || null;
  const prescription = prescriptionId ? await col.prescriptions().findOne({ _id: prescriptionId, pharmacy_id: ctx.pharmacyId }) : null;
  if (prescriptionId && !prescription) bad('That prescription could not be found.', 'prescriptionId');
  if (prescription && !['verified', 'dispensed'].includes(prescription.status)) {
    bad(`Prescription ${prescription.reference} has not been verified by a pharmacist yet.`, 'prescriptionId');
  }

  /* ---- Validate every line and plan the batch allocation before writing ---- */
  const ids = lines.map((line) => toStr(line.medicineId, 40));
  const medicines = new Map((await col.medicines().find({ _id: { $in: ids }, pharmacy_id: ctx.pharmacyId, status: 'active' }).toArray()).map((m) => [m._id, m]));
  const plan: PlannedLine[] = [];
  let subtotal = 0;
  let costTotal = 0;
  let gstTotal = 0;
  const wanted = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    const medicine = medicines.get(toStr(line.medicineId, 40));
    if (!medicine) return bad(`Line ${index + 1}: that medicine is no longer available.`, 'items');
    const quantity = toInt(line.quantity, 0);
    if (quantity <= 0) bad(`Line ${index + 1} (${medicine.name}): the quantity must be at least 1.`, 'items');
    if (quantity > 100_000) bad(`Line ${index + 1} (${medicine.name}): that quantity is not realistic for one invoice.`, 'items');
    if (medicine.requires_prescription && requireRx && !prescription) {
      bad(`${medicine.name} is prescription-only. Attach a verified prescription before selling it.`, 'prescriptionId');
    }

    /* The same medicine on two lines draws from the same batches. */
    const already = wanted.get(medicine.id) ?? 0;
    wanted.set(medicine.id, already + quantity);
    const batches = (await sellableBatches(medicine.id)).map((batch) => ({ ...batch }));
    let skip = already;
    for (const batch of batches) {
      const used = Math.min(batch.quantity, skip);
      batch.quantity -= used;
      skip -= used;
    }
    const usable = batches.filter((batch) => batch.quantity > 0);
    const available = usable.reduce((sum, batch) => sum + batch.quantity, 0);
    if (available < quantity && !allowNegative) {
      const [blocked] = await col.batches().aggregate<{ n: number }>([
        { $match: { medicine_id: medicine.id, quantity: { $gt: 0 }, $or: [{ status: { $ne: 'active' } }, { expiry_date: { $lte: today() } }] } },
        { $group: { _id: null, n: { $sum: '$quantity' } } }
      ]).toArray();
      const held = blocked?.n ?? 0;
      bad(available === 0
        ? `${medicine.name} is out of stock${held > 0 ? ` (${held} units are quarantined or expired and cannot be sold)` : ''}.`
        : `Only ${available} unit(s) of ${medicine.name} can be sold. You asked for ${quantity}.`, 'items');
    }

    const unitPrice = toInt(line.unitPricePaisa, medicine.price_paisa);
    if (unitPrice < 0) bad(`Line ${index + 1} (${medicine.name}): the price cannot be negative.`, 'items');
    if (unitPrice < medicine.price_paisa && !ctx.can('pos.discount')) bad(`You do not have permission to change the price of ${medicine.name}.`, 'items');

    /* FEFO: the batch closest to expiry goes first. */
    let remaining = quantity;
    const takes: Take[] = [];
    for (const batch of usable) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      takes.push({ batch, take });
      remaining -= take;
    }
    if (remaining > 0 && allowNegative) {
      const fallback = usable.at(-1) ?? batches.at(-1);
      if (!fallback) bad(`${medicine.name} has no batch on record to sell from. Receive stock first.`, 'items');
      takes.push({ batch: fallback!, take: remaining });
    }

    const lineTotal = unitPrice * quantity;
    const gst = medicine.gst_percent > 0 ? Math.round(lineTotal * medicine.gst_percent / 100) : 0;
    subtotal += lineTotal;
    gstTotal += gst;
    costTotal += takes.reduce((sum, item) => sum + item.batch.cost_paisa * item.take, 0);
    plan.push({ medicine, quantity, unitPrice, lineTotal, gst, takes });
  }

  /* ---- Discount ---- */
  const discount = Math.max(0, toInt(ctx.body.discountPaisa, 0));
  if (discount > 0 && !ctx.can('pos.discount')) forbid('You do not have permission to apply a discount.');
  if (discount > subtotal) bad('The discount cannot be larger than the sale.', 'discountPaisa');
  const discountReason = discount > 0 ? toStr(ctx.body.discountReason, 20) : '';
  const discountNote = discount > 0 ? toStr(ctx.body.discountNote, 140) : '';
  if (discount > 0) {
    if (!DISCOUNT_REASONS[discountReason]) bad('Choose why this discount is being given.', 'discountReason');
    if (discountReason === 'other' && !discountNote) bad('Write a short note saying why — for example "damaged box".', 'discountNote');
    const limit = Math.max(0, Number(await getSetting(ctx.pharmacyId, 'pos.max_discount_percent') ?? 10) || 0);
    const allowedPaisa = Math.floor(subtotal * limit / 100);
    if (discount > allowedPaisa && !ctx.can('pos.discount.override')) {
      forbid(`The most you can give on this sale is ${limit}% (Rs ${rupees(allowedPaisa)}). Ask a manager to give a bigger discount.`);
    }
  }

  /* ---- Payment ---- */
  const total = subtotal - discount + gstTotal;
  const paymentMethod = toStr(ctx.body.paymentMethod, 20) || await getSetting(ctx.pharmacyId, 'pos.default_payment') || 'cash';
  if (!PAYMENT_METHODS.includes(paymentMethod)) bad('Choose a valid payment method.', 'paymentMethod');
  const paid = toInt(ctx.body.paidPaisa, total);
  if (paymentMethod !== 'credit' && paid < total) {
    bad(`The amount received (Rs ${rupees(paid)}) is less than the total due (Rs ${rupees(total)}).`, 'paidPaisa');
  }
  if (paymentMethod === 'credit') {
    if (!customer) bad('A credit sale needs a registered customer.', 'customerId');
    if (customer!.credit_limit_paisa > 0 && customer!.balance_paisa + total > customer!.credit_limit_paisa) {
      bad(`This would take ${customer!.name} over their credit limit of Rs ${rupees(customer!.credit_limit_paisa)}.`, 'paymentMethod');
    }
  }
  const change = paymentMethod === 'credit' ? 0 : Math.max(0, paid - total);

  /* ---- Commit ---- */
  const saleId = uid('SAL');
  const at = nowIso();
  const invoiceNo = await nextNumber(ctx.pharmacyId, 'invoice', await getSetting(ctx.pharmacyId, 'invoice.prefix') || 'KSF');
  const applied: Take[] = [];

  try {
    await tx(async () => {
      const items: SaleItem[] = [];
      for (const line of plan) {
        for (const { batch, take } of line.takes) {
          /* Two tills, one last pack. The plan was made from a read taken
             before this write, so the decrement is conditional and atomic:
             subtract in the database, only where there is still enough. If
             nothing matches, another counter got there first and the whole
             sale is undone rather than quietly overselling. */
          let after = await col.batches().findOneAndUpdate(
            { _id: batch.id, status: 'active', quantity: { $gte: take } },
            { $inc: { quantity: -take }, $set: { updated_at: at } },
            { returnDocument: 'after', ...s() }
          );
          if (!after) {
            if (!allowNegative) {
              throw new HttpError(409, `${line.medicine.name}: another till sold the last of batch ${batch.batch_no} while this sale was being rung up. `
                + 'Nothing has been charged — start the line again and the till will use what is actually on the shelf.', 'items');
            }
            after = await col.batches().findOneAndUpdate(
              { _id: batch.id }, { $inc: { quantity: -take }, $set: { updated_at: at } }, { returnDocument: 'after', ...s() }
            );
          }
          applied.push({ batch, take });
          const balance = after?.quantity ?? 0;
          if (balance === 0) await col.batches().updateOne({ _id: batch.id, status: 'active' }, { $set: { status: 'finished' } }, s());
          await recordMovement({
            pharmacyId: ctx.pharmacyId, medicineId: line.medicine.id, batchId: batch.id, type: 'sale', delta: -take, balanceAfter: balance,
            referenceType: 'sale', referenceId: saleId, reason: `Sold on invoice ${invoiceNo}`, userId: ctx.user.id, at
          });
          items.push({
            id: randomUUID(), medicine_id: line.medicine.id, batch_id: batch.id, medicine_name: line.medicine.name, batch_no: batch.batch_no,
            expiry_date: batch.expiry_date, quantity: take, unit_price_paisa: line.unitPrice, unit_cost_paisa: batch.cost_paisa,
            discount_paisa: 0, gst_paisa: Math.round(line.gst * take / line.quantity), line_total_paisa: line.unitPrice * take
          });
        }
      }

      if (customer) {
        const loyaltyOn = await getSetting(ctx.pharmacyId, 'loyalty.enabled') !== 'false';
        const perHundred = Number(await getSetting(ctx.pharmacyId, 'loyalty.points_per_100') || 1);
        const points = loyaltyOn ? Math.floor(total / 10_000) * perHundred : 0;
        const credit = paymentMethod === 'credit' ? total : 0;
        /* The credit limit is checked again here, against the balance the
           database holds now. */
        const filter: Filter<Customer> = { _id: customer.id };
        if (credit > 0) {
          filter.$expr = { $or: [{ $lte: ['$credit_limit_paisa', 0] }, { $lte: [{ $add: ['$balance_paisa', credit] }, '$credit_limit_paisa'] }] };
        }
        const charged = await col.customers().updateOne(filter, { $inc: { loyalty_points: points, balance_paisa: credit }, $set: { updated_at: at } }, s());
        if (!charged.matchedCount) throw new HttpError(409, `This would take ${customer.name} over their credit limit. Nothing has been charged.`, 'paymentMethod');
      }

      if (prescription && prescription.status === 'verified') {
        await col.prescriptions().updateOne(
          { _id: prescription.id, status: 'verified' },
          { $set: { status: 'dispensed', dispensed_by: ctx.user.id, dispensed_at: at, sale_id: saleId, updated_at: at } }, s()
        );
      }

      const sale: Sale = {
        _id: saleId, id: saleId, pharmacy_id: ctx.pharmacyId, branch_id: ctx.user.branch_id, customer_id: customerId, prescription_id: prescriptionId,
        invoice_no: invoiceNo, sold_at: at, items, subtotal_paisa: subtotal, discount_paisa: discount, gst_paisa: gstTotal, total_paisa: total,
        paid_paisa: paymentMethod === 'credit' ? 0 : paid, change_paisa: change, cost_paisa: costTotal, payment_method: paymentMethod,
        status: 'completed', customer_name: customer?.name ?? 'Walk-in customer', served_by: ctx.user.id, served_by_name: ctx.user.full_name,
        notes: toStr(ctx.body.notes, 300) || null, discount_reason: discountReason || null, discount_note: discountNote || null,
        refunded_at: null, refunded_by: null, created_at: at, updated_at: at
      };
      await col.sales().insertOne(sale, s());
    });
  } catch (error) {
    if (!supportsTransactions()) await undoDecrements(applied, saleId);
    throw error;
  }

  await logActivity(ctx, {
    action: 'sale.completed', entity: 'sale', entityId: saleId, severity: discount > 0 ? 'warn' : 'info',
    summary: `Invoice ${invoiceNo} — ${plan.length} item(s), Rs ${rupees(total)} by ${paymentMethod}`
      + (discount > 0 ? ` — discount Rs ${rupees(discount)} (${DISCOUNT_REASONS[discountReason]}${discountNote ? `: ${discountNote}` : ''})` : ''),
    meta: { invoiceNo, totalPaisa: total, discountPaisa: discount, discountReason, discountNote, paymentMethod, items: plan.length }
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return { data: await saleDetail(ctx, saleId), __status: 201 };
});

/** Without transactions: put back what a failed sale had already taken. */
async function undoDecrements(applied: Take[], saleId: string): Promise<void> {
  for (const { batch, take } of applied) {
    await col.batches().updateOne({ _id: batch.id }, [{
      $set: { quantity: { $add: ['$quantity', take] }, status: { $cond: [{ $eq: ['$status', 'finished'] }, 'active', '$status'] }, updated_at: nowIso() }
    }]);
  }
  await col.stockMovements().deleteMany({ reference_type: 'sale', reference_id: saleId });
}

async function saleDetail(ctx: PharmacyCtx, saleId: string) {
  const [sale] = await col.sales().aggregate<Sale & Document>([
    { $match: { _id: saleId, pharmacy_id: ctx.pharmacyId } },
    ...lookupField('branches', 'branch_id', 'name', 'branch_name'),
    { $lookup: { from: 'customers', localField: 'customer_id', foreignField: '_id', as: '__c', pipeline: [{ $project: { phone: 1, loyalty_points: 1 } }] } },
    { $set: { customer_phone: { $ifNull: [{ $first: '$__c.phone' }, null] }, loyalty_points: { $ifNull: [{ $first: '$__c.loyalty_points' }, null] } } },
    ...lookupField('prescriptions', 'prescription_id', 'reference', 'prescription_reference'),
    { $unset: '__c' }
  ]).toArray();
  if (!sale) return missing('That invoice could not be found.');
  const pharmacy = await col.pharmacies().findOne({ _id: ctx.pharmacyId }, { projection: { _id: 0, name: 1, address: 1, city: 1, phone: 1, ntn: 1, strn: 1, drap_licence: 1 } });
  const items = [...(sale.items as SaleItem[])].sort((a, b) => a.medicine_name.localeCompare(b.medicine_name)).map((item) => ({ ...item, sale_id: sale._id }));
  return { ...sale, items, pharmacy, footer: await getSetting(ctx.pharmacyId, 'invoice.footer') };
}

/* ============================ SALES HISTORY ============================ */

route('GET', '/api/v1/sales', 'sales.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const search = toStr(ctx.query.get('q'), 80);
  const status = toStr(ctx.query.get('status'), 20);
  const method = toStr(ctx.query.get('method'), 20);
  const from = toStr(ctx.query.get('from'), 10);
  const to = toStr(ctx.query.get('to'), 10);
  const mine = ctx.query.get('mine') === 'true';

  const match: Filter<Sale> = { pharmacy_id: ctx.pharmacyId };
  const and: Filter<Sale>[] = [];
  if (search) and.push({ $or: [{ invoice_no: contains(search) }, { customer_name: contains(search) }] });
  if (status && status !== 'all') match.status = status as Sale['status'];
  if (method && method !== 'all') match.payment_method = method;
  if (from || to) match.sold_at = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: `${to}T23:59:59.999Z` } : {}) };

  /* Everybody sees the invoices they rang up; somebody with reports.everyone
     sees every till, one person or one role. Someone who can refund may still
     open any invoice by its full number, because a customer brings back what
     another till sold. */
  const scope = await salesScope(ctx);
  if (mine) {
    match.served_by = ctx.user.id;
  } else if (scope.userId && !scope.everyone && ctx.can('sales.refund') && search) {
    and.push({ $or: [{ served_by: scope.userId }, { invoice_no: new RegExp(`^${escapeRegex(search)}$`, 'i') }] });
  } else {
    Object.assign(match, scopeMatch(scope));
  }
  if (and.length) match.$and = and;

  const [[result], [summary]] = await Promise.all([
    col.sales().aggregate<{ rows: Document[]; total: { n: number }[] }>([
      { $match: match },
      { $sort: { sold_at: -1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: size }, { $set: { line_count: { $size: '$items' }, unit_count: { $sum: '$items.quantity' } } }, { $project: { items: 0 } }],
          total: [{ $count: 'n' }]
        }
      }
    ]).toArray(),
    col.sales().aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$total_paisa', 0] } },
          profit: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, { $subtract: ['$total_paisa', '$cost_paisa'] }, 0] } },
          refunded: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, '$total_paisa', 0] } },
          discount: { $sum: '$discount_paisa' },
          invoices: { $sum: 1 }
        }
      },
      { $project: { _id: 0 } }
    ]).toArray()
  ]);
  return {
    ...pageResult(result?.rows ?? [], result?.total[0]?.n ?? 0, { page, size }),
    summary: summary ?? { revenue: 0, profit: 0, refunded: 0, discount: 0, invoices: 0 },
    scope: { everyone: scope.everyone, person: scope.person }
  };
});

route('GET', '/api/v1/sales/:id', 'sales.read', async (ctx) => {
  const sale = await saleDetail(ctx, ctx.params.id);
  /* Someone who sees only their own sales may open their own invoices — and,
     if they can refund, any invoice, for the returns desk. */
  if (!ctx.can('reports.everyone') && !ctx.can('sales.refund') && sale.served_by !== ctx.user.id) missing('That invoice could not be found.');
  return { data: sale };
});

route('POST', '/api/v1/sales/:id/refund', 'sales.refund', async (ctx) => {
  const sale = await col.sales().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!sale) return missing('That invoice could not be found.');
  if (sale.status === 'refunded') bad('That invoice has already been refunded.');
  if (sale.status !== 'completed') bad('Only a completed invoice can be refunded.');
  const reason = toStr(ctx.body.reason, 200);
  if (!reason) bad('A reason is required for every refund.', 'reason');

  const at = nowIso();
  const restocked = { shelf: 0, held: 0 };
  await tx(async () => {
    /* Claim the invoice first, so two refunds of the same sale cannot both
       put the stock back. */
    const claimed = await col.sales().findOneAndUpdate(
      { _id: sale.id, status: 'completed' },
      { $set: { status: 'refunded', refunded_at: at, refunded_by: ctx.user.id, refund_reason: reason, notes: `${sale.notes || ''}\nRefunded: ${reason}`.trim(), updated_at: at } },
      { returnDocument: 'after', ...s() }
    );
    if (!claimed) bad('That invoice has already been refunded.');

    for (const item of sale.items) {
      if (!item.batch_id) continue;
      const batch = await col.batches().findOne({ _id: item.batch_id }, s());
      if (!batch) continue;
      /* A refund puts units back in the building; whether they go back on the
         shelf is a different question. Not when the batch has expired since,
         has been quarantined (a recall, damage) or written off — releasing
         held stock is a deliberate act with its own audit entry. */
      const expired = batch.expiry_date <= today();
      const held = batch.status === 'quarantined' || batch.status === 'written-off';
      const shelf = !expired && !held;
      restocked[shelf ? 'shelf' : 'held'] += item.quantity;
      const why = expired ? 'batch expired' : batch.status === 'written-off' ? 'batch written off' : 'batch quarantined';
      const after = await col.batches().findOneAndUpdate(
        { _id: batch.id },
        [{
          $set: {
            quantity: { $add: ['$quantity', item.quantity] }, status: shelf ? 'active' : 'quarantined', updated_at: at,
            quarantine_note: shelf ? null : { $ifNull: ['$quarantine_note', `Returned on invoice ${sale.invoice_no} — held because the ${why}`] }
          }
        }],
        { returnDocument: 'after', ...s() }
      );
      await recordMovement({
        pharmacyId: ctx.pharmacyId, medicineId: item.medicine_id ?? batch.medicine_id, batchId: batch.id, type: 'refund', delta: item.quantity,
        balanceAfter: after?.quantity ?? 0, referenceType: 'sale', referenceId: sale.id,
        reason: `Refund of invoice ${sale.invoice_no}: ${reason}${shelf ? '' : ` (${why}, returned units quarantined)`}`, userId: ctx.user.id, at
      });
    }

    if (sale.customer_id && sale.payment_method === 'credit') {
      /* Only a credit sale put money on the account, so only a credit sale
         takes it off again — floored at zero. */
      await col.customers().updateOne({ _id: sale.customer_id }, [{
        $set: { balance_paisa: { $max: [0, { $subtract: ['$balance_paisa', sale.total_paisa] }] }, updated_at: at }
      }], s());
    }
  });

  await logActivity(ctx, {
    action: 'sale.refunded', entity: 'sale', entityId: sale.id, severity: 'warn',
    summary: `Invoice ${sale.invoice_no} refunded (Rs ${rupees(sale.total_paisa)}) — ${reason}`
  });
  await refreshStockAlerts(ctx.pharmacyId);
  return {
    data: await saleDetail(ctx, sale.id),
    restocked,
    message: restocked.held > 0
      ? `Refunded. ${restocked.shelf} unit(s) are back on the shelf; ${restocked.held} unit(s) are quarantined because the batch is expired, on hold or written off — check the expiry screen before they are sold again.`
      : `Refunded. ${restocked.shelf} unit(s) are back on the shelf.`
  };
});

/* =============================== CUSTOMERS =============================== */

route('GET', '/api/v1/customers', 'customers.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const search = toStr(ctx.query.get('q'), 80);
  const status = toStr(ctx.query.get('status'), 20);
  const match: Filter<Customer> = { pharmacy_id: ctx.pharmacyId };
  if (status && status !== 'all') match.status = status;
  else if (!status) match.status = { $ne: 'archived' };
  if (search) {
    const pattern = contains(search);
    match.$or = [{ name: pattern }, { phone: pattern }, { cnic: pattern }];
  }
  const [rows, total] = await Promise.all([
    col.customers().aggregate([
      { $match: match },
      { $sort: { name: 1 } },
      { $skip: skip },
      { $limit: size },
      {
        $lookup: {
          from: 'sales', localField: '_id', foreignField: 'customer_id', as: '__s',
          pipeline: [{ $match: { status: 'completed' } }, { $group: { _id: null, visits: { $sum: 1 }, spend: { $sum: '$total_paisa' }, last: { $max: '$sold_at' } } }]
        }
      },
      { $set: { visits: { $ifNull: [{ $first: '$__s.visits' }, 0] }, total_spend_paisa: { $ifNull: [{ $first: '$__s.spend' }, 0] }, last_visit: { $ifNull: [{ $first: '$__s.last' }, null] } } },
      { $unset: '__s' }
    ]).toArray(),
    col.customers().countDocuments(match)
  ]);
  return pageResult(rows, total, { page, size });
});

route('GET', '/api/v1/customers/:id', 'customers.read', async (ctx) => {
  const customer = await col.customers().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!customer) return missing('That customer could not be found.');
  const [sales, prescriptions, stats, payments] = await Promise.all([
    col.sales().find({ customer_id: customer.id }, { projection: { invoice_no: 1, sold_at: 1, total_paisa: 1, payment_method: 1, status: 1 } })
      .sort({ sold_at: -1 }).limit(25).toArray(),
    col.prescriptions().find({ customer_id: customer.id }, { projection: { reference: 1, doctor_name: 1, prescription_date: 1, status: 1 } })
      .sort({ prescription_date: -1 }).limit(15).toArray(),
    col.sales().aggregate([
      { $match: { customer_id: customer.id, status: 'completed' } },
      { $group: { _id: null, visits: { $sum: 1 }, spend: { $sum: '$total_paisa' }, average: { $avg: '$total_paisa' } } },
      { $project: { _id: 0 } }
    ]).toArray(),
    /* Udhaar coming back, so the screen shows both sides of the account. */
    col.customerPayments().find({ customer_id: customer.id }, {
      projection: { receipt_no: 1, amount_paisa: 1, payment_method: 1, received_at: 1, received_by_name: 1, reversed_at: 1, balance_after_paisa: 1 }
    }).sort({ received_at: -1 }).limit(25).toArray()
  ]);
  return {
    data: {
      ...customer,
      sales: sales.map((row) => ({ ...row, id: row._id })),
      prescriptions: prescriptions.map((row) => ({ ...row, id: row._id })),
      stats: stats[0] ?? { visits: 0, spend: 0, average: 0 },
      payments: payments.map((row) => ({ ...row, id: row._id }))
    }
  };
});

function customerPayload(ctx: PharmacyCtx, existing: Customer | null) {
  const body = ctx.body;
  const text = (key: string, max: number, current: string | null | undefined) =>
    body[key] !== undefined ? toStr(body[key], max) || null : current ?? null;
  const name = toStr(body.name, 120) || existing?.name;
  if (!name) return bad('Enter the customer name.', 'name');
  const phone = text('phone', 40, existing?.phone);
  if (phone && !isPkPhone(phone)) bad('Enter a valid Pakistani mobile number, for example +92 300 1234567.', 'phone');
  const cnic = text('cnic', 20, existing?.cnic);
  if (cnic && !isCnic(cnic)) bad('Enter the CNIC as 12345-1234567-1.', 'cnic');
  const email = text('email', 160, existing?.email);
  if (email && !isEmail(email)) bad('That email address does not look right.', 'email');
  const dob = text('dateOfBirth', 10, existing?.date_of_birth);
  if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob > today())) bad('Enter the date of birth as YYYY-MM-DD, not in the future.', 'dateOfBirth');
  const status = toStr(body.status, 20) || existing?.status || 'active';
  if (!['active', 'inactive', 'archived'].includes(status)) bad('Choose a valid status.', 'status');
  return {
    name, phone, cnic, email,
    address: text('address', 300, existing?.address),
    city: toStr(body.city, 80) || existing?.city || 'Karachi',
    date_of_birth: dob,
    gender: text('gender', 20, existing?.gender),
    allergies: text('allergies', 300, existing?.allergies),
    chronic_notes: text('chronicNotes', 400, existing?.chronic_notes),
    credit_limit_paisa: Math.max(0, toInt(body.creditLimitPaisa, existing?.credit_limit_paisa ?? 0)),
    status
  };
}

async function phoneTaken(pharmacyId: string, phone: string | null, exceptId?: string): Promise<boolean> {
  if (!phone) return false;
  const filter: Filter<Customer> = { pharmacy_id: pharmacyId, phone, status: { $ne: 'archived' } };
  if (exceptId) filter._id = { $ne: exceptId };
  return !!(await col.customers().findOne(filter, { projection: { _id: 1 } }));
}

route('POST', '/api/v1/customers', 'customers.write', async (ctx) => {
  const payload = customerPayload(ctx, null);
  if (await phoneTaken(ctx.pharmacyId, payload.phone)) bad('A customer with that phone number already exists.', 'phone');
  const id = uid('CUS');
  const at = nowIso();
  const customer: Customer = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, ...payload, loyalty_points: 0, balance_paisa: 0, opening_balance_paisa: 0, created_at: at, updated_at: at
  };
  await col.customers().insertOne(customer);
  await logActivity(ctx, { action: 'customer.created', entity: 'customer', entityId: id, summary: `Customer "${payload.name}" registered` });
  return { data: customer, __status: 201 };
});

route('PATCH', '/api/v1/customers/:id', 'customers.write', async (ctx) => {
  const existing = await col.customers().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That customer could not be found.');
  const payload = customerPayload(ctx, existing);
  if (await phoneTaken(ctx.pharmacyId, payload.phone, existing.id)) bad('A customer with that phone number already exists.', 'phone');
  if (payload.status === 'archived' && existing.balance_paisa > 0) bad(`${existing.name} still owes Rs ${rupees(existing.balance_paisa)}. Settle the balance first.`, 'status');
  const updated = await col.customers().findOneAndUpdate({ _id: existing.id }, { $set: { ...payload, updated_at: nowIso() } }, { returnDocument: 'after' });
  await logActivity(ctx, { action: 'customer.updated', entity: 'customer', entityId: existing.id, summary: `Customer "${payload.name}" updated` });
  return { data: updated };
});

route('DELETE', '/api/v1/customers/:id', 'customers.write', async (ctx) => {
  const existing = await col.customers().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!existing) return missing('That customer could not be found.');
  if (existing.balance_paisa > 0) bad(`${existing.name} still owes Rs ${rupees(existing.balance_paisa)}. Settle the balance first.`);
  /* Invoices and prescriptions name the customer, so the record is archived. */
  await col.customers().updateOne({ _id: existing.id }, { $set: { status: 'archived', updated_at: nowIso() } });
  await logActivity(ctx, { action: 'customer.archived', entity: 'customer', entityId: existing.id, severity: 'warn', summary: `Customer "${existing.name}" archived` });
  return { ok: true };
});

/* ============================= PRESCRIPTIONS ============================= */

const prescriptionPeople = (): Document[] => [
  { $lookup: { from: 'customers', localField: 'customer_id', foreignField: '_id', as: '__c', pipeline: [{ $project: { name: 1, phone: 1, allergies: 1, chronic_notes: 1 } }] } },
  {
    $set: {
      customer_name: { $ifNull: [{ $first: '$__c.name' }, null] }, customer_phone: { $ifNull: [{ $first: '$__c.phone' }, null] },
      allergies: { $ifNull: [{ $first: '$__c.allergies' }, null] }, chronic_notes: { $ifNull: [{ $first: '$__c.chronic_notes' }, null] }
    }
  },
  ...lookupField('users', 'verified_by', 'full_name', 'verified_by_name'),
  ...lookupField('users', 'dispensed_by', 'full_name', 'dispensed_by_name'),
  { $unset: '__c' }
];

route('GET', '/api/v1/prescriptions', 'prescriptions.read', async (ctx) => {
  const { page, size, skip } = paging(ctx);
  const status = toStr(ctx.query.get('status'), 20);
  const search = toStr(ctx.query.get('q'), 80);
  const match: Filter<Prescription> = { pharmacy_id: ctx.pharmacyId };
  if (status && status !== 'all') match.status = status;
  if (search) {
    const pattern = contains(search);
    match.$or = [{ reference: pattern }, { patient_name: pattern }, { doctor_name: pattern }];
  }
  const [rows, total, counted] = await Promise.all([
    col.prescriptions().aggregate([
      { $match: match },
      { $sort: { prescription_date: -1, created_at: -1 } },
      { $skip: skip },
      { $limit: size },
      ...prescriptionPeople(),
      { $set: { item_count: { $size: '$items' } } },
      { $project: { items: 0, chronic_notes: 0 } }
    ]).toArray(),
    col.prescriptions().countDocuments(match),
    col.prescriptions().aggregate<{ _id: string; n: number }>([
      { $match: { pharmacy_id: ctx.pharmacyId } }, { $group: { _id: '$status', n: { $sum: 1 } } }
    ]).toArray()
  ]);
  const counts = { pending: 0, verified: 0, dispensed: 0, rejected: 0 } as Record<string, number>;
  for (const row of counted) counts[row._id] = row.n;
  return { ...pageResult(rows, total, { page, size }), counts };
});

route('GET', '/api/v1/prescriptions/:id', 'prescriptions.read', async (ctx) => {
  const [rx] = await col.prescriptions().aggregate([
    { $match: { _id: ctx.params.id, pharmacy_id: ctx.pharmacyId } },
    ...prescriptionPeople(),
    ...lookupField('sales', 'sale_id', 'invoice_no', 'invoice_no')
  ]).toArray();
  if (!rx) return missing('That prescription could not be found.');
  const lines = rx.items as PrescriptionItem[];
  const ids = lines.map((item) => item.medicine_id).filter((id): id is string => !!id);
  const [catalogue, stock] = await Promise.all([
    col.medicines().find({ _id: { $in: ids } }, { projection: { name: 1, price_paisa: 1, requires_prescription: 1 } }).toArray(),
    onHandMap(ctx.pharmacyId, ids)
  ]);
  const byId = new Map(catalogue.map((m) => [m._id, m]));
  const items = lines.map((item) => {
    const medicine = item.medicine_id ? byId.get(item.medicine_id) : undefined;
    return {
      ...item, prescription_id: rx._id, catalogue_name: medicine?.name ?? null, price_paisa: medicine?.price_paisa ?? null,
      requires_prescription: medicine?.requires_prescription ?? null, on_hand: item.medicine_id ? stock.get(item.medicine_id) ?? 0 : 0
    };
  });
  return { data: { ...rx, items } };
});

async function readPrescriptionItems(ctx: PharmacyCtx): Promise<PrescriptionItem[]> {
  const items: Record<string, unknown>[] = Array.isArray(ctx.body.items) ? ctx.body.items : [];
  if (!items.length) bad('Add at least one prescribed medicine.', 'items');
  if (items.length > 50) bad('A prescription cannot hold more than 50 lines.', 'items');
  const ids = items.map((item) => toStr(item.medicineId, 40)).filter(Boolean);
  const known = new Set((await col.medicines().find({ _id: { $in: ids }, pharmacy_id: ctx.pharmacyId }, { projection: { _id: 1 } }).toArray()).map((m) => m._id));
  return items.map((item) => {
    const text = toStr(item.medicineText, 140);
    if (!text) bad('Every prescribed line needs a medicine name.', 'items');
    const medicineId = toStr(item.medicineId, 40) || null;
    return {
      id: randomUUID(), medicine_id: medicineId && known.has(medicineId) ? medicineId : null, medicine_text: text,
      dosage: toStr(item.dosage, 120) || null, duration: toStr(item.duration, 60) || null, quantity: Math.max(1, toInt(item.quantity, 1))
    };
  });
}

route('POST', '/api/v1/prescriptions', 'prescriptions.read', async (ctx) => {
  const customerId = toStr(ctx.body.customerId, 40) || null;
  if (customerId && !await col.customers().findOne({ _id: customerId, pharmacy_id: ctx.pharmacyId }, { projection: { _id: 1 } })) {
    bad('That customer could not be found.', 'customerId');
  }
  const doctor = toStr(ctx.body.doctorName, 120);
  if (!doctor) bad('Enter the prescribing doctor name.', 'doctorName');
  const items = await readPrescriptionItems(ctx);
  const date = toStr(ctx.body.prescriptionDate, 10) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) bad('Enter the prescription date as YYYY-MM-DD, not in the future.', 'prescriptionDate');

  const id = uid('RX');
  const at = nowIso();
  const reference = await nextNumber(ctx.pharmacyId, 'prescription', 'KSF-RX');
  const prescription: Prescription = {
    _id: id, id, pharmacy_id: ctx.pharmacyId, customer_id: customerId, reference, patient_name: toStr(ctx.body.patientName, 120) || 'Patient',
    doctor_name: doctor, hospital: toStr(ctx.body.hospital, 140) || null, pmdc_number: toStr(ctx.body.pmdcNumber, 40) || null,
    prescription_date: date, status: 'pending', notes: toStr(ctx.body.notes, 500) || null, items, verified_by: null, verified_at: null,
    dispensed_by: null, dispensed_at: null, sale_id: null, created_by: ctx.user.id, created_at: at, updated_at: at
  };
  await col.prescriptions().insertOne(prescription);
  await logActivity(ctx, { action: 'prescription.created', entity: 'prescription', entityId: id, summary: `Prescription ${reference} recorded from ${doctor}` });
  return { data: prescription, __status: 201 };
});

/** A prescription can be corrected until a pharmacist has decided on it. */
route('PATCH', '/api/v1/prescriptions/:id', 'prescriptions.read', async (ctx) => {
  const rx = await col.prescriptions().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!rx) return missing('That prescription could not be found.');
  if (rx.status !== 'pending') bad(`That prescription is already ${rx.status} and can no longer be edited.`);
  const set: Partial<Prescription> = { updated_at: nowIso() };
  if (ctx.body.doctorName !== undefined) {
    set.doctor_name = toStr(ctx.body.doctorName, 120);
    if (!set.doctor_name) bad('Enter the prescribing doctor name.', 'doctorName');
  }
  if (ctx.body.patientName !== undefined) set.patient_name = toStr(ctx.body.patientName, 120) || 'Patient';
  if (ctx.body.hospital !== undefined) set.hospital = toStr(ctx.body.hospital, 140) || null;
  if (ctx.body.pmdcNumber !== undefined) set.pmdc_number = toStr(ctx.body.pmdcNumber, 40) || null;
  if (ctx.body.notes !== undefined) set.notes = toStr(ctx.body.notes, 500) || null;
  if (ctx.body.prescriptionDate !== undefined) set.prescription_date = toStr(ctx.body.prescriptionDate, 10) || rx.prescription_date;
  if (Array.isArray(ctx.body.items)) set.items = await readPrescriptionItems(ctx);
  const updated = await col.prescriptions().findOneAndUpdate({ _id: rx.id, status: 'pending' }, { $set: set }, { returnDocument: 'after' });
  if (!updated) bad('That prescription was verified or rejected while you were editing it.');
  await logActivity(ctx, { action: 'prescription.updated', entity: 'prescription', entityId: rx.id, summary: `Prescription ${rx.reference} corrected` });
  return { data: updated };
});

route('POST', '/api/v1/prescriptions/:id/verify', 'prescriptions.verify', async (ctx) => {
  const rx = await col.prescriptions().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!rx) return missing('That prescription could not be found.');
  if (rx.status !== 'pending') bad(`That prescription is already ${rx.status}.`);
  const at = nowIso();
  const updated = await col.prescriptions().findOneAndUpdate(
    { _id: rx.id, status: 'pending' },
    { $set: { status: 'verified', verified_by: ctx.user.id, verified_at: at, notes: toStr(ctx.body.notes, 500) || rx.notes, updated_at: at } },
    { returnDocument: 'after' }
  );
  if (!updated) bad('Another pharmacist decided on that prescription a moment ago.');
  await logActivity(ctx, { action: 'prescription.verified', entity: 'prescription', entityId: rx.id, summary: `Prescription ${rx.reference} verified by ${ctx.user.full_name}` });
  return { data: updated };
});

route('POST', '/api/v1/prescriptions/:id/reject', 'prescriptions.verify', async (ctx) => {
  const rx = await col.prescriptions().findOne({ _id: ctx.params.id, pharmacy_id: ctx.pharmacyId });
  if (!rx) return missing('That prescription could not be found.');
  if (rx.status === 'dispensed') bad('That prescription has already been dispensed.');
  if (rx.status === 'rejected') bad('That prescription is already rejected.');
  const reason = toStr(ctx.body.reason, 300);
  if (!reason) bad('Explain why the prescription is being rejected.', 'reason');
  const at = nowIso();
  const updated = await col.prescriptions().findOneAndUpdate(
    { _id: rx.id, status: { $in: ['pending', 'verified'] } },
    { $set: { status: 'rejected', verified_by: ctx.user.id, verified_at: at, notes: `${rx.notes || ''}\nRejected: ${reason}`.trim(), updated_at: at } },
    { returnDocument: 'after' }
  );
  if (!updated) bad('That prescription was dispensed while you were rejecting it.');
  await logActivity(ctx, { action: 'prescription.rejected', entity: 'prescription', entityId: rx.id, severity: 'warn', summary: `Prescription ${rx.reference} rejected — ${reason}` });
  return { data: updated };
});
