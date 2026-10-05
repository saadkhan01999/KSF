/* Inventory: what is actually on the shelf right now.

   The distinction that matters here is between stock you can sell and stock
   you cannot. Quarantined and expired units are counted separately and never
   folded into the sellable figure, because that is the number staff trust
   when they tell a customer "yes, we have it". */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Boxes, Download, PackageX, AlertTriangle, Coins, SlidersHorizontal,
  Plus, History, Layers, MapPin
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, StatCard, StatusBadge, Badge, Modal, TextInput, TextArea,
  SelectInput, EmptyState, TableSkeleton, Pager, Allow, Meter, Alert, Segmented
} from '../components/ui';
import { rupees, rupeesShort, number, date, dateTime, downloadCsv } from '../utils/format';
import type { Batch, Medicine, Paged, StockMovement } from '../types';

interface InventoryRow {
  id: string; name: string; generic_name: string | null; form: string; strength: string | null;
  pack_size: string | null; shelf_location: string | null; min_stock: number; max_stock: number;
  cost_paisa: number; price_paisa: number; requires_prescription: number;
  category_name: string | null; category_colour: string | null;
  on_hand: number; blocked_qty: number; batch_count: number;
  next_expiry: string | null; stock_value_paisa: number; stock_state: string;
}

interface InventoryResponse extends Paged<InventoryRow> {
  summary: {
    tracked: number; inStock: number; lowStock: number; outOfStock: number;
    stockValuePaisa: number; retailValuePaisa: number; blockedUnits: number;
  };
}

export default function Inventory() {
  const { ok } = useApp();
  const [params, setParams] = useSearchParams();

  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [state, setState] = useState(params.get('state') ?? '');
  const [page, setPage] = useState(1);

  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [ledgerFor, setLedgerFor] = useState<InventoryRow | null>(null);
  const [addingBatch, setAddingBatch] = useState(false);

  const path = `/inventory${query({ q: search, state, page, size: 25 })}`;
  const { data, loading, reload } = useApiData<InventoryResponse>(path, [search, state, page]);

  useEffect(() => { setPage(1); }, [search, state]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (state) next.set('state', state);
    setParams(next, { replace: true });
  }, [state, setParams]);

  const summary = data?.summary;

  const exportCsv = () => {
    if (!data?.data.length) return;
    downloadCsv(`ksf-inventory-${new Date().toISOString().slice(0, 10)}`, data.data.map((row) => ({
      Medicine: row.name, Category: row.category_name, Form: row.form, Strength: row.strength,
      Shelf: row.shelf_location, 'Sellable units': row.on_hand, 'Blocked units': row.blocked_qty,
      Minimum: row.min_stock, Batches: row.batch_count, 'Next expiry': row.next_expiry,
      'Value at cost (Rs)': row.stock_value_paisa / 100, Status: row.stock_state
    })));
    ok('Exported', 'Your stock list has been saved as a CSV file.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="sub">Live stock across every batch. Only in-date, released batches count as sellable.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>
            Export
          </Button>
          <Allow permission="inventory.adjust">
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setAddingBatch(true)}>
              Add a batch
            </Button>
          </Allow>
        </div>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Stock value (at cost)" value={rupeesShort(summary?.stockValuePaisa ?? 0)} icon={<Coins size={20} />} hint={`Retail ${rupeesShort(summary?.retailValuePaisa ?? 0)}`} tone="gold" />
        <StatCard label="Medicines tracked" value={number(summary?.tracked ?? 0)} icon={<Boxes size={20} />} hint={`${summary?.inStock ?? 0} comfortably in stock`} />
        <StatCard label="Low stock" value={number(summary?.lowStock ?? 0)} icon={<AlertTriangle size={20} />} tone="warn" hint="at or near minimum" onClick={() => setState('low-stock')} />
        <StatCard label="Out of stock" value={number(summary?.outOfStock ?? 0)} icon={<PackageX size={20} />} tone="danger" hint="cannot be sold" onClick={() => setState('out-of-stock')} />
      </div>

      {(summary?.blockedUnits ?? 0) > 0 && (
        <div className="mb-4">
          <Alert tone="warn" title={`${number(summary!.blockedUnits)} units are on the shelf but cannot be sold`}>
            These are quarantined or past their expiry date. They are excluded from every sellable figure on this page.
            Deal with them on the Expiry Control screen.
          </Alert>
        </div>
      )}

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by name, generic name or shelf…" />
        <Segmented
          value={state || 'all'}
          onChange={(value) => setState(value === 'all' ? '' : value)}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'in-stock', label: 'In stock' },
            { value: 'reorder-soon', label: 'Reorder soon' },
            { value: 'low-stock', label: 'Low' },
            { value: 'out-of-stock', label: 'Out' }
          ]}
        />
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={6} />
          : !data?.data.length
            ? <EmptyState icon={<Boxes size={30} />} title="Nothing to show" message="No medicine matches these filters." />
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th>Shelf</th>
                        <th>Sellable stock</th>
                        <th>Batches</th>
                        <th style={{ textAlign: 'right' }}>Value at cost</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((row) => (
                        <tr key={row.id}>
                          <td className="cell-title">
                            <div className="row-tight">
                              <span className="cell-main">{row.name}</span>
                              {!!row.requires_prescription && <Badge tone="purple" dot={false}>Rx</Badge>}
                            </div>
                            <div className="cell-sub">
                              {row.form}{row.strength ? ` ${row.strength}` : ''}
                              {row.category_name ? ` · ${row.category_name}` : ''}
                            </div>
                          </td>
                          <td data-label="Shelf">
                            <span className="row-tight t-sm">
                              {row.shelf_location ? <><MapPin size={13} className="t-dim" />{row.shelf_location}</> : <span className="t-dim">—</span>}
                            </span>
                          </td>
                          <td data-label="Sellable stock">
                            <div className="stock-meter">
                              <Meter value={row.on_hand} max={Math.max(row.min_stock * 3, 1)} />
                              <span className="n">{number(row.on_hand)}</span>
                            </div>
                            <div className="cell-sub row-tight" style={{ justifyContent: 'flex-end' }}>
                              <StatusBadge status={row.stock_state} />
                              {row.blocked_qty > 0 && <Badge tone="warn" dot={false}>{row.blocked_qty} blocked</Badge>}
                            </div>
                          </td>
                          <td data-label="Batches">
                            <div className="t-sm">{row.batch_count} batch{row.batch_count === 1 ? '' : 'es'}</div>
                            {row.next_expiry && (
                              <div className="cell-sub">first expiry {date(row.next_expiry)}</div>
                            )}
                          </td>
                          <td data-label="Value at cost" className="t-right">
                            <div className="t-bold num">{rupees(row.stock_value_paisa)}</div>
                            <div className="cell-sub">min {row.min_stock}</div>
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions">
                              <button className="icon-btn" onClick={() => setLedgerFor(row)} aria-label="Stock history" title="Stock history">
                                <History size={17} />
                              </button>
                              <Allow permission="inventory.adjust">
                                <button className="icon-btn" onClick={() => setAdjusting(row)} aria-label="Adjust stock" title="Adjust stock">
                                  <SlidersHorizontal size={17} />
                                </button>
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

      <AdjustStockModal
        row={adjusting}
        onClose={() => setAdjusting(null)}
        onSaved={() => { setAdjusting(null); void reload(true); }}
      />
      <AddBatchModal
        open={addingBatch}
        onClose={() => setAddingBatch(false)}
        onSaved={() => { setAddingBatch(false); void reload(true); }}
      />
      <LedgerModal row={ledgerFor} onClose={() => setLedgerFor(null)} />
    </>
  );
}

