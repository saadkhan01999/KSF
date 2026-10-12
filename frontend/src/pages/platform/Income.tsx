/* What the platform has earned: subscription payments from every pharmacy,
   by month, plan, payment method and pharmacy — with the transfers waiting
   to be matched against the bank statement and the refunds still to finish. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, RotateCcw, BadgeCheck, Download, RefreshCw, Receipt, CircleCheck, FileText } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction, useLiveRefresh } from '../../hooks/useApi';
import { api, query } from '../../services/api';
import {
  Button, Card, StatCard, BarChart, DonutChart, StatusBadge, EmptyState, TableSkeleton, Pager, TextInput, Modal, TextArea, Tabs
} from '../../components/ui';
import { rupees, rupeesShort, number, date, monthLabel, isoDaysAgo, todayIso, downloadCsv, ago, toPaisa } from '../../utils/format';
import type { PaymentAttemptRow, PlatformPayment } from '../../types/platform';
import { InvoiceDialog } from '../../components/invoice';

interface IncomeReply {
  range: { from: string; to: string };
  totals: { grossPaisa: number; refundedPaisa: number; netPaisa: number; payments: number };
  byMonth: { period: string; net: number; gross: number; refunded: number; payments: number }[];
  byPlan: { plan: string; net: number; payments: number }[];
  byProvider: { provider: string; net: number; payments: number }[];
  byPharmacy: { pharmacy_id: string; name: string; net: number; payments: number; last: string }[];
  refunds: { id: string; pharmacy_name: string; amount_paisa: number; reason: string | null; status: string; provider: string; requested_at: string }[];
  data: PlatformPayment[]; page: number; pages: number; total: number; size: number;
}

type Tab = 'payments' | 'pending' | 'refunds';

export default function Income() {
  const navigate = useNavigate();
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [from, setFrom] = useState(isoDaysAgo(365));
  const [to, setTo] = useState(todayIso());
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>('payments');
  const [verifying, setVerifying] = useState<PaymentAttemptRow | null>(null);
  const [refunding, setRefunding] = useState<PlatformPayment | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  const { data, loading, reload } = useApiData<IncomeReply>(`/platform/income${query({ from, to, page })}`, [from, to, page]);
  const pending = useApiData<{ data: PaymentAttemptRow[] }>('/platform/payments/attempts?status=open');
  useLiveRefresh(reload, ['subscription']);
  useLiveRefresh(pending.reload, ['subscription']);

  const reconcile = () => run(
    () => api.post<{ checked: number; settled: number; expired: number }>('/platform/payments/reconcile'),
    (result) => { ok('Payments checked', `${result.checked} open payment(s): ${result.settled} settled, ${result.expired} expired.`); void pending.reload(true); void reload(true); }
  );

  const completeRefund = (refundId: string) => run(
    () => api.post(`/platform/refunds/${refundId}/complete`, {}),
    () => { ok('Refund marked complete'); void reload(true); }
  );

  const exportCsv = () => downloadCsv(`ksf-income-${from}-to-${to}`, (data?.data ?? []).map((row) => ({
    Date: (row.paid_at ?? row.created_at).slice(0, 10), Pharmacy: row.pharmacy_name, Plan: row.plan_key, Provider: row.provider ?? 'manual',
    Method: row.method, Reference: row.provider_reference, Status: row.status, 'Amount (Rs)': row.amount_paisa / 100, 'Refunded (Rs)': (row.refunded_paisa ?? 0) / 100
  })));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Income</h1>
          <p className="sub">Subscription money received from every pharmacy, after refunds.</p>
        </div>
        <div className="actions">
          <TextInput aria-label="From" type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
          <TextInput aria-label="To" type="date" value={to} min={from} max={todayIso()} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>Export</Button>
        </div>
      </div>

      {loading && !data
        ? <TableSkeleton rows={6} columns={4} />
        : data && (
          <>
            <div className="grid grid-4 mb-5">
              <StatCard label="Received, net" value={rupeesShort(data.totals.netPaisa)} icon={<Wallet size={20} />} tone="gold" hint={`${number(data.totals.payments)} payment(s)`} />
              <StatCard label="Received, before refunds" value={rupeesShort(data.totals.grossPaisa)} icon={<Receipt size={20} />} />
              <StatCard label="Refunded" value={rupeesShort(data.totals.refundedPaisa)} icon={<RotateCcw size={20} />} tone={data.totals.refundedPaisa ? 'warn' : 'brand'} />
              <StatCard label="Waiting to be confirmed" value={number(pending.data?.data.length ?? 0)} icon={<BadgeCheck size={20} />} tone={pending.data?.data.length ? 'warn' : 'brand'}
                hint="bank transfers and open checkouts" onClick={() => setTab('pending')} />
            </div>

            <div className="grid grid-2 mb-5">
              <Card title="By month" subtitle={`${date(data.range.from)} – ${date(data.range.to)}`}>
                {data.byMonth.length
                  ? <BarChart data={data.byMonth.map((row) => ({ label: monthLabel(row.period), value: row.net }))} format={rupeesShort} />
                  : <EmptyState icon={<Wallet size={28} />} title="Nothing received in this period" />}
              </Card>
              <Card title="By plan and method">
                <DonutChart data={data.byPlan.map((row) => ({ label: row.plan, value: row.net / 100 }))} format={(value) => rupeesShort(value * 100)} centreLabel="by plan" centreValue={rupeesShort(data.totals.netPaisa)} />
                <div className="row-tight mt-4" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {data.byProvider.map((row) => <span key={row.provider} className="badge badge-neutral no-dot">{row.provider}: {rupeesShort(row.net)}</span>)}
                </div>
              </Card>
            </div>

            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'payments', label: 'Payments', count: data.total },
                { value: 'pending', label: 'Waiting to be confirmed', count: pending.data?.data.length },
                { value: 'refunds', label: 'Refunds', count: data.refunds.length }
              ]}
            />

            {tab === 'payments' && (
              <div className="table-wrap mb-5">
                {!data.data.length
                  ? <EmptyState icon={<Wallet size={28} />} title="No payments in this period" />
                  : (
                    <>
                      <div className="table-scroll">
                        <table className="tbl responsive">
                          <thead><tr><th>Pharmacy</th><th>When</th><th>How</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                          <tbody>
                            {data.data.map((row) => (
                              <tr key={row.id}>
                                <td className="cell-title">
                                  <button className="link-button" onClick={() => navigate(`/platform/pharmacies/${row.pharmacy_id}`)}>{row.pharmacy_name ?? row.pharmacy_id}</button>
                                  <div className="cell-sub">{row.plan_key ?? '—'} plan · {row.kind}</div>
                                </td>
                                <td data-label="When" className="t-sm">{date(row.paid_at ?? row.created_at)}</td>
                                <td data-label="How" className="t-sm">{row.provider ?? 'manual'}{row.method ? ` · ${row.method}` : ''}<div className="cell-sub mono">{row.provider_reference ?? ''}</div></td>
                                <td data-label="Status"><StatusBadge status={row.status} />{row.refunded_paisa ? <div className="cell-sub">{rupees(row.refunded_paisa)} refunded</div> : null}</td>
                                <td data-label="Amount" className="t-right num t-semi">{rupees(row.amount_paisa)}</td>
                                <td data-label="Actions">
                                  <div className="row-actions">
                                    {(row.status === 'succeeded' || row.status === 'refunded') && (
                                      <button className="icon-btn" onClick={() => setInvoiceId(row.id)} aria-label="Invoice" title="Invoice"><FileText size={16} /></button>
                                    )}
                                    {row.status === 'succeeded' && (row.refunded_paisa ?? 0) < row.amount_paisa && (
                                      <button className="icon-btn" onClick={() => setRefunding(row)} aria-label="Refund" title="Refund"><RotateCcw size={16} /></button>
                                    )}
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
            )}

            {tab === 'pending' && (
              <div className="table-wrap mb-5">
                <div className="row-between" style={{ padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line)', gap: 8, flexWrap: 'wrap' }}>
                  <span className="t-sm t-dim">Online checkouts settle by themselves. A bank transfer waits for you to see it on the statement.</span>
                  <Button size="sm" variant="outline" icon={<RefreshCw size={15} />} loading={busy} onClick={() => { void reconcile(); }}>Ask the providers again</Button>
                </div>
                {!pending.data?.data.length
                  ? <EmptyState icon={<CircleCheck size={28} />} title="Nothing waiting" />
                  : (
                    <div className="table-scroll">
                      <table className="tbl responsive">
                        <thead><tr><th>Reference</th><th>Pharmacy</th><th>Method</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                        <tbody>
                          {pending.data.data.map((row) => (
                            <tr key={row.id}>
                              <td className="cell-title"><div className="cell-main mono">{row.reference}</div><div className="cell-sub">{row.plan_key} plan · started {ago(row.created_at)} by {row.created_by_name ?? '—'}</div></td>
                              <td data-label="Pharmacy"><button className="link-button" onClick={() => navigate(`/platform/pharmacies/${row.pharmacy_id}`)}>{row.pharmacy_name}</button></td>
                              <td data-label="Method"><StatusBadge status={row.status} /> {row.provider}</td>
                              <td data-label="Amount" className="t-right num t-semi">{rupees(row.amount_paisa)}</td>
                              <td data-label="Actions"><div className="row-actions">{row.provider === 'bank-transfer' && <Button size="sm" variant="primary" onClick={() => setVerifying(row)}>Confirm</Button>}</div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            )}

            {tab === 'refunds' && (
              <div className="table-wrap mb-5">
                {!data.refunds.length
                  ? <EmptyState icon={<RotateCcw size={28} />} title="No refunds" />
                  : (
                    <div className="table-scroll">
                      <table className="tbl responsive">
                        <thead><tr><th>Pharmacy</th><th>Reason</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                        <tbody>
                          {data.refunds.map((row) => (
                            <tr key={row.id}>
                              <td className="cell-title"><div className="cell-main">{row.pharmacy_name}</div><div className="cell-sub">{date(row.requested_at)} · {row.provider}</div></td>
                              <td data-label="Reason" className="t-sm">{row.reason ?? '—'}</td>
                              <td data-label="Status"><StatusBadge status={row.status === 'completed' ? 'completed' : row.status} /></td>
                              <td data-label="Amount" className="t-right num t-semi">{rupees(row.amount_paisa)}</td>
                              <td data-label="Actions">
                                <div className="row-actions">
                                  {row.status === 'pending' && <Button size="sm" variant="outline" loading={busy} onClick={() => { void completeRefund(row.id); }}>Mark refunded</Button>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            )}

            <Card title="By pharmacy" subtitle="Who has paid the most in this period" pad={false}>
              {!data.byPharmacy.length
                ? <EmptyState title="Nothing yet" />
                : (
                  <div className="table-scroll">
                    <table className="tbl responsive">
                      <thead><tr><th>Pharmacy</th><th>Payments</th><th>Last paid</th><th style={{ textAlign: 'right' }}>Net</th></tr></thead>
                      <tbody>
                        {data.byPharmacy.map((row) => (
                          <tr key={row.pharmacy_id} onClick={() => navigate(`/platform/pharmacies/${row.pharmacy_id}`)} style={{ cursor: 'pointer' }}>
                            <td className="cell-title cell-main">{row.name}</td>
                            <td data-label="Payments">{number(row.payments)}</td>
                            <td data-label="Last paid" className="t-sm">{date(row.last)}</td>
                            <td data-label="Net" className="t-right num t-semi">{rupees(row.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </Card>
          </>
        )}

      <ConfirmTransfer attempt={verifying} onClose={() => setVerifying(null)} onDone={() => { setVerifying(null); void pending.reload(true); void reload(true); }} />
      <Refund payment={refunding} onClose={() => setRefunding(null)} onDone={() => { setRefunding(null); void reload(true); }} />
      <InvoiceDialog paymentId={invoiceId} source="platform" onClose={() => setInvoiceId(null)} />
    </>
  );
}

function ConfirmTransfer({ attempt, onClose, onDone }: { attempt: PaymentAttemptRow | null; onClose: () => void; onDone: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [statement, setStatement] = useState('');
  const [note, setNote] = useState('');
  const save = () => run(
    () => api.post<{ message: string }>(`/platform/payments/attempts/${attempt!.id}/verify`, { statementReference: statement, note }),
    (reply) => { ok('Transfer confirmed', reply.message); setStatement(''); setNote(''); onDone(); }
  );
  return (
    <Modal open={!!attempt} onClose={onClose} icon={<BadgeCheck />} title={`Confirm ${attempt?.reference ?? ''}`}
      subtitle={attempt ? `${rupees(attempt.amount_paisa)} from ${attempt.pharmacy_name}. Confirm only once you can see it on your bank statement.` : ''}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!statement.trim()}>Confirm payment</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        <TextInput label="Bank statement reference" required value={statement} onChange={(event) => setStatement(event.target.value)} />
        <TextArea label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
    </Modal>
  );
}

function Refund({ payment, onClose, onDone }: { payment: PlatformPayment | null; onClose: () => void; onDone: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const left = payment ? payment.amount_paisa - (payment.refunded_paisa ?? 0) : 0;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const save = () => run(
    () => api.post<{ message: string }>(`/platform/payments/${payment!.id}/refund`, { amountPaisa: amount ? toPaisa(amount) : left, reason }),
    (reply) => { ok('Refund recorded', reply.message); setAmount(''); setReason(''); onDone(); }
  );
  return (
    <Modal open={!!payment} onClose={onClose} tone="warn" icon={<RotateCcw />} title={`Refund ${payment?.pharmacy_name ?? ''}`}
      subtitle={payment ? `Up to ${rupees(left)} can be refunded. Leave the amount empty to refund all of it.` : ''}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={save} disabled={reason.trim().length < 3}>Refund</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        <TextInput label="Amount" prefix="Rs" type="number" min={1} placeholder={String(left / 100)} value={amount} onChange={(event) => setAmount(event.target.value)} />
        <TextArea label="Reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </Modal>
  );
}
