/* Purchase orders and stock-in.

   A purchase is where stock enters the pharmacy, so this is also where batch
   numbers and expiry dates are captured. The form insists on both, because a
   batch without an expiry date is a batch nobody can control later. */

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, ClipboardList, Package, Trash2, X, Download,
  Eye, Printer, Coins, Clock, CheckCheck
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, StatCard, StatusBadge, Modal, TextInput, TextArea,
  SelectInput, Checkbox, ConfirmDialog, EmptyState, TableSkeleton, Pager,
  Allow, Alert, Segmented, Badge
} from '../components/ui';
import { rupees, rupeesShort, toPaisa, number, date, todayIso, downloadCsv, PAYMENT_LABELS } from '../utils/format';
import type { Medicine, Paged, Purchase, Supplier } from '../types';

interface PurchaseResponse extends Paged<Purchase> {
  summary: { orders: number; received_value: number; pending_value: number; payable: number };
}

interface DraftLine {
  key: number;
  medicineId: string;
  quantity: string;
  cost: string;
  price: string;
  batchNo: string;
  expiryDate: string;
}

let lineSeed = 0;
const newLine = (): DraftLine => ({
  key: (lineSeed += 1), medicineId: '', quantity: '', cost: '', price: '', batchNo: '', expiryDate: ''
});

