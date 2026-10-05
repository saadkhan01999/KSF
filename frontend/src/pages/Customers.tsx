/* Customers.

   A pharmacy customer record is partly commercial and partly clinical: what
   they have spent, but also what they are allergic to and what long-term
   condition they are being treated for. Allergies are surfaced at the till,
   which is the only place that knowledge is any use. */

import { useEffect, useState } from 'react';
import {
  Plus, Users, Pencil, Trash2, Phone, MapPin, Download, Eye, Award,
  CircleAlert, HeartPulse, IdCard, Wallet, HandCoins, Printer, Undo2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, Modal, TextInput, TextArea, SelectInput, ConfirmDialog,
  StatusBadge, Badge, EmptyState, TableSkeleton, Pager, Allow, Alert
} from '../components/ui';
import {
  rupees, amount, toPaisa, toRupeeInput, number, date, dateTime, phone as fmtPhone,
  cnic as fmtCnic, cnicMask, downloadCsv, payment, PAYMENT_LABELS
} from '../utils/format';
import { BRAND } from '../brand';
import type { Customer, CustomerPayment, Paged } from '../types';

const empty = {
  name: '', phone: '', cnic: '', email: '', address: '', city: 'Karachi',
  dateOfBirth: '', gender: '', allergies: '', chronicNotes: '', creditLimit: '', status: 'active'
};

