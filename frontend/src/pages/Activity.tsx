/* The audit trail.

   Every write in KSF lands here with who did it, from which address, and
   exactly what changed. For a pharmacy this is not a nicety: it is how a
   discrepancy in stock, cash or a controlled medicine gets traced back to a
   person and a moment. Nothing in the application can delete a row from it. */

import { useEffect, useState } from 'react';
import {
  ScrollText, Download, Filter, ShieldAlert, User, Search
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, EmptyState, TableSkeleton, Pager, Badge, Allow,
  Modal, StatCard, Alert
} from '../components/ui';
import { dateTime, ago, isoDaysAgo, todayIso, number, downloadCsv, titleCase } from '../utils/format';
import type { ActivityEntry, Paged } from '../types';

interface ActivityResponse extends Paged<ActivityEntry> {
  actors: { id: string; name: string }[];
  entities: { entity: string; n: number }[];
}

const SEVERITY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info'> = {
  info: 'info', warn: 'warn', danger: 'danger', success: 'ok'
};

export default function Activity() {
  const { ok } = useApp();
  const { busy, run } = useAction();

  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [entity, setEntity] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(todayIso());
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<ActivityEntry | null>(null);

  const path = `/activity${query({ q: search, entity, severity, user: actor, from, to, page, size: 40 })}`;
  const { data, loading } = useApiData<ActivityResponse>(path, [search, entity, severity, actor, from, to, page]);

  useEffect(() => { setPage(1); }, [search, entity, severity, actor, from, to]);

  const exportCsv = () => run(
    () => api.get<{ data: Record<string, unknown>[] }>(`/reports/export?kind=audit&from=${from}&to=${to}`),
    (result) => {
      if (!result.data.length) { ok('Nothing to export', 'No activity in this period.'); return; }
      downloadCsv(`ksf-audit-${from}-to-${to}`, result.data);
      ok('Exported', `${result.data.length} audit entries saved as a CSV file.`);
    }
  );

  const entries = data?.data ?? [];
  const alerts = entries.filter((e) => e.severity === 'danger').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity log</h1>
          <p className="sub">
            A permanent record of every change made in KSF. Entries cannot be edited or deleted
            from inside the application.
          </p>
        </div>
        <Allow permission="audit.export">
          <div className="actions">
            <Button variant="outline" icon={<Download size={17} />} onClick={exportCsv} loading={busy}>
              Export the trail
            </Button>
          </div>
        </Allow>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Entries in this period" value={number(data?.total ?? 0)} icon={<ScrollText size={20} />} />
        <StatCard label="High-risk actions" value={number(alerts)} icon={<ShieldAlert size={20} />} tone="danger" hint="on this page" onClick={() => setSeverity('danger')} />
        <StatCard label="People active" value={number(data?.actors.length ?? 0)} icon={<User size={20} />} tone="info" />
        <StatCard label="Record types touched" value={number(data?.entities.length ?? 0)} icon={<Filter size={20} />} tone="gold" />
      </div>

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search what happened, or who did it…" />
        <select className="select" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Person">
          <option value="">Anyone</option>
          {(data?.actors ?? []).map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
        <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Record type">
          <option value="all">Any record</option>
          {(data?.entities ?? []).map((row) => (
            <option key={row.entity} value={row.entity}>{titleCase(row.entity)} ({row.n})</option>
          ))}
        </select>
        <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="all">Any importance</option>
          <option value="info">Routine</option>
          <option value="warn">Notable</option>
          <option value="danger">High risk</option>
        </select>
        <input className="input" style={{ width: 'auto' }} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="input" style={{ width: 'auto' }} type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton rows={10} columns={4} />
          : entries.length === 0
            ? (
              <EmptyState
                icon={<Search size={30} />}
                title="No activity matches these filters"
                message="Try widening the dates or clearing a filter."
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Who</th>
                        <th>What happened</th>
                        <th>Record</th>
                        <th style={{ textAlign: 'right' }}>From</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr
                          key={entry.id}
                          onClick={() => setViewing(entry)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td data-label="When" className="cell-title">
                            <div className="t-sm t-semi">{ago(entry.created_at)}</div>
                            <div className="cell-sub">{dateTime(entry.created_at)}</div>
                          </td>
                          <td data-label="Who">
                            <div className="t-sm t-semi">{entry.actor_name ?? 'System'}</div>
                            <div className="cell-sub">{entry.actor_role ?? '—'}</div>
                          </td>
                          <td data-label="What happened">
                            <div className="t-sm">{entry.summary ?? entry.action}</div>
                            <div className="cell-sub mono">{entry.action}</div>
                          </td>
                          <td data-label="Record">
                            <Badge tone={SEVERITY_TONE[entry.severity] ?? 'neutral'} dot={false}>
                              {entry.entity ? titleCase(entry.entity) : 'system'}
                            </Badge>
                          </td>
                          <td data-label="From" className="t-right">
                            <span className="t-xs t-dim mono">{entry.ip || '—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={data!.page} pages={data!.pages} total={data!.total} size={data!.size} onPage={setPage} />
              </>
            )}
      </div>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="md"
        icon={<ScrollText />}
        title="Audit entry"
        subtitle={viewing ? dateTime(viewing.created_at) : ''}
        footer={<Button variant="outline" onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing && (
          <>
            {viewing.severity === 'danger' && (
              <div className="mb-4">
                <Alert tone="danger" title="High-risk action">
                  Actions like password resets, write-offs and role changes are recorded at this level
                  so they can be reviewed easily.
                </Alert>
              </div>
            )}

            <dl className="kv">
              <dt>What happened</dt><dd>{viewing.summary ?? '—'}</dd>
              <dt>Action code</dt><dd className="mono">{viewing.action}</dd>
              <dt>Who did it</dt><dd>{viewing.actor_name ?? 'System'}{viewing.actor_role ? ` (${viewing.actor_role})` : ''}</dd>
              <dt>When</dt><dd>{dateTime(viewing.created_at)} — {ago(viewing.created_at)}</dd>
              <dt>Record type</dt><dd>{viewing.entity ? titleCase(viewing.entity) : '—'}</dd>
              <dt>Record id</dt><dd className="mono">{viewing.entity_id ?? '—'}</dd>
              <dt>IP address</dt><dd className="mono">{viewing.ip || '—'}</dd>
              <dt>Device</dt><dd className="t-xs" style={{ wordBreak: 'break-word' }}>{viewing.user_agent || '—'}</dd>
            </dl>

            {viewing.meta && (
              <div className="mt-4">
                <div className="lbl mb-2">Details recorded at the time</div>
                <pre
                  className="mini-card mono t-xs"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}
                >
                  {JSON.stringify(JSON.parse(viewing.meta), null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
