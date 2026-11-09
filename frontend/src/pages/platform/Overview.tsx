/* The platform at a glance.

   On top, the owner's design: website visitors, active users, new
   registrations, pharmacies, referrals and paid subscriptions for the period
   chosen; the website traffic day by day; the subscription mix; and the
   newest pharmacies. Below it, the business: income, sales across every
   pharmacy, and who is waiting for an answer. */

import { useNavigate } from 'react-router-dom';
import {
  Building2, Wallet, TrendingUp, LifeBuoy, Users, Receipt, ArrowRight, CreditCard, Sparkles, RefreshCw,
  Globe, UserRoundCheck, UserRoundPlus, Store, Share2, WalletCards, Layers
} from 'lucide-react';
import { useApiData, useLiveRefresh } from '../../hooks/useApi';
import { Button, Card, StatCard, BarChart, DonutChart, StatusBadge, EmptyState, CardSkeleton, Badge } from '../../components/ui';
import { rupees, rupeesShort, number, monthLabel, ago, date } from '../../utils/format';
import type { PlatformInsights, PlatformOverview } from '../../types/platform';
import { VersionCheck } from '../../components/VersionCheck';
import { KpiStrip, MixBar, RangeMenu, TrafficChart, dayLabel, rangeQuery, useRange } from '../../components/insights-ui';
import { Crumbs } from '../subscription/wallet-ui';
import { PlanBadge, initials } from './insights-shared';

const change = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

export default function Overview() {
  const [range, setRange] = useRange('30');
  const insights = useApiData<PlatformInsights>(`/platform/insights?${rangeQuery(range)}`, [range.from, range.to]);
  const { data, loading, reload } = useApiData<PlatformOverview>('/platform/overview');
  useLiveRefresh(reload);
  useLiveRefresh(insights.reload);

  return (
    <>
      <Crumbs trail={[{ label: 'Super admin', to: '/platform' }, { label: 'Overview' }]} separator="›" />
      <div className="page-head">
        <div>
          <h1>Platform overview</h1>
          <p className="sub">Website activity and pharmacy subscriptions</p>
        </div>
        <div className="actions">
          <span className="insight-live" title="Counted from the live database">Live data</span>
          <RangeMenu value={range} onChange={setRange} />
        </div>
      </div>

      <GrowthOverview data={insights.data} loading={insights.loading} />

      <h2 className="insight-section-title">Income, sales and support</h2>
      {loading && !data && <CardSkeleton count={8} />}
      {data && <BusinessOverview data={data} onRefresh={() => { void reload(); void insights.reload(); }} />}
    </>
  );
}

/* ----------------------------------------------- the owner's design, on top */

