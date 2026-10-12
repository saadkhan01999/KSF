/* Adding or correcting a directory entry. Lists are typed one item per line;
   brands and references are rows. Saving a change to what an entry says
   clears its verification — the server decides, and the screen says so. */

import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Button, Modal, SelectInput, TextArea, TextInput } from '../../components/ui';
import type { DirectoryEntry } from '../../types/directory';

const lines = (items: string[] | undefined) => (items ?? []).join('\n');
const split = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

type Brand = { name: string; manufacturer: string };
type Reference = { source: string; title: string; url: string };

export function DirectoryEditor({
  open, entry, suggested, onClose, onSaved
}: { open: boolean; entry: DirectoryEntry | null; suggested: string[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [form, setForm] = useState({
    name: '', category: '', prescription: 'prescription', status: 'published', synonyms: '', forms: '',
    uses: '', precautions: '', sideEffects: '', interactions: ''
  });
  const [brands, setBrands] = useState<Brand[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: entry?.name ?? '', category: entry?.category ?? '', prescription: entry?.prescription ?? 'prescription', status: entry?.status ?? 'published',
      synonyms: lines(entry?.synonyms), forms: lines(entry?.forms), uses: lines(entry?.uses), precautions: lines(entry?.precautions),
      sideEffects: lines(entry?.side_effects), interactions: lines(entry?.interactions)
    });
    setBrands((entry?.brands ?? []).map((brand) => ({ name: brand.name, manufacturer: brand.manufacturer ?? '' })));
    setReferences((entry?.references ?? []).map((reference) => ({ source: reference.source, title: reference.title ?? '', url: reference.url })));
  }, [open, entry]);

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const save = () => run(
    () => {
      const body = {
        name: form.name, category: form.category, prescription: form.prescription, status: form.status,
        synonyms: split(form.synonyms), forms: split(form.forms), uses: split(form.uses), precautions: split(form.precautions),
        sideEffects: split(form.sideEffects), interactions: split(form.interactions),
        brands: brands.filter((brand) => brand.name.trim()),
        references: references.filter((reference) => reference.url.trim() || reference.source.trim())
      };
      return entry
        ? api.patch<{ data: DirectoryEntry; unverified: boolean }>(`/platform/medicine-directory/${entry.id}`, body)
        : api.post<{ data: DirectoryEntry }>('/platform/medicine-directory', body);
    },
    (reply) => {
      ok(entry ? 'Entry saved' : 'Added to the directory', 'unverified' in reply && reply.unverified ? 'What it says changed, so it needs verifying again.' : undefined);
      onSaved(reply.data.id);
    }
  );

  return (
    <Modal
      open={open} onClose={onClose} size="lg" icon={<BookOpen />}
      title={entry ? `Edit ${entry.name}` : 'Add a medicine to the directory'}
      subtitle="Write it as a leaflet would: plain words, no doses."
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim() || !form.category.trim() || !split(form.uses).length}>
            {entry ? 'Save' : 'Add it'}
          </Button>
        </>
      )}
    >
      <div className="form-grid">
        <TextInput label="Generic name" required value={form.name} onChange={(event) => set({ name: event.target.value })} placeholder="e.g. Paracetamol" />
        <TextInput label="Category" required value={form.category} list="directory-categories" onChange={(event) => set({ category: event.target.value })} />
        <datalist id="directory-categories">{suggested.map((name) => <option key={name} value={name} />)}</datalist>
        <SelectInput
          label="Sold" value={form.prescription} onChange={(event) => set({ prescription: event.target.value })}
          options={[{ value: 'otc', label: 'Over the counter' }, { value: 'prescription', label: 'Prescription only' }, { value: 'controlled', label: 'Controlled drug' }]}
        />
        <SelectInput
          label="Shown to pharmacies" value={form.status} onChange={(event) => set({ status: event.target.value })}
          options={[{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft — team only' }, { value: 'archived', label: 'Archived' }]}
        />
        <TextArea label="Other names" rows={2} hint="One per line" value={form.synonyms} onChange={(event) => set({ synonyms: event.target.value })} />
        <TextArea label="Forms and strengths" rows={2} hint="One per line, e.g. Tablet 500 mg" value={form.forms} onChange={(event) => set({ forms: event.target.value })} />
        <TextArea label="Used for" required rows={3} wrapClass="span-2" hint="One per line" value={form.uses} onChange={(event) => set({ uses: event.target.value })} />
        <TextArea label="Precautions" rows={3} wrapClass="span-2" hint="One per line" value={form.precautions} onChange={(event) => set({ precautions: event.target.value })} />
        <TextArea label="Side effects" rows={3} hint="One per line" value={form.sideEffects} onChange={(event) => set({ sideEffects: event.target.value })} />
        <TextArea label="Interactions" rows={3} hint="One per line" value={form.interactions} onChange={(event) => set({ interactions: event.target.value })} />
      </div>

      <div className="dir-rows mt-5">
        <div className="row-between"><h3>Well-known brands</h3><Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={() => setBrands([...brands, { name: '', manufacturer: '' }])}>Add a brand</Button></div>
        {brands.map((brand, index) => (
          <div className="dir-row" key={index}>
            <input className="input" placeholder="Brand" aria-label="Brand" value={brand.name} onChange={(event) => setBrands(brands.map((row, at) => (at === index ? { ...row, name: event.target.value } : row)))} />
            <input className="input" placeholder="Company" aria-label="Company" value={brand.manufacturer} onChange={(event) => setBrands(brands.map((row, at) => (at === index ? { ...row, manufacturer: event.target.value } : row)))} />
            <button className="icon-btn" aria-label="Remove brand" onClick={() => setBrands(brands.filter((_, at) => at !== index))}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>

      <div className="dir-rows mt-5">
        <div className="row-between"><h3>References</h3><Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={() => setReferences([...references, { source: '', title: '', url: 'https://' }])}>Add a reference</Button></div>
        <p className="t-xs t-dim">The monograph or leaflet you checked the entry against. Secure (https://) addresses only.</p>
        {references.map((reference, index) => (
          <div className="dir-row is-ref" key={index}>
            <input className="input" placeholder="Source, e.g. DailyMed" aria-label="Source" value={reference.source} onChange={(event) => setReferences(references.map((row, at) => (at === index ? { ...row, source: event.target.value } : row)))} />
            <input className="input" placeholder="https://…" aria-label="Address" inputMode="url" value={reference.url} onChange={(event) => setReferences(references.map((row, at) => (at === index ? { ...row, url: event.target.value } : row)))} />
            <button className="icon-btn" aria-label="Remove reference" onClick={() => setReferences(references.filter((_, at) => at !== index))}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
