/* Help & Support: asking KSF for help without picking up the phone.

   Anybody at the pharmacy can raise a request; the pharmacy Admin sees all of
   them, everyone else sees their own. Replies from KSF arrive here, as a
   notification and by e-mail. */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, Plus, CheckCircle2, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import { Button, Tabs, Modal, TextInput, TextArea, SelectInput, EmptyState, TableSkeleton, Alert } from '../components/ui';
import { TicketList, TicketThread } from '../components/support';
import { TICKET_CATEGORY_LABEL, type Ticket, type TicketStatus, type TicketSummary } from '../types/platform';

interface ListReply { data: TicketSummary[]; total: number; counts: Record<TicketStatus, number>; categories: string[]; priorities: string[] }

export default function Support() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ok, refreshWorkspace, user } = useApp();
  const { busy, run } = useAction();
  const [filter, setFilter] = useState<'open' | 'all' | 'resolved' | 'closed'>('open');
  const [creating, setCreating] = useState(false);

  const list = useApiData<ListReply>(`/support/tickets${query({ status: filter, size: 50 })}`, [filter]);
  const detail = useApiData<{ data: Ticket }>(id ? `/support/tickets/${id}` : null, [id]);
  useEffect(() => { if (detail.data) void refreshWorkspace(); }, [detail.data, refreshWorkspace]);

  const reply = (body: string) => run(
    () => api.post<{ data: Ticket }>(`/support/tickets/${id}/messages`, { body }),
    (result) => { detail.setData({ data: result.data }); void list.reload(true); }
  );

  const close = () => run(
    () => api.post<{ data: Ticket }>(`/support/tickets/${id}/close`, {}),
    (result) => { detail.setData({ data: result.data }); ok('Request closed', 'Glad it is sorted.'); void list.reload(true); }
  );

  const reopen = () => run(
    () => api.post<{ data: Ticket }>(`/support/tickets/${id}/reopen`, {}),
    (result) => { detail.setData({ data: result.data }); ok('Request reopened', 'KSF support has been told.'); void list.reload(true); }
  );

  const counts = list.data?.counts;
  const ticket = detail.data?.data;
  const isClosed = ticket?.status === 'closed';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Help &amp; Support</h1>
          <p className="sub">
            Ask KSF for help with anything — an account, a payment, a screen that is not working. {user?.roleKey === 'admin' ? 'You see every request from your pharmacy.' : 'You see the requests you raised.'}
          </p>
        </div>
        <div className="actions">
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>New request</Button>
        </div>
      </div>

      <Tabs value={filter} onChange={setFilter} tabs={[
        { value: 'open', label: 'Open', count: (counts?.open ?? 0) + (counts?.in_progress ?? 0) + (counts?.waiting ?? 0) },
        { value: 'resolved', label: 'Resolved', count: counts?.resolved },
        { value: 'closed', label: 'Closed', count: counts?.closed },
        { value: 'all', label: 'Everything' }
      ]} />

      <div className={`desk ${id ? 'has-selection' : ''}`}>
        <div className="desk-list">
          <div className="desk-list-body">
            {list.loading && !list.data
              ? <TableSkeleton rows={5} columns={1} />
              : <TicketList tickets={list.data?.data ?? []} selected={id} side="pharmacy" onSelect={(row) => navigate(`/support/${row.id}`)}
                  empty={{ title: filter === 'open' ? 'Nothing open' : 'No requests here', message: 'Press "New request" whenever you need a hand.' }} />}
          </div>
        </div>
        <div className="desk-pane">
          <button className="link-button desk-back" onClick={() => navigate('/support')}><ArrowLeft size={15} /> All requests</button>
          {!id
            ? (
              <EmptyState
                icon={<LifeBuoy size={30} />}
                title="How can KSF help?"
                message="Pick a request to read the replies, or raise a new one. You will be notified the moment KSF answers."
                action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>New request</Button>}
              />
            )
            : detail.loading && !ticket
              ? <TableSkeleton rows={5} columns={1} />
              : !ticket
                ? <EmptyState title="That request could not be found" />
                : (
                  <TicketThread
                    ticket={ticket}
                    side="pharmacy"
                    onReply={reply}
                    replying={busy}
                    disabledReason={isClosed ? 'This request is closed. Reopen it if the problem is back.' : undefined}
                    extraActions={ticket.status !== 'closed'
                      ? <Button size="sm" variant="outline" icon={<CheckCircle2 size={15} />} onClick={() => { void close(); }}>It is sorted — close</Button>
                      : undefined}
                  />
                )}
          {ticket && isClosed && (
            <div style={{ padding: 'var(--s-3) var(--s-5)' }}>
              <Button size="sm" variant="outline" icon={<RotateCcw size={15} />} loading={busy} onClick={() => { void reopen(); }}>Reopen</Button>
            </div>
          )}
        </div>
      </div>

      <NewRequest open={creating} onClose={() => setCreating(false)} onCreated={(created) => { setCreating(false); void list.reload(true); navigate(`/support/${created.id}`); }} />
    </>
  );
}

function NewRequest({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (ticket: Ticket) => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [form, setForm] = useState({ subject: '', category: 'technical', priority: 'normal', body: '' });
  useEffect(() => { if (open) setForm({ subject: '', category: 'technical', priority: 'normal', body: '' }); }, [open]);

  const send = () => run(
    () => api.post<{ data: Ticket; message: string }>('/support/tickets', form),
    (reply) => { ok('Request sent', reply.message); onCreated(reply.data); }
  );

  return (
    <Modal open={open} onClose={onClose} icon={<LifeBuoy />} title="Ask KSF for help" subtitle="Say what happened and what you expected. The more detail, the faster the answer."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => { void send(); }} disabled={!form.subject.trim() || !form.body.trim()}>Send request</Button></>}>
      <div className="form-grid">
        <TextInput label="Subject" required wrapClass="span-2" maxLength={140} value={form.subject} placeholder="For example: the receipt printer stopped printing"
          onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
        <SelectInput label="About" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
          options={Object.entries(TICKET_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
        <SelectInput label="How urgent" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
          options={[{ value: 'low', label: 'Whenever you can' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Soon — it slows us down' }, { value: 'urgent', label: 'Urgent — we cannot work' }]} />
        <TextArea label="What happened" required wrapClass="span-2" rows={6} maxLength={5000} value={form.body}
          onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
      </div>
      <div className="mt-4"><Alert tone="info">Never write a password here. KSF support never needs it — they can help from their own console.</Alert></div>
    </Modal>
  );
}
