/* The platform's support desk: every request from every pharmacy in one
   queue, unread first. Answering puts the request in the pharmacy's court;
   "Work inside" opens that pharmacy to fix the problem where it is. */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LogIn, Building2, LifeBuoy } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useDebounced, useAction } from '../../hooks/useApi';
import { api, query } from '../../services/api';
import { Button, Tabs, SearchField, SelectInput, EmptyState, TableSkeleton, Pager } from '../../components/ui';
import { TicketList, TicketThread } from '../../components/support';
import { TICKET_STATUS_LABEL, type Ticket, type TicketStatus, type TicketSummary } from '../../types/platform';

interface Queue {
  data: TicketSummary[]; page: number; pages: number; total: number; size: number;
  counts: Record<TicketStatus | 'unread', number>;
}

type Filter = 'open' | 'unread' | 'resolved' | 'closed' | 'all';

export default function SupportDesk() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, enterSupport, fail, refreshWorkspace } = useApp();
  const { busy, run } = useAction();
  const [filter, setFilter] = useState<Filter>('open');
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [priority, setPriority] = useState('all');
  const [page, setPage] = useState(1);
  const [replyStatus, setReplyStatus] = useState<TicketStatus>('waiting');

  const list = useApiData<Queue>(`/platform/support/tickets${query({ status: filter, q: search, priority, page })}`, [filter, search, priority, page]);
  const detail = useApiData<{ data: Ticket; pharmacy: { name: string; status: string; phone: string | null; email: string | null } | null }>(
    id ? `/platform/support/tickets/${id}` : null, [id]
  );

  const open = (ticket: TicketSummary) => navigate(`/platform/support/${ticket.id}`);

  const reply = (body: string) => run(
    () => api.post<{ data: Ticket }>(`/platform/support/tickets/${id}/messages`, { body, status: replyStatus }),
    (result) => {
      detail.setData((current) => (current ? { ...current, data: result.data } : current));
      ok('Answer sent', 'The pharmacy has been notified and e-mailed.');
      void list.reload(true);
      void refreshWorkspace();
    }
  );

  const setStatus = (status: TicketStatus) => run(
    () => api.patch<{ data: Ticket }>(`/platform/support/tickets/${id}`, { status }),
    (result) => { detail.setData((current) => (current ? { ...current, data: result.data } : current)); void list.reload(true); }
  );

  const goInside = async () => {
    const ticket = detail.data?.data;
    if (!ticket) return;
    try {
      await enterSupport(ticket.pharmacy_id);
      ok(`Working inside ${ticket.pharmacy_name}`, 'Everything you do is recorded as Super Admin (support).');
      navigate('/dashboard');
    } catch (problem) {
      fail(problem);
    }
  };

  const counts = list.data?.counts;
  const ticket = detail.data?.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Support desk</h1>
          <p className="sub">Requests from every pharmacy. Answer here, or step inside the pharmacy to fix the problem yourself.</p>
        </div>
      </div>

      <Tabs
        value={filter}
        onChange={(value) => { setFilter(value); setPage(1); }}
        tabs={[
          { value: 'open', label: 'Open', count: (counts?.open ?? 0) + (counts?.in_progress ?? 0) + (counts?.waiting ?? 0) },
          { value: 'unread', label: 'Unread', count: counts?.unread },
          { value: 'resolved', label: 'Resolved', count: counts?.resolved },
          { value: 'closed', label: 'Closed', count: counts?.closed },
          { value: 'all', label: 'Everything' }
        ]}
      />

      <div className={`desk ${id ? 'has-selection' : ''}`}>
        <div className="desk-list">
          <div className="desk-list-head">
            <SearchField value={term} onChange={(value) => { setTerm(value); setPage(1); }} placeholder="Reference, subject, pharmacy or person…" />
            <SelectInput aria-label="Priority" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }}
              options={[{ value: 'all', label: 'Any priority' }, { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]} />
          </div>
          <div className="desk-list-body">
            {list.loading && !list.data
              ? <TableSkeleton rows={6} columns={1} />
              : <TicketList tickets={list.data?.data ?? []} selected={id} onSelect={open} side="platform"
                  empty={{ title: filter === 'open' ? 'Nothing waiting' : 'No requests here', message: filter === 'open' ? 'Every pharmacy has been answered.' : undefined }} />}
          </div>
          {list.data && list.data.pages > 1 && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} size={list.data.size} onPage={setPage} />}
        </div>

        <div className="desk-pane">
          <button className="link-button desk-back" onClick={() => navigate('/platform/support')}><ArrowLeft size={15} /> All requests</button>
          {!id
            ? <EmptyState icon={<LifeBuoy size={30} />} title="Choose a request" message="Pick a request on the left to read it and answer." />
            : detail.loading && !ticket
              ? <TableSkeleton rows={5} columns={1} />
              : !ticket
                ? <EmptyState title="That request could not be found" />
                : (
                  <>
                    <div className="row-between" style={{ padding: 'var(--s-3) var(--s-5)', borderBottom: '1px solid var(--line)', gap: 8, flexWrap: 'wrap' }}>
                      <button className="link-button" onClick={() => navigate(`/platform/pharmacies/${ticket.pharmacy_id}`)}><Building2 size={15} /> {ticket.pharmacy_name}</button>
                      <div className="row-tight" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <SelectInput aria-label="Status" value={ticket.status} onChange={(event) => { void setStatus(event.target.value as TicketStatus); }}
                          options={(Object.keys(TICKET_STATUS_LABEL) as TicketStatus[]).map((key) => ({ value: key, label: TICKET_STATUS_LABEL[key] }))} />
                        <Button size="sm" variant="outline" icon={<LogIn size={15} />} onClick={() => { void goInside(); }}>Work inside</Button>
                      </div>
                    </div>
                    <TicketThread
                      ticket={ticket}
                      side="platform"
                      onReply={reply}
                      replying={busy}
                      extraActions={
                        <SelectInput aria-label="After sending" value={replyStatus} onChange={(event) => setReplyStatus(event.target.value as TicketStatus)}
                          options={[
                            { value: 'waiting', label: 'Then wait for the pharmacy' },
                            { value: 'in_progress', label: 'Then keep it in progress' },
                            { value: 'resolved', label: 'Then mark it resolved' }
                          ]} />
                      }
                    />
                  </>
                )}
        </div>
      </div>
    </>
  );
}
