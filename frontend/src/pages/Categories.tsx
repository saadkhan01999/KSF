/* Medicine categories.

   Shown as cards rather than a table: there are rarely more than a dozen, and
   the colour is part of the information — it is what tints the badge on every
   other screen. */

import { useState } from 'react';
import { Plus, Tags, Pencil, Trash2, Pill } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import {
  Button, Modal, TextInput, TextArea, Checkbox, ConfirmDialog, Badge,
  EmptyState, CardSkeleton, Allow
} from '../components/ui';
import { number } from '../utils/format';
import type { Category, Tone } from '../types';

const COLOURS: { value: Tone; label: string }[] = [
  { value: 'brand', label: 'Green' },
  { value: 'info', label: 'Blue' },
  { value: 'warn', label: 'Amber' },
  { value: 'danger', label: 'Red' },
  { value: 'purple', label: 'Purple' },
  { value: 'gold', label: 'Gold' },
  { value: 'neutral', label: 'Grey' }
];

const SWATCH: Record<Tone, string> = {
  brand: 'var(--brand-500)', ok: 'var(--ok-500)', info: 'var(--info-500)',
  warn: 'var(--warn-500)', danger: 'var(--danger-500)', purple: 'var(--purple-500)',
  gold: 'var(--gold-500)', neutral: 'var(--ink-300)'
};

const empty = { name: '', description: '', colour: 'brand' as Tone, requiresPrescription: false };

export default function Categories() {
  const { ok, can } = useApp();
  const { busy, run } = useAction();
  const { data, loading, reload } = useApiData<{ data: Category[] }>('/categories');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState(empty);
  const [removing, setRemoving] = useState<Category | null>(null);

  const openNew = () => { setEditing(null); setForm(empty); setFormOpen(true); };
  const openEdit = (category: Category) => {
    setEditing(category);
    setForm({
      name: category.name,
      description: category.description ?? '',
      colour: category.colour,
      requiresPrescription: !!category.requires_prescription
    });
    setFormOpen(true);
  };

  const save = () => run(
    () => (editing
      ? api.patch(`/categories/${editing.id}`, form)
      : api.post('/categories', form)),
    () => { setFormOpen(false); ok(editing ? 'Category updated' : 'Category added', form.name); void reload(true); }
  );

  const categories = data?.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Medicine categories</h1>
          <p className="sub">
            Categories group your catalogue and drive the colours you see across KSF.
            Marking one prescription-only is a useful reminder, but each medicine still carries its own rule.
          </p>
        </div>
        <Allow permission="categories.manage">
          <div className="actions">
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Add category</Button>
          </div>
        </Allow>
      </div>

      {loading
        ? <CardSkeleton count={6} />
        : categories.length === 0
          ? (
            <div className="table-wrap">
              <EmptyState
                icon={<Tags size={30} />}
                title="No categories yet"
                message="Categories such as Antibiotics, Pain Relief or Baby Care make the catalogue much easier to search."
                action={can('categories.manage')
                  ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Create the first category</Button>
                  : undefined}
              />
            </div>
          )
          : (
            <div className="grid grid-auto-lg">
              {categories.map((category) => (
                <div className="card card-hover card-pad" key={category.id}>
                  <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                    <span
                      className="stat-icon"
                      style={{ background: SWATCH[category.colour], color: 'var(--on-solid)', width: 44, height: 44, flex: '0 0 44px' }}
                    >
                      <Tags size={20} />
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row-tight wrap">
                        <h3 style={{ fontSize: 'var(--fs-md)' }}>{category.name}</h3>
                        {!!category.requires_prescription && <Badge tone="purple" dot={false}>Prescription</Badge>}
                      </div>
                      <p className="t-sm t-soft mt-2" style={{ minHeight: 40 }}>
                        {category.description || 'No description added.'}
                      </p>
                    </div>
                  </div>

                  <div className="row-between mt-4" style={{ paddingTop: 14, borderTop: '1px solid var(--line-faint)' }}>
                    <span className="row-tight t-sm t-soft">
                      <Pill size={15} />
                      {number(category.medicine_count ?? 0)} medicine{category.medicine_count === 1 ? '' : 's'}
                    </span>
                    <Allow permission="categories.manage">
                      <div className="row-tight">
                        <button className="icon-btn" onClick={() => openEdit(category)} aria-label={`Edit ${category.name}`}>
                          <Pencil size={16} />
                        </button>
                        <button className="icon-btn" onClick={() => setRemoving(category)} aria-label={`Delete ${category.name}`}>
                          <Trash2 size={16} />
                        </button>
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
        size="sm"
        icon={<Tags />}
        title={editing ? `Edit ${editing.name}` : 'New category'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim()}>
              {editing ? 'Save changes' : 'Create category'}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 16 }}>
          <TextInput
            label="Category name" required placeholder="e.g. Cough, Cold & Allergy"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextArea
            label="Description"
            hint="A short line so other staff know what belongs here."
            placeholder="e.g. Syrups, antihistamines and decongestants"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="field">
            <label className="label">Colour</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {COLOURS.map((colour) => (
                <button
                  key={colour.value}
                  type="button"
                  className={`chip ${form.colour === colour.value ? 'is-on' : ''}`}
                  onClick={() => setForm({ ...form, colour: colour.value })}
                >
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: SWATCH[colour.value], display: 'inline-block' }} />
                  {colour.label}
                </button>
              ))}
            </div>
            <span className="hint">This colour is used on badges wherever the category appears.</span>
          </div>
          <Checkbox
            checked={form.requiresPrescription}
            onChange={(v) => setForm({ ...form, requiresPrescription: v })}
            label="Medicines here normally need a prescription"
            hint="A reminder for staff. The prescription rule is still set on each medicine individually."
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/categories/${removing!.id}`),
          () => { setRemoving(null); ok('Category deleted'); void reload(true); }
        )}
        loading={busy}
        title="Delete this category?"
        confirmLabel="Delete"
        message={
          <>
            <b>{removing?.name}</b> will be removed.
            {(removing?.medicine_count ?? 0) > 0 && (
              <span style={{ display: 'block', marginTop: 10, color: 'var(--danger-600)', fontWeight: 600 }}>
                {removing?.medicine_count} medicine(s) still use it — move them to another category first.
              </span>
            )}
          </>
        }
      />
    </>
  );
}
