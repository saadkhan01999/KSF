/* Management › Subscriptions: every pharmacy's plan today — Demo trial,
   Standard Referral, Pro monthly, Diamond Annual — with when it ends and
   whether it renews. The plan itself is changed on the pharmacy's page. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, WalletCards } from 'lucide-react';
import { useApiData, useDebounced, useLiveRefresh } from '../../../hooks/useApi';
import { CardSkeleton, EmptyState, Pager, SearchField, Segmented, SelectInput, StatusBadge } from '../../../components/ui';
import { date, rupees, number } from '../../../utils/format';
import type { PlanCategory, PlatformSubscriptions } from '../../../types/platform';
import { MixBar } from '../../../components/insights-ui';
import { Crumbs } from '../../subscription/wallet-ui';
import { PlanBadge } from '../insights-shared';

export default function Subscriptions() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanCategory | 'all'>('all');
  const [state, setState] = useState('running');
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const path = `/platform/subscriptions?page=${page}&size=25${plan === 'all' ? '' : `&plan=${plan}`}${state ? `&state=${state}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
  const { data, loading, reload } = useApiData<PlatformSubscriptions>(path, [path]);
  useLiveRefresh(reload);
  const labels = data?.labels;

  return (
    <>
      <Crumbs trail={[{ label: 'Super admin', to: '/platform' }, { label: 'Subscriptions' }]} separator="›" />
      <div className="page-head">
        <div>
          <h1>Subscriptions</h1>
          <p className="sub">Every pharmacy's plan today. Change or extend a plan, or record a payment, from the pharmacy's page.</p>
        </div>
      </div>

      {loading && !data && <CardSkeleton count={3} />}
      {data && (
        <div className="insight-split">
          <section className="insight-card" aria-labelledby="sub-mix-title">
            <div className="insight-card-head"><div><h2 id="sub-mix-title">Subscription mix</h2></div><Layers size={20} className="t-dim" aria-hidden="true" /></div>
            <p className="mix-total">{number(data.mix.total)}<small>active plans</small></p>
            <MixBar items={data.mix.items} total={data.mix.total} />
          </section>
          <section className="insight-card" aria-labelledby="sub-paid-title">
            <div className="insight-card-head"><div><h2 id="sub-paid-title">Paying pharmacies</h2><p>Plans running today, paid for</p></div><WalletCards size={20} className="t-dim" aria-hidden="true" /></div>
            <p className="mix-total">{number(data.mix.paid)}<small>paid subscriptions</small></p>
            <p className="insight-foot">{number(data.mix.trialOrReferral)} on a trial or the Standard Referral · {number(Math.max(0, data.mix.total - data.mix.paid - data.mix.trialOrReferral))} other</p>
          </section>
        </div>
      )}

      <div className="insight-filters">
        <SearchField value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by pharmacy or city" />
        <Segmented
          label="Plan" value={plan} onChange={(value) => { setPlan(value); setPage(1); }}
          options={[
            { value: 'all', label: 'All plans' },
            { value: 'demo', label: labels?.demo ?? 'Demo trial' },
            { value: 'referral', label: labels?.referral ?? 'Standard Referral' },
            { value: 'pro', label: labels?.pro ?? 'Pro monthly' },
            { value: 'annual', label: labels?.annual ?? 'Diamond Annual' }
          ]}
        />
        <SelectInput
          label="State" value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}
          options={[
            { value: 'running', label: 'Running now' }, { value: 'paid', label: 'Paid and running' }, { value: 'ended', label: 'Ended' },
            { value: 'grace', label: 'In grace (payment failed)' }, { value: 'cancelled', label: 'Cancelled' }, { value: '', label: 'Every state' }
          ]}
        />
      </div>

      {data && (
        <section className="card">
          {data.data.length === 0
            ? <EmptyState icon={<WalletCards size={28} />} title="No subscriptions match" message="Choose another plan or state." />
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <thead>
                    <tr>
                      <th scope="col">Pharmacy</th><th scope="col">Plan</th><th scope="col">State</th><th scope="col" className="t-right">Price</th>
                      <th scope="col">Runs until</th><th scope="col">Renews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => (
                      <tr key={row.subscriptionId} onClick={() => navigate(`/platform/pharmacies/${row.pharmacyId}`)} style={{ cursor: 'pointer' }}>
                        <td className="cell-title"><div className="cell-main">{row.pharmacyName}</div><div className="cell-sub">{row.city ?? '—'}</div></td>
                        <td data-label="Plan">
                          <PlanBadge plan={{ category: row.category, label: row.label, entitled: row.entitled }} />
                          {row.bonusDays > 0 && <div className="cell-sub">+{row.bonusDays} referral days</div>}
                        </td>
                        <td data-label="State"><StatusBadge status={row.status} /></td>
                        <td data-label="Price" className="t-right num">{row.pricePaisa > 0 ? rupees(row.pricePaisa) : 'Free'}</td>
                        <td data-label="Runs until">
                          {row.periodEnd ? date(row.periodEnd) : '—'}
                          {row.entitled && row.daysLeft !== null && <div className="cell-sub">{row.daysLeft} day{row.daysLeft === 1 ? '' : 's'} left</div>}
                        </td>
                        <td data-label="Renews">{row.paid ? (row.autoRenew ? `Yes${row.provider ? ` · ${row.provider}` : ''}` : 'No') : '—'}</td>
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
