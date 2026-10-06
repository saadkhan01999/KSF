/* The pieces both sides of a support request share: the list of requests
   and the conversation itself. The pharmacy sees "KSF Support" on the
   platform's replies; the platform sees which pharmacy and which person
   wrote, and their role — and, for its own replies, who on the desk wrote
   each one and who has the request. */

import { useEffect, useRef, useState } from 'react';
import { Send, LifeBuoy, Building2 } from 'lucide-react';
import { Button, StatusBadge, EmptyState, Badge } from './ui';
import { PersonAvatar } from './people';
import { ago, dateTime, initials } from '../utils/format';
import { TICKET_CATEGORY_LABEL, type Ticket, type TicketSummary } from '../types/platform';

export function TicketList({
  tickets, selected, onSelect, side, empty
}: {
  tickets: TicketSummary[]; selected?: string | null; onSelect: (ticket: TicketSummary) => void;
  side: 'pharmacy' | 'platform'; empty: { title: string; message?: string };
}) {
  if (!tickets.length) return <EmptyState icon={<LifeBuoy size={28} />} title={empty.title} message={empty.message} />;
  return (
    <ul className="ticket-list">
      {tickets.map((ticket) => {
        const unread = side === 'platform' ? ticket.unread_by_platform : ticket.unread_by_pharmacy;
        return (
          <li key={ticket.id}>
            <button type="button" className={`ticket-row ${selected === ticket.id ? 'is-selected' : ''} ${unread ? 'is-unread' : ''}`} onClick={() => onSelect(ticket)}>
              <div className="row-between" style={{ gap: 8 }}>
                <strong className="truncate">{ticket.subject}</strong>
                <span className="t-xs t-dim" style={{ flex: '0 0 auto' }}>{ago(ticket.last_activity_at)}</span>
              </div>
              <div className="t-xs t-dim truncate">
                {side === 'platform' ? <><Building2 size={12} /> {ticket.pharmacy_name} · {ticket.raised_by_name}</> : <>{ticket.reference} · {ticket.raised_by_name}</>}
              </div>
              {ticket.last_message && <div className="t-sm t-soft ticket-preview">{ticket.last_message.author_side === side ? 'You: ' : ''}{ticket.last_message.preview}</div>}
              <div className="row-tight" style={{ flexWrap: 'wrap', gap: 6 }}>
                <StatusBadge status={ticket.status} />
                {(ticket.priority === 'high' || ticket.priority === 'urgent') && <StatusBadge status={ticket.priority} />}
                {side === 'platform' && ticket.assigned_to_name && (
                  <span className="row-tight t-xs t-soft ticket-assignee" title={`Given to ${ticket.assigned_to_name}`}>
                    <PersonAvatar name={ticket.assigned_to_name} url={ticket.assigned_to_avatar} size="xs" /> {ticket.assigned_to_name}
                  </span>
                )}
                {unread ? <span className="unread-dot" aria-label="Unread" /> : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TicketThread({
  ticket, side, onReply, replying, disabledReason, extraActions
}: {
  ticket: Ticket; side: 'pharmacy' | 'platform';
  onReply?: (body: string) => Promise<unknown>; replying?: boolean; disabledReason?: string;
  extraActions?: React.ReactNode;
}) {
  const [body, setBody] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [ticket.messages.length]);

  const send = async () => {
    if (!body.trim() || !onReply) return;
    await onReply(body.trim());
    setBody('');
  };

  return (
    <div className="ticket-thread">
      <header className="ticket-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="truncate">{ticket.subject}</h2>
          <div className="t-sm t-dim">
            <span className="mono">{ticket.reference}</span> · {TICKET_CATEGORY_LABEL[ticket.category] ?? ticket.category}
            {side === 'platform' ? ` · ${ticket.pharmacy_name}` : ''} · opened {dateTime(ticket.created_at)}
          </div>
          {side === 'platform' && ticket.resolved_by_name && (ticket.status === 'resolved' || ticket.status === 'closed') && (
            <div className="t-sm t-soft mt-1">{ticket.status === 'closed' ? 'Closed' : 'Resolved'} by {ticket.resolved_by_name}</div>
          )}
        </div>
        <div className="row-tight" style={{ flexWrap: 'wrap', gap: 6 }}>
          <StatusBadge status={ticket.status} large />
          <StatusBadge status={ticket.priority} />
        </div>
      </header>

      <div className="ticket-messages" aria-live="polite">
        {ticket.messages.map((message) => {
          const mine = message.author_side === side;
          /* The desk sees who wrote its replies; the pharmacy sees KSF Support. */
          const name = message.author_side === 'platform'
            ? (side === 'platform' ? message.agent_name ?? message.author_name : 'KSF Support')
            : message.author_name;
          return (
            <div key={message.id} className={`bubble-row ${mine ? 'is-mine' : ''}`}>
              <span className={`avatar sm ${message.author_side === 'platform' ? 'gold' : ''}`} aria-hidden="true">{message.author_side === 'platform' ? 'KS' : initials(message.author_name)}</span>
              <div className="bubble">
                <div className="bubble-meta">
                  <strong>{name}</strong>
                  {message.author_side === 'pharmacy' && side === 'platform' && ticket.raised_by_role && message.author_id === ticket.raised_by && <Badge tone="neutral" dot={false}>{ticket.raised_by_role}</Badge>}
                  {message.author_side === 'platform' && side === 'platform' && message.agent_role && <Badge tone="gold" dot={false}>{message.agent_role}</Badge>}
                  <span>{dateTime(message.created_at)}</span>
                </div>
                <p>{message.body}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {onReply && (
        <footer className="ticket-compose">
          {disabledReason
            ? <p className="t-sm t-dim">{disabledReason}</p>
            : (
              <>
                <textarea
                  className="textarea"
                  rows={3}
                  value={body}
                  maxLength={5000}
                  placeholder={side === 'platform' ? 'Write your answer to the pharmacy…' : 'Add more detail, or reply to KSF support…'}
                  onChange={(event) => setBody(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }}
                  aria-label="Your message"
                />
                <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div className="row-tight" style={{ flexWrap: 'wrap', gap: 8 }}>{extraActions}</div>
                  <Button variant="primary" icon={<Send size={16} />} loading={replying} disabled={!body.trim()} onClick={() => { void send(); }}>Send</Button>
                </div>
              </>
            )}
        </footer>
      )}
    </div>
  );
}
