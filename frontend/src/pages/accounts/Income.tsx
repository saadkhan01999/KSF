/* Money that came in other than from a sale: a supplier's bonus, shelf rent,
   delivery charges. Sales are counted from the till and never typed here. */

import { useEffect, useState } from 'react';
import { HandCoins, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useDebounced } from '../../hooks/useApi';
import { api, query } from '../../services/api';
import {
  Allow, Button, ConfirmDialog, EmptyState, Modal, Pager, SearchField, SelectInput, TableSkeleton, TextInput
} from '../../components/ui';
import type { IncomeEntry } from '../../types/accounting';
import type { Paged } from '../../types';
import { date, payment, PAYMENT_LABELS, rupees, toPaisa, toRupeeInput, todayIso } from '../../utils/format';

interface IncomeReply extends Paged<IncomeEntry> {
  summary: { totalPaisa: number; entries: number };
  categories: string[];
  methods: string[];
}

const blank = { category: '', description: '', amount: '', receivedOn: todayIso(), paymentMethod: 'cash', payer: '', reference: '' };

export function AccountsIncome({ range, onChanged }: { range: string; onChanged: () => void }) {
  const { ok, can } = useApp();
  const { busy, run } = useAction();
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, category, range]);

  const { data, loading, reload } = useApiData<IncomeReply>(
    `/accounting/income?${range}&${query({ q: search, category, page, size: 25 }).slice(1)}`,
    [range, search, category, page]
  );

  const [editing, setEditing] = useState<IncomeEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [removing, setRemoving] = useState<IncomeEntry | null>(null);
  const set = (patch: Partial<typeof blank>) => setForm((current) => ({ ...current, ...patch }));

  const openNew = () => {
    setEditing(null);
    setForm({ ...blank, category: data?.categories[0] ?? '' });
    setFormOpen(true);
  };
  const openEdit = (entry: IncomeEntry) => {
    setEditing(entry);
    setForm({
      category: entry.category, description: entry.description, amount: toRupeeInput(entry.amount_paisa), receivedOn: entry.received_on,
      paymentMethod: entry.payment_method, payer: entry.payer ?? '', reference: entry.reference ?? ''
    });
    setFormOpen(true);
  };
  const changed = (message: string) => { ok(message); void reload(true); onChanged(); };

  const save = () => run(
    () => {
      const body = { ...form, amountPaisa: toPaisa(form.amount) };
      return editing ? api.patch(`/accounting/income/${editing.id}`, body) : api.post('/accounting/income', body);
    },
    () => { setFormOpen(false); changed(editing ? 'Income entry updated' : 'Income recorded'); }
  );

  return (
    <>
      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search description, payer or reference…" />
        <select className="select" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Kind of income">
          <option value="all">All kinds of income</option>
          {(data?.categories ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <Allow permission="accounting.manage">
          <Button variant="primary" icon={<Plus size={18} />} onClick={openNew} className="toolbar-end">Record income</Button>
        </Allow>
      </div>

      {data && (
        <div className="ledger-totals">
          <span>{data.summary.entries} entr{data.summary.entries === 1 ? 'y' : 'ies'}</span>
          <span>Total <b className="num">{rupees(data.summary.totalPaisa)}</b></span>
        </div>
      )}

      <div className="table-wrap">
        {loading && !data
          ? <TableSkeleton columns={4} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<HandCoins size={30} />} title="No other income in this period"
                message="A supplier's bonus, rent for a shelf, delivery charges — money that did not come through the till. Sales are counted automatically."
                action={can('accounting.manage') ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Record income</Button> : undefined}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr><th>Description</th><th>Kind</th><th>Received</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                    </thead>
                    <tbody>
                      {data.data.map((entry) => (
                        <tr key={entry.id}>
                          <td className="cell-title">
                            <span className="cell-main">{entry.description}</span>
                            <div className="cell-sub">
                              {entry.payer ? `${entry.payer} · ` : ''}{payment(entry.payment_method)}{entry.reference ? ` · ${entry.reference}` : ''}
                            </div>
                          </td>
                          <td data-label="Kind"><span className="badge badge-neutral no-dot">{entry.category}</span></td>
                          <td data-label="Received" className="t-sm">{date(entry.received_on)}</td>
                          <td data-label="Amount" className="t-right"><span className="t-bold num">{rupees(entry.amount_paisa)}</span></td>
                          <td data-label="Actions">
                            <Allow permission="accounting.manage">
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => openEdit(entry)} aria-label={`Edit ${entry.description}`}><Pencil size={17} /></button>
                                <button className="icon-btn" onClick={() => setRemoving(entry)} aria-label={`Delete ${entry.description}`}><Trash2 size={17} /></button>
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
        open={formOpen} onClose={() => setFormOpen(false)} size="md" icon={<HandCoins />}
        title={editing ? 'Edit income' : 'Record income'}
        subtitle="Money that came in other than through the till."
        footer={(
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!form.category || !form.description.trim() || !(Number(form.amount) > 0)}>
              {editing ? 'Save changes' : 'Record it'}
            </Button>
          </>
        )}
      >
        <div className="form-grid">
          <SelectInput
            label="Kind of income" required value={form.category} onChange={(event) => set({ category: event.target.value })}
            options={(data?.categories ?? []).map((name) => ({ value: name, label: name }))}
          />
          <TextInput
            label="Amount" required type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01"
            value={form.amount} onChange={(event) => set({ amount: event.target.value })}
          />
          <TextInput
            label="What was it for?" required wrapClass="span-2" placeholder="e.g. Quarterly volume bonus"
            value={form.description} onChange={(event) => set({ description: event.target.value })}
          />
          <TextInput label="Received from" placeholder="e.g. Premier Distributors" value={form.payer} onChange={(event) => set({ payer: event.target.value })} />
          <TextInput label="Date received" type="date" max={todayIso()} value={form.receivedOn} onChange={(event) => set({ receivedOn: event.target.value })} />
          <SelectInput
            label="Received by" value={form.paymentMethod} onChange={(event) => set({ paymentMethod: event.target.value })}
            options={(data?.methods ?? ['cash']).map((value) => ({ value, label: PAYMENT_LABELS[value] ?? value }))}
          />
          <TextInput label="Reference" placeholder="Cheque or receipt number" value={form.reference} onChange={(event) => set({ reference: event.target.value })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing} onCancel={() => setRemoving(null)} loading={busy} title="Delete this income entry?" confirmLabel="Delete"
        message={<>This removes <b>{removing?.description}</b> ({rupees(removing?.amount_paisa ?? 0)}) from the accounts. The deletion stays in the audit trail.</>}
        onConfirm={() => run(() => api.delete(`/accounting/income/${removing!.id}`), () => { setRemoving(null); changed('Income entry deleted'); })}
      />
    </>
  );
}
