/* Suppliers and distributors. */

import { useState } from 'react';
import {
  Plus, Truck, Pencil, Trash2, Phone, Mail, MapPin, Star, Building2, Download
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, Modal, TextInput, TextArea, SelectInput, ConfirmDialog,
  StatusBadge, Badge, EmptyState, CardSkeleton, Allow
} from '../components/ui';
import { rupees, number, date, phone as fmtPhone, downloadCsv } from '../utils/format';
import type { Supplier } from '../types';

const TERMS = ['Cash on delivery', '7 days credit', '15 days credit', '30 days credit', '45 days credit', '60 days credit'];

const empty = {
  name: '', contactPerson: '', phone: '', email: '', address: '',
  city: 'Karachi', ntn: '', paymentTerms: 'Cash on delivery', rating: 4, notes: '', status: 'active'
};

export default function Suppliers() {
  const { ok, can } = useApp();
  const { busy, run } = useAction();

  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);
  const [removing, setRemoving] = useState<Supplier | null>(null);

  const { data, loading, reload } = useApiData<{ data: Supplier[] }>(
    `/suppliers${query({ q: search })}`, [search]
  );

  const openNew = () => { setEditing(null); setForm(empty); setFormOpen(true); };
  const openEdit = (supplier: Supplier) => {
    setEditing(supplier);
    setForm({
      name: supplier.name, contactPerson: supplier.contact_person ?? '', phone: supplier.phone ?? '',
      email: supplier.email ?? '', address: supplier.address ?? '', city: supplier.city ?? 'Karachi',
      ntn: supplier.ntn ?? '', paymentTerms: supplier.payment_terms, rating: supplier.rating,
      notes: supplier.notes ?? '', status: supplier.status
    });
    setFormOpen(true);
  };

  const save = () => run(
    () => (editing ? api.patch(`/suppliers/${editing.id}`, form) : api.post('/suppliers', form)),
    () => { setFormOpen(false); ok(editing ? 'Supplier updated' : 'Supplier added', form.name); void reload(true); }
  );

  const suppliers = data?.data ?? [];

  const exportCsv = () => {
    downloadCsv(`ksf-suppliers-${new Date().toISOString().slice(0, 10)}`, suppliers.map((s) => ({
      Supplier: s.name, Contact: s.contact_person, Phone: s.phone, Email: s.email,
      City: s.city, NTN: s.ntn, Terms: s.payment_terms, Orders: s.order_count ?? 0,
      'Total spend (Rs)': (s.total_spend_paisa ?? 0) / 100,
      'Owed to them (Rs)': (s.payable_paisa ?? 0) / 100,
      'Of which brought across (Rs)': (s.opening_balance_paisa ?? 0) / 100,
      Status: s.status
    })));
    ok('Exported', 'Your supplier list has been saved as a CSV file.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Suppliers</h1>
          <p className="sub">The distributors and companies you buy stock from, with what you have spent with each.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!suppliers.length}>Export</Button>
          <Allow permission="suppliers.write">
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Add supplier</Button>
          </Allow>
        </div>
      </div>

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by name, contact, city or phone…" />
      </div>

      {loading
        ? <CardSkeleton count={6} />
        : suppliers.length === 0
          ? (
            <div className="table-wrap">
              <EmptyState
                icon={<Truck size={30} />}
                title={term ? 'No supplier matches that search' : 'No suppliers yet'}
                message="Add the distributors you buy from so purchase orders can be raised against them."
                action={can('suppliers.write') && !term
                  ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Add your first supplier</Button>
                  : undefined}
              />
            </div>
          )
          : (
            <div className="grid grid-auto-lg">
              {suppliers.map((supplier) => (
                <div className="card card-hover card-pad" key={supplier.id}>
                  <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                    <span className="stat-icon" style={{ width: 46, height: 46, flex: '0 0 46px' }}>
                      <Building2 size={22} />
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row-between" style={{ gap: 8 }}>
                        <h3 className="truncate" style={{ fontSize: 'var(--fs-md)' }}>{supplier.name}</h3>
                        <StatusBadge status={supplier.status} />
                      </div>
                      <div className="t-sm t-soft mt-2">{supplier.contact_person || 'No named contact'}</div>
                      <div className="row-tight t-xs t-dim mt-2" aria-label="Rating">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <Star
                            key={index}
                            size={13}
                            fill={index < supplier.rating ? 'var(--gold-500)' : 'none'}
                            color={index < supplier.rating ? 'var(--gold-500)' : 'var(--ink-300)'}
                          />
                        ))}
                        <span style={{ marginLeft: 4 }}>{supplier.payment_terms}</span>
                      </div>
                    </div>
                  </div>

                  <div className="col mt-4" style={{ gap: 7 }}>
                    {supplier.phone && (
                      <a href={`tel:${supplier.phone}`} className="row-tight t-sm" style={{ color: 'var(--text-soft)' }}>
                        <Phone size={14} /> {fmtPhone(supplier.phone)}
                      </a>
                    )}
                    {supplier.email && (
                      <a href={`mailto:${supplier.email}`} className="row-tight t-sm truncate" style={{ color: 'var(--text-soft)' }}>
                        <Mail size={14} /> {supplier.email}
                      </a>
                    )}
                    {(supplier.address || supplier.city) && (
                      <span className="row-tight t-sm t-soft">
                        <MapPin size={14} /> <span className="truncate">{[supplier.address, supplier.city].filter(Boolean).join(', ')}</span>
                      </span>
                    )}
                  </div>

                  <div className="row-between mt-4" style={{ paddingTop: 14, borderTop: '1px solid var(--line-faint)' }}>
                    <div>
                      <div className="t-xs t-dim">Bought from them</div>
                      <div className="t-semi">
                        {rupees(supplier.total_spend_paisa ?? 0)}
                        <span className="t-xs t-dim"> · {number(supplier.order_count ?? 0)} orders</span>
                      </div>
                      {supplier.last_order && <div className="t-xs t-dim">last {date(supplier.last_order)}</div>}
                      {/* What is owed: the figure brought across at the migration plus
                          received orders still unpaid. Broken out, because the two are
                          settled in different places. */}
                      {(supplier.payable_paisa ?? 0) > 0 && (
                        <div className="mt-2">
                          <Badge tone="warn" dot={false}>You owe {rupees(supplier.payable_paisa ?? 0)}</Badge>
                          <div className="t-xs t-dim">
                            {(supplier.opening_balance_paisa ?? 0) > 0 && (
                              <>{rupees(supplier.opening_balance_paisa ?? 0)} brought across</>
                            )}
                            {(supplier.opening_balance_paisa ?? 0) > 0 && (supplier.unpaid_orders_paisa ?? 0) > 0 && ' · '}
                            {(supplier.unpaid_orders_paisa ?? 0) > 0 && (
                              <>{rupees(supplier.unpaid_orders_paisa ?? 0)} on unpaid orders</>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <Allow permission="suppliers.write">
                      <div className="row-tight">
                        <button className="icon-btn" onClick={() => openEdit(supplier)} aria-label={`Edit ${supplier.name}`}><Pencil size={16} /></button>
                        <button className="icon-btn" onClick={() => setRemoving(supplier)} aria-label={`Remove ${supplier.name}`}><Trash2 size={16} /></button>
                      </div>
                    </Allow>
                  </div>
                </div>
              ))}
            </div>
          )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="lg"
        icon={<Truck />}
        title={editing ? `Edit ${editing.name}` : 'Add a supplier'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim()}>
              {editing ? 'Save changes' : 'Add supplier'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <TextInput
            label="Company name" required wrapClass="span-2"
            placeholder="e.g. Getz Pharma Distribution"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextInput
            label="Contact person" placeholder="Who do you speak to?"
            value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
          />
          <TextInput
            label="Phone" icon={<Phone />} placeholder="+92 21 3456 7890" inputMode="tel"
            value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <TextInput
            label="Email" type="email" icon={<Mail />} placeholder="orders@supplier.pk"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <TextInput
            label="City" placeholder="Karachi"
            value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <TextInput
            label="Address" wrapClass="span-2"
            placeholder="Street, area, landmark"
            value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <TextInput
            label="NTN" placeholder="1234567-8"
            hint="National Tax Number, for your purchase records"
            value={form.ntn} onChange={(e) => setForm({ ...form, ntn: e.target.value })}
          />
          <SelectInput
            label="Payment terms"
            value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
            options={TERMS.map((t) => ({ value: t, label: t }))}
          />
          <div className="field span-2">
            <label className="label">How reliable are they?</label>
            <div className="row-tight">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="icon-btn"
                  onClick={() => setForm({ ...form, rating: value })}
                  aria-label={`${value} out of 5`}
                >
                  <Star size={22} fill={value <= form.rating ? 'var(--gold-500)' : 'none'} color={value <= form.rating ? 'var(--gold-500)' : 'var(--ink-300)'} />
                </button>
              ))}
              <span className="t-sm t-dim" style={{ marginLeft: 8 }}>{form.rating} of 5</span>
            </div>
          </div>
          <TextArea
            label="Notes" className="span-2"
            placeholder="Delivery days, minimum order, anything worth remembering"
            value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/suppliers/${removing!.id}`),
          () => { setRemoving(null); ok('Supplier removed'); void reload(true); }
        )}
        loading={busy}
        title="Remove this supplier?"
        confirmLabel="Remove"
        message={
          <>
            <b>{removing?.name}</b> will be removed. If they have purchase orders on record they are
            made inactive instead, so your buying history stays intact.
          </>
        }
      />
    </>
  );
}
