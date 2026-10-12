/* The medicine directory: one reference book for the whole platform.

   A pharmacy's staff search it at the counter and add an entry to their own
   catalogue in one step; the KSF team keeps it, verifies it against its
   references, and sees drafts and archived entries too. The same screen
   serves both, at /directory and /platform/directory.

   Wide screens show the list and the open entry side by side; on a phone the
   list and the entry are one screen each, and the entry has its own address
   so it can be shared. */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Plus, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAction, useApiData, useDebounced } from '../hooks/useApi';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { api, query } from '../services/api';
import { Badge, Button, ConfirmDialog, EmptyState, Pager, SearchField, Segmented, TableSkeleton } from '../components/ui';
import { DirectoryDetail } from './directory/DirectoryDetail';
import { DirectoryEditor } from './directory/DirectoryEditor';
import type { DirectoryEntry, DirectoryList } from '../types/directory';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

export default function MedicineDirectory() {
  const { isPlatform, ok } = useApp();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const { id } = useParams();
  const base = isPlatform ? '/platform/directory' : '/directory';
  const wide = useMediaQuery('(min-width: 1024px)');

  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [category, setCategory] = useState('');
  const [letter, setLetter] = useState('');
  /* 'any' is published and drafts together (the query helper drops a value of 'all'). */
  const [status, setStatus] = useState<'published' | 'any' | 'draft' | 'archived'>('published');
  const [verified, setVerified] = useState<'' | 'yes' | 'no'>('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, category, letter, status, verified]);

  const listPath = `/medicine-directory${query({ q: search, category, letter, status, verified, page, size: 30 })}`;
  const { data, loading, reload } = useApiData<DirectoryList>(listPath, [search, category, letter, status, verified, page]);
  const { data: detail, reload: reloadDetail } = useApiData<{ data: DirectoryEntry; canManage: boolean }>(id ? `/medicine-directory/${id}` : null, [id]);
  const manage = !!data?.canManage;

  const [editing, setEditing] = useState<DirectoryEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<DirectoryEntry | null>(null);

  /* On a wide screen the first result opens beside the list. */
  useEffect(() => {
    if (wide && !id && data?.data[0]) navigate(`${base}/${data.data[0].id}`, { replace: true });
  }, [wide, id, data, base, navigate]);

  const refresh = () => { void reload(true); void reloadDetail(true); };
  const entry = detail?.data && detail.data.id === id ? detail.data : null;
  const showList = wide || !id;
  const showDetail = wide || !!id;

  const verify = () => entry && run(() => api.post(`/platform/medicine-directory/${entry.id}/verify`), () => { ok('Verified', `${entry.name} is marked verified under your name.`); refresh(); });
  const restore = () => entry && run(() => api.patch(`/platform/medicine-directory/${entry.id}`, { status: 'published' }), () => { ok('Restored'); refresh(); });
  const loadStarter = () => run(
    () => api.post<{ added: number; updated: number }>('/platform/medicine-directory/import', { starter: true }),
    (reply) => { ok('Starter set loaded', `${reply.added} added, ${reply.updated} brought up to date.`); refresh(); }
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Medicine directory</h1>
          <p className="sub">
            {manage
              ? 'The reference every pharmacy searches. Keep it accurate, and verify each entry against its references.'
              : 'Uses, precautions, side effects and references for common medicines — and a quick way to add one to your catalogue.'}
          </p>
        </div>
        {manage && (
          <div className="actions">
            <Button variant="outline" icon={<Upload size={17} />} onClick={() => { void loadStarter(); }} loading={busy}>Reload starter set</Button>
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>Add a medicine</Button>
          </div>
        )}
      </div>

      <div className={`dir-layout ${wide ? 'is-wide' : ''}`}>
        {showList && (
          <section className="dir-list" aria-label="Medicines">
            <div className="dir-filters">
              <SearchField value={term} onChange={setTerm} placeholder="Search by name, other name or brand…" />
              <select className="select" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {(data?.categories ?? []).map((row) => <option key={row.category} value={row.category}>{row.category} ({row.count})</option>)}
              </select>
              {manage && (
                <>
                  <Segmented
                    value={status} onChange={setStatus} label="Which entries"
                    options={[{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'archived', label: 'Archived' }, { value: 'any', label: 'All' }]}
                  />
                  <Segmented
                    value={verified} onChange={setVerified} label="Verification"
                    options={[{ value: '', label: 'Any' }, { value: 'no', label: 'To verify' }, { value: 'yes', label: 'Verified' }]}
                  />
                </>
              )}
            </div>
            <nav className="dir-letters" aria-label="By first letter">
              <button className={letter === '' ? 'is-on' : ''} onClick={() => setLetter('')}>All</button>
              {LETTERS.map((value) => (
                <button key={value} className={letter === value ? 'is-on' : ''} onClick={() => setLetter(letter === value ? '' : value)} aria-pressed={letter === value}>
                  {value.toUpperCase()}
                </button>
              ))}
            </nav>

            {loading && !data
              ? <TableSkeleton columns={2} />
              : !data?.data.length
                ? <EmptyState icon={<BookOpen size={28} />} title="Nothing matches" message="Try a shorter search, another letter, or all categories." />
                : (
                  <>
                    <ul className="dir-results">
                      {data.data.map((row) => (
                        <li key={row.id}>
                          <button className={row.id === id ? 'is-on' : ''} onClick={() => navigate(`${base}/${row.id}`)} aria-current={row.id === id ? 'true' : undefined}>
                            <span className="dir-name">{row.name}</span>
                            <span className="dir-meta">
                              {row.category}
                              {row.brands.length > 0 && ` · ${row.brands.slice(0, 2).map((brand) => brand.name).join(', ')}`}
                            </span>
                            <span className="row-tight wrap">
                              {row.prescription !== 'otc' && <Badge tone={row.prescription === 'controlled' ? 'danger' : 'warn'} dot={false}>{row.prescription === 'controlled' ? 'Controlled' : 'Rx'}</Badge>}
                              {row.verified_at && <Badge tone="ok" dot={false}>Verified</Badge>}
                              {row.status !== 'published' && <Badge tone="neutral" dot={false}>{row.status}</Badge>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} />
                  </>
                )}
          </section>
        )}

        {showDetail && (
          <section className="dir-pane">
            {id
              ? (
                <DirectoryDetail
                  entry={entry}
                  busy={busy}
                  onBack={wide ? undefined : () => navigate(base)}
                  onEdit={manage && entry ? () => setEditing(entry) : undefined}
                  onVerify={manage ? () => { void verify(); } : undefined}
                  onArchive={manage && entry ? () => setArchiving(entry) : undefined}
                  onRestore={manage ? () => { void restore(); } : undefined}
                />
              )
              : <EmptyState icon={<BookOpen size={28} />} title="Choose a medicine" message="Pick one from the list to read about it." />}
          </section>
        )}
      </div>

      <DirectoryEditor
        open={creating || !!editing}
        entry={editing}
        suggested={data?.suggested ?? []}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={(savedId) => { setCreating(false); setEditing(null); refresh(); navigate(`${base}/${savedId}`); }}
      />

      <ConfirmDialog
        open={!!archiving} onCancel={() => setArchiving(null)} loading={busy} tone="warn" title="Archive this entry?" confirmLabel="Archive"
        message={<>Pharmacies stop seeing <b>{archiving?.name}</b>. Nothing is deleted — it can be restored from the archived list.</>}
        onConfirm={() => run(() => api.delete(`/platform/medicine-directory/${archiving!.id}`), () => { setArchiving(null); ok('Archived'); refresh(); })}
      />
    </>
  );
}
