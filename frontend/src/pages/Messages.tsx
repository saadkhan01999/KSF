/* Internal messaging.

   Two panes: the threads you are in, and the one you have open. It looks like
   every messaging app staff already use, because the goal is that nobody needs
   training — the only new idea is that a conversation can be addressed to a
   *role* rather than to people, so "every Pharmacist" keeps meaning the right
   people as staff come and go. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MessagesSquare, Plus, Send, Search, Users, Megaphone, ShieldCheck,
  CheckCheck, ArrowLeft, BellOff, Bell, CircleCheck, RotateCcw, Trash2,
  AlertTriangle, Link2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, Modal, TextInput, TextArea, SelectInput, Checkbox, EmptyState,
  TableSkeleton, Badge, Allow, Alert, Segmented, Spinner, ConfirmDialog
} from '../components/ui';
import { initials, ago, dateTime, date } from '../utils/format';
import type { Conversation, MessageDirectory, Paged } from '../types';

interface ConversationList extends Paged<Conversation> {
  counts: { total: number; open: number; resolved: number; urgent: number };
}

const KIND_LABEL: Record<string, string> = {
  direct: 'Direct',
  role: 'To a role',
  broadcast: 'Everyone'
};

export default function Messages() {
  const { user, ok, refreshWorkspace } = useApp();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();

  const [filter, setFilter] = useState('open');
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [openId, setOpenId] = useState<string | null>(params.get('thread'));
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const streamRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const listPath = `/messages/conversations${query({ filter, q: search, size: 60 })}`;
  const { data: list, loading, reload: reloadList } = useApiData<ConversationList>(listPath, [filter, search]);
  const { data: thread, loading: threadLoading, reload: reloadThread } =
    useApiData<{ data: Conversation }>(openId ? `/messages/conversations/${openId}` : null, [openId]);

  const conversations = list?.data ?? [];
  const current = thread?.data ?? null;

  useEffect(() => {
    setParams(openId ? new URLSearchParams({ thread: openId }) : new URLSearchParams(), { replace: true });
  }, [openId, setParams]);

  /* Opening a thread marks it read, which is what clears the sidebar badge. */
  useEffect(() => {
    if (!openId || !current) return;
    void api.post(`/messages/conversations/${openId}/read`).then(() => {
      void reloadList(true);
      void refreshWorkspace();
    });
  }, [openId, current?.messages?.length, reloadList, refreshWorkspace, current]);

  /* Keep the newest message in view when a thread opens or a reply lands. */
  useEffect(() => {
    const node = streamRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [current?.id, current?.messages?.length]);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !openId) return;
    void run(
      () => api.post(`/messages/conversations/${openId}/messages`, { body }),
      () => { setDraft(''); void reloadThread(true); void reloadList(true); composerRef.current?.focus(); }
    );
  }, [draft, openId, run, reloadThread, reloadList]);

  const onComposerKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter makes a new line — the convention everyone knows.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  /* Messages grouped by day, so a long thread stays readable. */
  const grouped = useMemo(() => {
    const groups: { day: string; items: NonNullable<Conversation['messages']> }[] = [];
    for (const message of current?.messages ?? []) {
      const day = message.created_at.slice(0, 10);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(message);
      else groups.push({ day, items: [message] });
    }
    return groups;
  }, [current]);

  const dayLabel = (day: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    return date(day);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="sub">
            Talk to the rest of the team inside KSF, so a question about a batch or a price stays
            next to the record it is about — and inside the pharmacy.
          </p>
        </div>
        <Allow permission="messages.write">
          <div className="actions">
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setComposeOpen(true)}>
              New conversation
            </Button>
          </div>
        </Allow>
      </div>

      <div className={`msg ${openId ? 'has-open' : ''}`}>
        {/* ------------------------------ thread list ------------------------------ */}
        <aside className="msg-list">
          <div className="msg-list-head">
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <div className="search" style={{ maxWidth: 'none' }}>
                <Search />
                <input
                  className="input"
                  type="search"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search conversations…"
                  aria-label="Search conversations"
                />
              </div>
            </div>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: `Open${list?.counts?.open ? ` (${list.counts.open})` : ''}` },
                { value: 'urgent', label: 'Urgent' },
                { value: 'resolved', label: 'Done' },
                { value: 'all', label: 'All' }
              ]}
            />
          </div>

          <div className="msg-list-scroll">
            {loading
              ? <TableSkeleton rows={6} columns={2} />
              : conversations.length === 0
                ? (
                  <EmptyState
                    icon={<MessagesSquare size={26} />}
                    title={search ? 'Nothing matches' : 'No conversations yet'}
                    message={search
                      ? 'Try a different word, or switch to All.'
                      : 'Start one to ask a colleague something without leaving KSF.'}
                  />
                )
                : conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    className={`msg-row ${conversation.id === openId ? 'is-active' : ''} ${(conversation.unread ?? 0) > 0 ? 'is-unread' : ''}`}
                    onClick={() => setOpenId(conversation.id)}
                  >
                    <span className={`avatar sm ${conversation.kind === 'broadcast' ? 'gold' : conversation.kind === 'role' ? 'neutral' : ''}`}>
                      {conversation.kind === 'broadcast'
                        ? <Megaphone size={13} />
                        : conversation.kind === 'role'
                          ? <Users size={13} />
                          : initials(conversation.last_sender ?? conversation.created_by_name)}
                    </span>
                    <span className="body">
                      <span className="msg-row-top">
                        <span className="msg-row-subject">{conversation.subject}</span>
                        <span className="msg-row-when">{ago(conversation.last_message_at)}</span>
                      </span>
                      <span className="msg-row-preview">
                        {conversation.last_sender ? `${conversation.last_sender.split(' ')[0]}: ` : ''}
                        {conversation.last_body || 'No messages yet.'}
                      </span>
                      <span className="msg-row-meta">
                        <Badge tone={conversation.kind === 'broadcast' ? 'gold' : conversation.kind === 'role' ? 'info' : 'neutral'} dot={false}>
                          {conversation.kind === 'role' && conversation.audience_role_name
                            ? conversation.audience_role_name
                            : KIND_LABEL[conversation.kind]}
                        </Badge>
                        {conversation.priority !== 'normal' && (
                          <Badge tone={conversation.priority === 'urgent' ? 'danger' : 'warn'} dot={false}>
                            {conversation.priority}
                          </Badge>
                        )}
                        {conversation.status === 'resolved' && <Badge tone="ok" dot={false}>Done</Badge>}
                        {(conversation.unread ?? 0) > 0 && (
                          <span className="msg-unread" style={{ marginLeft: 'auto' }}>{conversation.unread}</span>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
          </div>
        </aside>

        {/* -------------------------------- thread -------------------------------- */}
        <section className="msg-thread">
          {!openId
            ? (
              <EmptyState
                icon={<MessagesSquare size={30} />}
                title="Pick a conversation"
                message="Choose a thread on the left, or start a new one. You can write to a person, to everyone holding a role, or to the whole team."
              />
            )
            : threadLoading || !current
              ? <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}><Spinner large /></div>
              : (
                <>
                  <header className="msg-thread-head">
                    <button
                      className="icon-btn nav-toggle"
                      onClick={() => setOpenId(null)}
                      aria-label="Back to conversations"
                    >
                      <ArrowLeft />
                    </button>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <h2 className="truncate">{current.subject}</h2>
                      <div className="sub">
                        {current.members?.length ?? 0} member{(current.members?.length ?? 0) === 1 ? '' : 's'}
                        {' · '}started by {current.created_by_name ?? 'a colleague'} {ago(current.created_at)}
                        {current.linked_entity ? ` · about a ${current.linked_entity}` : ''}
                      </div>
                      <div className="row-tight wrap mt-2">
                        <Badge tone={current.kind === 'broadcast' ? 'gold' : current.kind === 'role' ? 'info' : 'neutral'} dot={false}>
                          {current.kind === 'role' && current.audience_role_name
                            ? `Every ${current.audience_role_name}`
                            : KIND_LABEL[current.kind]}
                        </Badge>
                        {current.priority !== 'normal' && (
                          <Badge tone={current.priority === 'urgent' ? 'danger' : 'warn'} dot={false}>
                            {current.priority}
                          </Badge>
                        )}
                        {current.status === 'resolved' && <Badge tone="ok" dot={false}>Resolved</Badge>}
                        {current.linked_entity && (
                          <Badge tone="purple" dot={false} icon={<Link2 size={11} />}>{current.linked_entity}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="row-tight">
                      <button
                        className="icon-btn"
                        title={current.members?.find((m) => m.user_id === user?.id)?.is_muted ? 'Unmute' : 'Mute'}
                        aria-label="Mute this conversation"
                        onClick={() => run(
                          () => api.post<{ muted: boolean }>(`/messages/conversations/${current.id}/mute`),
                          (result) => { ok(result.muted ? 'Muted' : 'Unmuted'); void reloadThread(true); }
                        )}
                      >
                        {current.members?.find((m) => m.user_id === user?.id)?.is_muted ? <BellOff /> : <Bell />}
                      </button>
                      <Allow permission="messages.write">
                        <Button
                          size="sm"
                          variant={current.status === 'resolved' ? 'secondary' : 'quiet'}
                          icon={current.status === 'resolved' ? <RotateCcw size={14} /> : <CircleCheck size={14} />}
                          onClick={() => run(
                            () => api.post(`/messages/conversations/${current.id}/resolve`),
                            () => {
                              ok(current.status === 'resolved' ? 'Reopened' : 'Marked resolved');
                              void reloadThread(true);
                              void reloadList(true);
                            }
                          )}
                        >
                          {current.status === 'resolved' ? 'Reopen' : 'Resolve'}
                        </Button>
                      </Allow>
                    </div>
                  </header>

                  <div className="msg-stream" ref={streamRef}>
                    {grouped.map((group) => (
                      <div key={group.day} style={{ display: 'contents' }}>
                        <div className="msg-day">{dayLabel(group.day)}</div>
                        {group.items.map((message) => {
                          const mine = message.sender_id === user?.id;
                          return (
                            <div className={`msg-bubble-row ${mine ? 'is-mine' : ''}`} key={message.id}>
                              {!mine && <span className="avatar sm">{initials(message.sender_name)}</span>}
                              <div style={{ minWidth: 0 }}>
                                <div className="msg-bubble-meta">
                                  {!mine && <span className="msg-bubble-sender">{message.sender_name}</span>}
                                  {!mine && message.sender_role && <span>· {message.sender_role}</span>}
                                  <span title={dateTime(message.created_at)}>
                                    {new Date(message.created_at).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}
                                  </span>
                                  {mine && (
                                    <button
                                      className="icon-btn"
                                      style={{ width: 22, height: 22 }}
                                      aria-label="Withdraw this message"
                                      onClick={() => setRemoving(message.id)}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                                <div className="msg-bubble">{message.body}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {grouped.length === 0 && (
                      <EmptyState title="No messages yet" message="Write the first one below." />
                    )}
                  </div>

                  <Allow
                    permission="messages.write"
                    fallback={
                      <div className="msg-composer">
                        <Alert tone="info">Your role can read this conversation but not reply to it.</Alert>
                      </div>
                    }
                  >
                    <div className="msg-composer">
                      {current.status === 'resolved'
                        ? <Alert tone="ok" icon={<CheckCheck />}>This conversation is resolved. Reopen it to reply.</Alert>
                        : (
                          <div className="row" style={{ gap: 10 }}>
                            <textarea
                              ref={composerRef}
                              className="textarea grow"
                              rows={1}
                              value={draft}
                              maxLength={4000}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={onComposerKey}
                              placeholder="Write a message… (Enter sends, Shift+Enter for a new line)"
                              aria-label="Message"
                            />
                            <Button
                              variant="primary"
                              icon={<Send size={17} />}
                              loading={busy}
                              disabled={!draft.trim()}
                              onClick={send}
                            >
                              Send
                            </Button>
                          </div>
                        )}
                    </div>
                  </Allow>
                </>
              )}
        </section>
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={(id) => { setComposeOpen(false); setOpenId(id); void reloadList(true); }}
      />

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/messages/messages/${removing}`),
          () => { setRemoving(null); ok('Message withdrawn'); void reloadThread(true); void reloadList(true); }
        )}
        loading={busy}
        title="Withdraw this message?"
        confirmLabel="Withdraw"
        message="The text is removed for everyone, but the fact that a message was sent and withdrawn stays in the thread. Conversations cannot be silently rewritten."
      />
    </>
  );
}

/* ----------------------------- new conversation ----------------------------- */

function ComposeModal({
  open, onClose, onSent
}: { open: boolean; onClose: () => void; onSent: (id: string) => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();

  const [audience, setAudience] = useState<'people' | 'role' | 'everyone'>('people');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roleId, setRoleId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [personSearch, setPersonSearch] = useState('');

  const { data: directory } = useApiData<MessageDirectory>(open ? '/messages/directory' : null, [open]);

  useEffect(() => {
    if (!open) return;
    setAudience('people'); setSelected(new Set()); setRoleId('');
    setSubject(''); setBody(''); setPriority('normal'); setPersonSearch('');
  }, [open]);

  const people = useMemo(() => {
    const list = directory?.people ?? [];
    if (!personSearch) return list;
    const needle = personSearch.toLowerCase();
    return list.filter((p) => `${p.full_name} ${p.role_name}`.toLowerCase().includes(needle));
  }, [directory, personSearch]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const canBroadcast = directory?.canBroadcast ?? false;
  const ready = subject.trim() && body.trim()
    && (audience === 'people' ? selected.size > 0 : audience === 'role' ? !!roleId : true);

  const submit = () => run(
    () => api.post<{ data: Conversation }>('/messages/conversations', {
      subject,
      body,
      priority,
      userIds: audience === 'people' ? [...selected] : [],
      roleId: audience === 'role' ? roleId : '',
      broadcast: audience === 'everyone'
    }),
    (result) => { ok('Conversation started', subject); onSent(result.data.id); }
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<MessagesSquare />}
      title="New conversation"
      subtitle="Write to a person, to everyone holding a role, or to the whole team."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!ready}>Send</Button>
        </>
      }
    >
      <div className="col" style={{ gap: 18 }}>
        <div className="field">
          <label className="label">Who is this for?</label>
          <Segmented
            value={audience}
            onChange={(value) => setAudience(value as typeof audience)}
            options={[
              { value: 'people', label: 'Specific people' },
              { value: 'role', label: 'A whole role' },
              { value: 'everyone', label: 'Everyone' }
            ]}
          />
          {!canBroadcast && audience !== 'people' && (
            <span className="hint" style={{ color: 'var(--warn-600)' }}>
              Your role can only message specific people. Ask your Admin if you need to announce to a group.
            </span>
          )}
        </div>

        {audience === 'people' && (
          <div className="field">
            <label className="label">
              Choose people
              {selected.size > 0 && <span className="pill-count">{selected.size} selected</span>}
            </label>
            <div className="search" style={{ position: 'relative', marginBottom: 8 }}>
              <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', width: 17, height: 17 }} />
              <input
                className="input"
                style={{ paddingLeft: 37 }}
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Find a colleague…"
                aria-label="Find a colleague"
              />
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
              {people.map((person) => (
                <label
                  key={person.id}
                  className="row"
                  style={{ gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--line-faint)', cursor: 'pointer' }}
                >
                  <Checkbox checked={selected.has(person.id)} onChange={() => toggle(person.id)} label="" />
                  <span className="avatar sm">{initials(person.full_name)}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t-sm t-semi" style={{ display: 'block' }}>{person.full_name}</span>
                    <span className="t-xs t-dim">{person.role_name}{person.branch_name ? ` · ${person.branch_name}` : ''}</span>
                  </span>
                  {person.online > 0 && <Badge tone="ok">Online</Badge>}
                </label>
              ))}
              {people.length === 0 && <div className="t-center t-dim t-sm" style={{ padding: 20 }}>Nobody matches that search.</div>}
            </div>
          </div>
        )}

        {audience === 'role' && (
          <SelectInput
            label="Which role?"
            required
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            placeholder="Choose a role"
            options={(directory?.roles ?? []).map((role) => ({
              value: role.id,
              label: `${role.name} (${role.member_count} ${role.member_count === 1 ? 'person' : 'people'})`
            }))}
            hint="Anyone who takes this role later joins the conversation automatically."
            disabled={!canBroadcast}
          />
        )}

        {audience === 'everyone' && (
          <Alert tone="warn" title="This goes to the whole team" icon={<Megaphone />}>
            Every active member of staff will see it and get an unread badge. Use it for rotas,
            closures and safety notices — not for a question one person can answer.
          </Alert>
        )}

        <TextInput
          label="Subject"
          required
          maxLength={140}
          placeholder="e.g. Augmentin 625 — price change from Getz"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          hint="A clear subject is what makes a thread findable in six months."
        />

        <TextArea
          label="Message"
          required
          rows={5}
          maxLength={4000}
          placeholder="Write your message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          hint={`${body.length} of 4000 characters`}
        />

        <div className="field">
          <label className="label">Priority</label>
          <Segmented
            value={priority}
            onChange={setPriority}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' }
            ]}
          />
          {priority === 'urgent' && (
            <span className="hint row-tight" style={{ color: 'var(--danger-600)' }}>
              <AlertTriangle size={13} /> Urgent also raises a notification for everyone in the thread.
            </span>
          )}
        </div>

        <Alert tone="info" icon={<ShieldCheck />}>
          Conversations stay inside KSF and inside the pharmacy. They are not email, they never
          leave the building, and every one is covered by the same audit trail as the rest of the system.
        </Alert>
      </div>
    </Modal>
  );
}
