/* Workspace › Registrations: the pharmacies that signed up in the period,
   who registered them, what plan they are on today and whether a referral
   brought them. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Store, UserRoundPlus } from 'lucide-react';
import { useApiData, useDebounced, useLiveRefresh } from '../../../hooks/useApi';
import { CardSkeleton, EmptyState, Pager, SearchField, Segmented } from '../../../components/ui';
import { date } from '../../../utils/format';
import type { PlatformRegistrations } from '../../../types/platform';
import { KpiStrip, RangeMenu, rangeQuery, useRange } from '../../../components/insights-ui';
import { Crumbs } from '../../subscription/wallet-ui';
import { PlanBadge, initials } from '../insights-shared';

type Source = 'all' | 'direct' | 'referral';

export default function Registrations() {
  const navigate = useNavigate();
  const [range, setRange] = useRange('30');
  const [source, setSource] = useState<Source>('all');
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const path = `/platform/registrations?${rangeQuery(range)}&page=${page}&size=25${source === 'all' ? '' : `&source=${source}`}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
  const { data, loading, reload } = useApiData<PlatformRegistrations>(path, [path]);
  useLiveRefresh(reload);

  return (
    <>
      <Crumbs trail={[{ label: 'Super admin', to: '/platform' }, { label: 'Registrations' }]} separator="›" />
      <div className="page-head">
        <div>
          <h1>Registrations</h1>
          <p className="sub">Pharmacies that created a KSF workspace in the period, and the plan each is on today.</p>
        </div>
        <div className="actions"><RangeMenu value={range} onChange={(next) => { setRange(next); setPage(1); }} /></div>
      </div>

      {data && (
        <KpiStrip
          label="Registrations in this period"
          items={[
            { key: 'all', icon: <UserRoundPlus />, label: 'New registrations', value: data.counts.total, hint: 'New pharmacy accounts', onClick: () => { setSource('all'); setPage(1); } },
            { key: 'direct', icon: <Store />, label: 'Direct', value: data.counts.direct, hint: 'Found KSF themselves', onClick: () => { setSource('direct'); setPage(1); } },
            { key: 'referral', icon: <Share2 />, label: 'Through a referral', value: data.counts.referral, hint: 'Registered via invite', onClick: () => { setSource('referral'); setPage(1); } }
          ]}
        />
      )}

      <div className="insight-filters">
        <SearchField value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by pharmacy, city or e-mail" />
        <Segmented
          label="Signup source" value={source} onChange={(value) => { setSource(value); setPage(1); }}
          options={[{ value: 'all', label: 'All' }, { value: 'direct', label: 'Direct' }, { value: 'referral', label: 'Referral' }]}
        />
      </div>

      {loading && !data && <CardSkeleton count={3} />}
      {data && (
        <section className="card">
          {data.data.length === 0
            ? <EmptyState icon={<UserRoundPlus size={28} />} title="No registrations in this period" message="Choose a longer period, or another source." />
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <thead>
                    <tr>
                      <th scope="col">Pharmacy</th><th scope="col">City</th><th scope="col">Current plan</th><th scope="col">Signup source</th>
                      <th scope="col">Registered by</th><th scope="col">Registered on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => (
                      <tr key={row.id} onClick={() => navigate(`/platform/pharmacies/${row.id}`)} style={{ cursor: 'pointer' }}>
                        <td className="cell-title"><span className="insight-name"><span className="insight-avatar" aria-hidden="true">{initials(row.name)}</span>{row.name}</span></td>
                        <td data-label="City">{row.city ?? '—'}</td>
                        <td data-label="Current plan"><PlanBadge plan={row.plan} /></td>
                        <td data-label="Signup source">
                          {row.source}
                          {row.referredBy && <div className="cell-sub">via {row.referredBy}</div>}
                        </td>
                        <td data-label="Registered by">
                          {row.owner ? <><div className="cell-main">{row.owner.name}</div><div className="cell-sub">{row.owner.email}{row.owner.phone ? ` · ${row.owner.phone}` : ''}</div></> : '—'}
                        </td>
                        <td data-label="Registered on">{date(row.registeredAt)}</td>
                      </tr>
                    ))}
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
