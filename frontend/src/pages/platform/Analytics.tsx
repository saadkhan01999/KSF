/* ==========================================================================
   Platform › Analytics
   --------------------------------------------------------------------------
   One page for growth, for any period: website visitors, active users, new
   registrations, pharmacies, referrals and paid subscriptions — the six
   figures on top, each opening its own section below. The website day by
   day with the pages read and the sites visitors came from; people using
   KSF day by day; registrations by source; referrals by stage (and the ones
   held for a check, decided here); pharmacies by state; the subscription
   mix; and the newest pharmacies.
   ========================================================================== */

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Check, FileText, Globe, Layers, Link2, Share2, Store, UserRoundCheck, UserRoundPlus, WalletCards, X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Button, CardSkeleton, ConfirmDialog, EmptyState } from '../../components/ui';
import { date, number } from '../../utils/format';
import type { PlatformAnalytics } from '../../types/platform';
import { KpiStrip, MixBar, RangeMenu, TrafficChart, dayLabel, rangeQuery, useRange } from '../../components/insights-ui';
import { Crumbs } from '../subscription/wallet-ui';
import { PlanBadge, initials } from './insights-shared';

const PAGE_NAMES: Record<string, string> = {
  '/': 'Home', '/product': 'Product', '/features': 'Features', '/pricing': 'Pricing', '/about': 'About', '/subscription': 'How subscriptions work',
  '/register': 'Register', '/login': 'Sign in', '/forgot-password': 'Forgotten password', '/reset-password': 'Reset password', '/privacy': 'Privacy',
  '/terms': 'Terms', '/refunds': 'Refunds', '/support': 'Support', '/directory': 'Medicine directory', '/other': 'Other addresses'
};

