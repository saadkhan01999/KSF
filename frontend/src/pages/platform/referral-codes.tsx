/* ==========================================================================
   Referral codes, for the Super Admin
   --------------------------------------------------------------------------
   ReferralCodesCard (Analytics): every pharmacy with its code and how many
   pharmacies registered with it; "Pharmacies" opens the list, "New code"
   issues one.
   PharmacyReferralsPanel (a pharmacy's own page, and the dialog): its codes,
   a new code (KHAN-239 from its name, or one typed), whose code it came
   through, and every pharmacy that registered with its codes.
   ========================================================================== */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, KeyRound, Search, Share2, Sparkles, Store } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useDebounced, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Badge, Button, CardSkeleton, EmptyState, Modal, TextInput } from '../../components/ui';
import { date, number } from '../../utils/format';
import type { PharmacyReferrals, ReferralCodeBoard } from '../../types/platform';
import { PlanBadge, initials } from './insights-shared';

const STAGE_TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'danger'> = { converted: 'ok', review: 'warn', pending: 'neutral', rejected: 'danger' };

/** Copy text, saying so; quietly does nothing where the browser refuses. */
function useCopy() {
  const { ok } = useApp();
  return (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => ok(`${what} copied`), () => undefined);
  };
}

/* ------------------------------------------------------------ the board */

