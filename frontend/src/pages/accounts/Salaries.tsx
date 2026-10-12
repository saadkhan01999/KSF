/* Salaries, advances and bonuses: one row per payment to one person for one
   month. The server refuses a second salary for the same person and month,
   which is almost always a slip of the finger. */

import { useEffect, useMemo, useState } from 'react';
import { Banknote, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useDebounced } from '../../hooks/useApi';
import { api, query } from '../../services/api';
import {
  Allow, Button, ConfirmDialog, EmptyState, Modal, Pager, SearchField, Segmented, SelectInput, TableSkeleton, TextArea, TextInput
} from '../../components/ui';
import type { Payee, SalaryKind, SalaryPayment } from '../../types/accounting';
import type { Paged } from '../../types';
import { date, monthLabel, payment, PAYMENT_LABELS, rupees, toPaisa, toRupeeInput, todayIso } from '../../utils/format';

interface SalaryReply extends Paged<SalaryPayment> {
  summary: { totalPaisa: number; payments: number; people: number; deductionsPaisa: number };
  kinds: { value: SalaryKind; label: string }[];
  methods: string[];
}

/** Someone paid who has no KSF account — a cleaner, a delivery rider. */
const SOMEONE_ELSE = '__other';
const thisMonth = () => todayIso().slice(0, 7);
const blank = {
  staffId: '', staffName: '', kind: 'salary' as SalaryKind, period: thisMonth(), basic: '', allowances: '', deductions: '',
  paidOn: todayIso(), paymentMethod: 'cash', reference: '', note: ''
};
const KIND_LABEL: Record<SalaryKind, string> = { salary: 'Salary', advance: 'Advance', bonus: 'Bonus' };
const monthName = (period: string) => `${monthLabel(period)} ${period.slice(0, 4)}`;

/** This month and the eleven before it, newest first, as YYYY-MM. */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, back) => {
    const at = new Date(now.getFullYear(), now.getMonth() - back, 1);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
  });
}

