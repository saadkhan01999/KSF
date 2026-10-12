/* The platform at a glance: every pharmacy combined — what they sell, what
   they pay, who signed up and who is waiting for an answer. */

import { useNavigate } from 'react-router-dom';
import {
  Building2, Wallet, TrendingUp, LifeBuoy, Users, Receipt, ArrowRight, CreditCard, Sparkles, RefreshCw
} from 'lucide-react';
import { useApiData, useLiveRefresh } from '../../hooks/useApi';
import { Button, Card, StatCard, BarChart, DonutChart, StatusBadge, EmptyState, CardSkeleton, Badge } from '../../components/ui';
import { rupees, rupeesShort, number, monthLabel, ago, date } from '../../utils/format';
import type { PlatformOverview } from '../../types/platform';
import { VersionCheck } from '../../components/VersionCheck';

const change = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

export default function Overview() {
  const navigate = useNavigate();
  const { data, loading, reload } = useApiData<PlatformOverview>('/platform/overview');
  useLiveRefresh(reload);

  if (loading && !data) return <><div className="page-head"><h1>Platform overview</h1></div><CardSkeleton count={8} /></>;
  if (!data) return null;
  const { pharmacies, income, sales, support, subscriptions } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Platform overview</h1>
          <p className="sub">Every pharmacy on KSF together: their trade, your income, and who needs you.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<RefreshCw size={17} />} onClick={() => { void reload(); }}>Refresh</Button>
          <Button variant="primary" icon={<Building2 size={18} />} onClick={() => navigate('/platform/pharmacies')}>All pharmacies</Button>
        </div>
      </div>
      <VersionCheck />

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
                        <td className="t-right"><StatusBadge status={row.status} /><div className="cell-sub">{row.plan_key ?? 'basic'}</div></td>
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