/** Analytics › Referral codes: every pharmacy's code and the pharmacies that registered with it. */
export function ReferralCodesCard() {
  const { can } = useApp();
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 300);
  const [open, setOpen] = useState<{ id: string; name: string; issue?: boolean } | null>(null);
  const path = `/platform/referral-codes${term ? `?q=${encodeURIComponent(term)}` : ''}`;
  const { data, loading, reload } = useApiData<ReferralCodeBoard>(path, [path]);
  useLiveRefresh(reload);
  const manages = can('platform.pharmacies.manage');

  return (
    <section className="card" id="an-codes" aria-labelledby="an-codes-title">
      <div className="insight-table-head">
        <div>
          <h2 id="an-codes-title">Referral codes</h2>
          <p>Each pharmacy's code, and how many pharmacies registered with it. Give a pharmacy a code made from its name — Khan Pharmacy gets KHAN-239.</p>
        </div>
        <div className="codes-search">
          <Search size={16} aria-hidden="true" />
          <input
            className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Pharmacy, city or code" aria-label="Find a pharmacy or a referral code"
          />
        </div>
      </div>
      {data && (
        <div className="codes-totals">
          <span><strong>{number(data.totals.registrations)}</strong> {data.totals.registrations === 1 ? 'pharmacy' : 'pharmacies'} registered with a referral code</span>
          <span><strong>{number(data.totals.issuedCodes)}</strong> {data.totals.issuedCodes === 1 ? 'code' : 'codes'} issued by KSF</span>
          <span>Each registration earns the pharmacy that shared the code <strong>{number(data.daysPerReferral)} days</strong></span>
        </div>
      )}
      {loading && !data && <div className="card-pad"><CardSkeleton count={2} /></div>}
      {data && data.data.length === 0 && <EmptyState icon={<KeyRound size={26} />} title={term ? 'Nothing matches that' : 'No pharmacies yet'} />}
      {data && data.data.length > 0 && (
        <div className="table-scroll" style={{ maxHeight: 560 }}>
          <table className="tbl responsive">
            <thead>
              <tr>
                <th scope="col">Pharmacy</th><th scope="col">Referral code</th><th scope="col" className="t-right">Registered</th>
                <th scope="col" className="t-right">Signing up</th><th scope="col">Last registration</th><th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => (
                <tr key={row.pharmacyId}>
                  <td className="cell-title">
                    <span className="insight-name"><span className="insight-avatar" aria-hidden="true">{initials(row.name)}</span>
                      <span><span className="cell-main">{row.name}</span><span className="cell-sub">{row.city ?? '—'}</span></span>
                    </span>
                  </td>
                  <td data-label="Referral code">
                    {row.code ? <span className="code-chip">{row.code}</span> : <span className="t-dim">Not made yet</span>}
                    {row.otherCodes.length > 0 && <div className="cell-sub">also {row.otherCodes.join(', ')}</div>}
                  </td>
                  <td data-label="Registered" className="t-right num t-semi">{number(row.registered)}</td>
                  <td data-label="Signing up" className="t-right num">{number(row.signingUp + row.review)}</td>
                  <td data-label="Last registration">{row.lastRegisteredAt ? date(row.lastRegisteredAt) : '—'}</td>
                  <td className="cell-actions">
                    <div className="row-actions">
                      <Button size="sm" variant="outline" icon={<Store size={15} />} onClick={() => setOpen({ id: row.pharmacyId, name: row.name })}>
                        Pharmacies{row.registered ? ` (${row.registered})` : ''}
                      </Button>
                      {manages && (
                        <Button size="sm" variant="ghost" icon={<Sparkles size={15} />} onClick={() => setOpen({ id: row.pharmacyId, name: row.name, issue: true })}>
                          New code
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!open} onClose={() => { setOpen(null); void reload(true); }} size="xl" icon={<Share2 />}
        title={open ? `${open.name}: referral codes` : ''} subtitle="Its codes, and every pharmacy that registered with them"
        footer={<Button variant="outline" onClick={() => { setOpen(null); void reload(true); }}>Close</Button>}
      >
        {open && <PharmacyReferralsPanel pharmacyId={open.id} startIssuing={open.issue} onChanged={() => { void reload(true); }} />}
      </Modal>
    </section>
  );
}

/* ------------------------------------------------------- one pharmacy */

/** A pharmacy's referral codes, a new code, and the pharmacies that registered with them. */
export function PharmacyReferralsPanel({ pharmacyId, startIssuing = false, onChanged }: { pharmacyId: string; startIssuing?: boolean; onChanged?: () => void }) {
  const navigate = useNavigate();
  const { can, ok } = useApp();
  const copy = useCopy();
  const { busy, run } = useAction();
  const { data, loading, reload } = useApiData<PharmacyReferrals>(`/platform/pharmacies/${pharmacyId}/referrals`, [pharmacyId]);
  const [issuing, setIssuing] = useState(startIssuing);
  const [custom, setCustom] = useState('');
  const manages = can('platform.pharmacies.manage');

  const issue = () => run(
    () => api.post<{ message: string; data: { code: string } }>(`/platform/pharmacies/${pharmacyId}/referral-code`, custom.trim() ? { code: custom.trim() } : {}),
    (reply) => { ok('Referral code issued', reply.message); setIssuing(false); setCustom(''); void reload(true); onChanged?.(); }
  );

  if (loading && !data) return <CardSkeleton count={2} />;
  if (!data) return <EmptyState title="The referrals could not be loaded" message="Try again in a moment." />;
  const active = data.codes.find((row) => row.status === 'active') ?? null;
  const earlier = data.codes.filter((row) => row.status !== 'active');

  return (
    <div className="ref-panel">
      <div className="ref-codes">
        <div className="ref-code-main">
          <span className="lbl">Referral code</span>
          {active
            ? (
              <div className="ref-code-line">
                <strong className="code-chip is-large">{active.code}</strong>
                <Button size="sm" variant="ghost" icon={<Copy size={15} />} onClick={() => copy(active.code, 'Code')}>Copy code</Button>
                <Button size="sm" variant="ghost" icon={<Copy size={15} />} onClick={() => copy(active.link, 'Link')}>Copy link</Button>
              </div>
            )
            : <span className="t-dim">None yet</span>}
          {earlier.length > 0 && (
            <p className="t-sm t-dim">Still honoured: {earlier.map((row) => row.code).join(', ')} — a link already sent keeps working.</p>
          )}
        </div>
        <dl className="ref-counts">
          <div><dt>Registered</dt><dd>{number(data.counts.registered)}</dd></div>
          <div><dt>Signing up</dt><dd>{number(data.counts.signingUp)}</dd></div>
          <div><dt>Being checked</dt><dd>{number(data.counts.review)}</dd></div>
          <div><dt>Not accepted</dt><dd>{number(data.counts.rejected)}</dd></div>
        </dl>
      </div>

      {manages && (issuing
        ? (
          <div className="ref-issue">
            <p>
              Leave it empty for a code made from the name — like <strong>{suggestion(data.pharmacy.name)}</strong> — or type one of your own
              (letters, a dash, numbers). It becomes the code {data.pharmacy.name} shares; the pharmacy is told.
            </p>
            <div className="ref-issue-row">
              <TextInput label="Code (optional)" value={custom} placeholder={suggestion(data.pharmacy.name)} maxLength={20} onChange={(event) => setCustom(event.target.value.toUpperCase())} />
              <Button variant="primary" icon={<Sparkles size={16} />} loading={busy} onClick={() => { void issue(); }}>Issue the code</Button>
              <Button variant="ghost" onClick={() => { setIssuing(false); setCustom(''); }}>Cancel</Button>
            </div>
          </div>
        )
        : <Button variant="outline" icon={<Sparkles size={16} />} onClick={() => setIssuing(true)}>Give a new referral code</Button>)}

      {data.cameThrough && (
        <p className="ref-came">
          {data.pharmacy.name} registered with <strong className="code-chip">{data.cameThrough.code}</strong>
          {data.cameThrough.pharmacyName ? <> — the code of <button type="button" className="link-button" onClick={() => data.cameThrough?.pharmacyId && navigate(`/platform/pharmacies/${data.cameThrough.pharmacyId}`)}>{data.cameThrough.pharmacyName}</button>{data.cameThrough.city ? `, ${data.cameThrough.city}` : ''}</> : null}.
        </p>
      )}

      <h3 className="ref-list-title">Pharmacies that registered with {active ? active.code : 'its codes'}{earlier.length ? ' and its earlier codes' : ''}</h3>
      {data.referred.length === 0
        ? <EmptyState icon={<Store size={26} />} title="Nobody has used its codes yet" message={`When a pharmacy registers with ${active?.code ?? 'its code'}, it appears here — with ${data.pharmacy.name} as the pharmacy that referred it.`} />
        : (
          <div className="table-scroll">
            <table className="tbl responsive">
              <thead>
                <tr><th scope="col">Pharmacy</th><th scope="col">Owner</th><th scope="col">Code used</th><th scope="col">Stage</th><th scope="col">Plan</th><th scope="col">Registered</th></tr>
              </thead>
              <tbody>
                {data.referred.map((row) => (
                  <tr key={row.id} onClick={() => row.pharmacyId && navigate(`/platform/pharmacies/${row.pharmacyId}`)} style={{ cursor: row.pharmacyId ? 'pointer' : undefined }}>
                    <td className="cell-title">
                      <span className="cell-main">{row.pharmacyName ?? row.name ?? 'Not finished signing up'}</span>
                      <span className="cell-sub">{row.city ?? row.email}</span>
                    </td>
                    <td data-label="Owner">{row.owner ? <><div>{row.owner.name}</div><div className="cell-sub">{row.owner.email}</div></> : <span className="t-dim">{row.name ?? '—'}</span>}</td>
                    <td data-label="Code used"><span className="code-chip">{row.code}</span><div className="cell-sub">via {data.pharmacy.name}</div></td>
                    <td data-label="Stage"><Badge tone={STAGE_TONE[row.status] ?? 'neutral'} dot={false}>{row.stage}</Badge>{row.rejectReason && <div className="cell-sub">{row.rejectReason}</div>}</td>
                    <td data-label="Plan">{row.plan ? <PlanBadge plan={row.plan} /> : <span className="t-dim">—</span>}</td>
                    <td data-label="Registered">{row.registeredAt ? date(row.registeredAt) : <span className="t-dim">started {date(row.startedAt)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

/** What a code from the name looks like, as a hint: KHAN-239. Mirrors codeStem on the server. */
function suggestion(name: string): string {
  const generic = new Set(['PHARMACY', 'PHARMACIES', 'PHARMA', 'MEDICAL', 'MEDICALS', 'MEDICOS', 'MEDICINE', 'MEDICINES', 'STORE', 'STORES', 'CHEMIST', 'CHEMISTS', 'DRUG', 'DRUGS', 'CLINIC', 'HEALTH', 'CARE', 'CENTRE', 'CENTER', 'HOUSE', 'MART', 'THE', 'AND', 'AL', 'EL', 'PVT', 'LTD', 'CO', 'NEW', 'MY']);
  const articles = new Set(['THE', 'AND', 'AL', 'EL', 'PVT', 'LTD', 'CO', 'NEW', 'MY']);
  const words = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(Boolean);
  const stem = (words.find((word) => !generic.has(word)) ?? words.find((word) => !articles.has(word)) ?? '').slice(0, 10);
  return `${stem.length >= 2 ? stem : 'KSF'}-239`;
}
