/* Every pharmacy on the platform, searchable by its name, city or the
   person who runs it — the screen the Super Admin opens when the phone rings. */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Eye, LogIn, Phone, Mail, Download } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useDebounced, useLiveRefresh } from '../../hooks/useApi';
import { query } from '../../services/api';
import {
  Button, SearchField, SelectInput, StatusBadge, Badge, EmptyState, TableSkeleton, Pager
} from '../../components/ui';
import { rupees, number, ago, date, phone as fmtPhone, downloadCsv } from '../../utils/format';
import type { PharmacyRow } from '../../types/platform';

interface PharmacyList { data: PharmacyRow[]; page: number; pages: number; total: number; size: number; plans: { key: string; name: string }[] }

export default function Pharmacies() {
  const navigate = useNavigate();
  const { enterSupport, ok, fail, can, user } = useApp();
  const [params] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  /* The top-bar search lands here with ?q=. */
  useEffect(() => { const next = params.get('q'); if (next !== null) setTerm(next); }, [params]);
  const search = useDebounced(term);
  const [status, setStatus] = useState('all');
  const [plan, setPlan] = useState('all');
  const [page, setPage] = useState(1);

  const { data, loading, reload } = useApiData<PharmacyList>(
    `/platform/pharmacies${query({ q: search, status, plan, page })}`, [search, status, plan, page]
  );
  useLiveRefresh(reload, ['subscription']);

  const support = async (row: PharmacyRow) => {
    try {
      await enterSupport(row.id);
      ok(`Working inside ${row.name}`, user?.isPlatformAdmin ? 'Everything you do is recorded as Super Admin (support).' : 'Everything you do is recorded under your name, as the KSF team.');
      navigate('/dashboard');
    } catch (problem) {
      fail(problem);
    }
  };

  const exportCsv = () => {
    downloadCsv(`ksf-pharmacies-${new Date().toISOString().slice(0, 10)}`, (data?.data ?? []).map((row) => ({
      Pharmacy: row.name, City: row.city, Status: row.status, Plan: row.plan_key, Admin: row.owner?.name, Email: row.owner?.email,
      Phone: row.owner?.phone ?? row.phone, Staff: row.staff_count, 'Sales 30 days (Rs)': row.revenue_30d / 100,
      'Open requests': row.open_tickets, Joined: row.created_at.slice(0, 10)
    })));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pharmacies</h1>
          <p className="sub">Every pharmacy on KSF. Open one to see its figures, its people and its payments — or step inside to help.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} disabled={!data?.data.length}>Export</Button>
        </div>
      </div>

      <div className="toolbar">
        <SearchField value={term} onChange={(value) => { setTerm(value); setPage(1); }} placeholder="Search pharmacy, city, Admin's name, e-mail or phone…" />
        <SelectInput
          aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}
          options={[{ value: 'all', label: 'Every status' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'closed', label: 'Closed' }]}
        />
        <SelectInput
          aria-label="Plan" value={plan} onChange={(event) => { setPlan(event.target.value); setPage(1); }}
          options={[{ value: 'all', label: 'Every plan' }, ...(data?.plans ?? []).map((row) => ({ value: row.key, label: row.name }))]}
        />
      </div>

      <div className="table-wrap">
        {loading && !data
          ? <TableSkeleton columns={6} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<Building2 size={30} />}
                title={term || status !== 'all' || plan !== 'all' ? 'No pharmacy matches' : 'No pharmacies yet'}
                message={term ? 'Try part of the name, the city, or the Admin\'s phone number.' : 'Pharmacies appear here as soon as they register from the website.'}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Pharmacy</th>
                        <th>Admin</th>
                        <th>Plan</th>
                        <th style={{ textAlign: 'right' }}>Sales, 30 days</th>
                        <th>Activity</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((row) => (
                        <tr key={row.id}>
                          <td className="cell-title">
                            <div className="row-tight" style={{ flexWrap: 'wrap' }}>
                              <span className="cell-main">{row.name}</span>
                              {row.status !== 'active' && <StatusBadge status={row.status} />}
                              {row.open_tickets > 0 && <Badge tone="warn" dot={false}>{row.open_tickets} open request{row.open_tickets === 1 ? '' : 's'}</Badge>}
                            </div>
                            <div className="cell-sub">{[row.city, row.province].filter(Boolean).join(', ') || 'Address not set'} · joined {date(row.created_at)}</div>
                          </td>
                          <td data-label="Admin">
                            <div className="t-sm t-semi">{row.owner?.name ?? '—'}</div>
                            {row.owner?.email && <a className="cell-sub row-tight" href={`mailto:${row.owner.email}`}><Mail size={12} /> {row.owner.email}</a>}
                            {(row.owner?.phone ?? row.phone) && <a className="cell-sub row-tight" href={`tel:${row.owner?.phone ?? row.phone}`}><Phone size={12} /> {fmtPhone(row.owner?.phone ?? row.phone)}</a>}
                          </td>
                          <td data-label="Plan">
                            <div className="t-sm t-semi" style={{ textTransform: 'capitalize' }}>{row.plan_key ?? '—'}</div>
                            {row.subscription_status && <StatusBadge status={row.subscription_status} />}
                          </td>
                          <td data-label="Sales, 30 days" className="t-right">
                            <div className="t-semi num">{rupees(row.revenue_30d)}</div>
                            <div className="cell-sub">{number(row.invoices_30d)} invoices</div>
                          </td>
                          <td data-label="Activity">
                            <div className="t-sm">{number(row.staff_count)} staff</div>
                            <div className="cell-sub">{row.last_active_at ? `last sign-in ${ago(row.last_active_at)}` : 'nobody has signed in yet'}</div>
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions">
                              <button className="icon-btn" onClick={() => navigate(`/platform/pharmacies/${row.id}`)} aria-label={`Open ${row.name}`} title="Open">
                                <Eye size={17} />
                              </button>
                              {can('platform.pharmacies.enter') && (
                                <button className="icon-btn" onClick={() => { void support(row); }} aria-label={`Work inside ${row.name}`} title="Work inside this pharmacy">
                                  <LogIn size={17} />
                                </button>
                              )}
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
    </>
  );
}
