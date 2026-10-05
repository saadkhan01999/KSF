/* Running costs: rent, K-Electric, salaries, licences and everything else that
   comes out of the till before the owner sees a profit. */

import { useEffect, useState } from 'react';
import {
  Plus, Wallet, Pencil, Trash2, Download, Check, Receipt, TrendingDown, Clock
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, StatCard, StatusBadge, Modal, TextInput, 
  SelectInput, ConfirmDialog, EmptyState, TableSkeleton, Pager, Allow,
  DonutChart, Card, Segmented
} from '../components/ui';
import {
  rupees, rupeesShort, toPaisa, toRupeeInput, number, date,
  isoDaysAgo, todayIso, payment, PAYMENT_LABELS, downloadCsv
} from '../utils/format';
import type { Expense, Paged } from '../types';

interface ExpenseResponse extends Paged<Expense> {
  summary: { total: number; approved: number; pending: number; entries: number };
  byCategory: { category: string; amount: number; entries: number }[];
  categories: string[];
}

const empty = {
  category: '', description: '', amount: '', expenseDate: todayIso(),
  paymentMethod: 'cash', reference: '', vendor: ''
};

export default function Expenses() {
  const { ok, can } = useApp();
  const { busy, run } = useAction();

  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState(isoDaysAgo(89));
  const [to, setTo] = useState(todayIso());
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState(empty);
  const [removing, setRemoving] = useState<Expense | null>(null);
  const [approving, setApproving] = useState<Expense | null>(null);

  const path = `/expenses${query({ q: search, category, status, from, to, page, size: 25 })}`;
  const { data, loading, reload } = useApiData<ExpenseResponse>(path, [search, category, status, from, to, page]);

  useEffect(() => { setPage(1); }, [search, category, status, from, to]);

  const summary = data?.summary;

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty, category: data?.categories?.[0] ?? '' });
    setFormOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setForm({
      category: expense.category, description: expense.description,
      amount: toRupeeInput(expense.amount_paisa), expenseDate: expense.expense_date,
      paymentMethod: expense.payment_method, reference: expense.reference ?? '',
      vendor: expense.vendor ?? ''
    });
    setFormOpen(true);
  };

  const save = () => run(
    () => {
      const payload = { ...form, amountPaisa: toPaisa(form.amount) };
      return editing ? api.patch(`/expenses/${editing.id}`, payload) : api.post('/expenses', payload);
    },
    () => { setFormOpen(false); ok(editing ? 'Expense updated' : 'Expense recorded', form.description); void reload(true); }
  );

  const exportCsv = () => {
    if (!data?.data.length) return;
    downloadCsv(`ksf-expenses-${from}-to-${to}`, data.data.map((e) => ({
      Date: e.expense_date, Category: e.category, Description: e.description,
      Vendor: e.vendor, 'Paid by': payment(e.payment_method), Reference: e.reference,
      'Amount (Rs)': e.amount_paisa / 100, Status: e.status,
      'Recorded by': e.created_by_name, 'Approved by': e.approved_by_name
    })));
    ok('Exported', 'Your expense list has been saved as a CSV file.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expenses</h1>
          <p className="sub">Every rupee the pharmacy spends outside stock. These are subtracted from gross profit in your reports.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>Export</Button>
          <Allow permission="expenses.write">
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Record expense</Button>
          </Allow>
        </div>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Spent in this period" value={rupeesShort(summary?.total ?? 0)} icon={<TrendingDown size={20} />} tone="danger" hint={`${number(summary?.entries ?? 0)} entries`} />
        <StatCard label="Approved" value={rupeesShort(summary?.approved ?? 0)} icon={<Check size={20} />} />
        <StatCard label="Waiting for approval" value={rupeesShort(summary?.pending ?? 0)} icon={<Clock size={20} />} tone="warn" onClick={() => setStatus('recorded')} />
        <StatCard
          label="Biggest category"
          value={data?.byCategory?.[0]?.category ?? '—'}
          icon={<Wallet size={20} />}
          tone="info"
          hint={data?.byCategory?.[0] ? rupees(data.byCategory[0].amount) : undefined}
        />
      </div>

      {!!data?.byCategory?.length && (
        <div className="mb-5">
          <Card title="Where the money goes" subtitle={`${date(from)} to ${date(to)}`}>
            <DonutChart
              data={data.byCategory.slice(0, 8).map((row) => ({ label: row.category, value: row.amount }))}
              centreLabel="total spent"
              centreValue={rupeesShort(summary?.total ?? 0)}
              format={(value) => rupeesShort(value)}
            />
          </Card>
        </div>
      )}

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by description, vendor or reference…" />
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {(data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input" style={{ width: 'auto' }} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="input" style={{ width: 'auto' }} type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'recorded', label: 'Pending' },
            { value: 'approved', label: 'Approved' }
          ]}
        />
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={5} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<Wallet size={30} />}
                title="No expenses in this period"
                message="Recording rent, bills and salaries here is what makes the net profit figure on your reports real."
                action={can('expenses.write')
                  ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Record the first expense</Button>
                  : undefined}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((expense) => (
                        <tr key={expense.id}>
                          <td className="cell-title">
                            <span className="cell-main">{expense.description}</span>
                            <div className="cell-sub">
                              {expense.vendor ? `${expense.vendor} · ` : ''}
                              {payment(expense.payment_method)}
                              {expense.reference ? ` · ${expense.reference}` : ''}
                            </div>
                          </td>
                          <td data-label="Category"><span className="badge badge-neutral no-dot">{expense.category}</span></td>
                          <td data-label="Date" className="t-sm">{date(expense.expense_date)}</td>
                          <td data-label="Amount" className="t-right">
                            <div className="t-bold num">{rupees(expense.amount_paisa)}</div>
                            <div className="cell-sub"><StatusBadge status={expense.status} /></div>
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions">
                              <Allow permission="expenses.approve">
                                {expense.status === 'recorded' && (
                                  <button className="btn btn-quiet btn-sm" onClick={() => setApproving(expense)}>
                                    <Check size={14} /> Approve
                                  </button>
                                )}
                              </Allow>
                              <Allow permission="expenses.write">
                                <button className="icon-btn" onClick={() => openEdit(expense)} aria-label="Edit"><Pencil size={17} /></button>
                                <button className="icon-btn" onClick={() => setRemoving(expense)} aria-label="Delete"><Trash2 size={17} /></button>
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

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="md"
        icon={<Receipt />}
        title={editing ? 'Edit expense' : 'Record an expense'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              variant="primary" loading={busy} onClick={save}
              disabled={!form.description.trim() || !form.category || !form.amount}
            >
              {editing ? 'Save changes' : 'Record it'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <SelectInput
            label="Category" required
            value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="Choose a category"
            options={(data?.categories ?? []).map((c) => ({ value: c, label: c }))}
          />
          <TextInput
            label="Amount" required type="number" prefix="Rs" min={0} step="0.01"
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <TextInput
            label="What was it for?" required wrapClass="span-2"
            placeholder="e.g. K-Electric bill for August"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <TextInput
            label="Paid to" placeholder="e.g. K-Electric"
            value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          />
          <TextInput
            label="Date" type="date" max={todayIso()}
            value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
            hint="Cannot be in the future"
          />
          <SelectInput
            label="Paid by"
            value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
            options={Object.entries(PAYMENT_LABELS)
              .filter(([key]) => key !== 'credit')
              .map(([value, label]) => ({ value, label }))}
          />
          <TextInput
            label="Reference" placeholder="Cheque number, bill number…"
            value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!approving}
        onCancel={() => setApproving(null)}
        onConfirm={() => run(
          () => api.post(`/expenses/${approving!.id}/approve`, {}),
          () => { setApproving(null); ok('Expense approved'); void reload(true); }
        )}
        loading={busy}
        tone="warn"
        title="Approve this expense?"
        confirmLabel="Approve"
        message={<><b>{approving?.description}</b> — {rupees(approving?.amount_paisa ?? 0)}. Your name is recorded as the approver.</>}
      />

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/expenses/${removing!.id}`),
          () => { setRemoving(null); ok('Expense deleted'); void reload(true); }
        )}
        loading={busy}
        title="Delete this expense?"
        confirmLabel="Delete"
        message={<>This removes <b>{removing?.description}</b> ({rupees(removing?.amount_paisa ?? 0)}) from your accounts. The deletion is recorded in the audit trail.</>}
      />
    </>
  );
}