/* --------------------------- stock adjustment --------------------------- */

function AdjustStockModal({
  row, onClose, onSaved
}: { row: InventoryRow | null; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [batchId, setBatchId] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');

  const { data } = useApiData<{ data: Batch[] }>(
    row ? `/inventory/batches?medicine=${row.id}` : null, [row?.id]
  );

  useEffect(() => {
    if (row) { setBatchId(''); setCounted(''); setReason(''); }
  }, [row]);

  const batches = (data?.data ?? []).filter((b) => b.status !== 'written-off');
  const batch = batches.find((b) => b.id === batchId);
  const difference = batch && counted !== '' ? Number(counted) - batch.quantity : 0;

  const submit = () => run(
    () => api.post('/inventory/adjust', { batchId, quantity: Number(counted), reason }),
    () => { ok('Stock corrected', `${row?.name} batch ${batch?.batch_no} is now ${counted}.`); onSaved(); }
  );

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      size="sm"
      icon={<SlidersHorizontal />}
      title="Correct the stock count"
      subtitle={row ? `${row.name} — after a physical count, breakage or loss` : ''}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} onClick={submit}
            disabled={!batchId || counted === '' || reason.trim().length < 3 || difference === 0}
          >
            Save correction
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <Alert tone="info">
          Every correction is recorded in the audit trail against your name. Use it for a real
          count, breakage or loss — not to fix a mistyped sale, which should be refunded instead.
        </Alert>

        <SelectInput
          label="Which batch?" required
          value={batchId} onChange={(e) => setBatchId(e.target.value)}
          placeholder="Choose a batch"
          options={batches.map((b) => ({
            value: b.id,
            label: `${b.batch_no} — ${b.quantity} units, expires ${date(b.expiry_date)}`
          }))}
          hint={batches.length === 0 ? 'This medicine has no batches to adjust.' : undefined}
        />

        {batch && (
          <>
            <div className="grid grid-2">
              <div className="mini-card"><div className="lbl">System says</div><div className="val">{batch.quantity}</div></div>
              <div className="mini-card">
                <div className="lbl">Difference</div>
                <div className="val" style={{ color: difference === 0 ? 'var(--text)' : difference > 0 ? 'var(--ok-600)' : 'var(--danger-600)' }}>
                  {difference > 0 ? '+' : ''}{difference}
                </div>
              </div>
            </div>
            <TextInput
              label="Counted quantity" required type="number" min={0}
              value={counted} onChange={(e) => setCounted(e.target.value)}
              hint="What you actually found on the shelf"
            />
          </>
        )}

        <TextArea
          label="Reason" required
          placeholder="e.g. Physical count on 4 September; two packs damaged in transit"
          value={reason} onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/* ------------------------------ add a batch ------------------------------ */

function AddBatchModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [form, setForm] = useState({ medicineId: '', batchNo: '', expiryDate: '', quantity: '', reason: '' });

  const { data: medicines } = useApiData<{ data: Medicine[] }>(open ? '/medicines-lookup' : null, [open]);

  useEffect(() => {
    if (open) setForm({ medicineId: '', batchNo: '', expiryDate: '', quantity: '', reason: '' });
  }, [open]);

  const submit = () => run(
    () => api.post('/inventory/batches', {
      medicineId: form.medicineId, batchNo: form.batchNo, expiryDate: form.expiryDate,
      quantity: Number(form.quantity), reason: form.reason
    }),
    () => { ok('Batch added', `${form.quantity} units are now on the shelf.`); onSaved(); }
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      icon={<Layers />}
      title="Add a batch by hand"
      subtitle="For opening stock or a small over-the-counter purchase. Deliveries from a supplier should go through Purchases."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy} onClick={submit}
            disabled={!form.medicineId || !form.batchNo || !form.expiryDate || !form.quantity}
          >
            Add to stock
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <SelectInput
          label="Medicine" required
          value={form.medicineId} onChange={(e) => setForm({ ...form, medicineId: e.target.value })}
          placeholder="Choose a medicine"
          options={(medicines?.data ?? []).map((m) => ({ value: m.id, label: `${m.name} — ${m.form}${m.strength ? ` ${m.strength}` : ''}` }))}
        />
        <div className="form-grid">
          <TextInput
            label="Batch number" required placeholder="Printed on the pack"
            value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })}
          />
          <TextInput
            label="Expiry date" required type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            hint="An expired batch cannot be added"
          />
        </div>
        <TextInput
          label="Quantity received" required type="number" min={1}
          value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />
        <TextInput
          label="Note" placeholder="e.g. Opening stock count"
          value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
      </div>
    </Modal>
  );
}

