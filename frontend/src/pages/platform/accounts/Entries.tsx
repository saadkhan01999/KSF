/* KSF's own income and expenses other than subscriptions: a setup fee in;
   team salaries, servers, software or rent out. Subscriptions and refunds are
   counted from the payments and never typed here. */

import { useEffect, useState } from 'react';
import { HandCoins, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAction, useApiData, useDebounced } from '../../../hooks/useApi';
import { api, query } from '../../../services/api';
import {
  Allow, Button, ConfirmDialog, EmptyState, Modal, Pager, SearchField, Segmented, SelectInput, TableSkeleton, TextInput
} from '../../../components/ui';
import type { PlatformEntry, PlatformEntryKind } from '../../../types/accounting';
import type { Paged } from '../../../types';
import { date, payment, PAYMENT_LABELS, rupees, toPaisa, toRupeeInput, todayIso } from '../../../utils/format';

interface EntriesReply extends Paged<PlatformEntry> {
  summary: { incomePaisa: number; expensesPaisa: number; entries: number };
  categories: Record<PlatformEntryKind, string[]>;
  methods: string[];
  team: string[];
}

const MANAGE = 'platform.finance.manage';
const blank = {
  kind: 'expense' as PlatformEntryKind, category: '', description: '', amount: '', entryDate: todayIso(),
  paymentMethod: 'bank-transfer', party: '', reference: ''
};

