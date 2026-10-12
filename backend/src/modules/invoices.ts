/* ==========================================================================
   Invoices and receipts for subscription payments
   --------------------------------------------------------------------------
   Every payment that succeeded is an invoice with its own number (numbered
   in services/subscriptions.ts as it is recorded). These endpoints return
   the whole document — who sold, who bought, what for, what was paid and
   refunded — so the web app can show it and print it, and the platform's
   finance team sees exactly what the pharmacy sees.
   ========================================================================== */

import { BUSINESS } from '../config/env.js';
import { col } from '../db/mongo.js';
import { missing } from '../core/errors.js';
import { toStr } from '../core/util.js';
import { platformRoute, route } from '../http/router.js';
import { adapterFor } from '../services/payments/index.js';
import { pageResult, paging } from './shared.js';

const INVOICED = ['succeeded', 'refunded'];

const KINDS: Record<string, string> = { checkout: 'Subscription', renewal: 'Renewal', manual: 'Payment recorded by KSF', upgrade: 'Plan change' };

async function invoiceDocument(paymentId: string, pharmacyId?: string) {
  const payment = await col.subscriptionPayments().findOne({ _id: toStr(paymentId, 60), status: { $in: INVOICED }, ...(pharmacyId ? { pharmacy_id: pharmacyId } : {}) });
  if (!payment) return missing('That invoice could not be found.');
  const pharmacy = await col.pharmacies().findOne({ _id: payment.pharmacy_id });
  const refunded = payment.refunded_paisa ?? 0;
  return {
    id: payment.id,
    number: payment.invoice_no ?? `KSF-${payment.id.slice(0, 8).toUpperCase()}`,
    issuedAt: payment.paid_at ?? payment.created_at,
    status: refunded >= payment.amount_paisa ? 'refunded' : refunded > 0 ? 'partly-refunded' : 'paid',
    currency: payment.currency,
    seller: {
      name: BUSINESS.legalName || 'KSF Pharmacy Management System', address: BUSINESS.address, city: BUSINESS.city, country: BUSINESS.country,
      phone: BUSINESS.phone, email: BUSINESS.supportEmail, website: BUSINESS.website, ntn: BUSINESS.ntn, strn: BUSINESS.strn
    },
    buyer: {
      name: pharmacy?.name ?? 'Pharmacy', legalName: pharmacy?.legal_name ?? null, address: pharmacy?.address ?? null, city: pharmacy?.city ?? null,
      province: pharmacy?.province ?? null, phone: pharmacy?.phone ?? null, email: pharmacy?.email ?? null, ntn: pharmacy?.ntn ?? null, strn: pharmacy?.strn ?? null
    },
    lines: [{
      description: `KSF ${payment.plan_name ?? payment.plan_key ?? ''} plan — ${KINDS[payment.kind] ?? 'Subscription'}`.replace(/\s+/g, ' '),
      periodStart: payment.period_start, periodEnd: payment.period_end, quantity: 1, amountPaisa: payment.amount_paisa
    }],
    totals: { subtotalPaisa: payment.amount_paisa, totalPaisa: payment.amount_paisa, paidPaisa: payment.amount_paisa, refundedPaisa: refunded },
    payment: {
      method: payment.method, provider: adapterFor(payment.provider)?.label ?? (payment.provider === 'manual' ? 'Recorded by KSF' : payment.provider),
      reference: payment.provider_reference, statementReference: payment.statement_reference, paidAt: payment.paid_at
    }
  };
}

/* The pharmacy's own invoices, newest first. */
route('GET', '/api/v1/billing/invoices', 'settings.read', async (ctx) => {
  const { page, size, skip } = paging(ctx, 25);
  const filter = { pharmacy_id: ctx.pharmacyId, status: { $in: INVOICED } };
  const [rows, total] = await Promise.all([
    col.subscriptionPayments().find(filter, {
      projection: {
        _id: 0, id: 1, invoice_no: 1, plan_name: 1, kind: 1, amount_paisa: 1, refunded_paisa: 1, currency: 1, status: 1, method: 1,
        provider: 1, period_start: 1, period_end: 1, paid_at: 1, created_at: 1
      }
    }).sort({ paid_at: -1, created_at: -1 }).skip(skip).limit(size).toArray(),
    col.subscriptionPayments().countDocuments(filter)
  ]);
  return pageResult(rows, total, { page, size });
});

route('GET', '/api/v1/billing/invoices/:id', 'settings.read', async (ctx) => ({ data: await invoiceDocument(ctx.params.id, ctx.pharmacyId) }));

/* The same document for the platform's finance team. */
platformRoute('GET', '/api/v1/platform/invoices/:id', 'platform.finance.view', async (ctx) => ({ data: await invoiceDocument(ctx.params.id) }));