const plural = (count: number, one: string, many = `${one}s`): string => `${number(count)} ${count === 1 ? one : many}`;
const share = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/** Scroll to a section of this page, keeping the address as it is. */
const goTo = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export default function Analytics() {
  const navigate = useNavigate();
  const { can, ok } = useApp();
  const { busy, run } = useAction();
  const [range, setRange] = useRange('30');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const { data, loading, reload } = useApiData<PlatformAnalytics>(`/platform/analytics?${rangeQuery(range)}`, [range.from, range.to]);
  useLiveRefresh(reload);
  const canDecide = can('platform.pharmacies.manage');

  const decide = (id: string, verdict: 'approve' | 'reject', reason?: string) => run(
    () => api.post<{ message: string }>(`/platform/referrals/${id}/${verdict}`, reason ? { reason } : {}),
    (reply) => { ok(reply.message); setRejecting(null); void reload(true); }
  );

  return (
    <>
      <Crumbs trail={[{ label: 'Super admin', to: '/platform' }, { label: 'Analytics' }]} separator="›" />
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="sub">Website visitors, active users, registrations, referrals, pharmacies and paid subscriptions</p>
        </div>
        <div className="actions">
          <span className="insight-live" title="Counted from the live database">Live data</span>
          <RangeMenu value={range} onChange={setRange} />
        </div>
      </div>

      {loading && !data && <CardSkeleton count={6} />}
      {!loading && !data && <EmptyState title="The figures could not be loaded" message="Try again in a moment." action={<Button onClick={() => { void reload(); }}>Try again</Button>} />}
      {data && (
        <>
          <KpiStrip
            label="The platform in this period"
            items={[
              { key: 'visitors', icon: <Globe />, label: 'Website visitors', value: data.kpis.visitors, hint: 'Unique visitors', onClick: goTo('an-website') },
              { key: 'active', icon: <UserRoundCheck />, label: 'Active users', value: data.kpis.activeUsers, hint: 'Signed-in users', onClick: goTo('an-active') },
              { key: 'registrations', icon: <UserRoundPlus />, label: 'New registrations', value: data.kpis.registrations, hint: 'New accounts', onClick: goTo('an-registrations') },
              { key: 'pharmacies', icon: <Store />, label: 'Pharmacies', value: data.kpis.pharmacies, hint: 'Total workspaces', onClick: goTo('an-pharmacies') },
              { key: 'referrals', icon: <Share2 />, label: 'Referrals', value: data.kpis.referrals, hint: 'Registered via invite', onClick: goTo('an-referrals') },
              { key: 'paid', icon: <WalletCards />, label: 'Paid subscriptions', value: data.kpis.paidSubscriptions, hint: 'Current paid plans', onClick: goTo('an-subscriptions') }
            ]}
          />

          {/* Website traffic beside the subscription mix, as in the design. */}
          <div className="insight-grid">
            <section className="insight-card" id="an-website" aria-labelledby="an-website-title">
              <div className="insight-card-head">
                <div><h2 id="an-website-title">Website traffic</h2><p>Unique visitors per day</p></div>
                <span className="insight-key">Visitors</span>
              </div>
              <TrafficChart data={data.days.map((row) => ({ day: row.day, value: row.visitors }))} />
              <p className="insight-foot">
                <strong>{plural(data.website.views, 'page view')}</strong> · {number(data.website.averageVisitorsPerDay)} visitors a day on average
                {data.website.busiestDay && <> · busiest on {dayLabel(data.website.busiestDay.day)} ({number(data.website.busiestDay.visitors)})</>}
              </p>
            </section>

            <section className="insight-card" id="an-subscriptions" aria-labelledby="an-mix-title">
              <div className="insight-card-head">
                <div><h2 id="an-mix-title">Subscription mix</h2><p>Plans running today</p></div>
                <Layers size={20} className="t-dim" aria-hidden="true" />
              </div>
              <p className="mix-total">{number(data.mix.total)}<small>active plans</small></p>
              <MixBar items={data.mix.items} total={data.mix.total} />
              <p className="insight-foot">
                <strong>{plural(data.mix.paid, 'paid subscription')}</strong> · {plural(data.mix.trialOrReferral, 'trial or referral plan')}
              </p>
            </section>
          </div>

          <div className="insight-split">
            <section className="card" aria-labelledby="an-pages-title">
              <div className="insight-table-head"><div><h2 id="an-pages-title">Pages opened</h2><p>The website's pages, most read first</p></div></div>
              {data.website.pages.length === 0
                ? <EmptyState icon={<FileText size={26} />} title="No page views in this period" />
                : (
                  <table className="tbl">
                    <thead><tr><th scope="col">Page</th><th scope="col" className="t-right">Views</th></tr></thead>
                    <tbody>
                      {data.website.pages.map((row) => (
                        <tr key={row.path}>
                          <td><div className="cell-main">{PAGE_NAMES[row.path] ?? row.path}</div><div className="cell-sub mono">{row.path}</div></td>
                          <td className="t-right num t-semi">{number(row.views)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </section>
            <section className="card" aria-labelledby="an-referrers-title">
              <div className="insight-table-head"><div><h2 id="an-referrers-title">Where visitors came from</h2><p>Other websites that sent them (search engines, social media)</p></div></div>
              {data.website.referrers.length === 0
                ? <EmptyState icon={<Link2 size={26} />} title="No visitors from other websites yet" message="Visitors who typed the address, or came from an app, are not listed here." />
                : (
                  <table className="tbl">
                    <thead><tr><th scope="col">Website</th><th scope="col" className="t-right">Visitors</th></tr></thead>
                    <tbody>
                      {data.website.referrers.map((row) => (
                        <tr key={row.host}><td>{row.host}</td><td className="t-right num t-semi">{number(row.visitors)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </section>
          </div>

          <div className="insight-split">
            <section className="insight-card" id="an-active" aria-labelledby="an-active-title">
              <div className="insight-card-head">
                <div><h2 id="an-active-title">Active users</h2><p>People in pharmacies who used KSF, per day</p></div>
                <span className="insight-key">Active users</span>
              </div>
              <TrafficChart data={data.days.map((row) => ({ day: row.day, value: row.activeUsers }))} unit="active users" height={200} />
              <p className="insight-foot"><strong>{plural(data.kpis.activeUsers, 'person', 'people')}</strong> signed in during the period</p>
            </section>

            <section className="insight-card" id="an-registrations" aria-labelledby="an-registrations-title">
              <div className="insight-card-head">
                <div><h2 id="an-registrations-title">New registrations</h2><p>Pharmacies that created a workspace in the period</p></div>
                <UserRoundPlus size={20} className="t-dim" aria-hidden="true" />
              </div>
              <p className="mix-total">{number(data.registrations.total)}<small>new pharmacies</small></p>
              <FigureTable
                caption="New registrations by where they came from"
                rows={[
                  ['Found KSF themselves', data.registrations.direct, share(data.registrations.direct, data.registrations.total)],
                  ['Through a referral', data.registrations.referral, share(data.registrations.referral, data.registrations.total)]
                ]}
              />
            </section>
          </div>

          <div className="insight-split">
            <section className="insight-card" id="an-referrals" aria-labelledby="an-referrals-title">
              <div className="insight-card-head">
                <div>
                  <h2 id="an-referrals-title">Referrals</h2>
                  <p>Each pharmacy that registers through a link earns the one that shared it {plural(data.referrals.daysPerReferral, 'day')}</p>
                </div>
                <Share2 size={20} className="t-dim" aria-hidden="true" />
              </div>
              <p className="mix-total">{number(data.referrals.registered)}<small>registered via invite</small></p>
              <FigureTable
                caption="Referrals by stage"
                rows={[
                  ['Invitations started', data.referrals.invited, 'in the period'],
                  ['Waiting to finish signing up', data.referrals.waiting, 'today'],
                  ['Being checked', data.referrals.review, 'today'],
                  ['Days ready to claim', data.referrals.readyDays, 'today'],
                  ['Days claimed', data.referrals.claimedDays, 'in the period']
                ]}
              />
              {data.referrals.held.length > 0 && (
                <div className="an-held">
                  <h3>Waiting for your decision</h3>
                  <ul>
                    {data.referrals.held.map((row) => (
                      <li key={row.id}>
                        <div>
                          <strong>{row.referred.pharmacy ?? row.referred.name ?? row.referred.email ?? 'A new pharmacy'}</strong>
                          <small>invited by {row.referrer ?? '—'} · <span className="mono">{row.code}</span> · {date(row.createdAt)}</small>
                        </div>
                        {canDecide && (
                          <span className="row-tight">
                            <Button size="sm" variant="outline" icon={<Check size={15} />} disabled={busy} onClick={() => { void decide(row.id, 'approve'); }}>Accept</Button>
                            <Button size="sm" variant="ghost" icon={<X size={15} />} disabled={busy} onClick={() => setRejecting(row.id)}>Turn down</Button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="insight-card" id="an-pharmacies" aria-labelledby="an-pharmacies-title">
              <div className="insight-card-head">
                <div><h2 id="an-pharmacies-title">Pharmacies</h2><p>Every workspace on KSF, today</p></div>
                <Building2 size={20} className="t-dim" aria-hidden="true" />
              </div>
              <p className="mix-total">{number(data.pharmacies.total)}<small>workspaces</small></p>
              <FigureTable
                caption="Pharmacies by state"
                rows={[
                  ['Open', data.pharmacies.active, share(data.pharmacies.active, data.pharmacies.total)],
                  ['Suspended', data.pharmacies.suspended, share(data.pharmacies.suspended, data.pharmacies.total)],
                  ['Closed', data.pharmacies.closed, share(data.pharmacies.closed, data.pharmacies.total)],
                  ['On a paid plan', data.pharmacies.paid, share(data.pharmacies.paid, data.pharmacies.total)],
                  ['On a trial or referral days', data.pharmacies.onTrial, share(data.pharmacies.onTrial, data.pharmacies.total)],
                  ['Plan ended', data.pharmacies.ended, share(data.pharmacies.ended, data.pharmacies.total)]
                ]}
              />
              <Button variant="outline" size="sm" icon={<Building2 size={15} />} onClick={() => navigate('/platform/pharmacies')}>All pharmacies</Button>
            </section>
          </div>

          <section className="card" aria-labelledby="an-recent-title">
            <div className="insight-table-head">
              <div><h2 id="an-recent-title">Recent pharmacy registrations</h2><p>Latest workspaces created on KSF</p></div>
              <span>{plural(data.recent.length, 'latest registration')}</span>
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
            <span>Visitors, active users, registrations and referrals cover the selected period (Pakistan time).</span>
            <span>Plan, pharmacy and referral-stage totals as of {date(data.asOf)}</span>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!rejecting}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => { if (rejecting) void decide(rejecting, 'reject', reason); }}
        tone="warn"
        title="Turn this referral down?"
        message="It earns no referral price for the new pharmacy and no days for the one that invited it. The new pharmacy's account and trial are not affected."
        confirmLabel="Turn it down"
        loading={busy}
        reasonLabel="Why? (kept with the referral)"
        reasonHint="For example: the same person registering several pharmacies."
      />
    </>
  );
}

/** A small table of figures: what is counted, how many, and a note (a share, or when). */
function FigureTable({ caption, rows }: { caption: string; rows: [ReactNode, number, string][] }) {
  return (
    <table className="mix-legend an-figures">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map(([label, value, note], index) => (
          <tr key={index}>
            <th scope="row">{label}</th>
            <td className="num t-semi">{number(value)}</td>
            <td className="num t-dim">{note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
