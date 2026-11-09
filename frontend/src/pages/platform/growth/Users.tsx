/* Management › Users: every person working in a pharmacy on KSF — their
   pharmacy and role, when they last signed in, and whether they are locked
   out. Opening one goes to their pharmacy, where the team can help. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, KeyRound, UserRoundCheck, Users as UsersIcon } from 'lucide-react';
import { useApiData, useDebounced, useLiveRefresh } from '../../../hooks/useApi';
import { Badge, CardSkeleton, EmptyState, Pager, SearchField, SelectInput, StatusBadge } from '../../../components/ui';
import { ago, date } from '../../../utils/format';
import type { PlatformUsers } from '../../../types/platform';
import { KpiStrip } from '../../../components/insights-ui';
import { Crumbs } from '../../subscription/wallet-ui';

export default function Users() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 300);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('created');
  const [page, setPage] = useState(1);
  const path = `/platform/users?list=1&page=${page}&size=25${status ? `&status=${status}` : ''}${sort === 'last_login' ? '&sort=last_login' : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
  const { data, loading, reload } = useApiData<PlatformUsers>(path, [path]);
  useLiveRefresh(reload);
  const now = Date.now();

  return (
    <>
      <Crumbs trail={[{ label: 'Super admin', to: '/platform' }, { label: 'Users' }]} separator="›" />
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="sub">Everyone working in a pharmacy on KSF. Open one to go to their pharmacy.</p>
        </div>
      </div>

      {data && (
        <KpiStrip
          label="Pharmacy users"
          items={[
            { key: 'all', icon: <UsersIcon />, label: 'All users', value: data.counts.all, hint: 'Accounts in pharmacies', onClick: () => { setStatus(''); setPage(1); } },
            { key: 'active', icon: <UserRoundCheck />, label: 'Active', value: data.counts.active, hint: 'Allowed to sign in', onClick: () => { setStatus('active'); setPage(1); } },
            { key: 'recent', icon: <KeyRound />, label: 'Signed in', value: data.counts.signedIn30, hint: 'In the last 30 days', onClick: () => { setSort('last_login'); setPage(1); } },
            { key: 'owners', icon: <Crown />, label: 'Pharmacy owners', value: data.counts.owners, hint: 'Admins who registered' }
          ]}
        />
      )}

      <div className="insight-filters">
        <SearchField value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by name, e-mail, phone or pharmacy" />
        <SelectInput
          label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}
          options={[{ value: '', label: 'Everyone' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'suspended', label: 'Suspended' }, { value: 'locked', label: 'Locked out now' }]}
        />
        <SelectInput
          label="Order" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}
          options={[{ value: 'created', label: 'Newest first' }, { value: 'last_login', label: 'Last signed in' }]}
        />
      </div>

      {loading && !data && <CardSkeleton count={3} />}
      {data && (
        <section className="card">
          {data.data.length === 0
            ? <EmptyState icon={<UsersIcon size={28} />} title="Nobody matches" message="Try another search or status." />
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <thead>
                    <tr>
                      <th scope="col">Name</th><th scope="col">Pharmacy</th><th scope="col">Role</th>
                      <th scope="col">Last signed in</th><th scope="col">Status</th><th scope="col">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => {
                      const locked = !!row.locked_until && Date.parse(row.locked_until) > now;
                      return (
                        <tr key={row.id} onClick={() => navigate(`/platform/pharmacies/${row.pharmacy_id}`)} style={{ cursor: 'pointer' }}>
                          <td className="cell-title"><div className="cell-main">{row.full_name}</div><div className="cell-sub">{row.email}{row.phone ? ` · ${row.phone}` : ''}</div></td>
                          <td data-label="Pharmacy">{row.pharmacy_name ?? '—'}</td>
                          <td data-label="Role">
                            {row.role_name ?? '—'}
                            {row.is_owner ? <> <Badge tone="gold" dot={false}>Owner</Badge></> : null}
                            {row.totp_enabled ? <div className="cell-sub">Two-step sign-in on</div> : null}
                          </td>
                          <td data-label="Last signed in">{row.last_login_at ? ago(row.last_login_at) : <span className="t-dim">Never</span>}</td>
                          <td data-label="Status">{locked ? <Badge tone="danger" dot={false}>Locked out</Badge> : <StatusBadge status={row.status} />}</td>
                          <td data-label="Joined">{date(row.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          {data.total > data.size && <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} />}
        </section>
      )}
    </>
  );
}