function GrowthOverview({ data, loading }: { data: PlatformInsights | null; loading: boolean }) {
  const navigate = useNavigate();
  if (loading && !data) return <CardSkeleton count={4} />;
  if (!data) return <EmptyState title="The figures could not be loaded" message="Try again in a moment." />;
  const { kpis, mix } = data;
  const last = data.traffic.at(-1);
  return (
    <>
      <KpiStrip
        label="The platform in this period"
        items={[
          { key: 'visitors', icon: <Globe />, label: 'Website visitors', value: kpis.visitors, hint: 'Unique visitors', onClick: () => navigate('/platform/traffic') },
          { key: 'active', icon: <UserRoundCheck />, label: 'Active users', value: kpis.activeUsers, hint: 'Signed-in users', onClick: () => navigate('/platform/users') },
          { key: 'registrations', icon: <UserRoundPlus />, label: 'New registrations', value: kpis.registrations, hint: 'New accounts', onClick: () => navigate('/platform/registrations') },
          { key: 'pharmacies', icon: <Store />, label: 'Pharmacies', value: kpis.pharmacies, hint: 'Total workspaces', onClick: () => navigate('/platform/pharmacies') },
          { key: 'referrals', icon: <Share2 />, label: 'Referrals', value: kpis.referrals, hint: 'Registered via invite', onClick: () => navigate('/platform/referrals') },
          { key: 'paid', icon: <WalletCards />, label: 'Paid subscriptions', value: kpis.paidSubscriptions, hint: 'Current paid plans', onClick: () => navigate('/platform/subscriptions') }
        ]}
      />

      <div className="insight-grid">
        <section className="insight-card" aria-labelledby="traffic-title">
          <div className="insight-card-head">
            <div><h2 id="traffic-title">Website traffic</h2><p>Unique visitors per day</p></div>
            <span className="insight-key">Visitors</span>
          </div>
          <TrafficChart data={data.traffic.map((row) => ({ day: row.day, value: row.visitors }))} />
          {last && <p className="insight-foot"><strong>{number(last.visitors)} visitor{last.visitors === 1 ? '' : 's'}</strong> on {dayLabel(last.day)}</p>}
        </section>

        <section className="insight-card" aria-labelledby="mix-title">
          <div className="insight-card-head">
            <div><h2 id="mix-title">Subscription mix</h2></div>
            <Layers size={20} className="t-dim" aria-hidden="true" />
          </div>
          <p className="mix-total">{number(mix.total)}<small>active plans</small></p>
          <MixBar items={mix.items} total={mix.total} />
          <p className="insight-foot">{number(mix.paid)} paid subscription{mix.paid === 1 ? '' : 's'} · {number(mix.trialOrReferral)} trial or referral plan{mix.trialOrReferral === 1 ? '' : 's'}</p>
        </section>
      </div>

      <section className="card" aria-labelledby="recent-title">
        <div className="insight-table-head">
          <div><h2 id="recent-title">Recent pharmacy registrations</h2><p>Latest workspaces created on KSF</p></div>
          <span>{data.recent.length} latest registration{data.recent.length === 1 ? '' : 's'}</span>
        </div>
        {data.recent.length === 0
          ? <EmptyState title="No pharmacies yet" message="When a pharmacy registers from the website it appears here." />
          : (
            <div className="table-scroll">
              <table className="tbl responsive">
                <thead>
                  <tr><th scope="col">Pharmacy</th><th scope="col">City</th><th scope="col">Current plan</th><th scope="col">Signup source</th><th scope="col">Registered on</th></tr>
                </thead>
                <tbody>
                  {data.recent.map((row) => (
                    <tr key={row.id} onClick={() => navigate(`/platform/pharmacies/${row.id}`)} style={{ cursor: 'pointer' }}>
                      <td className="cell-title"><span className="insight-name"><span className="insight-avatar" aria-hidden="true">{initials(row.name)}</span>{row.name}</span></td>
                      <td data-label="City">{row.city ?? '—'}</td>
                      <td data-label="Current plan"><PlanBadge plan={row.plan} /></td>
                      <td data-label="Signup source">{row.source}</td>
                      <td data-label="Registered on">{date(row.registeredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
      <div className="insight-notes">
        <span>Visitor and signup counts cover the selected period (Pakistan time).</span>
        <span>Plan and pharmacy totals as of {date(data.asOf)}</span>
      </div>
    </>
  );
}

/* ------------------------------------------- the business, as it was before */

function BusinessOverview({ data, onRefresh }: { data: PlatformOverview; onRefresh: () => void }) {
  const navigate = useNavigate();
  const { pharmacies, income, sales, support, subscriptions } = data;
  return (
    <>
      <div className="row-tight mb-4" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <VersionCheck />
        <div className="row-tight" style={{ gap: 8 }}>
          <Button variant="outline" icon={<RefreshCw size={17} />} onClick={onRefresh}>Refresh</Button>
          <Button variant="primary" icon={<Building2 size={18} />} onClick={() => navigate('/platform/pharmacies')}>All pharmacies</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard
          label="Pharmacies" value={number(pharmacies.total)} icon={<Building2 size={20} />}
          hint={`${number(pharmacies.active)} active · ${number(pharmacies.new30)} new this month`}
          onClick={() => navigate('/platform/pharmacies')}
        />
        <StatCard
          label="Your income this month" value={rupeesShort(income.monthPaisa)} icon={<Wallet size={20} />} tone="gold"
          change={change(income.monthPaisa, income.lastMonthPaisa)} hint="vs last month" onClick={() => navigate('/platform/income')}
        />
        <StatCard
          label="Monthly recurring revenue" value={rupeesShort(income.mrrPaisa)} icon={<TrendingUp size={20} />} tone="info"
          hint={`${rupeesShort(income.allTimePaisa)} received in all`}
        />
        <StatCard
          label="Open support requests" value={number(support.open)} icon={<LifeBuoy size={20} />}
          tone={support.urgent ? 'danger' : support.open ? 'warn' : 'brand'}
          hint={support.unread ? `${number(support.unread)} unread · ${number(support.urgent)} urgent` : 'all answered'}
          onClick={() => navigate('/platform/support')}
        />
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Sold today, all pharmacies" value={rupeesShort(sales.todayPaisa)} icon={<Receipt size={20} />} hint={`${number(sales.todayInvoices)} invoices`} />
        <StatCard
          label="Sold this month" value={rupeesShort(sales.monthPaisa)} icon={<TrendingUp size={20} />}
          change={change(sales.monthPaisa, sales.lastMonthPaisa)} hint={`${number(sales.monthInvoices)} invoices`}
        />
        <StatCard label="People using KSF" value={number(pharmacies.staff)} icon={<Users size={20} />} tone="info" hint="active staff accounts" />
        <StatCard label="Trials running" value={number(subscriptions.trialsActive)} icon={<Sparkles size={20} />} tone="gold" hint="from referrals" />
      </div>

      <div className="grid grid-2 mb-5">
        <Card title="Your income" subtitle="Net of refunds, last 12 months" icon={<Wallet size={18} />}
          actions={<Button size="sm" variant="ghost" iconRight={<ArrowRight size={15} />} onClick={() => navigate('/platform/income')}>Details</Button>}>
          {income.trend.length
            ? <BarChart data={income.trend.map((row) => ({ label: monthLabel(row.period), value: row.net }))} format={(value) => rupeesShort(value)} />
            : <EmptyState icon={<CreditCard size={28} />} title="No payments yet" message="Subscription payments appear here as pharmacies pay." />}
        </Card>
        <Card title="Pharmacies by plan" subtitle="Where every pharmacy is today" icon={<Building2 size={18} />}>
          <DonutChart
            data={subscriptions.byPlan.map((row) => ({ label: row.plan, value: row.pharmacies }))}
            centreLabel="pharmacies" centreValue={number(pharmacies.total)}
          />
          <div className="row-tight mt-4" style={{ flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(subscriptions.byStatus).map(([status, count]) => (
              <Badge key={status} tone="neutral" dot={false}>{status.replace('_', ' ')}: {number(count)}</Badge>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Top pharmacies this month" subtitle="By sales" pad={false}>
          {sales.topPharmacies.length === 0
            ? <EmptyState title="No sales yet this month" />
            : (
              <div className="table-scroll">
                <table className="tbl">
                  <tbody>
                    {sales.topPharmacies.map((row, index) => (
                      <tr key={row.pharmacy_id} onClick={() => navigate(`/platform/pharmacies/${row.pharmacy_id}`)} style={{ cursor: 'pointer' }}>
                        <td style={{ width: 28 }} className="t-dim">{index + 1}</td>
                        <td><div className="cell-main">{row.name}</div><div className="cell-sub">{number(row.invoices)} invoices</div></td>
                        <td className="t-right num t-semi">{rupees(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>

        <Card title="Newest pharmacies" subtitle="Signed up most recently" pad={false}>
          {data.recentSignups.length === 0
            ? <EmptyState title="No pharmacies yet" message="When a pharmacy registers from the website it appears here." />
            : (
              <div className="table-scroll">
                <table className="tbl">
                  <tbody>
                    {data.recentSignups.map((row) => (
                      <tr key={row.id} onClick={() => navigate(`/platform/pharmacies/${row.id}`)} style={{ cursor: 'pointer' }}>
                        <td><div className="cell-main">{row.name}</div><div className="cell-sub">{row.city ?? '—'} · {ago(row.created_at)}</div></td>
                        <td className="t-right"><StatusBadge status={row.status} /><div className="cell-sub">{row.plan_key ?? '—'}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>

        <Card title="Latest payments" subtitle="Money received" pad={false}>
          {data.recentPayments.length === 0
            ? <EmptyState title="Nothing received yet" />
            : (
              <div className="table-scroll">
                <table className="tbl">
                  <tbody>
                    {data.recentPayments.map((row) => (
                      <tr key={row.id}>
                        <td><div className="cell-main">{row.pharmacy_name}</div><div className="cell-sub">{row.provider ?? 'manual'} · {date(row.paid_at)}</div></td>
                        <td className="t-right num t-semi">{rupees(row.amount_paisa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      </div>
    </>
  );
}
