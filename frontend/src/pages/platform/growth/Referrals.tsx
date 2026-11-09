/* Management › Referrals: every invitation on the platform — the pharmacy
   that shared its link, who came through it, how far they got, and the 15
   days it earned. A referral held for a check (many sign-ups from one
   address in a day) is approved or turned down here. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Check, Hourglass, Share2, UserRoundCheck, X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAction, useApiData, useDebounced, useLiveRefresh } from '../../../hooks/useApi';
import { api } from '../../../services/api';
import { Badge, Button, CardSkeleton, ConfirmDialog, EmptyState, Pager, SearchField, Segmented } from '../../../components/ui';
import { date } from '../../../utils/format';
import type { PlatformReferrals } from '../../../types/platform';
import { KpiStrip } from '../../../components/insights-ui';
import { Crumbs } from '../../subscription/wallet-ui';

type Filter = 'all' | 'pending' | 'review' | 'converted' | 'ready' | 'claimed' | 'rejected';
const STAGE_TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'danger'> = { converted: 'ok', review: 'warn', pending: 'neutral', rejected: 'danger' };

export default function Referrals() {
  const navigate = useNavigate();
  const { can, ok } = useApp();
  const { busy, run } = useAction();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const path = `/platform/referrals?page=${page}&size=25${filter === 'all' ? '' : `&status=${filter}`}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
  const { data, loading, reload } = useApiData<PlatformReferrals>(path, [path]);
  useLiveRefresh(reload);
  const canDecide = can('platform.pharmacies.manage');
  const choose = (next: Filter) => { setFilter(next); setPage(1); };

  const decide = (id: string, verdict: 'approve' | 'reject', reason?: string) => run(
    () => api.post<{ message: string }>(`/platform/referrals/${id}/${verdict}`, reason ? { reason } : {}),
    (reply) => { ok(reply.message); setRejecting(null); void reload(true); }
  );

  return (
    <>
      <Crumbs trail={[{ label: 'Super admin', to: '/platform' }, { label: 'Referrals' }]} separator="›" />
      <div className="page-head">
        <div>
          <h1>Referrals</h1>
          <p className="sub">
            Pharmacies inviting pharmacies. Each one that registers earns the pharmacy that invited it {data?.daysPerReferral ?? 15} days of full access.
          </p>
        </div>
      </div>

      {data && (
        <KpiStrip
          label="Referrals on the platform"
          items={[
            { key: 'all', icon: <Share2 />, label: 'Invitations', value: data.counts.all, hint: 'Sign-ups started with a link', onClick: () => choose('all') },
            { key: 'registered', icon: <UserRoundCheck />, label: 'Registered', value: data.counts.registered, hint: 'Completed through an invite', onClick: () => choose('converted') },
            { key: 'review', icon: <Hourglass />, label: 'Being checked', value: data.counts.review, hint: 'Waiting for your decision', onClick: () => choose('review') },
            { key: 'ready', icon: <CalendarPlus />, label: 'Days ready to claim', value: data.counts.readyDays, hint: 'Earned, not yet claimed', onClick: () => choose('ready') },
            { key: 'claimed', icon: <CalendarCheck />, label: 'Days claimed', value: data.counts.claimedDays, hint: 'Added to pharmacies', onClick: () => choose('claimed') }
          ]}
        />
      )}

      <div className="insight-filters">
        <SearchField value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by pharmacy, code, name or e-mail" />
        <Segmented
          label="Show" value={filter} onChange={choose}
          options={[
            { value: 'all', label: 'All' }, { value: 'pending', label: 'Invited' }, { value: 'review', label: 'Being checked' },
            { value: 'converted', label: 'Registered' }, { value: 'ready', label: 'Ready to claim' }, { value: 'claimed', label: 'Claimed' },
            { value: 'rejected', label: 'Not accepted' }
          ]}
        />
      </div>

      {loading && !data && <CardSkeleton count={3} />}
      {data && (
        <section className="card">
          {data.data.length === 0
            ? <EmptyState icon={<Share2 size={28} />} title="No referrals here" message="When a pharmacy shares its link from Subscription plans › Referrals, every sign-up through it appears here." />
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <thead>
                    <tr>
                      <th scope="col">Invited by</th><th scope="col">Who came</th><th scope="col">Stage</th><th scope="col">Referral days</th>
                      <th scope="col">Started</th>{canDecide && <th scope="col" className="t-right">Decide</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => (
                      <tr key={row.id}>
                        <td className="cell-title">
                          {row.referrer
                            ? <button type="button" className="link-button" onClick={() => navigate(`/platform/pharmacies/${row.referrer!.id}`)}>{row.referrer.name}</button>
                            : '—'}
                          <div className="cell-sub mono">{row.code}</div>
                        </td>
                        <td data-label="Who came">
                          {row.referred.pharmacyId && row.referred.pharmacyName
                            ? <button type="button" className="link-button" onClick={() => navigate(`/platform/pharmacies/${row.referred.pharmacyId}`)}>{row.referred.pharmacyName}</button>
                            : <span>{row.referred.name ?? '—'}</span>}
                          <div className="cell-sub">{row.referred.email}</div>
                        </td>
                        <td data-label="Stage">
                          <Badge tone={STAGE_TONE[row.status] ?? 'neutral'} dot={false}>{row.stage}</Badge>
                          {row.rejectReason && <div className="cell-sub">{row.rejectReason}</div>}
                        </td>
                        <td data-label="Referral days">
                          {row.rewardClaimedAt
                            ? <>Claimed +{row.rewardDays} days<div className="cell-sub">{date(row.rewardClaimedAt)}</div></>
                            : row.status === 'converted' ? <Badge tone="gold" dot={false}>Ready to claim</Badge> : <span className="t-dim">—</span>}
                        </td>
                        <td data-label="Started">{date(row.createdAt)}{row.convertedAt && <div className="cell-sub">Registered {date(row.convertedAt)}</div>}</td>
                        {canDecide && (
                          <td className="t-right">
                            {row.status === 'review' && (
                              <span className="row-tight" style={{ justifyContent: 'flex-end', gap: 6 }}>
                                <Button size="sm" variant="primary" icon={<Check size={15} />} loading={busy} onClick={() => { void decide(row.id, 'approve'); }}>Approve</Button>
                                <Button size="sm" variant="outline" icon={<X size={15} />} onClick={() => setRejecting(row.id)}>Turn down</Button>
                              </span>
                            )}
                            {row.status === 'pending' && <Button size="sm" variant="ghost" icon={<X size={15} />} onClick={() => setRejecting(row.id)}>Turn down</Button>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {data.total > data.size && <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} />}
        </section>
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
