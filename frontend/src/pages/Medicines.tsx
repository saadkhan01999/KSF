/* The medicine catalogue: what the pharmacy sells, and the rules attached to
   each product — price, minimum stock, whether it needs a prescription, and
   where it sits on the shelf.

   Adding a medicine starts with its pack: scan the barcode (scanner, camera
   or typed) and the form fills in what KSF knows about the product — the
   fields it filled are tinted until someone changes them. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Pill, Pencil, Trash2, Download, Package, MoreVertical,
  Barcode, MapPin, ShieldAlert, Eye, ScanBarcode, Camera
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction, useSort } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, SelectInput, TextInput, Checkbox, Modal,
  ConfirmDialog, StatusBadge, Badge, EmptyState, TableSkeleton, Pager,
  SortHead, Menu, MenuItem, Allow, Meter, Alert, Spinner
} from '../components/ui';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { CameraScanner } from './pos/CameraScanner';
import { FILLABLE, productLine, sourceLine, type BarcodeInfo } from '../utils/barcodeInfo';
import { readable } from '../utils/scanner';
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
  /* The fields a person typed in; a barcode lookup never overwrites them. */
  const touched = useRef(new Set<string>());
  const edit = useCallback((patch: Partial<typeof emptyForm>) => {
    /* A field emptied again counts as untouched — as when a scanner's first
       keys landed in it and were taken back out. */
    for (const [key, value] of Object.entries(patch)) {
      if (value === '') touched.current.delete(key); else touched.current.add(key);
    }
    setFilled((current) => current.filter((key) => !(key in patch)));
    setForm((current) => ({ ...current, ...patch }));
  }, []);
  /* The pack's barcode, looked up: what was found, and which fields it filled. */
  const [lookup, setLookup] = useState<{ state: 'idle' | 'looking' | 'found' | 'unknown' | 'existing' | 'failed'; code?: string; info?: BarcodeInfo }>({ state: 'idle' });
  const [filled, setFilled] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const lookupRun = useRef(0);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [removing, setRemoving] = useState<Medicine | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  /** Look a barcode up and fill in the fields nobody has typed in yet. */
  const fillFrom = useCallback(async (code: string) => {
    const text = code.trim();
    if (!text) return;
    const run = ++lookupRun.current;
    setLookup({ state: 'looking', code: text });
    try {
      const info = await api.get<BarcodeInfo>(`/medicines-barcode-info${query({ code: text })}`);
      if (run !== lookupRun.current) return;
      setForm((current) => ({ ...current, barcode: info.barcode }));
      if (info.existing) { setLookup({ state: 'existing', code: text, info }); return; }
      if (!info.fields) { setLookup({ state: 'unknown', code: text, info }); return; }
      const patch: Record<string, string | boolean> = {};
      for (const [key] of FILLABLE) {
        const value = info.fields[key];
        if (value === null || value === undefined || value === '' || touched.current.has(key)) continue;
        if (key === 'form' && !FORMS.includes(String(value))) continue;
        patch[key] = value;
      }
      setForm((current) => ({ ...current, ...patch }));
      setFilled(Object.keys(patch));
      setLookup({ state: 'found', code: text, info });
    } catch {
      if (run === lookupRun.current) setLookup({ state: 'failed', code: text });
    }
  }, []);

  /* A hardware scanner while the form is open: the code goes into the
     barcode field wherever the cursor is, and a new medicine is filled in. */
  const onFormScan = useCallback((code: string) => {
    edit({ barcode: readable(code) });
    if (!editing) { void fillFrom(code); return; }
    /* Editing: only the barcode changes — as printed on the box, for a 2D code. */
    void api.get<BarcodeInfo>(`/medicines-barcode-info${query({ code })}`)
      .then((info) => setForm((current) => ({ ...current, barcode: info.barcode })))
      .catch(() => undefined);
  }, [edit, editing, fillFrom]);
  useBarcodeScanner(onFormScan, formOpen && !cameraOpen);

  /* Opened from the medicine directory with "Add to my medicines": the form
     starts filled in from the entry, and only the prices and stock levels are
     left to type. Opened from the till with an unknown barcode
     (?barcode=…, in a new tab so the sale is kept): the form starts with it.
     The draft is read once, then cleared from the history. */
  const location = useLocation();
  const navigate = useNavigate();
  const [prefill] = useState(() => (location.state as { prefill?: Partial<typeof emptyForm> } | null)?.prefill
    ?? (params.get('barcode') ? { barcode: params.get('barcode') ?? '' } : null));
  useEffect(() => {
    if (!prefill) return;
    setEditing(null);
    setForm({ ...emptyForm, ...prefill });
    touched.current = new Set(Object.keys(prefill).filter((key) => key !== 'barcode'));
    setFilled([]);
    setLookup({ state: 'idle' });
    setFormOpen(true);
    /* From the till: the pack's details come from its barcode. */
    if (prefill.barcode && !prefill.name) void fillFrom(prefill.barcode);
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
    touched.current = new Set();
    setFilled([]);
    setLookup({ state: 'idle' });
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
    touched.current = new Set();
    setFilled([]);
    setLookup({ state: 'idle' });
    setFieldError(null);
    setFormOpen(true);
  };

  /** The medicine that already has a scanned barcode, opened for editing. */
  const openExisting = async (id: string) => {
    const found = await api.get<{ data: Medicine }>(`/medicines/${id}`).catch(() => null);
    if (found) openEdit(found.data);
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
        onClose={() => { if (!cameraOpen) setFormOpen(false); }}
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

        {!editing && (
          <PackScan
            lookup={lookup} filled={filled}
            onCamera={() => setCameraOpen(true)}
            onOpenExisting={(id) => { void openExisting(id); }}
          />
        )}

        <div className="form-grid">
          <TextInput
            label="Medicine name" required wrapClass="span-2"
            placeholder="e.g. Panadol Extra"
            className={filled.includes('name') ? 'is-autofilled' : ''}
            value={form.name} onChange={(e) => edit({ name: e.target.value })}
          />
          <TextInput
            label="Generic name" hint="The salt or active ingredient"
            placeholder="e.g. Paracetamol + Caffeine"
            className={filled.includes('genericName') ? 'is-autofilled' : ''}
            value={form.genericName} onChange={(e) => edit({ genericName: e.target.value })}
          />
          <TextInput
            label="Manufacturer" placeholder="e.g. GSK Pakistan"
            className={filled.includes('manufacturer') ? 'is-autofilled' : ''}
            value={form.manufacturer} onChange={(e) => edit({ manufacturer: e.target.value })}
          />
          <SelectInput
            label="Category"
            className={filled.includes('categoryId') ? 'is-autofilled' : ''}
            value={form.categoryId} onChange={(e) => edit({ categoryId: e.target.value })}
            placeholder="No category"
            options={(categories?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectInput
            label="Form"
            className={filled.includes('form') ? 'is-autofilled' : ''}
            value={form.form} onChange={(e) => edit({ form: e.target.value })}
            options={FORMS.map((f) => ({ value: f, label: f }))}
          />
          <TextInput
            label="Strength" placeholder="e.g. 500mg"
            className={filled.includes('strength') ? 'is-autofilled' : ''}
            value={form.strength} onChange={(e) => edit({ strength: e.target.value })}
          />
          <TextInput
            label="Pack size" placeholder="e.g. 20 tablets"
            className={filled.includes('packSize') ? 'is-autofilled' : ''}
            value={form.packSize} onChange={(e) => edit({ packSize: e.target.value })}
          />

          <fieldset className="fieldset span-2">
            <legend>Pricing</legend>
            <div className="form-grid">
              <TextInput
                label="Purchase cost" type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01"
                value={form.cost} onChange={(e) => edit({ cost: e.target.value })}
              />
              <TextInput
                label="Selling price" type="number" inputMode="decimal" prefix="Rs" min={0} step="0.01"
                value={form.price} onChange={(e) => edit({ price: e.target.value })}
                hint={margin !== null ? `Margin ${margin}%` : 'What the customer pays'}
                error={margin !== null && margin < 0 ? 'The price is below the cost.' : undefined}
              />
              <TextInput
                label="GST %" type="number" inputMode="decimal" suffix="%" min={0} max={100} step="0.5"
                value={form.gstPercent} onChange={(e) => edit({ gstPercent: e.target.value })}
                hint="Leave at 0 unless this item is taxed"
              />
            </div>
          </fieldset>

          <fieldset className="fieldset span-2">
            <legend>Stock rules</legend>
            <div className="form-grid">
              <TextInput
                label="Minimum stock" type="number" min={0}
                value={form.minStock} onChange={(e) => edit({ minStock: e.target.value })}
                hint="KSF warns you when stock falls to this level"
              />
              <TextInput
                label="Maximum stock" type="number" min={0}
                value={form.maxStock} onChange={(e) => edit({ maxStock: e.target.value })}
                hint="Used to suggest order quantities"
              />
              <TextInput
                label="Shelf location" placeholder="e.g. Rack C-3" icon={<MapPin />}
                value={form.shelfLocation} onChange={(e) => edit({ shelfLocation: e.target.value })}
              />
              <TextInput
                label="Storage note" placeholder="e.g. Store between 2°C and 8°C"
                value={form.storageNote} onChange={(e) => edit({ storageNote: e.target.value })}
              />
            </div>
          </fieldset>

          <fieldset className="fieldset span-2">
            <legend>Identification</legend>
            <div className="form-grid">
              <TextInput
                label="Barcode" icon={<Barcode />} placeholder="Scan or type the barcode"
                value={form.barcode} onChange={(e) => edit({ barcode: e.target.value })}
                hint={editing ? undefined : 'Typed by hand? Press Enter to fill in the rest'}
                onKeyDown={(e) => { if (e.key === 'Enter' && !editing) { e.preventDefault(); void fillFrom(form.barcode); } }}
              />
              <TextInput
                label="Your own code (SKU)" placeholder="Left blank, KSF creates one"
                value={form.sku} onChange={(e) => edit({ sku: e.target.value })}
              />
              <TextInput
                label="DRAP registration number" wrapClass="span-2"
                placeholder="e.g. DRAP-024518"
                hint="From the Drug Regulatory Authority of Pakistan registration on the pack"
                className={filled.includes('drapRegNo') ? 'is-autofilled' : ''}
            value={form.drapRegNo} onChange={(e) => edit({ drapRegNo: e.target.value })}
              />
            </div>
          </fieldset>

          <div className="span-2 col" style={{ gap: 4 }}>
            <Checkbox
              checked={form.requiresPrescription}
              onChange={(v) => edit({ requiresPrescription: v })}
              label="Prescription-only medicine"
              hint="The till will refuse to sell this without a prescription a pharmacist has verified."
            />
            <Checkbox
              checked={form.isControlled}
              onChange={(v) => edit({ isControlled: v })}
              label="Controlled substance"
              hint="Flags the item for extra care in the audit trail."
            />
          </div>
        </div>
      </Modal>

      <CameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCode={(code) => { setCameraOpen(false); onFormScan(code); }}
      />

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

/* The strip at the top of a new medicine: scan the pack, and what came of it. */
function PackScan({ lookup, filled, onCamera, onOpenExisting }: {
  lookup: { state: 'idle' | 'looking' | 'found' | 'unknown' | 'existing' | 'failed'; code?: string; info?: BarcodeInfo };
  filled: string[]; onCamera: () => void; onOpenExisting: (id: string) => void;
}) {
  const info = lookup.info;
  const words = FILLABLE.filter(([key]) => filled.includes(key));
  const pack = info?.gs1 && (info.gs1.batch || info.gs1.expiry)
    ? [info.gs1.batch && `batch ${info.gs1.batch}`, info.gs1.expiry && `expires ${date(info.gs1.expiry)}`].filter(Boolean).join(' · ')
    : '';
  let title: ReactNode = 'Scan the pack to fill this in';
  let text: ReactNode = 'Use the barcode scanner or the camera, or type the barcode below. KSF fills in what it knows about the product.';
  if (lookup.state === 'looking') {
    title = <>Looking up <span className="mono">{readable(lookup.code ?? '')}</span>…</>;
    text = 'Checking KSF and the open product databases.';
  } else if (lookup.state === 'found' && info?.fields) {
    title = info.fields.name;
    text = (
      <>
        {productLine(info.fields) && <span className="pack-scan-line">{productLine(info.fields)}</span>}
        <span className="pack-scan-note">
          {words.length ? `Filled in ${words.length} ${words.length === 1 ? 'detail' : 'details'} from ${sourceLine(info)}` : `Found in ${sourceLine(info)}`} — check them, then add the prices.
        </span>
        {pack && <span className="pack-scan-line">This pack: {pack}</span>}
      </>
    );
  } else if (lookup.state === 'unknown') {
    title = <>KSF does not know <span className="mono">{info?.barcode}</span> yet</>;
    text = 'Fill it in once: the barcode is saved with it, and the next KSF pharmacy that scans this pack gets the details filled in.';
  } else if (lookup.state === 'existing' && info?.existing) {
    title = 'Already in your catalogue';
    text = (
      <>
        {info.existing.name} has this barcode.{' '}
        <button type="button" className="link-btn" onClick={() => onOpenExisting(info.existing!.id)}>Open it</button>
      </>
    );
  } else if (lookup.state === 'failed') {
    title = 'The barcode could not be looked up';
    text = 'Check the connection and scan again, or fill it in by hand.';
  }
  return (
    <div className={`pack-scan is-${lookup.state}`} aria-live="polite">
      <span className="pack-scan-icon" aria-hidden="true">{lookup.state === 'looking' ? <Spinner /> : <ScanBarcode size={22} />}</span>
      <div className="pack-scan-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <Button variant="outline" size="sm" icon={<Camera size={16} />} onClick={onCamera}>Camera</Button>
    </div>
  );
}
