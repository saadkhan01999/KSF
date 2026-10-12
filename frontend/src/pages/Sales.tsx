/* Sales history: every invoice, with the batch each item came from.

   A cashier without reporting rights only ever sees their own till here — the
   server applies that rule, this screen just explains it. */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Receipt, Download, Eye, Printer, RotateCcw, Coins, TrendingUp,
  Percent, CircleAlert, Filter
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, StatCard, StatusBadge, Modal, ConfirmDialog, EmptyState,
  TableSkeleton, Pager, Allow, Alert, Badge
} from '../components/ui';
import { Receipt as ReceiptView } from './Pos';
import {
  rupees, rupeesShort, number, dateTime, date, payment, PAYMENT_LABELS,
  isoDaysAgo, todayIso, downloadCsv
} from '../utils/format';
import type { Paged, Sale, FigureScope } from '../types';
import { StaffPicker } from '../components/StaffPicker';

interface SalesResponse extends Paged<Sale> {
  summary: { revenue: number; profit: number; refunded: number; discount: number; invoices: number };
  scope?: FigureScope;
}

/* What the server reports after a refund: how many units went back on the
   shelf, and how many are held because the batch is no longer sellable. */
interface RefundResult {
  restocked: { shelf: number; held: number };
  message: string;
}

export default function Sales() {
  const { ok, can, workspace } = useApp();
  const reasonLabel = (key?: string | null) => (key
    ? workspace?.discountReasons?.find((r) => r.value === key)?.label ?? key
    : 'No reason was recorded for this sale.');
  const { busy, run } = useAction();
  const [params] = useSearchParams();

  const [term, setTerm] = useState(params.get('invoice') ?? '');
  const search = useDebounced(term);
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  /* A link can open one day or one period (the accounts link a day's takings here). */
  const day = (key: string) => (/^\d{4}-\d{2}-\d{2}$/.test(params.get(key) ?? '') ? params.get(key)! : null);
  const [from, setFrom] = useState(day('from') ?? isoDaysAgo(29));
  const [to, setTo] = useState(day('to') ?? todayIso());
  const [mine, setMine] = useState(false);
  /* The Admin can look at one person's till, or every till in one role. */
  const [staff, setStaff] = useState('');
  const [page, setPage] = useState(1);

  const [viewing, setViewing] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<Sale | null>(null);

  const path = `/sales${query({ q: search, status, method, from, to, mine, staff, page, size: 25 })}`;
  const { data, loading, reload } = useApiData<SalesResponse>(path, [search, status, method, from, to, mine, staff, page]);
  const { data: detail } = useApiData<{ data: Sale }>(viewing ? `/sales/${viewing}` : null, [viewing]);

  useEffect(() => { setPage(1); }, [search, status, method, from, to, mine, staff]);

  const summary = data?.summary;
  /* Everybody sees the invoices they rang up; the Admin sees every till.
     The server applies the same rule. */
  const ownOnly = !can('reports.everyone');
  const scopePerson = data?.scope?.person ?? null;

  const exportCsv = () => {
    if (!data?.data.length) return;
    downloadCsv(`ksf-sales-${from}-to-${to}`, data.data.map((sale) => ({
      Invoice: sale.invoice_no, Date: date(sale.sold_at), Customer: sale.customer_name,
      'Served by': sale.served_by_name, Payment: payment(sale.payment_method),
      Items: sale.line_count, Units: sale.unit_count,
      'Discount (Rs)': sale.discount_paisa / 100,
      'Discount reason': sale.discount_paisa > 0 && sale.discount_reason ? reasonLabel(sale.discount_reason) : '',
      'Total (Rs)': sale.total_paisa / 100,
      Status: sale.status
    })));
    ok('Exported', 'Your sales list has been saved as a CSV file.');
  };

  const preset = (days: number) => { setFrom(isoDaysAgo(days)); setTo(todayIso()); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sales history</h1>
          <p className="sub">
            {ownOnly
              ? `The invoices you rang up.${can('sales.refund') ? ' To refund a sale from another till, search its full invoice number.' : ''}`
              : scopePerson
                ? `Invoices ${scopePerson.name} rang up${scopePerson.role ? ` (${scopePerson.role})` : ''}.`
                : 'Every invoice, with the batch each item was taken from.'}
          </p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>
            Export
          </Button>
        </div>
      </div>

      <Allow permission="reports.view">
        <div className="grid grid-4 mb-5">
          <StatCard label="Takings in this period" value={rupeesShort(summary?.revenue ?? 0)} icon={<Coins size={20} />} hint={`${number(summary?.invoices ?? 0)} invoices`} tone="gold" />
          <StatCard label="Gross profit" value={rupeesShort(summary?.profit ?? 0)} icon={<TrendingUp size={20} />} hint="sales less cost of stock" />
          <StatCard label="Discounts given" value={rupeesShort(summary?.discount ?? 0)} icon={<Percent size={20} />} tone="info" />
          <StatCard label="Refunded" value={rupeesShort(summary?.refunded ?? 0)} icon={<RotateCcw size={20} />} tone="danger" />
        </div>
      </Allow>

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by invoice number or customer…" />
        <input className="input" style={{ width: 'auto' }} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input" style={{ width: 'auto' }} type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
          <option value="all">Any payment method</option>
          {Object.entries(PAYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All invoices</option>
          <option value="completed">Completed</option>
          <option value="refunded">Refunded</option>
        </select>
        <StaffPicker value={staff} onChange={(next) => { setStaff(next); setMine(false); }} everyoneLabel="Every till" />
      </div>

      <div className="row wrap mb-4" style={{ gap: 8 }}>
        <button className="chip" onClick={() => preset(0)}>Today</button>
        <button className="chip" onClick={() => preset(6)}>Last 7 days</button>
        <button className="chip" onClick={() => preset(29)}>Last 30 days</button>
        <button className="chip" onClick={() => preset(89)}>Last 3 months</button>
        {!ownOnly && !staff && (
          <button className={`chip ${mine ? 'is-on' : ''}`} onClick={() => setMine((v) => !v)}>
            <Filter size={14} /> Only my sales
          </button>
        )}
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={6} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<Receipt size={30} />}
                title="No invoices in this period"
                message="Try widening the dates, or clearing the filters above."
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Customer</th>
                        <th>When</th>
                        <th>Payment</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((sale) => (
                        <tr key={sale.id}>
                          <td className="cell-title">
                            <div className="row-tight">
                              <span className="cell-main">{sale.invoice_no}</span>
                              {sale.status === 'refunded' && <StatusBadge status="refunded" />}
                            </div>
                            <div className="cell-sub">{sale.line_count} item{sale.line_count === 1 ? '' : 's'} · {sale.unit_count} units</div>
                          </td>
                          <td data-label="Customer">
                            <div className="t-sm">{sale.customer_name || 'Walk-in customer'}</div>
                            <div className="cell-sub">served by {sale.served_by_name}</div>
                          </td>
                          <td data-label="When" className="t-sm">{dateTime(sale.sold_at)}</td>
                          <td data-label="Payment">
                            <Badge tone="neutral" dot={false}>{payment(sale.payment_method)}</Badge>
                          </td>
                          <td data-label="Total" className="t-right">
                            <div className="t-bold num">{rupees(sale.total_paisa)}</div>
                            {sale.discount_paisa > 0 && (
                              <div className="cell-sub">{rupees(sale.discount_paisa)} off</div>
                            )}
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions">
                              <button className="icon-btn" onClick={() => setViewing(sale.id)} aria-label="View invoice" title="View invoice">
                                <Eye size={17} />
                              </button>
                              <Allow permission="sales.refund">
                                {sale.status === 'completed' && (
                                  <button className="icon-btn" onClick={() => setRefunding(sale)} aria-label="Refund" title="Refund">
                                    <RotateCcw size={17} />
                                  </button>
                                )}
                              </Allow>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} />
              </>
            )}
      </div>

      {/* ----------------------------- invoice ----------------------------- */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        icon={<Receipt />}
        title={detail?.data?.invoice_no ?? 'Invoice'}
        subtitle={detail?.data ? dateTime(detail.data.sold_at) : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setViewing(null)} className="no-print">Close</Button>
            <Button variant="secondary" icon={<Printer size={17} />} onClick={() => window.print()} className="no-print">
              Print receipt
            </Button>
          </>
        }
      >
        {!detail?.data
          ? <TableSkeleton rows={5} columns={4} />
          : (
            <>
              {detail.data.status === 'refunded' && (
                <div className="mb-4">
                  <Alert tone="danger" title="This invoice has been refunded" icon={<CircleAlert />}>
                    The stock was returned to the shelf where the batch was still in date.
                  </Alert>
                </div>
              )}

              <div className="grid grid-3 mb-5">
                <div className="mini-card"><div className="lbl">Total</div><div className="val">{rupees(detail.data.total_paisa)}</div></div>
                <div className="mini-card"><div className="lbl">Paid by</div><div className="val" style={{ fontSize: 'var(--fs-md)' }}>{payment(detail.data.payment_method)}</div></div>
                <div className="mini-card"><div className="lbl">Served by</div><div className="val" style={{ fontSize: 'var(--fs-md)' }}>{detail.data.served_by_name}</div></div>
              </div>

              {detail.data.discount_paisa > 0 && (
                <div className="mb-5">
                  <Alert tone="info" title={`Discount of ${rupees(detail.data.discount_paisa)} given by ${detail.data.served_by_name ?? 'the till'}`}>
                    {reasonLabel(detail.data.discount_reason)}
                    {detail.data.discount_note ? ` — "${detail.data.discount_note}"` : ''}
                  </Alert>
                </div>
              )}

              <h4 className="mb-3">Items sold</h4>
              <div className="table-scroll mb-5">
                <table className="tbl">
                  <thead>
                    <tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="t-right">Qty</th><th className="t-right">Price</th><th className="t-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {(detail.data.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td className="cell-main">{item.medicine_name}</td>
                        <td className="mono t-sm">{item.batch_no ?? '—'}</td>
                        <td className="t-sm">{item.expiry_date ? date(item.expiry_date) : '—'}</td>
                        <td className="t-right num">{item.quantity}</td>
                        <td className="t-right num">{rupees(item.unit_price_paisa, { decimals: true })}</td>
                        <td className="t-right num t-bold">{rupees(item.line_total_paisa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details>
                <summary className="t-semi" style={{ cursor: 'pointer', padding: '8px 0' }}>
                  Show the printable receipt
                </summary>
                <div className="mt-4"><ReceiptView sale={detail.data} /></div>
              </details>
            </>
          )}
      </Modal>

      <ConfirmDialog
        open={!!refunding}
        onCancel={() => setRefunding(null)}
        onConfirm={(reason) => run(
          () => api.post<RefundResult>(`/sales/${refunding!.id}/refund`, { reason }),
          (result) => {
            setRefunding(null);
            /* The server says what actually happened to the stock — how much
               went back on the shelf and how much is being held. */
            ok('Invoice refunded', result?.message ?? 'Stock has been returned where the batch is still in date.');
            void reload(true);
          }
        )}
        loading={busy}
        requireReason
        reasonLabel="Why is this being refunded?"
        title="Refund this invoice?"
        confirmLabel="Refund it"
        message={
          <>
            Invoice <b>{refunding?.invoice_no}</b> for <b>{rupees(refunding?.total_paisa ?? 0)}</b> will be
            marked refunded. Every item goes back into its original batch, unless that batch has expired,
            been quarantined or been written off since it was sold — those units are held for a pharmacist
            to look at instead of going straight back on the shelf.
          </>
        }
      />
    </>
  );
}