export function AccountsSalaries({ range, onChanged }: { range: string; onChanged: () => void }) {
  const { ok, can } = useApp();
  const { busy, run } = useAction();
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  /* Empty: paid during the period chosen above. A month: paid for that month. */
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, month, range]);

  const filter = month ? `period=${month}` : range;
  const { data, loading, reload } = useApiData<SalaryReply>(`/accounting/salaries?${filter}&${query({ q: search, page, size: 25 }).slice(1)}`, [filter, search, page]);
  const [formOpen, setFormOpen] = useState(false);
  const { data: payees } = useApiData<{ data: Payee[] }>(formOpen && can('accounting.manage') ? '/accounting/salaries/payees' : null, [formOpen]);

  const [editing, setEditing] = useState<SalaryPayment | null>(null);
  const [form, setForm] = useState(blank);
  const [removing, setRemoving] = useState<SalaryPayment | null>(null);
  const set = (patch: Partial<typeof blank>) => setForm((current) => ({ ...current, ...patch }));
  const net = useMemo(() => toPaisa(form.basic) + toPaisa(form.allowances) - toPaisa(form.deductions), [form.basic, form.allowances, form.deductions]);

  const openNew = () => { setEditing(null); setForm({ ...blank, period: month || thisMonth() }); setFormOpen(true); };
  const openEdit = (row: SalaryPayment) => {
    setEditing(row);
    setForm({
      staffId: row.staff_id ?? SOMEONE_ELSE, staffName: row.staff_id ? '' : row.staff_name, kind: row.kind, period: row.period,
      basic: toRupeeInput(row.basic_paisa), allowances: row.allowances_paisa ? toRupeeInput(row.allowances_paisa) : '',
      deductions: row.deductions_paisa ? toRupeeInput(row.deductions_paisa) : '', paidOn: row.paid_on, paymentMethod: row.payment_method,
      reference: row.reference ?? '', note: row.note ?? ''
    });
    setFormOpen(true);
  };
  const changed = (message: string) => { ok(message); void reload(true); onChanged(); };

  const save = () => run(
    () => {
      const other = form.staffId === SOMEONE_ELSE;
      const body = {
        staffId: other ? null : form.staffId, staffName: other ? form.staffName : undefined, kind: form.kind, period: form.period,
        basicPaisa: toPaisa(form.basic), allowancesPaisa: toPaisa(form.allowances), deductionsPaisa: toPaisa(form.deductions),
        paidOn: form.paidOn, paymentMethod: form.paymentMethod, reference: form.reference, note: form.note
      };
      return editing ? api.patch(`/accounting/salaries/${editing.id}`, body) : api.post('/accounting/salaries', body);
    },
    () => { setFormOpen(false); changed(editing ? 'Payment updated' : `${KIND_LABEL[form.kind]} recorded`); }
  );

  const who = form.staffId === SOMEONE_ELSE ? form.staffName.trim() : form.staffId;

  return (
    <>
      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by name, reference or note…" />
        <select className="select" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Month paid for">
          <option value="">Paid in the period above</option>
          {recentMonths().map((value) => <option key={value} value={value}>For {monthName(value)}</option>)}
        </select>
        <Allow permission="accounting.manage">
          <Button variant="primary" icon={<Plus size={18} />} onClick={openNew} className="toolbar-end">Pay someone</Button>
        </Allow>
      </div>

      {data && (
        <div className="ledger-totals">
          <span>{month ? `For ${monthName(month)}` : 'Paid in this period'}</span>
          <span>{data.summary.people} {data.summary.people === 1 ? 'person' : 'people'} · {data.summary.payments} payment{data.summary.payments === 1 ? '' : 's'}</span>
          <span>Total <b className="num">{rupees(data.summary.totalPaisa)}</b></span>
        </div>
      )}

      <div className="table-wrap">
        {loading && !data
          ? <TableSkeleton columns={5} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<Banknote size={30} />} title="No salaries recorded here"
                message="Record each salary, advance or bonus as it is paid. They are counted as a running cost in the profit and loss."
                action={can('accounting.manage') ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Pay someone</Button> : undefined}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr><th>Person</th><th>For</th><th>Paid on</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                    </thead>
                    <tbody>
                      {data.data.map((row) => (
                        <tr key={row.id}>
                          <td className="cell-title">
                            <span className="cell-main">{row.staff_name}</span>
                            <div className="cell-sub">{payment(row.payment_method)}{row.reference ? ` · ${row.reference}` : ''}{row.note ? ` · ${row.note}` : ''}</div>
                          </td>
                          <td data-label="For">
                            <span className={`badge no-dot ${row.kind === 'salary' ? 'badge-neutral' : row.kind === 'bonus' ? 'badge-ok' : 'badge-warn'}`}>{KIND_LABEL[row.kind]}</span>
                            <span className="t-sm t-dim"> {monthName(row.period)}</span>
                          </td>
                          <td data-label="Paid on" className="t-sm">{date(row.paid_on)}</td>
                          <td data-label="Paid" className="t-right">
                            <div className="t-bold num">{rupees(row.net_paisa)}</div>
                            {row.deductions_paisa > 0 && <div className="cell-sub">after {rupees(row.deductions_paisa)} deducted</div>}
                          </td>
                          <td data-label="Actions">
                            <Allow permission="accounting.manage">
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => openEdit(row)} aria-label={`Edit payment to ${row.staff_name}`}><Pencil size={17} /></button>
                                <button className="icon-btn" onClick={() => setRemoving(row)} aria-label={`Delete payment to ${row.staff_name}`}><Trash2 size={17} /></button>
                              </div>
                            </Allow>
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

      <Modal
        open={formOpen} onClose={() => setFormOpen(false)} size="md" icon={<Banknote />}
        title={editing ? 'Edit payment' : 'Pay someone'}
        footer={(
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!who || !form.period || net <= 0}>
              {editing ? 'Save changes' : `Record ${rupees(Math.max(0, net))}`}
            </Button>
          </>
        )}
      >
        <div className="form-grid">
          <SelectInput
            label="Who was paid" required value={form.staffId} placeholder="Choose a person" wrapClass="span-2"
            onChange={(event) => set({ staffId: event.target.value })}
            options={[
              ...(payees?.data ?? []).map((person) => ({ value: person.id, label: `${person.name}${person.role ? ` — ${person.role}` : ''}${person.status !== 'active' ? ' (suspended)' : ''}` })),
              /* Editing a payment to someone the list no longer offers. */
              ...(editing?.staff_id && !payees?.data.some((person) => person.id === editing.staff_id) ? [{ value: editing.staff_id, label: editing.staff_name }] : []),
              { value: SOMEONE_ELSE, label: 'Someone without a KSF account…' }
            ]}
          />
          {form.staffId === SOMEONE_ELSE && (
            <TextInput label="Their name" required wrapClass="span-2" placeholder="e.g. Rafiq (cleaner)" value={form.staffName} onChange={(event) => set({ staffName: event.target.value })} />
          )}
          <div className="span-2">
            <Segmented
              value={form.kind} onChange={(kind) => set({ kind })} label="Kind of payment"
              options={(data?.kinds ?? [{ value: 'salary', label: 'Salary' }]).map((kind) => ({ value: kind.value, label: kind.label }))}
            />
          </div>
          <TextInput label="For the month of" required type="month" value={form.period} max={thisMonth()} onChange={(event) => set({ period: event.target.value })} />
          <TextInput label="Paid on" type="date" max={todayIso()} value={form.paidOn} onChange={(event) => set({ paidOn: event.target.value })} />
          <TextInput label={form.kind === 'salary' ? 'Basic pay' : 'Amount'} required type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01" value={form.basic} onChange={(event) => set({ basic: event.target.value })} />
          <TextInput label="Allowances" type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01" value={form.allowances} onChange={(event) => set({ allowances: event.target.value })} hint="Overtime, travel, food" />
          <TextInput label="Deductions" type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01" value={form.deductions} onChange={(event) => set({ deductions: event.target.value })} hint="An advance taken back, leave" />
          <SelectInput
            label="Paid by" value={form.paymentMethod} onChange={(event) => set({ paymentMethod: event.target.value })}
            options={(data?.methods ?? ['cash']).map((value) => ({ value, label: PAYMENT_LABELS[value] ?? value }))}
          />
          <TextInput label="Reference" placeholder="Cheque or transfer number" value={form.reference} onChange={(event) => set({ reference: event.target.value })} />
          <TextArea label="Note" rows={2} wrapClass="span-2" value={form.note} onChange={(event) => set({ note: event.target.value })} />
          <div className={`salary-net span-2 ${net <= 0 ? 'is-neg' : ''}`}>
            <span>Paid to them</span>
            <b className="num">{rupees(net)}</b>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing} onCancel={() => setRemoving(null)} loading={busy} title="Delete this payment?" confirmLabel="Delete"
        message={<>This removes the {removing ? KIND_LABEL[removing.kind].toLowerCase() : ''} paid to <b>{removing?.staff_name}</b> ({rupees(removing?.net_paisa ?? 0)}) from the accounts. The deletion stays in the audit trail.</>}
        onConfirm={() => run(() => api.delete(`/accounting/salaries/${removing!.id}`), () => { setRemoving(null); changed('Payment deleted'); })}
      />
    </>
  );
}