/* ------------------------------ stock ledger ----------------------------- */

const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening stock', purchase: 'Received from supplier', sale: 'Sold',
  refund: 'Returned by customer', adjustment: 'Manual correction',
  'write-off': 'Written off', 'stock-in': 'Added by hand'
};

function LedgerModal({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const { data, loading } = useApiData<Paged<StockMovement>>(
    row ? `/stock-movements?medicine=${row.id}&size=100` : null, [row?.id]
  );

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      size="lg"
      icon={<History />}
      title="Stock history"
      subtitle={row ? `Every movement recorded for ${row.name}` : ''}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      {loading
        ? <TableSkeleton rows={6} columns={4} />
        : !data?.data.length
          ? <EmptyState title="No movements recorded" message="Stock changes will appear here as they happen." />
          : (
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr><th>When</th><th>What happened</th><th>Batch</th><th className="t-right">Change</th><th className="t-right">Balance</th></tr>
                </thead>
                <tbody>
                  {data.data.map((move) => (
                    <tr key={move.id}>
                      <td className="t-sm">{dateTime(move.created_at)}</td>
                      <td>
                        <div className="t-semi t-sm">{MOVEMENT_LABELS[move.type] ?? move.type}</div>
                        {move.reason && <div className="cell-sub">{move.reason}</div>}
                        {move.actor_name && <div className="cell-sub">by {move.actor_name}</div>}
                      </td>
                      <td className="mono t-sm">{move.batch_no ?? '—'}</td>
                      <td className="t-right num t-bold" style={{ color: move.quantity_delta >= 0 ? 'var(--ok-600)' : 'var(--danger-600)' }}>
                        {move.quantity_delta > 0 ? '+' : ''}{move.quantity_delta}
                      </td>
                      <td className="t-right num">{move.balance_after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </Modal>
  );
}