export default function Purchases() {
  const { ok, can } = useApp();
  const { busy, run } = useAction();

  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);

  const path = `/purchases${query({ q: search, status, page, size: 20 })}`;
  const { data, loading, reload } = useApiData<PurchaseResponse>(path, [search, status, page]);
  const { data: detail, reload: reloadDetail } = useApiData<{ data: Purchase }>(viewing ? `/purchases/${viewing}` : null, [viewing]);

  useEffect(() => { setPage(1); }, [search, status]);

  const summary = data?.summary;

  const exportCsv = () => {
    if (!data?.data.length) return;
    downloadCsv(`ksf-purchases-${todayIso()}`, data.data.map((p) => ({
      Reference: p.reference, 'Supplier invoice': p.invoice_no, Supplier: p.supplier_name,
      Date: p.purchase_date, Status: p.status, Lines: p.line_count, Units: p.unit_count,
      'Total (Rs)': p.total_paisa / 100, 'Paid (Rs)': p.paid_paisa / 100, Payment: p.payment_status
    })));
    ok('Exported', 'Your purchase list has been saved as a CSV file.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Purchases</h1>
          <p className="sub">Orders to your suppliers, and the stock-in that follows. Receiving an order is what puts medicine on the shelf.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>Export</Button>
          <Allow permission="purchases.write">
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setFormOpen(true)}>New purchase</Button>
          </Allow>
        </div>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Orders on record" value={number(summary?.orders ?? 0)} icon={<ClipboardList size={20} />} />
        <StatCard label="Stock received" value={rupeesShort(summary?.received_value ?? 0)} icon={<CheckCheck size={20} />} hint="at purchase cost" />
        <StatCard label="On order" value={rupeesShort(summary?.pending_value ?? 0)} icon={<Clock size={20} />} tone="info" hint="not yet delivered" />
        <StatCard label="Owed to suppliers" value={rupeesShort(summary?.payable ?? 0)} icon={<Coins size={20} />} tone="warn" hint="received but unpaid" />
      </div>

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by reference, invoice or supplier…" />
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Draft' },
            { value: 'ordered', label: 'Ordered' },
            { value: 'received', label: 'Received' },
            { value: 'cancelled', label: 'Cancelled' }
          ]}
        />
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={6} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<ClipboardList size={30} />}
                title="No purchase orders yet"
                message="Raise an order when you buy from a distributor. Receiving it adds the batches to your stock automatically."
                action={can('purchases.write')
                  ? <Button variant="primary" icon={<Plus size={18} />} onClick={() => setFormOpen(true)}>Raise the first order</Button>
                  : undefined}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Supplier</th>
                        <th>Date</th>
                        <th>Contents</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((purchase) => (
                        <tr key={purchase.id}>
                          <td className="cell-title">
                            <span className="cell-main">{purchase.reference}</span>
                            <div className="cell-sub">{purchase.invoice_no ? `Supplier invoice ${purchase.invoice_no}` : 'No supplier invoice'}</div>
                          </td>
                          <td data-label="Supplier">
                            <div className="t-sm t-semi">{purchase.supplier_name}</div>
                            <div className="cell-sub"><StatusBadge status={purchase.status} /></div>
                          </td>
                          <td data-label="Date" className="t-sm">{date(purchase.purchase_date)}</td>
                          <td data-label="Contents">
                            <div className="t-sm">{purchase.line_count} line{purchase.line_count === 1 ? '' : 's'}</div>
                            <div className="cell-sub">{number(purchase.unit_count ?? 0)} units</div>
                          </td>
                          <td data-label="Total" className="t-right">
                            <div className="t-bold num">{rupees(purchase.total_paisa)}</div>
                            <div className="cell-sub"><StatusBadge status={purchase.payment_status} /></div>
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions wrap" style={{ gap: 6 }}>
                              <button className="icon-btn" onClick={() => setViewing(purchase.id)} aria-label="View order"><Eye size={17} /></button>
                              <Allow permission="purchases.write">
                                {purchase.status !== 'received' && purchase.status !== 'cancelled' && (
                                  <>
                                    <button className="btn btn-primary btn-sm" onClick={() => setReceiving(purchase)}>
                                      <Package size={14} /> Receive
                                    </button>
                                    <button className="icon-btn" onClick={() => setCancelling(purchase)} aria-label="Cancel order"><X size={17} /></button>
                                  </>
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

      <PurchaseForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void reload(true); }}
      />

      <PurchaseDetail
        purchase={detail?.data ?? null}
        open={!!viewing}
        onClose={() => setViewing(null)}
        onPaid={() => { void reloadDetail(true); void reload(true); }}
      />

      <ConfirmDialog
        open={!!receiving}
        onCancel={() => setReceiving(null)}
        onConfirm={() => run(
          () => api.post(`/purchases/${receiving!.id}/receive`, {}),
          () => { setReceiving(null); ok('Stock received', `${receiving!.reference} is now on the shelf.`); void reload(true); }
        )}
        loading={busy}
        tone="warn"
        title="Receive this delivery?"
        confirmLabel="Yes, add it to stock"
        message={
          <>
            Every line on <b>{receiving?.reference}</b> will be added to stock as its own batch, with
            the batch number and expiry date already on the order. Check the physical delivery matches
            before you confirm — this is what your shelf figures will be based on.
          </>
        }
      />

      <ConfirmDialog
        open={!!cancelling}
        onCancel={() => setCancelling(null)}
        onConfirm={(reason) => run(
          () => api.post(`/purchases/${cancelling!.id}/cancel`, { reason }),
          () => { setCancelling(null); ok('Order cancelled'); void reload(true); }
        )}
        loading={busy}
        requireReason
        reasonLabel="Why is it being cancelled?"
        title="Cancel this order?"
        confirmLabel="Cancel the order"
        message={<>Order <b>{cancelling?.reference}</b> will be marked cancelled. No stock is affected.</>}
      />
    </>
  );
}

/* ------------------------------ the form ------------------------------ */

function PurchaseForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [receiveNow, setReceiveNow] = useState(true);
  const [markPaid, setMarkPaid] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [error, setError] = useState('');

  const { data: suppliers } = useApiData<{ data: Supplier[] }>(open ? '/suppliers' : null, [open]);
  const { data: medicines } = useApiData<{ data: Medicine[] }>(open ? '/medicines-lookup' : null, [open]);

  useEffect(() => {
    if (!open) return;
    setSupplierId(''); setInvoiceNo(''); setPurchaseDate(todayIso());
    setDiscount(''); setNotes(''); setReceiveNow(true); setMarkPaid(false);
    setLines([newLine()]); setError('');
  }, [open]);

  const setLine = (key: number, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  /* Choosing a medicine pre-fills its usual cost and price. */
  const pickMedicine = (key: number, medicineId: string) => {
    const medicine = medicines?.data.find((m) => m.id === medicineId);
    setLine(key, {
      medicineId,
      cost: medicine ? String(medicine.cost_paisa / 100) : '',
      price: medicine ? String(medicine.price_paisa / 100) : ''
    });
  };

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + toPaisa(line.cost || 0) * Number(line.quantity || 0), 0),
    [lines]
  );
  const discountPaisa = Math.min(subtotal, Math.max(0, toPaisa(discount || 0)));
  const total = subtotal - discountPaisa;

  const complete = lines.filter((l) => l.medicineId && l.quantity && l.batchNo && l.expiryDate);
  const ready = !!supplierId && complete.length > 0 && complete.length === lines.length;

  const submit = () => {
    setError('');
    return run(
      () => api.post('/purchases', {
        supplierId, invoiceNo, purchaseDate,
        discountPaisa, notes, receiveNow, markPaid,
        items: lines.map((line) => ({
          medicineId: line.medicineId,
          quantity: Number(line.quantity),
          costPaisa: toPaisa(line.cost),
          pricePaisa: toPaisa(line.price),
          batchNo: line.batchNo,
          expiryDate: line.expiryDate
        }))
      }),
      () => {
        ok(receiveNow ? 'Purchase received' : 'Purchase order raised',
          receiveNow ? 'The stock is now on the shelf.' : 'Receive it when the delivery arrives.');
        onSaved();
      }
    ).then((result) => { if (result === null) setError('Please check the highlighted details and try again.'); });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      icon={<ClipboardList />}
      title="New purchase"
      subtitle="Record what you have bought. Batch number and expiry date are required on every line."
      footer={
        <>
          <span className="left t-sm t-soft">
            {complete.length} of {lines.length} lines complete · <b>{rupees(total)}</b>
          </span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!ready}>
            {receiveNow ? 'Save and add to stock' : 'Save order'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

      <div className="form-grid mb-5">
        <SelectInput
          label="Supplier" required
          value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
          placeholder="Who are you buying from?"
          options={(suppliers?.data ?? []).map((s) => ({ value: s.id, label: `${s.name}${s.city ? ` — ${s.city}` : ''}` }))}
        />
        <TextInput
          label="Their invoice number" placeholder="From the supplier's bill"
          value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)}
        />
        <TextInput
          label="Purchase date" type="date" max={todayIso()}
          value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)}
        />
        <TextInput
          label="Discount from supplier" type="number" prefix="Rs" min={0} step="0.01"
          value={discount} onChange={(e) => setDiscount(e.target.value)}
        />
      </div>

      <h4 className="mb-3">What is on the order</h4>

      <div className="col" style={{ gap: 12 }}>
        {lines.map((line, index) => {
          const medicine = medicines?.data.find((m) => m.id === line.medicineId);
          const lineTotal = toPaisa(line.cost || 0) * Number(line.quantity || 0);
          const losing = line.cost && line.price && Number(line.cost) > Number(line.price);
          return (
            <div className="mini-card" key={line.key}>
              <div className="row-between mb-3">
                <span className="lbl">Line {index + 1}</span>
                <div className="row-tight">
                  <span className="t-sm t-bold num">{rupees(lineTotal)}</span>
                  {lines.length > 1 && (
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="form-grid">
                <SelectInput
                  label="Medicine" required className="span-2"
                  value={line.medicineId} onChange={(e) => pickMedicine(line.key, e.target.value)}
                  placeholder="Choose a medicine"
                  options={(medicines?.data ?? []).map((m) => ({
                    value: m.id,
                    label: `${m.name} — ${m.form}${m.strength ? ` ${m.strength}` : ''}`
                  }))}
                />
                <TextInput
                  label="Quantity" required type="number" min={1}
                  value={line.quantity} onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                />
                <TextInput
                  label="Batch number" required placeholder="Printed on the pack"
                  value={line.batchNo} onChange={(e) => setLine(line.key, { batchNo: e.target.value })}
                />
                <TextInput
                  label="Expiry date" required type="date" min={todayIso()}
                  value={line.expiryDate} onChange={(e) => setLine(line.key, { expiryDate: e.target.value })}
                />
                <TextInput
                  label="Cost each" required type="number" prefix="Rs" min={0} step="0.01"
                  value={line.cost} onChange={(e) => setLine(line.key, { cost: e.target.value })}
                />
                <TextInput
                  label="New selling price" type="number" prefix="Rs" min={0} step="0.01"
                  value={line.price} onChange={(e) => setLine(line.key, { price: e.target.value })}
                  error={losing ? 'This is below the cost.' : undefined}
                  hint={!losing && medicine ? `Currently ${rupees(medicine.price_paisa)}` : undefined}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Button variant="secondary" icon={<Plus size={17} />} className="mt-3" onClick={() => setLines((c) => [...c, newLine()])}>
        Add another line
      </Button>

      <div className="mini-card mt-5">
        <div className="row-between t-sm" style={{ padding: '3px 0' }}>
          <span className="t-soft">Subtotal</span><span className="num t-semi">{rupees(subtotal, { decimals: true })}</span>
        </div>
        {discountPaisa > 0 && (
          <div className="row-between t-sm" style={{ padding: '3px 0' }}>
            <span className="t-soft">Discount</span><span className="num t-semi">−{rupees(discountPaisa, { decimals: true })}</span>
          </div>
        )}
        <div className="row-between mt-2" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <span className="t-bold">Total to pay</span>
          <span className="t-bold num" style={{ fontSize: 'var(--fs-lg)' }}>{rupees(total)}</span>
        </div>
      </div>

      <div className="col mt-4" style={{ gap: 2 }}>
        <Checkbox
          checked={receiveNow} onChange={setReceiveNow}
          label="The stock is here now — add it to the shelf straight away"
          hint="Leave this off to raise an order you will receive later."
        />
        {receiveNow && (
          <Checkbox checked={markPaid} onChange={setMarkPaid} label="Already paid for in full" />
        )}
      </div>

      <TextArea
        label="Notes" className="mt-4"
        placeholder="Anything worth recording about this delivery"
        value={notes} onChange={(e) => setNotes(e.target.value)}
      />
    </Modal>
  );
}

/* ------------------------------ the detail ------------------------------ */

const SUPPLIER_METHODS = ['cash', 'bank-transfer', 'cheque', 'card', 'easypaisa', 'jazzcash'];

/** Pay a supplier against a received order, in part or in full. */
function PayPurchase({ purchase, open, onClose, onPaid }: { purchase: Purchase; open: boolean; onClose: () => void; onPaid: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const outstanding = purchase.total_paisa - purchase.paid_paisa;
  const [form, setForm] = useState({ amount: '', method: 'cash', paidOn: todayIso(), reference: '' });
  useEffect(() => {
    if (open) setForm({ amount: String(outstanding / 100), method: 'cash', paidOn: todayIso(), reference: '' });
  }, [open, outstanding]);
  const amount = toPaisa(form.amount);

  const pay = () => run(
    () => api.post(`/purchases/${purchase.id}/payment`, { amountPaisa: amount, paymentMethod: form.method, paidOn: form.paidOn, paymentReference: form.reference }),
    () => { ok('Payment recorded', `${rupees(amount)} paid to ${purchase.supplier_name}.`); onClose(); onPaid(); }
  );

  return (
    <Modal
      open={open} onClose={onClose} size="sm" icon={<Coins />} title="Record a payment"
      subtitle={`${purchase.reference} · ${rupees(outstanding)} outstanding`}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={pay} disabled={amount <= 0 || amount > outstanding}>Record {rupees(Math.max(0, amount))}</Button>
        </>
      )}
    >
      <div className="form-grid">
        <TextInput
          label="Amount" required type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01" wrapClass="span-2"
          value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
          error={amount > outstanding ? `Only ${rupees(outstanding)} is outstanding.` : undefined}
        />
        <SelectInput
          label="Paid by" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
          options={SUPPLIER_METHODS.map((value) => ({ value, label: PAYMENT_LABELS[value] ?? value }))}
        />
        <TextInput label="Paid on" type="date" max={todayIso()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
        <TextInput
          label="Reference" wrapClass="span-2" placeholder="Cheque or transfer number"
          value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
        />
      </div>
    </Modal>
  );
}

function PurchaseDetail({ purchase, open, onClose, onPaid }: { purchase: Purchase | null; open: boolean; onClose: () => void; onPaid: () => void }) {
  const { can } = useApp();
  const [paying, setPaying] = useState(false);
  const payable = !!purchase && purchase.status === 'received' && purchase.paid_paisa < purchase.total_paisa && can('purchases.write');
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Package />}
      title={purchase?.reference ?? 'Purchase order'}
      subtitle={purchase ? `${purchase.supplier_name} · ${date(purchase.purchase_date)}` : ''}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {payable && <Button variant="primary" icon={<Coins size={17} />} onClick={() => setPaying(true)}>Record payment</Button>}
          <Button variant="secondary" icon={<Printer size={17} />} onClick={() => window.print()}>Print</Button>
        </>
      }
    >
      {purchase && payable && <PayPurchase purchase={purchase} open={paying} onClose={() => setPaying(false)} onPaid={onPaid} />}
      {!purchase
        ? <TableSkeleton rows={5} columns={4} />
        : (
          <>
            <div className="row-tight wrap mb-4">
              <StatusBadge status={purchase.status} large />
              <StatusBadge status={purchase.payment_status} large />
              {purchase.received_by_name && <Badge tone="neutral" dot={false}>Received by {purchase.received_by_name}</Badge>}
            </div>

            <dl className="kv mb-5">
              <dt>Supplier</dt><dd>{purchase.supplier_name}</dd>
              <dt>Their invoice</dt><dd>{purchase.invoice_no || '—'}</dd>
              <dt>Payment terms</dt><dd>{purchase.payment_terms || '—'}</dd>
              <dt>Raised by</dt><dd>{purchase.created_by_name || '—'}</dd>
              <dt>Paid so far</dt><dd>{rupees(purchase.paid_paisa)} of {rupees(purchase.total_paisa)}</dd>
            </dl>

            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Medicine</th><th>Batch</th><th>Expiry</th>
                    <th className="t-right">Qty</th><th className="t-right">Cost</th><th className="t-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {(purchase.items ?? []).map((item) => (
                    <tr key={item.id}>
                      <td className="cell-main">{item.medicine_name}</td>
                      <td className="mono t-sm">{item.batch_no}</td>
                      <td className="t-sm">{date(item.expiry_date)}</td>
                      <td className="t-right num">{item.quantity}</td>
                      <td className="t-right num">{rupees(item.cost_paisa, { decimals: true })}</td>
                      <td className="t-right num t-bold">{rupees(item.line_total_paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mini-card mt-4">
              <div className="row-between t-sm" style={{ padding: '3px 0' }}>
                <span className="t-soft">Subtotal</span><span className="num">{rupees(purchase.subtotal_paisa, { decimals: true })}</span>
              </div>
              {purchase.discount_paisa > 0 && (
                <div className="row-between t-sm" style={{ padding: '3px 0' }}>
                  <span className="t-soft">Discount</span><span className="num">−{rupees(purchase.discount_paisa, { decimals: true })}</span>
                </div>
              )}
              <div className="row-between mt-2" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <span className="t-bold">Total</span>
                <span className="t-bold num" style={{ fontSize: 'var(--fs-lg)' }}>{rupees(purchase.total_paisa)}</span>
              </div>
            </div>

            {purchase.notes && (
              <div className="mt-4">
                <div className="lbl mb-2">Notes</div>
                <p className="t-sm t-soft" style={{ whiteSpace: 'pre-wrap' }}>{purchase.notes}</p>
              </div>
            )}
          </>
        )}
    </Modal>
  );
}
