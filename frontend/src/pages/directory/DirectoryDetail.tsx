/* One medicine in the directory: what it is for, what to watch for, and the
   references it was written from — with "Add to my medicines" for a pharmacy
   and Edit, Verify and Archive for the team member who keeps it. */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, ExternalLink, Pencil, Plus, Archive, RotateCcw, ShieldAlert, Pill } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Badge, Button, CardSkeleton, Menu, MenuItem } from '../../components/ui';
import type { DirectoryEntry, Prescription } from '../../types/directory';
import { date } from '../../utils/format';

const RX_TONE: Record<Prescription, 'ok' | 'warn' | 'danger'> = { otc: 'ok', prescription: 'warn', controlled: 'danger' };

/* The catalogue's form list: a directory form "Tablet 500 mg" becomes Tablet + 500 mg. */
const CATALOGUE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Inhaler', 'Cream', 'Ointment', 'Lotion', 'Solution', 'Drops', 'Sachet', 'Powder'];

/** What the Medicines form is opened with when a pharmacy adds this entry. */
export function catalogueDraft(entry: DirectoryEntry, brand?: { name: string; manufacturer: string | null }) {
  const first = entry.forms[0] ?? '';
  const form = CATALOGUE_FORMS.find((name) => first.toLowerCase().startsWith(name.toLowerCase())) ?? 'Tablet';
  return {
    name: brand ? `${brand.name}${first ? ` ${first.slice(form.length).trim()}` : ''}`.trim() : entry.name,
    genericName: entry.name, manufacturer: brand?.manufacturer ?? '', form,
    strength: first.toLowerCase().startsWith(form.toLowerCase()) ? first.slice(form.length).trim() : '',
    requiresPrescription: entry.prescription !== 'otc', isControlled: entry.prescription === 'controlled'
  };
}

function Section({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  if (!items.length) return null;
  return (
    <section className={`dir-section ${tone ? `is-${tone}` : ''}`}>
      <h3>{title}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}

export function DirectoryDetail({
  entry, onBack, onEdit, onVerify, onArchive, onRestore, busy
}: {
  entry: DirectoryEntry | null; onBack?: () => void; onEdit?: () => void; onVerify?: () => void;
  onArchive?: () => void; onRestore?: () => void; busy?: boolean;
}) {
  const { can, isPlatform } = useApp();
  const navigate = useNavigate();
  if (!entry) return <CardSkeleton count={2} />;
  const addToCatalogue = (brand?: { name: string; manufacturer: string | null }) =>
    navigate('/medicines', { state: { prefill: catalogueDraft(entry, brand) } });

  return (
    <article className="dir-detail" aria-labelledby="dir-title">
      {onBack && <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={onBack} className="dir-back">All medicines</Button>}
      <header className="dir-head">
        <span className="dir-icon" aria-hidden="true"><Pill size={22} /></span>
        <div className="grow">
          <h2 id="dir-title">{entry.name}</h2>
          {entry.synonyms.length > 0 && <p className="t-sm t-dim">Also called {entry.synonyms.join(', ')}</p>}
          <div className="row-tight wrap mt-2">
            <Badge tone="neutral" dot={false}>{entry.category}</Badge>
            <Badge tone={RX_TONE[entry.prescription]} dot={false}>{entry.prescription_label}</Badge>
            {entry.verified_at
              ? <Badge tone="ok" dot={false}><BadgeCheck size={13} /> Verified by {entry.verified_by_name} · {date(entry.verified_at)}</Badge>
              : <Badge tone="neutral" dot={false}>Not yet verified by a pharmacist</Badge>}
            {entry.status !== 'published' && <Badge tone="warn" dot={false}>{entry.status === 'draft' ? 'Draft' : 'Archived'}</Badge>}
          </div>
        </div>
      </header>

      <div className="dir-actions">
        {!isPlatform && can('medicines.write') && entry.status === 'published' && (
          entry.brands.length
            ? (
              <Menu
                label="Add to my medicines"
                align="left"
                trigger={({ toggle, props }) => <button className="btn btn-primary btn-sm" onClick={toggle} {...props}><Plus size={15} /> Add to my medicines</button>}
              >
                {(close) => (
                  <>
                    {entry.brands.map((brand) => (
                      <MenuItem key={brand.name} onClick={() => { close(); addToCatalogue(brand); }}>
                        {brand.name}{brand.manufacturer ? ` — ${brand.manufacturer}` : ''}
                      </MenuItem>
                    ))}
                    <MenuItem onClick={() => { close(); addToCatalogue(); }}>{entry.name} (generic)</MenuItem>
                  </>
                )}
              </Menu>
            )
            : <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => addToCatalogue()}>Add to my medicines</Button>
        )}
        {onEdit && <Button variant="outline" size="sm" icon={<Pencil size={15} />} onClick={onEdit}>Edit</Button>}
        {onVerify && !entry.verified_at && entry.status !== 'archived' && (
          <Button variant="secondary" size="sm" icon={<BadgeCheck size={15} />} onClick={onVerify} loading={busy}>Verify</Button>
        )}
        {onArchive && entry.status !== 'archived' && <Button variant="ghost" size="sm" icon={<Archive size={15} />} onClick={onArchive}>Archive</Button>}
        {onRestore && entry.status === 'archived' && <Button variant="ghost" size="sm" icon={<RotateCcw size={15} />} onClick={onRestore}>Restore</Button>}
      </div>

      <div className="dir-grid">
        <Section title="Used for" items={entry.uses} />
        <Section title="Precautions" items={entry.precautions} tone="warn" />
        <Section title="Side effects" items={entry.side_effects} />
        <Section title="Interactions" items={entry.interactions} />
      </div>

      {(entry.forms.length > 0 || entry.brands.length > 0) && (
        <div className="dir-grid">
          {entry.forms.length > 0 && (
            <section className="dir-section">
              <h3>Forms</h3>
              <div className="row-tight wrap">{entry.forms.map((form) => <span key={form} className="badge badge-neutral no-dot">{form}</span>)}</div>
            </section>
          )}
          {entry.brands.length > 0 && (
            <section className="dir-section">
              <h3>Well-known brands</h3>
              <ul>{entry.brands.map((brand) => <li key={brand.name}><b>{brand.name}</b>{brand.manufacturer ? ` — ${brand.manufacturer}` : ''}</li>)}</ul>
            </section>
          )}
        </div>
      )}

      <section className="dir-section">
        <h3>References</h3>
        {entry.references.length
          ? (
            <ul className="dir-refs">
              {entry.references.map((reference) => (
                <li key={reference.url}>
                  <a href={reference.url} target="_blank" rel="noopener noreferrer">
                    {reference.title || reference.source} <ExternalLink size={13} aria-hidden="true" />
                  </a>
                  <span className="t-xs t-dim">{reference.source}</span>
                </li>
              ))}
            </ul>
          )
          : <p className="t-sm t-dim">No references yet.</p>}
      </section>

      <p className="dir-disclaimer">
        <ShieldAlert size={15} aria-hidden="true" />
        A reference for pharmacy staff, not a prescription. Doses are left out on purpose: follow the prescription and the
        product&apos;s own leaflet, and ask a pharmacist or doctor when in doubt.
      </p>
    </article>
  );
}
