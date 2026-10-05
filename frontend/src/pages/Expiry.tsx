/* Expiry control.

   The one screen that saves a pharmacy real money. Batches are grouped by how
   urgent they are, expired stock is already blocked from sale, and the two
   actions that matter — quarantine and write-off — are one tap away with the
   reason recorded against the person who did it. */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarClock, ShieldAlert, Trash2, Download, PackageCheck, Ban,
  RotateCcw, Coins, Layers
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import {
  Button, StatCard, StatusBadge, ConfirmDialog, EmptyState,
  TableSkeleton, Allow, Alert, Segmented
} from '../components/ui';
import { rupees, rupeesShort, number, date, inDays, downloadCsv } from '../utils/format';
import type { Batch } from '../types';

interface ExpiryResponse {
  data: Batch[];
  summary: {
    expired: number; critical: number; expiring: number; quarantined: number;
    expiredValuePaisa: number; atRiskValuePaisa: number;
  };
  warnDays: number;
}

type Action = { kind: 'quarantine' | 'write-off' | 'release'; batch: Batch } | { kind: 'bulk' } | null;

export default function Expiry() {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();

  const [filter, setFilter] = useState(params.get('state') ?? 'all');
  const [action, setAction] = useState<Action>(null);

  const { data, loading, reload } = useApiData<ExpiryResponse>(`/expiry?state=${filter}`, [filter]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== 'all') next.set('state', filter);
    setParams(next, { replace: true });
  }, [filter, setParams]);

  const summary = data?.summary;
  const batches = data?.data ?? [];

  const perform = (reason: string) => {
    if (!action) return;
    if (action.kind === 'bulk') {
      return run(
        () => api.post<{ quarantined: number }>('/expiry/quarantine-expired'),
        (result) => {
          setAction(null);
          ok('Expired stock quarantined', `${result.quarantined} batch(es) taken off sale.`);
          void reload(true);
        }
      );
    }
    const { batch, kind } = action;
    const endpoint = kind === 'write-off' ? 'write-off' : kind;
    return run(
      () => api.post(`/expiry/${batch.id}/${endpoint}`, { reason, note: reason }),
      () => {
        setAction(null);
        ok(
          kind === 'quarantine' ? 'Batch quarantined'
            : kind === 'release' ? 'Batch released back for sale'
              : 'Batch written off',
          `${batch.medicine_name} · ${batch.batch_no}`
        );
        void reload(true);
      }
    );
  };


  const exportCsv = () => {
    if (!batches.length) return;
    downloadCsv(`ksf-expiry-${new Date().toISOString().slice(0, 10)}`, batches.map((batch) => ({
      Medicine: batch.medicine_name, Batch: batch.batch_no, Expiry: batch.expiry_date,
      'Days left': batch.days, Units: batch.quantity, Status: batch.status,
      'Value at cost (Rs)': (batch.value_paisa ?? 0) / 100, Supplier: batch.supplier_name
    })));
    ok('Exported', 'Your expiry list has been saved as a CSV file.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expiry control</h1>
          <p className="sub">
            Batches are flagged {data?.warnDays ?? 90} days before they expire, so there is time to
            return, discount or move them. Anything past its date is already blocked from the till.
          </p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!batches.length}>
            Export
          </Button>
          <Allow permission="expiry.manage">
            {(summary?.expired ?? 0) > 0 && (
              <Button variant="danger" icon={<Ban size={17} />} onClick={() => setAction({ kind: 'bulk' })}>
                Quarantine all expired
              </Button>
            )}
          </Allow>
        </div>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Already expired" value={number(summary?.expired ?? 0)} icon={<ShieldAlert size={20} />} tone="danger" hint={`${rupeesShort(summary?.expiredValuePaisa ?? 0)} written down`} onClick={() => setFilter('expired')} />
        <StatCard label="Expires within 30 days" value={number(summary?.critical ?? 0)} icon={<CalendarClock size={20} />} tone="warn" hint="act now to avoid loss" onClick={() => setFilter('critical')} />
        <StatCard label="Expires within 90 days" value={number(summary?.expiring ?? 0)} icon={<Layers size={20} />} tone="info" hint="plan a discount or return" onClick={() => setFilter('expiring')} />
        <StatCard label="Value at risk" value={rupeesShort(summary?.atRiskValuePaisa ?? 0)} icon={<Coins size={20} />} tone="gold" hint={`${summary?.quarantined ?? 0} batch(es) quarantined`} />
      </div>

      {(summary?.expired ?? 0) > 0 && (
        <div className="mb-4">
          <Alert tone="danger" title={`${summary!.expired} expired batch${summary!.expired === 1 ? '' : 'es'} still on the shelf`}>
            KSF will not let anyone sell these. Quarantine them so they are physically separated,
            then write them off once they have been disposed of, keeping your stock value honest.
          </Alert>
        </div>
      )}

      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Needs attention' },
            { value: 'expired', label: 'Expired' },
            { value: 'critical', label: 'Within 30 days' },
            { value: 'expiring', label: 'Within 90 days' },
            { value: 'quarantined', label: 'Quarantined' }
          ]}
        />
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={6} />
          : !batches.length
            ? (
              <EmptyState
                icon={<PackageCheck size={30} />}
                title="Nothing needs attention"
                message="No batch is expired, quarantined or close to its expiry date. This is exactly where you want to be."
              />
            )
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th style={{ textAlign: 'right' }}>Units</th>
                      <th style={{ textAlign: 'right' }}>Value at cost</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id}>
                        <td className="cell-title">
                          <span className="cell-main">{batch.medicine_name}</span>
                          <div className="cell-sub">
                            {batch.form}{batch.strength ? ` ${batch.strength}` : ''}
                            {batch.supplier_name ? ` · from ${batch.supplier_name}` : ''}
                          </div>
                        </td>
                        <td data-label="Batch" className="mono t-sm">{batch.batch_no}</td>
                        <td data-label="Expiry">
                          <div className="expiry-flag">
                            <span className={
                              batch.state === 'expired' ? 't-danger'
                                : batch.state === 'critical' ? 't-warn' : ''
                            }>
                              {date(batch.expiry_date)}
                            </span>
                          </div>
                          <div className="cell-sub">{inDays(batch.days ?? 0)}</div>
                        </td>
                        <td data-label="Units" className="t-right num t-bold">{number(batch.quantity)}</td>
                        <td data-label="Value at cost" className="t-right num">{rupees(batch.value_paisa ?? 0)}</td>
                        <td data-label="Status">
                          <div className="row-actions wrap" style={{ gap: 6 }}>
                            <StatusBadge status={batch.status === 'active' ? (batch.state ?? 'safe') : batch.status} />
                            <Allow permission="expiry.manage">
                              {batch.status === 'quarantined'
                                ? (
                                  <>
                                    {(batch.days ?? 0) >= 0 && (
                                      <button
                                        className="btn btn-quiet btn-sm"
                                        onClick={() => setAction({ kind: 'release', batch })}
                                      >
                                        <RotateCcw size={14} /> Release
                                      </button>
                                    )}
                                    <button
                                      className="btn btn-danger-soft btn-sm"
                                      onClick={() => setAction({ kind: 'write-off', batch })}
                                    >
                                      <Trash2 size={14} /> Write off
                                    </button>
                                  </>
                                )
                                : (
                                  <>
                                    <button
                                      className="btn btn-quiet btn-sm"
                                      onClick={() => setAction({ kind: 'quarantine', batch })}
                                    >
                                      <Ban size={14} /> Quarantine
                                    </button>
                                    {batch.state === 'expired' && (
                                      <button
                                        className="btn btn-danger-soft btn-sm"
                                        onClick={() => setAction({ kind: 'write-off', batch })}
                                      >
                                        <Trash2 size={14} /> Write off
                                      </button>
                                    )}
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
            )}
      </div>

      <ConfirmDialog
        open={!!action}
        onCancel={() => setAction(null)}
        onConfirm={(reason) => { void perform(reason); }}
        loading={busy}
        tone={action && action.kind !== 'bulk' && action.kind === 'release' ? 'warn' : 'danger'}
        requireReason={!!action && action.kind !== 'bulk'}
        reasonLabel={
          action && action.kind === 'write-off' ? 'How was this stock disposed of?'
            : action && action.kind === 'release' ? 'Why is it safe to sell again?'
              : 'Why is it being quarantined?'
        }
        confirmLabel={
          action?.kind === 'bulk' ? 'Quarantine them all'
            : action?.kind === 'write-off' ? 'Write it off'
              : action?.kind === 'release' ? 'Release for sale'
                : 'Quarantine batch'
        }
        title={
          action?.kind === 'bulk' ? 'Quarantine every expired batch?'
            : action?.kind === 'write-off' ? 'Write this batch off?'
              : action?.kind === 'release' ? 'Release this batch back for sale?'
                : 'Take this batch off sale?'
        }
        message={
          action?.kind === 'bulk'
            ? `Every batch already past its expiry date will be marked quarantined in one action. This does not remove the stock — you can still write each batch off once it has been disposed of.`
            : action
              ? (
                <>
                  <b>{action.batch.medicine_name}</b>, batch <b>{action.batch.batch_no}</b> —{' '}
                  {action.batch.quantity} units worth {rupees(action.batch.value_paisa ?? 0)}.
                  {action.kind === 'write-off' && (
                    <span style={{ display: 'block', marginTop: 10 }}>
                      The stock will be set to zero and the loss recorded. This cannot be undone.
                    </span>
                  )}
                  {action.kind === 'quarantine' && (
                    <span style={{ display: 'block', marginTop: 10 }}>
                      It will be removed from the till immediately. Move the physical stock off the
                      shelf so nobody sells it by hand.
                    </span>
                  )}
                </>
              )
              : ''
        }
      />
    </>
  );
}
