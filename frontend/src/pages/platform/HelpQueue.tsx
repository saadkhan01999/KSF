/* Everybody who is stuck, in every pharmacy, in one list — locked out,
   forgotten password, too many devices, a lost authenticator phone — and a
   search across every account on the platform for when somebody phones. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LifeBuoy, LogIn, Search, UserRound, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useDebounced } from '../../hooks/useApi';
import { query } from '../../services/api';
import { Button, Card, SearchField, Badge, StatusBadge, EmptyState, TableSkeleton } from '../../components/ui';
import { ago, phone as fmtPhone } from '../../utils/format';
import type { HelpItem } from '../../types/platform';

interface Person {
  id: string; full_name: string; email: string; phone: string | null; status: string; is_owner: number;
  pharmacy_id: string; pharmacy_name: string; role_name: string | null; last_login_at: string | null; locked_until: string | null;
}

export default function HelpQueue() {
  const navigate = useNavigate();
  const { enterSupport, ok, fail, can, user } = useApp();
  /* Fixing somebody's sign-in happens inside their pharmacy. */
  const entersPharmacies = can('platform.pharmacies.enter');
  const { data, loading, reload } = useApiData<{ data: HelpItem[]; checkedAt: string }>('/platform/help');
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const people = useApiData<{ data: Person[] }>(search.length >= 2 ? `/platform/users${query({ q: search })}` : null, [search]);

  const fix = async (pharmacyId: string, pharmacyName: string | undefined) => {
    try {
      await enterSupport(pharmacyId);
      ok(`Working inside ${pharmacyName ?? 'the pharmacy'}`, `Use Staff › Who needs help to fix it. Everything is recorded ${user?.isPlatformAdmin ? 'as Super Admin (support)' : 'under your name, as the KSF team'}.`);
      navigate('/staff');
    } catch (problem) {
      fail(problem);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People who need help</h1>
          <p className="sub">Anyone, in any pharmacy, who could not sign in during the last day — and what fixes it.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<RefreshCw size={17} />} onClick={() => { void reload(); }}>Check again</Button>
        </div>
      </div>

      <Card title="Find a person" subtitle="By name, e-mail, phone or CNIC, across every pharmacy" icon={<Search size={18} />}>
        <SearchField value={term} onChange={setTerm} placeholder="Type at least two letters…" />
        {search.length >= 2 && (
          <div className="mt-4">
            {people.loading && !people.data
              ? <TableSkeleton rows={3} columns={3} />
              : !people.data?.data.length
                ? <p className="t-sm t-dim">Nobody matches “{search}”.</p>
                : (
                  <div className="table-scroll">
                    <table className="tbl responsive">
                      <tbody>
                        {people.data.data.map((person) => (
                          <tr key={person.id}>
                            <td className="cell-title">
                              <div className="row-tight"><span className="cell-main">{person.full_name}</span>{person.is_owner ? <Badge tone="gold" dot={false}>Admin</Badge> : null}</div>
                              <div className="cell-sub">{person.email}{person.phone ? ` · ${fmtPhone(person.phone)}` : ''}</div>
                            </td>
                            <td data-label="Pharmacy">
                              <button className="link-button" onClick={() => navigate(`/platform/pharmacies/${person.pharmacy_id}`)}>{person.pharmacy_name}</button>
                              <div className="cell-sub">{person.role_name}</div>
                            </td>
                            <td data-label="Status">
                              <StatusBadge status={person.status} />
                              {person.locked_until && new Date(person.locked_until) > new Date() && <Badge tone="danger" dot={false}>Locked</Badge>}
                              <div className="cell-sub">{person.last_login_at ? `signed in ${ago(person.last_login_at)}` : 'never signed in'}</div>
                            </td>
                            <td data-label="Actions"><div className="row-actions">{entersPharmacies && <Button size="sm" variant="outline" icon={<LogIn size={15} />} onClick={() => { void fix(person.pharmacy_id, person.pharmacy_name); }}>Help inside</Button>}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </div>
        )}
      </Card>

      <div className="table-wrap mt-5">
        {loading && !data
          ? <TableSkeleton rows={5} columns={3} />
          : !data?.data.length
            ? <EmptyState icon={<LifeBuoy size={30} />} title="Nobody is stuck" message="Every person who tried to sign in today got in." />
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <thead><tr><th>Person</th><th>Pharmacy</th><th>Problem</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                  <tbody>
                    {data.data.map((item) => (
                      <tr key={`${item.pharmacyId}:${item.id}`}>
                        <td className="cell-title"><div className="row-tight"><UserRound size={15} /><span className="cell-main">{item.name}</span></div><div className="cell-sub">{item.role} · {ago(item.at)}</div></td>
                        <td data-label="Pharmacy">{can('platform.pharmacies.view') ? <button className="link-button" onClick={() => navigate(`/platform/pharmacies/${item.pharmacyId}`)}>{item.pharmacyName}</button> : item.pharmacyName}</td>
                        <td data-label="Problem"><Badge tone="warn" dot={false}>{item.title}</Badge><div className="cell-sub">{item.detail}</div></td>
                        <td data-label="Actions"><div className="row-actions">{entersPharmacies && <Button size="sm" variant="primary" icon={<LogIn size={15} />} onClick={() => { void fix(item.pharmacyId, item.pharmacyName); }}>Fix it</Button>}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </>
  );
}
