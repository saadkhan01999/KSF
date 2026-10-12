/* A subscription invoice: on screen in a dialog, and on A4 when printed or
   saved as a PDF. The pharmacy opens its own from Billing; the platform's
   finance team opens any from Income. */

import { Printer, Receipt } from 'lucide-react';
import { useApiData } from '../hooks/useApi';
import { Badge, Button, Modal, TableSkeleton } from './ui';
import { PrintSheet, printSheet } from './print';
import { date, payment, rupees } from '../utils/format';

export interface InvoiceDocument {
  id: string; number: string; issuedAt: string; status: 'paid' | 'refunded' | 'partly-refunded'; currency: string;
  seller: { name: string; address: string; city: string; country: string; phone: string; email: string; website: string; ntn: string; strn: string };
  buyer: { name: string; legalName: string | null; address: string | null; city: string | null; province: string | null; phone: string | null; email: string | null; ntn: string | null; strn: string | null };
  lines: { description: string; periodStart: string | null; periodEnd: string | null; quantity: number; amountPaisa: number }[];
  totals: { subtotalPaisa: number; totalPaisa: number; paidPaisa: number; refundedPaisa: number };
  payment: { method: string | null; provider: string | null; reference: string | null; statementReference: string | null; paidAt: string | null };
}

const STATUS: Record<InvoiceDocument['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  paid: { label: 'Paid', tone: 'ok' },
  'partly-refunded': { label: 'Partly refunded', tone: 'warn' },
  refunded: { label: 'Refunded', tone: 'neutral' }
};

const lines = (...values: Array<string | null | undefined>) => values.filter(Boolean).join(', ');

function InvoiceBody({ invoice }: { invoice: InvoiceDocument }) {
  const { seller, buyer, totals } = invoice;
  return (
    <div className="invoice">
      <div className="invoice-parties">
        <div>
          <span className="invoice-lbl">From</span>
          <strong>{seller.name}</strong>
          {lines(seller.address, seller.city, seller.country) && <span>{lines(seller.address, seller.city, seller.country)}</span>}
          {(seller.phone || seller.email) && <span>{lines(seller.phone, seller.email)}</span>}
          {seller.ntn && <span>NTN {seller.ntn}{seller.strn ? ` · STRN ${seller.strn}` : ''}</span>}
        </div>
        <div>
          <span className="invoice-lbl">Billed to</span>
          <strong>{buyer.legalName || buyer.name}</strong>
          {buyer.legalName && buyer.legalName !== buyer.name && <span>{buyer.name}</span>}
          {lines(buyer.address, buyer.city, buyer.province) && <span>{lines(buyer.address, buyer.city, buyer.province)}</span>}
          {(buyer.phone || buyer.email) && <span>{lines(buyer.phone, buyer.email)}</span>}
          {buyer.ntn && <span>NTN {buyer.ntn}</span>}
        </div>
      </div>

      <dl className="kv invoice-meta">
        <dt>Invoice number</dt><dd className="mono">{invoice.number}</dd>
        <dt>Date</dt><dd>{date(invoice.issuedAt)}</dd>
        <dt>Status</dt><dd><Badge tone={STATUS[invoice.status].tone} dot={false}>{STATUS[invoice.status].label}</Badge></dd>
        <dt>Paid with</dt>
        <dd>{lines(invoice.payment.provider, invoice.payment.method ? payment(invoice.payment.method) : null)}</dd>
        {invoice.payment.reference && <><dt>Reference</dt><dd className="mono t-sm">{invoice.payment.reference}</dd></>}
      </dl>

      <div className="table-scroll">
        <table className="tbl invoice-lines">
          <thead><tr><th>Description</th><th>Period</th><th className="t-right">Amount</th></tr></thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.description}>
                <td>{line.description}</td>
                <td className="t-sm">{line.periodStart && line.periodEnd ? `${date(line.periodStart)} – ${date(line.periodEnd)}` : '—'}</td>
                <td className="t-right num">{rupees(line.amountPaisa, { decimals: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="invoice-totals">
        <div><span>Total</span><b className="num">{rupees(totals.totalPaisa, { decimals: true })}</b></div>
        <div><span>Paid</span><span className="num">{rupees(totals.paidPaisa, { decimals: true })}</span></div>
        {totals.refundedPaisa > 0 && <div><span>Refunded</span><span className="num">−{rupees(totals.refundedPaisa, { decimals: true })}</span></div>}
      </div>
      <p className="invoice-note">A computer-generated invoice for a KSF subscription; no signature is needed. Amounts are in Pakistani rupees ({invoice.currency}).</p>
    </div>
  );
}

export function InvoiceDialog({ paymentId, source = 'pharmacy', onClose }: { paymentId: string | null; source?: 'pharmacy' | 'platform'; onClose: () => void }) {
  const path = paymentId ? `${source === 'platform' ? '/platform' : '/billing'}/invoices/${encodeURIComponent(paymentId)}` : null;
  const { data } = useApiData<{ data: InvoiceDocument }>(path, [path]);
  const invoice = data?.data.id === paymentId ? data.data : null;

  return (
    <Modal
      open={!!paymentId}
      onClose={onClose}
      size="lg"
      icon={<Receipt />}
      title={invoice ? `Invoice ${invoice.number}` : 'Invoice'}
      subtitle={invoice ? `${invoice.buyer.name} · ${date(invoice.issuedAt)}` : undefined}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<Printer size={17} />} onClick={printSheet} disabled={!invoice}>Print or save as PDF</Button>
        </>
      )}
    >
      {invoice ? <InvoiceBody invoice={invoice} /> : <TableSkeleton rows={4} columns={3} />}
      {invoice && (
        <PrintSheet title={`Invoice ${invoice.number}`} subtitle={`Issued ${date(invoice.issuedAt)}`}>
          <InvoiceBody invoice={invoice} />
        </PrintSheet>
      )}
    </Modal>
  );
}
