/* Workspace › Website traffic: how many people opened the public website,
   day by day, which pages they read and where they came from. Counted from
   a random number each browser keeps (no cookie, no address); crawlers are
   not counted. */

import { FileText, Globe, Link2, MousePointerClick, TrendingUp } from 'lucide-react';
import { useApiData, useLiveRefresh } from '../../../hooks/useApi';
import { CardSkeleton, EmptyState } from '../../../components/ui';
import { number } from '../../../utils/format';
import type { PlatformTraffic } from '../../../types/platform';
import { KpiStrip, RangeMenu, TrafficChart, dayLabel, rangeQuery, useRange } from '../../../components/insights-ui';
import { Crumbs } from '../../subscription/wallet-ui';

const PAGE_NAMES: Record<string, string> = {
  '/': 'Home', '/product': 'Product', '/features': 'Features', '/pricing': 'Pricing', '/about': 'About', '/subscription': 'How subscriptions work',
  '/register': 'Register', '/login': 'Sign in', '/forgot-password': 'Forgotten password', '/reset-password': 'Reset password', '/privacy': 'Privacy',
  '/terms': 'Terms', '/refunds': 'Refunds', '/support': 'Support', '/directory': 'Medicine directory', '/other': 'Other addresses'
};

export default function Traffic() {
  const [range, setRange] = useRange('30');
  const { data, loading, reload } = useApiData<PlatformTraffic>(`/platform/traffic?${rangeQuery(range)}`, [range.from, range.to]);
  useLiveRefresh(reload);

  return (
    <>
      <Crumbs trail={[{ label: 'Super admin', to: '/platform' }, { label: 'Website traffic' }]} separator="›" />
      <div className="page-head">
        <div>
          <h1>Website traffic</h1>
          <p className="sub">Visitors to the public website — counted once a day each, without cookies or addresses.</p>
        </div>
        <div className="actions"><RangeMenu value={range} onChange={setRange} /></div>
      </div>

      {loading && !data && <CardSkeleton count={4} />}
      {data && (
        <>
          <KpiStrip
            label="Website traffic in this period"
            items={[
              { key: 'visitors', icon: <Globe />, label: 'Unique visitors', value: data.totals.visitors, hint: 'Each counted once a day' },
              { key: 'views', icon: <MousePointerClick />, label: 'Page views', value: data.totals.views, hint: 'Every page opened' },
              { key: 'average', icon: <TrendingUp />, label: 'Average a day', value: data.totals.averageVisitorsPerDay, hint: 'Visitors per day' },
              {
                key: 'busiest', icon: <FileText />, label: 'Busiest day', value: data.totals.busiestDay ? number(data.totals.busiestDay.visitors) : '—',
                hint: data.totals.busiestDay ? dayLabel(data.totals.busiestDay.day) : 'No visits yet'
              }
            ]}
          />

          <section className="insight-card mb-5" aria-labelledby="visitors-title">
            <div className="insight-card-head">
              <div><h2 id="visitors-title">Visitors per day</h2><p>{dayLabel(data.range.from)} to {dayLabel(data.range.to)}</p></div>
              <span className="insight-key">Visitors</span>
            </div>
            <TrafficChart data={data.days.map((row) => ({ day: row.day, value: row.visitors }))} height={280} />
          </section>

          <div className="insight-split">
            <section className="card" aria-labelledby="pages-title">
              <div className="insight-table-head"><div><h2 id="pages-title">Pages opened</h2><p>The website's pages, most read first</p></div></div>
              {data.pages.length === 0
                ? <EmptyState icon={<FileText size={26} />} title="No page views in this period" />
                : (
                  <table className="tbl">
                    <thead><tr><th scope="col">Page</th><th scope="col" className="t-right">Views</th></tr></thead>
                    <tbody>
                      {data.pages.map((row) => (
                        <tr key={row.path}>
                          <td><div className="cell-main">{PAGE_NAMES[row.path] ?? row.path}</div><div className="cell-sub mono">{row.path}</div></td>
                          <td className="t-right num t-semi">{number(row.views)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </section>
            <section className="card" aria-labelledby="referrers-title">
              <div className="insight-table-head"><div><h2 id="referrers-title">Where visitors came from</h2><p>Other websites that sent them (search engines, social media)</p></div></div>
              {data.referrers.length === 0
                ? <EmptyState icon={<Link2 size={26} />} title="No visitors from other websites yet" message="Visitors who typed the address, or came from an app, are not listed here." />
                : (
                  <table className="tbl">
                    <thead><tr><th scope="col">Website</th><th scope="col" className="t-right">Visitors</th></tr></thead>
                    <tbody>
                      {data.referrers.map((row) => (
                        <tr key={row.host}><td>{row.host}</td><td className="t-right num t-semi">{number(row.visitors)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </section>
          </div>

          {/* The chart as a table: every day's figures, newest first. */}
          <section className="card" aria-labelledby="days-title">
            <div className="insight-table-head"><div><h2 id="days-title">Day by day</h2><p>The figures behind the chart (Pakistan time)</p></div></div>
            <div className="table-scroll" style={{ maxHeight: 420 }}>
              <table className="tbl">
                <thead><tr><th scope="col">Day</th><th scope="col" className="t-right">Visitors</th><th scope="col" className="t-right">Page views</th></tr></thead>
                <tbody>
                  {[...data.days].reverse().map((row) => (
                    <tr key={row.day}>
                      <td>{new Date(`${row.day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                      <td className="t-right num">{number(row.visitors)}</td>
                      <td className="t-right num">{number(row.views)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