export default function Customers() {
  const { ok, can } = useApp();
  const { busy, run } = useAction();

  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(empty);
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Customer | null>(null);

  /* Udhaar coming back: the form, the slip that gets handed over, and the
     receipt a manager is about to reverse. */
  const [takingFrom, setTakingFrom] = useState<Customer | null>(null);
  const [takeAmount, setTakeAmount] = useState('');
  const [takeMethod, setTakeMethod] = useState('cash');
  const [takeNote, setTakeNote] = useState('');
  const [slip, setSlip] = useState<{ payment: CustomerPayment; customer: Customer } | null>(null);
  const [reversing, setReversing] = useState<CustomerPayment | null>(null);

  const { data, loading, reload } = useApiData<Paged<Customer>>(
    `/customers${query({ q: search, page, size: 25 })}`, [search, page]
  );
  const { data: detail, reload: reloadDetail } = useApiData<{ data: Customer }>(
    viewing ? `/customers/${viewing}` : null, [viewing]
  );

  useEffect(() => { setPage(1); }, [search]);

  const openNew = () => { setEditing(null); setForm(empty); setFormOpen(true); };

  const openTake = (customer: Customer) => {
    setTakingFrom(customer);
    /* Pre-filled with the whole balance, because that is what most people pay,
       and it is the one figure nobody wants to mistype. */
    setTakeAmount(toRupeeInput(customer.balance_paisa));
    setTakeMethod('cash');
    setTakeNote('');
  };

  const takePayment = () => run(
    () => api.post<{ data: CustomerPayment; customer: Customer; receiptNo: string }>(
      `/customers/${takingFrom!.id}/payments`,
      { amountPaisa: toPaisa(takeAmount), paymentMethod: takeMethod, note: takeNote }
    ),
    (result) => {
      ok(`${rupees(toPaisa(takeAmount))} received`, `Receipt ${result?.receiptNo}. ${takingFrom!.name} now owes ${rupees(result?.customer.balance_paisa ?? 0)}.`);
      if (result) setSlip({ payment: result.data, customer: result.customer });
      setTakingFrom(null);
      void reload(true);
      void reloadDetail(true);
    }
  );

  const reverse = (reason: string) => run(
    () => api.post(`/customer-payments/${reversing!.id}/reverse`, { reason }),
    () => {
      setReversing(null);
      ok('Receipt reversed', 'The amount is back on the account and the receipt is marked reversed.');
      void reload(true);
      void reloadDetail(true);
    }
  );
  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setForm({
      name: customer.name, phone: customer.phone ?? '', cnic: customer.cnic ?? '',
      email: customer.email ?? '', address: customer.address ?? '', city: customer.city ?? 'Karachi',
      dateOfBirth: customer.date_of_birth ?? '', gender: customer.gender ?? '',
      allergies: customer.allergies ?? '', chronicNotes: customer.chronic_notes ?? '',
      creditLimit: toRupeeInput(customer.credit_limit_paisa), status: customer.status
    });
    setFormOpen(true);
  };

  const save = () => run(
    () => {
      const payload = { ...form, creditLimitPaisa: toPaisa(form.creditLimit || 0) };
      return editing ? api.patch(`/customers/${editing.id}`, payload) : api.post('/customers', payload);
    },
    () => { setFormOpen(false); ok(editing ? 'Customer updated' : 'Customer added', form.name); void reload(true); }
  );

  const exportCsv = () => {
    if (!data?.data.length) return;
    downloadCsv(`ksf-customers-${new Date().toISOString().slice(0, 10)}`, data.data.map((c) => ({
      Name: c.name, Phone: c.phone, CNIC: c.cnic, City: c.city,
      Visits: c.visits ?? 0, 'Total spend (Rs)': (c.total_spend_paisa ?? 0) / 100,
      'Loyalty points': c.loyalty_points, 'Balance owed (Rs)': c.balance_paisa / 100,
      Allergies: c.allergies, Status: c.status
    })));
    ok('Exported', 'Your customer list has been saved as a CSV file.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p className="sub">Regular customers, their history, and the allergy notes that appear at the till.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>Export</Button>
          <Allow permission="customers.write">
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Add customer</Button>
          </Allow>
        </div>
      </div>

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by name, mobile number or CNIC…" />
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={5} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<Users size={30} />}
                title={term ? 'No customer matches that search' : 'No customers registered yet'}
                message="Registering a customer lets you keep their history, allergies and loyalty points."
                action={can('customers.write') && !term
                  ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Add your first customer</Button>
                  : undefined}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Contact</th>
                        <th>History</th>
                        <th style={{ textAlign: 'right' }}>Spend</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((customer) => (
                        <tr key={customer.id}>
                          <td className="cell-title">
                            <div className="row-tight">
                              <span className="cell-main">{customer.name}</span>
                              {customer.allergies && (
                                <span className="badge badge-danger" title={`Allergies: ${customer.allergies}`}>
                                  Allergy
                                </span>
                              )}
                              {customer.balance_paisa > 0 && <Badge tone="warn" dot={false}>Owes {rupees(customer.balance_paisa)}</Badge>}
                            </div>
                            <div className="cell-sub">{customer.cnic ? fmtCnic(customer.cnic) : 'No CNIC on file'}</div>
                          </td>
                          <td data-label="Contact">
                            <div className="t-sm">{customer.phone ? fmtPhone(customer.phone) : '—'}</div>
                            <div className="cell-sub">{customer.city || '—'}</div>
                          </td>
                          <td data-label="History">
                            <div className="t-sm">{number(customer.visits ?? 0)} visit{customer.visits === 1 ? '' : 's'}</div>
                            <div className="cell-sub">{customer.last_visit ? `last ${date(customer.last_visit)}` : 'no purchases yet'}</div>
                          </td>
                          <td data-label="Spend" className="t-right">
                            <div className="t-bold num">{rupees(customer.total_spend_paisa ?? 0)}</div>
                            {customer.loyalty_points > 0 && (
                              <div className="cell-sub row-tight" style={{ justifyContent: 'flex-end' }}>
                                <Award size={12} /> {number(customer.loyalty_points)} points
                              </div>
                            )}
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions">
                              <button className="icon-btn" onClick={() => setViewing(customer.id)} aria-label="View history"><Eye size={17} /></button>
                              {customer.balance_paisa > 0 && (
                                <Allow permission="pos.operate">
                                  <button className="icon-btn" onClick={() => openTake(customer)} aria-label={`Take a payment from ${customer.name}`} title="Take a payment">
                                    <HandCoins size={17} />
                                  </button>
                                </Allow>
                              )}
                              <Allow permission="customers.write">
                                <button className="icon-btn" onClick={() => openEdit(customer)} aria-label="Edit"><Pencil size={17} /></button>
                                <button className="icon-btn" onClick={() => setRemoving(customer)} aria-label="Archive"><Trash2 size={17} /></button>
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

      {/* ------------------------------ form ------------------------------ */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="lg"
        icon={<Users />}
        title={editing ? `Edit ${editing.name}` : 'Add a customer'}
        subtitle="Only the name is required. Everything else can be added the next time they come in."
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim()}>
              {editing ? 'Save changes' : 'Add customer'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <TextInput
            label="Full name" required wrapClass="span-2"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextInput
            label="Mobile number" icon={<Phone />} inputMode="tel" placeholder="+92 300 1234567"
            value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            hint="Used to find them quickly at the till"
          />
          <TextInput
            label="CNIC" icon={<IdCard />} inputMode="numeric" placeholder="12345-1234567-1"
            value={form.cnic} onChange={(e) => setForm({ ...form, cnic: cnicMask(e.target.value) })}
          />
          <TextInput
            label="Date of birth" type="date" max={new Date().toISOString().slice(0, 10)}
            value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
          />
          <SelectInput
            label="Gender"
            value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}
            placeholder="Prefer not to say"
            options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]}
          />
          <TextInput
            label="Address" wrapClass="span-2" icon={<MapPin />}
            value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <TextInput
            label="City"
            value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <TextInput
            label="Credit limit" type="number" prefix="Rs" min={0}
            value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            hint="Leave at 0 to refuse on-account sales"
          />

          <fieldset className="fieldset span-2">
            <legend>Clinical notes</legend>
            <div className="col" style={{ gap: 14 }}>
              <TextInput
                label="Known allergies" icon={<CircleAlert />}
                placeholder="e.g. Penicillin, Sulpha drugs"
                hint="This is shown in red at the till whenever this customer is selected."
                value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })}
              />
              <TextArea
                label="Long-term conditions"
                placeholder="e.g. Type 2 diabetes, hypertension — on Metformin and Bisoprolol"
                value={form.chronicNotes} onChange={(e) => setForm({ ...form, chronicNotes: e.target.value })}
              />
            </div>
          </fieldset>
        </div>
      </Modal>

      {/* ----------------------------- history ----------------------------- */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        icon={<Users />}
        title={detail?.data?.name ?? 'Customer'}
        subtitle={detail?.data?.phone ? fmtPhone(detail.data.phone) : ''}
        footer={<Button variant="outline" onClick={() => setViewing(null)}>Close</Button>}
      >
        {!detail?.data
          ? <TableSkeleton rows={5} columns={3} />
          : (
            <>
              {detail.data.allergies && (
                <div className="mb-4">
                  <Alert tone="danger" title="Allergies on file" icon={<CircleAlert />}>
                    {detail.data.allergies}
                  </Alert>
                </div>
              )}
              {detail.data.chronic_notes && (
                <div className="mb-4">
                  <Alert tone="info" title="Long-term conditions" icon={<HeartPulse />}>
                    {detail.data.chronic_notes}
                  </Alert>
                </div>
              )}

              <div className="grid grid-4 mb-5">
                <div className="mini-card"><div className="lbl">Visits</div><div className="val">{number(detail.data.stats?.visits ?? 0)}</div></div>
                <div className="mini-card"><div className="lbl">Total spend</div><div className="val" style={{ fontSize: 'var(--fs-lg)' }}>{rupees(detail.data.stats?.spend ?? 0)}</div></div>
                <div className="mini-card"><div className="lbl">Average basket</div><div className="val" style={{ fontSize: 'var(--fs-lg)' }}>{rupees(Math.round(detail.data.stats?.average ?? 0))}</div></div>
                <div className="mini-card"><div className="lbl">Loyalty points</div><div className="val">{number(detail.data.loyalty_points)}</div></div>
              </div>

              {detail.data.balance_paisa > 0 && (
                <div className="mb-4">
                  <Alert tone="warn" title="Outstanding balance" icon={<Wallet />}>
                    {detail.data.name} owes {rupees(detail.data.balance_paisa)} on account.
                    <Allow permission="pos.operate">
                      <div className="card-actions">
                        <Button variant="primary" size="sm" icon={<HandCoins size={16} />} onClick={() => openTake(detail.data)}>
                          Take a payment
                        </Button>
                      </div>
                    </Allow>
                  </Alert>
                </div>
              )}

              <h4 className="mb-3">Recent purchases</h4>
              <div className="table-scroll mb-5">
                <table className="tbl">
                  <thead><tr><th>Invoice</th><th>Date</th><th>Payment</th><th className="t-right">Total</th></tr></thead>
                  <tbody>
                    {(detail.data.sales ?? []).map((sale) => (
                      <tr key={sale.id}>
                        <td className="cell-main">{sale.invoice_no}</td>
                        <td className="t-sm">{dateTime(sale.sold_at)}</td>
                        <td className="t-sm">{payment(sale.payment_method)}</td>
                        <td className="t-right num t-bold">
                          {rupees(sale.total_paisa)}
                          {sale.status === 'refunded' && <div className="cell-sub"><StatusBadge status="refunded" /></div>}
                        </td>
                      </tr>
                    ))}
                    {!(detail.data.sales ?? []).length && (
                      <tr><td colSpan={4} className="t-center t-dim">No purchases recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!!(detail.data.payments ?? []).length && (
                <>
                  <h4 className="mb-3">Payments received</h4>
                  <div className="table-scroll mb-5">
                    <table className="tbl">
                      <thead>
                        <tr><th>Receipt</th><th>Date</th><th>How</th><th className="t-right">Amount</th><th /></tr>
                      </thead>
                      <tbody>
                        {(detail.data.payments ?? []).map((receipt) => (
                          <tr key={receipt.id} className={receipt.reversed_at ? 'is-muted' : undefined}>
                            <td className="cell-main">
                              {receipt.receipt_no}
                              {receipt.reversed_at && <div className="cell-sub">reversed {date(receipt.reversed_at)}</div>}
                            </td>
                            <td className="t-sm">{dateTime(receipt.received_at)}</td>
                            <td className="t-sm">{payment(receipt.payment_method)}</td>
                            <td className="t-right num t-bold">
                              {rupees(receipt.amount_paisa)}
                              <div className="cell-sub">left {rupees(receipt.balance_after_paisa)}</div>
                            </td>
                            <td className="row-actions">
                              {!receipt.reversed_at && (
                                <Allow permission="sales.refund">
                                  <button className="icon-btn" onClick={() => setReversing(receipt)} aria-label={`Reverse receipt ${receipt.receipt_no}`} title="Reverse this receipt">
                                    <Undo2 size={16} />
                                  </button>
                                </Allow>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {!!(detail.data.prescriptions ?? []).length && (
                <>
                  <h4 className="mb-3">Prescriptions</h4>
                  <div className="table-scroll">
                    <table className="tbl">
                      <thead><tr><th>Reference</th><th>Doctor</th><th>Date</th><th>Status</th></tr></thead>
                      <tbody>
                        {(detail.data.prescriptions ?? []).map((rx) => (
                          <tr key={rx.id}>
                            <td className="cell-main">{rx.reference}</td>
                            <td className="t-sm">{rx.doctor_name}</td>
                            <td className="t-sm">{date(rx.prescription_date)}</td>
                            <td><StatusBadge status={rx.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/customers/${removing!.id}`),
          () => { setRemoving(null); ok('Customer archived'); void reload(true); }
        )}
        loading={busy}
        title="Archive this customer?"
        confirmLabel="Archive"
        message={
          <>
            <b>{removing?.name}</b> will be hidden from the till, but their purchase history is kept
            so your reports stay accurate.
          </>
        }
      />

      {/* -------------------- udhaar coming back -------------------- */}
      <Modal
        open={!!takingFrom}
        onClose={() => setTakingFrom(null)}
        icon={<HandCoins />}
        title={`Take a payment from ${takingFrom?.name ?? ''}`}
        subtitle={takingFrom ? `Owes ${rupees(takingFrom.balance_paisa)} on account` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setTakingFrom(null)}>Cancel</Button>
            <Button
              variant="primary" loading={busy} onClick={takePayment}
              disabled={toPaisa(takeAmount) <= 0 || toPaisa(takeAmount) > (takingFrom?.balance_paisa ?? 0)}
            >
              Record {rupees(toPaisa(takeAmount))}
            </Button>
          </>
        }
      >
        <TextInput
          label="Amount received" prefix="Rs" required inputMode="decimal"
          value={takeAmount} onChange={(e) => setTakeAmount(e.target.value)}
          hint={
            toPaisa(takeAmount) > (takingFrom?.balance_paisa ?? 0)
              ? `That is more than the ${rupees(takingFrom?.balance_paisa ?? 0)} owed. Take the balance, or record the extra as a separate sale.`
              : 'Part payments are fine. The balance comes down by whatever is taken.'
          }
          error={toPaisa(takeAmount) > (takingFrom?.balance_paisa ?? 0) ? ' ' : undefined}
        />
        <SelectInput
          label="How was it received" value={takeMethod}
          onChange={(e) => setTakeMethod(e.target.value)}
          options={['cash', 'card', 'easypaisa', 'jazzcash', 'bank-transfer'].map((method) => ({
            value: method, label: PAYMENT_LABELS[method] ?? method
          }))}
          hint="Cash is counted at the day close. Anything else has to be matched against the statement."
        />
        <TextInput
          label="Note (optional)" value={takeNote} onChange={(e) => setTakeNote(e.target.value)}
          placeholder="Paid at the counter by his son"
        />
      </Modal>

      {/* The slip handed to the customer. Same 76mm roll as a sale receipt. */}
      <Modal
        open={!!slip}
        onClose={() => setSlip(null)}
        title="Payment receipt"
        subtitle={slip ? slip.payment.receipt_no : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setSlip(null)} className="no-print">Close</Button>
            <Button variant="primary" icon={<Printer size={17} />} onClick={() => window.print()} className="no-print">
              Print
            </Button>
          </>
        }
      >
        {slip && <PaymentReceipt receipt={slip.payment} customer={slip.customer} />}
      </Modal>

      <ConfirmDialog
        open={!!reversing}
        onCancel={() => setReversing(null)}
        onConfirm={reverse}
        loading={busy}
        requireReason
        reasonLabel="Why is this receipt being reversed?"
        title="Reverse this receipt?"
        confirmLabel="Reverse it"
        message={
          <>
            Receipt <b>{reversing?.receipt_no}</b> for <b>{rupees(reversing?.amount_paisa ?? 0)}</b> will be marked
            reversed and the amount goes back on to the account. The receipt is not deleted — the customer may still
            be holding their copy.
          </>
        }
      />
    </>
  );
}

/* -------------------------------------------------------------------------
   The slip for money received against an account. Deliberately plain: what
   was paid, what is left, and who took it.
   ------------------------------------------------------------------------- */
function PaymentReceipt({ receipt, customer }: { receipt: CustomerPayment; customer: Customer }) {
  return (
    <div className="receipt">
      <h3>PAYMENT RECEIVED</h3>
      <div className="rc-sub">{receipt.receipt_no}</div>
      <hr />
      <div className="rc-line"><span>Customer</span><span>{customer.name}</span></div>
      <div className="rc-line"><span>Date</span><span>{dateTime(receipt.received_at)}</span></div>
      <div className="rc-line"><span>Received by</span><span>{receipt.received_by_name ?? '—'}</span></div>
      <div className="rc-line"><span>Method</span><span>{payment(receipt.payment_method)}</span></div>
      <hr />
      <div className="rc-line rc-total"><span>PAID</span><span>Rs {amount(receipt.amount_paisa)}</span></div>
      <div className="rc-line"><span>Balance remaining</span><span>{amount(receipt.balance_after_paisa)}</span></div>
      {receipt.note && <div className="rc-trace">{receipt.note}</div>}
      <hr />
      <div className="rc-foot">
        Thank you.<br /><br />
        {BRAND.name} {BRAND.version}
      </div>
    </div>
  );
}
