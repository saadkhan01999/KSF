/* The medicine catalogue: what the pharmacy sells, and the rules attached to
   each product — price, minimum stock, whether it needs a prescription, and
   where it sits on the shelf. */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Pill, Pencil, Trash2, Download, Package, MoreVertical,
  Barcode, MapPin, ShieldAlert, Eye
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction, useSort } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, SelectInput, TextInput, Checkbox, Modal,
  ConfirmDialog, StatusBadge, Badge, EmptyState, TableSkeleton, Pager,
  SortHead, Menu, MenuItem, Allow, Meter, Alert
} from '../components/ui';
import { rupees, toPaisa, toRupeeInput, number, date, downloadCsv } from '../utils/format';
import type { Category, Medicine, Paged } from '../types';

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Inhaler', 'Cream', 'Ointment', 'Lotion', 'Solution', 'Drops', 'Sachet', 'Powder', 'Strips', 'Piece', 'Box', 'Pack'];

const emptyForm = {
  name: '', genericName: '', manufacturer: '', form: 'Tablet', strength: '', packSize: '',
  categoryId: '', barcode: '', sku: '', drapRegNo: '', shelfLocation: '', storageNote: '',
  cost: '', price: '', gstPercent: '0', minStock: '10', maxStock: '',
  requiresPrescription: false, isControlled: false, status: 'active'
};