export function PlatformEntries({ range, onChanged }: { range: string; onChanged: () => void }) {
  const { ok, can } = useApp();
  const { busy, run } = useAction();
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [kind, setKind] = useState<'all' | PlatformEntryKind>('all');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, kind, range]);

  const { data, loading, reload } = useApiData<EntriesReply>(
    `/platform/accounts/entries?${range}&${query({ q: search, kind, page, size: 25 }).slice(1)}`,
    [range, search, kind, page]
  );

  const [editing, setEditing] = useState<PlatformEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [removing, setRemoving] = useState<PlatformEntry | null>(null);
  const set = (patch: Partial<typeof blank>) => setForm((current) => ({ ...current, ...patch }));
  const categoriesFor = (which: PlatformEntryKind) => data?.categories[which] ?? [];

  const openNew = (which: PlatformEntryKind) => {
    setEditing(null);
    setForm({ ...blank, kind: which, category: categoriesFor(which)[0] ?? '' });
    setFormOpen(true);
  };
  const openEdit = (entry: PlatformEntry) => {
    setEditing(entry);
    setForm({
      kind: entry.kind, category: entry.category, description: entry.description, amount: toRupeeInput(entry.amount_paisa),
      entryDate: entry.entry_date, paymentMethod: entry.payment_method, party: entry.party ?? '', reference: entry.reference ?? ''
    });
    setFormOpen(true);
  };
  const changed = (message: string) => { ok(message); void reload(true); onChanged(); };

  const save = () => run(
    () => {
      const body = { ...form, amountPaisa: toPaisa(form.amount) };
      return editing ? api.patch(`/platform/accounts/entries/${editing.id}`, body) : api.post('/platform/accounts/entries', body);
    },
    () => { setFormOpen(false); changed(editing ? 'Entry updated' : form.kind === 'income' ? 'Income recorded' : 'Expense recorded'); }
  );

  const income = form.kind === 'income';

  return (
    <>
      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search description, who, or reference…" />
        <Segmented
          value={kind} onChange={setKind} label="Show"
          options={[{ value: 'all', label: 'All' }, { value: 'income', label: 'Income' }, { value: 'expense', label: 'Expenses' }]}
        />
        <Allow permission={MANAGE}>
          <div className="toolbar-end row-tight wrap">
            <Button variant="outline" icon={<HandCoins size={17} />} onClick={() => openNew('income')}>Record income</Button>
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => openNew('expense')}>Record expense</Button>
          </div>
        </Allow>
      </div>

      {data && (
        <div className="ledger-totals">
          <span>Income <b className="num t-ok">{rupees(data.summary.incomePaisa)}</b></span>
          <span>Expenses <b className="num t-danger">{rupees(data.summary.expensesPaisa)}</b></span>
          <span>{data.summary.entries} entr{data.summary.entries === 1 ? 'y' : 'ies'}</span>
        </div>
      )}

      <div className="table-wrap">
        {loading && !data
          ? <TableSkeleton columns={4} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<ReceiptText size={30} />} title="Nothing recorded in this period"
                message="Team salaries, servers, software, marketing, rent — and income other than subscriptions, such as a setup fee. Subscriptions are counted automatically."
                action={can(MANAGE) ? <Button variant="primary" icon={<Plus size={18} />} onClick={() => openNew('expense')}>Record expense</Button> : undefined}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr><th>Description</th><th>Category</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                    </thead>
                    <tbody>
                      {data.data.map((entry) => (
                        <tr key={entry.id}>
                          <td className="cell-title">
                            <span className="cell-main">{entry.description}</span>
                            <div className="cell-sub">
                              {entry.party ? `${entry.kind === 'income' ? 'From' : 'To'} ${entry.party} · ` : ''}{payment(entry.payment_method)}{entry.reference ? ` · ${entry.reference}` : ''}
                            </div>
                          </td>
                          <td data-label="Category">
                            <span className={`badge no-dot ${entry.kind === 'income' ? 'badge-ok' : 'badge-neutral'}`}>{entry.category}</span>
                          </td>
                          <td data-label="Date" className="t-sm">{date(entry.entry_date)}</td>
                          <td data-label="Amount" className="t-right">
                            <span className={`t-bold num ${entry.kind === 'income' ? 't-ok' : 't-danger'}`}>
                              {entry.kind === 'income' ? '+' : '−'}{rupees(entry.amount_paisa)}
                            </span>
                          </td>
                          <td data-label="Actions">
                            <Allow permission={MANAGE}>
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
        open={formOpen} onClose={() => setFormOpen(false)} size="md" icon={income ? <HandCoins /> : <ReceiptText />}
        title={editing ? `Edit ${income ? 'income' : 'expense'}` : income ? 'Record income' : 'Record an expense'}
        subtitle={income ? 'Money KSF received other than a subscription.' : 'Money KSF spent: salaries, servers, software, rent and the rest.'}
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
          {!editing && (
            <div className="span-2">
              <Segmented
                value={form.kind} label="Income or expense"
                onChange={(next) => set({ kind: next, category: categoriesFor(next)[0] ?? '' })}
                options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]}
              />
            </div>
          )}
          <SelectInput
            label="Category" required value={form.category} onChange={(event) => set({ category: event.target.value })}
            options={categoriesFor(form.kind).map((name) => ({ value: name, label: name }))}
          />
          <TextInput
            label="Amount" required type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01"
            value={form.amount} onChange={(event) => set({ amount: event.target.value })}
          />
          <TextInput
            label={income ? 'What was it for?' : 'What was it spent on?'} required wrapClass="span-2"
            placeholder={income ? 'e.g. Setup and staff training for a new pharmacy' : 'e.g. Server hosting for October'}
            value={form.description} onChange={(event) => set({ description: event.target.value })}
          />
          <TextInput
            label={income ? 'Received from' : 'Paid to'} list="platform-team" placeholder={income ? 'e.g. Khan Pharmacy' : 'e.g. a team member or a company'}
            value={form.party} onChange={(event) => set({ party: event.target.value })}
          />
          <datalist id="platform-team">{(data?.team ?? []).map((name) => <option key={name} value={name} />)}</datalist>
          <TextInput label="Date" type="date" max={todayIso()} value={form.entryDate} onChange={(event) => set({ entryDate: event.target.value })} />
          <SelectInput
            label={income ? 'Received by' : 'Paid by'} value={form.paymentMethod} onChange={(event) => set({ paymentMethod: event.target.value })}
            options={(data?.methods ?? ['bank-transfer']).map((value) => ({ value, label: PAYMENT_LABELS[value] ?? value }))}
          />
          <TextInput label="Reference" placeholder="Invoice, cheque or transfer number" value={form.reference} onChange={(event) => set({ reference: event.target.value })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing} onCancel={() => setRemoving(null)} loading={busy} title="Delete this entry?" confirmLabel="Delete"
        message={<>This removes <b>{removing?.description}</b> ({rupees(removing?.amount_paisa ?? 0)}) from KSF&apos;s accounts. The deletion is kept in the activity log.</>}
        onConfirm={() => run(() => api.delete(`/platform/accounts/entries/${removing!.id}`), () => { setRemoving(null); changed('Entry deleted'); })}
      />
    </>
  );
}
