/* What happened across the platform: every pharmacy's activity, and the
   security events worth a second look — failed sign-ins, refused devices,
   rejected payment callbacks. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollText, ShieldAlert } from 'lucide-react';
import { useApiData } from '../../hooks/useApi';
import { query } from '../../services/api';
import { Tabs, Badge, EmptyState, TableSkeleton, Pager, Checkbox } from '../../components/ui';
import { dateTime } from '../../utils/format';

interface Row {
  id: string; pharmacy_id: string | null; pharmacy_name: string | null; created_at: string;
  actor_name?: string; actor_role?: string; action?: string; summary?: string | null; severity: string;
  type?: string; outcome?: string; email_hint?: string | null; detail?: string | null; ip?: string | null;
}
interface Paged { data: Row[]; page: number; pages: number; total: number; size: number }

export default function PlatformActivity() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'activity' | 'security'>('activity');
  const [page, setPage] = useState(1);
  const [platformOnly, setPlatformOnly] = useState(false);
  const path = tab === 'activity' ? `/platform/activity${query({ page, platform: platformOnly || undefined })}` : `/platform/security${query({ page })}`;
  const { data, loading } = useApiData<Paged>(path, [path]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="sub">Everything recorded across the platform, newest first.</p>
        </div>
      </div>
      <Tabs value={tab} onChange={(value) => { setTab(value); setPage(1); }} tabs={[
        { value: 'activity', label: 'Activity', icon: <ScrollText size={16} /> },
        { value: 'security', label: 'Security events', icon: <ShieldAlert size={16} /> }
      ]} />
      {tab === 'activity' && (
        <div className="toolbar">
          <Checkbox label="Only what the KSF team did" checked={platformOnly} onChange={(on) => { setPlatformOnly(on); setPage(1); }} />
        </div>
      )}
      <div className="table-wrap">
        {loading && !data
          ? <TableSkeleton columns={4} />
          : !data?.data.length
            ? <EmptyState title="Nothing recorded" />
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead><tr><th>What</th><th>Who</th><th>Pharmacy</th><th>When</th></tr></thead>
                    <tbody>
                      {data.data.map((row) => (
                        <tr key={row.id}>
                          <td className="cell-title">
                            <div className="t-sm">{tab === 'activity' ? row.summary ?? row.action : row.type}</div>
                            {tab === 'security' && <div className="cell-sub">{row.detail ?? ''}</div>}
                          </td>
                          <td data-label="Who" className="t-sm">
                            {tab === 'activity' ? <>{row.actor_name}<div className="cell-sub">{row.actor_role}</div></> : <>{row.email_hint ?? '—'}<div className="cell-sub">{row.ip ?? ''}</div></>}
                          </td>
                          <td data-label="Pharmacy">
                            {row.pharmacy_id
                              ? <button className="link-button" onClick={() => navigate(`/platform/pharmacies/${row.pharmacy_id}`)}>{row.pharmacy_name ?? row.pharmacy_id}</button>
                              : <Badge tone="neutral" dot={false}>Platform</Badge>}
                          </td>
                          <td data-label="When" className="t-sm">
                            {dateTime(row.created_at)}
                            {row.severity !== 'info' && <div><Badge tone={row.severity === 'danger' ? 'danger' : 'warn'} dot={false}>{row.severity}</Badge></div>}
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