export default function Medicines() {
  const { ok, can } = useApp();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();

  const [term, setTerm] = useState(params.get('q') ?? '');
  const search = useDebounced(term);
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [rx, setRx] = useState('');
  const [page, setPage] = useState(1);
  const { sort, dir, onSort } = useSort('name', 'asc');

  const [editing, setEditing] = useState<Medicine | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [removing, setRemoving] = useState<Medicine | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  /* Opened from the medicine directory with "Add to my medicines": the form
     starts filled in from the entry, and only the prices and stock levels are
     left to type. The draft is read once, then cleared from the history. */
  const location = useLocation();
  const navigate = useNavigate();
  const [prefill] = useState(() => (location.state as { prefill?: Partial<typeof emptyForm> } | null)?.prefill ?? null);
  useEffect(() => {
    if (!prefill) return;
    setEditing(null);
    setForm({ ...emptyForm, ...prefill });
    setFormOpen(true);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const path = `/medicines${query({ q: search, category, state, rx, page, size: 25, sort, dir })}`;
  const { data, loading, reload } = useApiData<Paged<Medicine>>(path, [search, category, state, rx, page, sort, dir]);
  const { data: categories } = useApiData<{ data: Category[] }>('/categories');
  const { data: detail } = useApiData<{ data: Medicine & { batches: unknown[]; sales_30d: { units: number; revenue: number } } }>(
    viewing ? `/medicines/${viewing}` : null, [viewing]
  );

  useEffect(() => { setPage(1); }, [search, category, state, rx]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (term) next.set('q', term);
    if (category) next.set('category', category);
    if (state) next.set('state', state);
    setParams(next, { replace: true });
  }, [term, category, state, setParams]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, categoryId: categories?.data[0]?.id ?? '' });
    setFieldError(null);
    setFormOpen(true);
  };

  const openEdit = (medicine: Medicine) => {
    setEditing(medicine);
    setForm({
      name: medicine.name, genericName: medicine.generic_name ?? '', manufacturer: medicine.manufacturer ?? '',
      form: medicine.form, strength: medicine.strength ?? '', packSize: medicine.pack_size ?? '',
      categoryId: medicine.category_id ?? '', barcode: medicine.barcode ?? '', sku: medicine.sku ?? '',
      drapRegNo: medicine.drap_reg_no ?? '', shelfLocation: medicine.shelf_location ?? '',
      storageNote: medicine.storage_note ?? '',
      cost: toRupeeInput(medicine.cost_paisa), price: toRupeeInput(medicine.price_paisa),
      gstPercent: String(medicine.gst_percent ?? 0),
      minStock: String(medicine.min_stock), maxStock: String(medicine.max_stock),
      requiresPrescription: !!medicine.requires_prescription,
      isControlled: !!medicine.is_controlled,
      status: medicine.status
    });
    setFieldError(null);
    setFormOpen(true);
  };

  const save = () => {
    setFieldError(null);
    const payload = {
      name: form.name, genericName: form.genericName, manufacturer: form.manufacturer,
      form: form.form, strength: form.strength, packSize: form.packSize,
      categoryId: form.categoryId, barcode: form.barcode, sku: form.sku,
      drapRegNo: form.drapRegNo, shelfLocation: form.shelfLocation, storageNote: form.storageNote,
      costPaisa: toPaisa(form.cost), pricePaisa: toPaisa(form.price),
      gstPercent: Number(form.gstPercent || 0),
      minStock: Number(form.minStock || 0), maxStock: Number(form.maxStock || 0),
      requiresPrescription: form.requiresPrescription, isControlled: form.isControlled,
      status: form.status
    };
    return run(
      () => (editing ? api.patch(`/medicines/${editing.id}`, payload) : api.post('/medicines', payload)),
      () => {
        setFormOpen(false);
        ok(editing ? 'Medicine updated' : 'Medicine added', form.name);
        void reload(true);
      }
    ).catch(() => undefined);
  };

  const exportCsv = () => {
    if (!data?.data.length) return;
    downloadCsv(`ksf-medicines-${new Date().toISOString().slice(0, 10)}`, data.data.map((m) => ({
      Medicine: m.name, Generic: m.generic_name, Category: m.category_name, Form: m.form,
      Strength: m.strength, Pack: m.pack_size, Barcode: m.barcode, Shelf: m.shelf_location,
      'Cost (Rs)': m.cost_paisa / 100, 'Price (Rs)': m.price_paisa / 100,
      'On hand': m.on_hand, 'Minimum': m.min_stock,
      'Prescription only': m.requires_prescription ? 'Yes' : 'No', Status: m.status
    })));
    ok('Exported', 'The list has been saved as a CSV file.');
  };

  const margin = form.price && form.cost && Number(form.price) > 0
    ? Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 1000) / 10
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Medicines</h1>
          <p className="sub">Everything the pharmacy sells, with its price, pack size and stock rules.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>
            Export
          </Button>
          <Allow permission="medicines.write">
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Add medicine</Button>
          </Allow>
        </div>
      </div>

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by name, generic, barcode or maker…" />
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(categories?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select" value={state} onChange={(e) => setState(e.target.value)} aria-label="Stock level">
          <option value="">Any stock level</option>
          <option value="in-stock">In stock</option>
          <option value="reorder-soon">Reorder soon</option>
          <option value="low-stock">Low stock</option>
          <option value="out-of-stock">Out of stock</option>
        </select>
        <select className="select" value={rx} onChange={(e) => setRx(e.target.value)} aria-label="Prescription">
          <option value="">All medicines</option>
          <option value="true">Prescription-only</option>
          <option value="false">Over the counter</option>
        </select>
        {(term || category || state || rx) && (
          <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setCategory(''); setState(''); setRx(''); }}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={6} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<Pill size={30} />}
                title={term ? 'Nothing matches that search' : 'The catalogue is empty'}
                message={term
                  ? 'Try the generic name, or clear the filters above.'
                  : 'Add your first medicine to start selling and tracking stock.'}
                action={can('medicines.write') && !term
                  ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Add the first medicine</Button>
                  : undefined}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <SortHead label="Medicine" field="name" sort={sort} dir={dir} onSort={onSort} />
                        <th>Category</th>
                        <th>Shelf</th>
                        <SortHead label="Stock" field="stock" sort={sort} dir={dir} onSort={onSort} />
                        <SortHead label="Price" field="price" sort={sort} dir={dir} onSort={onSort} align="right" />
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((medicine) => (
                        <tr key={medicine.id}>
                          <td className="cell-title">
                            <div className="row-tight">
                              <span className="cell-main">{medicine.name}</span>
                              {!!medicine.requires_prescription && <Badge tone="purple" dot={false}>Rx</Badge>}
                              {!!medicine.is_controlled && <Badge tone="danger" dot={false}>Controlled</Badge>}
                            </div>
                            <div className="cell-sub">
                              {medicine.generic_name || '—'} · {medicine.form}
                              {medicine.strength ? ` ${medicine.strength}` : ''}
                              {medicine.pack_size ? ` · ${medicine.pack_size}` : ''}
                            </div>
                          </td>
                          <td data-label="Category">
                            {medicine.category_name
                              ? <Badge tone={medicine.category_colour ?? 'neutral'} dot={false}>{medicine.category_name}</Badge>
                              : <span className="t-dim">—</span>}
                          </td>
                          <td data-label="Shelf">
                            <span className="t-sm">{medicine.shelf_location || '—'}</span>
                          </td>
                          <td data-label="Stock">
                            <div className="stock-meter">
                              <Meter value={medicine.on_hand} max={Math.max(medicine.min_stock * 3, 1)} />
                              <span className="n">{number(medicine.on_hand)}</span>
                            </div>
                            <div className="cell-sub"><StatusBadge status={medicine.stock_state} /></div>
                          </td>
                          <td data-label="Price" className="t-right">
                            <div className="t-bold num">{rupees(medicine.price_paisa)}</div>
                            <div className="cell-sub">cost {rupees(medicine.cost_paisa)}</div>
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions">
                              <button className="icon-btn" onClick={() => setViewing(medicine.id)} aria-label="View details" title="View details">
                                <Eye size={17} />
                              </button>
                              <Allow permission="medicines.write">
                                <button className="icon-btn" onClick={() => openEdit(medicine)} aria-label="Edit" title="Edit">
                                  <Pencil size={17} />
                                </button>
                              </Allow>
                              <Allow permission="medicines.delete">
                                <Menu
                                  trigger={({ toggle }) => (
                                    <button className="icon-btn" onClick={toggle} aria-label="More actions"><MoreVertical size={17} /></button>
                                  )}
                                >
                                  {(close) => (
                                    <MenuItem icon={<Trash2 />} danger onClick={() => { close(); setRemoving(medicine); }}>
                                      Retire this medicine
                                    </MenuItem>
                                  )}
                                </Menu>
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
        icon={<Pill />}
        title={editing ? `Edit ${editing.name}` : 'Add a medicine'}
        subtitle="Everything except the name can be filled in later."
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim()}>
              {editing ? 'Save changes' : 'Add to catalogue'}
            </Button>
          </>
        }
      >
        {fieldError && <div className="mb-4"><Alert tone="danger">{fieldError.message}</Alert></div>}

        <div className="form-grid">
          <TextInput
            label="Medicine name" required wrapClass="span-2"
            placeholder="e.g. Panadol Extra"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextInput
            label="Generic name" hint="The salt or active ingredient"
            placeholder="e.g. Paracetamol + Caffeine"
            value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })}
          />
          <TextInput
            label="Manufacturer" placeholder="e.g. GSK Pakistan"
            value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
          />
          <SelectInput
            label="Category"
            value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            placeholder="No category"
            options={(categories?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectInput
            label="Form"
            value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value })}
            options={FORMS.map((f) => ({ value: f, label: f }))}
          />
          <TextInput
            label="Strength" placeholder="e.g. 500mg"
            value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })}
          />
          <TextInput
            label="Pack size" placeholder="e.g. 20 tablets"
            value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })}
          />

          <fieldset className="fieldset span-2">
            <legend>Pricing</legend>
            <div className="form-grid">
              <TextInput
                label="Purchase cost" type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01"
                value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
              <TextInput
                label="Selling price" type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01"
                value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                hint={margin !== null ? `Margin ${margin}%` : 'What the customer pays'}
                error={margin !== null && margin < 0 ? 'The price is below the cost.' : undefined}
              />
              <TextInput
                label="GST %" type="number" inputMode="decimal" suffix="%" min={0} max={100} step="0.5"
                value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })}
                hint="Leave at 0 unless this item is taxed"
              />
            </div>
          </fieldset>

          <fieldset className="fieldset span-2">
            <legend>Stock rules</legend>
            <div className="form-grid">
              <TextInput
                label="Minimum stock" type="number" min={0}
                value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                hint="KSF warns you when stock falls to this level"
              />
              <TextInput
                label="Maximum stock" type="number" min={0}
                value={form.maxStock} onChange={(e) => setForm({ ...form, maxStock: e.target.value })}
                hint="Used to suggest order quantities"
              />
              <TextInput
                label="Shelf location" placeholder="e.g. Rack C-3" icon={<MapPin />}
                value={form.shelfLocation} onChange={(e) => setForm({ ...form, shelfLocation: e.target.value })}
              />
              <TextInput
                label="Storage note" placeholder="e.g. Store between 2°C and 8°C"
                value={form.storageNote} onChange={(e) => setForm({ ...form, storageNote: e.target.value })}
              />
            </div>
          </fieldset>

          <fieldset className="fieldset span-2">
            <legend>Identification</legend>
            <div className="form-grid">
              <TextInput
                label="Barcode" icon={<Barcode />} placeholder="Scan or type the barcode"
                value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
              <TextInput
                label="Your own code (SKU)" placeholder="Left blank, KSF creates one"
                value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <TextInput
                label="DRAP registration number" wrapClass="span-2"
                placeholder="e.g. DRAP-024518"
                hint="From the Drug Regulatory Authority of Pakistan registration on the pack"
                value={form.drapRegNo} onChange={(e) => setForm({ ...form, drapRegNo: e.target.value })}
              />
            </div>
          </fieldset>

          <div className="span-2 col" style={{ gap: 4 }}>
            <Checkbox
              checked={form.requiresPrescription}
              onChange={(v) => setForm({ ...form, requiresPrescription: v })}
              label="Prescription-only medicine"
              hint="The till will refuse to sell this without a prescription a pharmacist has verified."
            />
            <Checkbox
              checked={form.isControlled}
              onChange={(v) => setForm({ ...form, isControlled: v })}
              label="Controlled substance"
              hint="Flags the item for extra care in the audit trail."
            />
          </div>
        </div>
      </Modal>

      {/* ------------------------------ detail ---------------------------- */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        icon={<Package />}
        title={detail?.data?.name ?? 'Medicine'}
        subtitle={detail?.data ? `${detail.data.form}${detail.data.strength ? ` · ${detail.data.strength}` : ''}` : ''}
        footer={<Button variant="outline" onClick={() => setViewing(null)}>Close</Button>}
      >
        {!detail?.data
          ? <TableSkeleton rows={4} columns={2} />
          : (
            <>
              <div className="grid grid-3 mb-5">
                <div className="mini-card"><div className="lbl">On the shelf</div><div className="val">{number(detail.data.on_hand)}</div></div>
                <div className="mini-card"><div className="lbl">Sold (30 days)</div><div className="val">{number(detail.data.sales_30d?.units ?? 0)}</div></div>
                <div className="mini-card"><div className="lbl">Revenue (30 days)</div><div className="val">{rupees(detail.data.sales_30d?.revenue ?? 0)}</div></div>
              </div>

              {!!detail.data.requires_prescription && (
                <div className="mb-4">
                  <Alert tone="warn" title="Prescription-only" icon={<ShieldAlert />}>
                    This medicine cannot be sold at the till unless a pharmacist has verified a prescription for it.
                  </Alert>
                </div>
              )}

              <dl className="kv mb-5">
                <dt>Generic name</dt><dd>{detail.data.generic_name || '—'}</dd>
                <dt>Manufacturer</dt><dd>{detail.data.manufacturer || '—'}</dd>
                <dt>Category</dt><dd>{detail.data.category_name || '—'}</dd>
                <dt>Pack size</dt><dd>{detail.data.pack_size || '—'}</dd>
                <dt>Barcode</dt><dd className="mono">{detail.data.barcode || '—'}</dd>
                <dt>DRAP number</dt><dd className="mono">{detail.data.drap_reg_no || '—'}</dd>
                <dt>Shelf</dt><dd>{detail.data.shelf_location || '—'}</dd>
                <dt>Storage</dt><dd>{detail.data.storage_note || '—'}</dd>
                <dt>Cost / price</dt><dd>{rupees(detail.data.cost_paisa)} → {rupees(detail.data.price_paisa)}</dd>
                <dt>Minimum stock</dt><dd>{detail.data.min_stock}</dd>
              </dl>

              <h4 className="mb-3">Batches on record</h4>
              <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr><th>Batch</th><th>Expiry</th><th className="t-right">Units</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {(detail.data.batches as { id: string; batch_no: string; expiry_date: string; quantity: number; status: string; state: string }[]).map((batch) => (
                      <tr key={batch.id}>
                        <td className="mono">{batch.batch_no}</td>
                        <td>{date(batch.expiry_date)}</td>
                        <td className="t-right num">{batch.quantity}</td>
                        <td><StatusBadge status={batch.status === 'active' ? batch.state : batch.status} /></td>
                      </tr>
                    ))}
                    {!(detail.data.batches as unknown[]).length && (
                      <tr><td colSpan={4} className="t-center t-dim">No batches recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/medicines/${removing!.id}`),
          () => { setRemoving(null); ok('Medicine retired', `${removing!.name} is no longer on sale.`); void reload(true); }
        )}
        loading={busy}
        title="Retire this medicine?"
        confirmLabel="Retire it"
        message={
          <>
            <b>{removing?.name}</b> will be taken off the till and out of the catalogue.
            Its sales history is kept, so your reports stay accurate.
            {(removing?.on_hand ?? 0) > 0 && (
              <span style={{ display: 'block', marginTop: 10, color: 'var(--danger-600)', fontWeight: 600 }}>
                There are still {removing?.on_hand} units in stock. Sell or write them off first.
              </span>
            )}
          </>
        }
      />
    </>
  );
}
