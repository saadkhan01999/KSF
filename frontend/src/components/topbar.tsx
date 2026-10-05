/* ==========================================================================
   The three things in the top-right corner: messages, notifications, account.
   --------------------------------------------------------------------------
   Each is a panel that opens in place — at a till in the middle of a sale,
   leaving the screen is the wrong trade — shows the last few, lets you deal
   with them there, and keeps "See all" as a deliberate second click.

   The panels are lazy: nothing is fetched until the panel is opened, so the
   cost of having them is a badge count that the workspace already loads.
   ========================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell, MessagesSquare, Check, CheckCheck, Inbox, AlertTriangle, Info,
  ShieldAlert, CreditCard, PackageX, CalendarClock, Gift, UserPlus, Loader2,
  ArrowRight, Megaphone, Users
} from 'lucide-react';
import { Menu } from './ui';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import { ago, internalPath } from '../utils/format';

/* ---------------------------------------------------------- shared bits -- */

function PanelHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="panel-head">
      <h3>{title}</h3>
      {action}
    </header>
  );
}

function PanelEmpty({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel-empty">
      <span aria-hidden="true">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

function PanelBusy() {
  return (
    <div className="panel-busy" aria-live="polite">
      <Loader2 size={18} className="spin" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}

/** Opens the panel's data the first time it is shown, and never again until
    it is closed and reopened. */
function usePanelData<T>(open: boolean, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    setBusy(true);
    setFailed(false);
    load()
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }, [load]);

  useEffect(() => {
    if (!open) { setData(null); return; }
    refresh();
  }, [open, refresh]);

  return { data, busy, failed, refresh };
}

/* --------------------------------------------------------- notifications -- */

interface NotificationRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: number;
  created_at: string;
}

/* The icon says what kind of thing it is before the words are read, which is
   the whole point of a panel you glance at. */
const NOTIFICATION_ICON: Record<string, React.ReactNode> = {
  stock: <PackageX size={16} />,
  expiry: <CalendarClock size={16} />,
  subscription: <CreditCard size={16} />,
  payment: <CreditCard size={16} />,
  security: <ShieldAlert size={16} />,
  referral: <Gift size={16} />,
  staff: <UserPlus size={16} />,
  system: <Info size={16} />
};

export function NotificationsMenu({ unread }: { unread: number }) {
  const navigate = useNavigate();
  const { refreshWorkspace, isPlatform } = useApp();
  const [open, setOpen] = useState(false);
  /* The platform console has its own notices — new pharmacies, support
     requests — kept apart from any one pharmacy's. */
  const base = isPlatform ? '/platform/notifications' : '/notifications';

  const load = useCallback(
    () => api.get<{ data: NotificationRow[]; counts: { unread: number } }>(isPlatform ? base : `${base}/recent`)
      .then((reply) => ({ ...reply, data: reply.data.slice(0, 6) })),
    [base, isPlatform]
  );
  const { data, busy, failed, refresh } = usePanelData(open, load);

  const markRead = async (id: string) => {
    await api.post(`${base}/${id}/read`);
    refresh();
    void refreshWorkspace();
  };

  const markAll = async () => {
    await api.post(`${base}/read-all`);
    refresh();
    void refreshWorkspace();
  };

  const openOne = (item: NotificationRow, close: () => void) => {
    if (!item.is_read) void markRead(item.id);
    close();
    /* A stored link is data, not a destination. */
    navigate(internalPath(item.link, base));
  };

  return (
    <Menu
      panel
      label="Notifications"
      onOpenChange={setOpen}
      trigger={({ toggle, props }) => (
        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          {...props}
        >
          <Bell />
          {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <>
          <PanelHead
            title="Notifications"
            action={
              unread > 0
                ? (
                  <button type="button" className="link-button" onClick={() => { void markAll(); }}>
                    <CheckCheck size={14} aria-hidden="true" /> Mark all read
                  </button>
                )
                : undefined
            }
          />

          {busy && !data && <PanelBusy />}
          {failed && <PanelEmpty icon={<AlertTriangle size={20} />}>These could not be loaded. Try again in a moment.</PanelEmpty>}

          {data && data.data.length === 0 && (
            <PanelEmpty icon={<Inbox size={20} />}>Nothing needs your attention.</PanelEmpty>
          )}

          {data && data.data.length > 0 && (
            <ul className="panel-list">
              {data.data.map((item) => (
                <li key={item.id} className={`panel-row tone-${item.severity} ${item.is_read ? '' : 'is-unread'}`}>
                  <button type="button" onClick={() => openOne(item, close)}>
                    <span className="panel-row-icon" aria-hidden="true">
                      {NOTIFICATION_ICON[item.type] ?? <Info size={16} />}
                    </span>
                    <span className="panel-row-body">
                      <strong>{item.title}</strong>
                      {item.body && <span className="panel-row-note">{item.body}</span>}
                      <span className="panel-row-time">{ago(item.created_at)}</span>
                    </span>
                    {!item.is_read && <span className="panel-row-dot" aria-label="Unread" />}
                  </button>
                  {!item.is_read && (
                    <button
                      type="button"
                      className="panel-row-action"
                      onClick={() => { void markRead(item.id); }}
                      aria-label={`Mark "${item.title}" as read`}
                      title="Mark as read"
                    >
                      <Check size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <footer className="panel-foot">
            <Link to={base} onClick={close}>
              See all notifications <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </footer>
        </>
      )}
    </Menu>
  );
}

/* -------------------------------------------------------------- messages -- */

interface ConversationRow {
  id: string;
  subject: string;
  kind: string;
  priority: string;
  status: string;
  last_message_at: string;
  last_body: string | null;
  last_sender: string | null;
  unread: number;
}

const KIND_ICON: Record<string, React.ReactNode> = {
  direct: <MessagesSquare size={16} />,
  role: <Users size={16} />,
  broadcast: <Megaphone size={16} />
};

export function MessagesMenu({ unread }: { unread: number }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const load = useCallback(() => api.get<{ data: ConversationRow[] }>('/messages/recent'), []);
  const { data, busy, failed } = usePanelData(open, load);

  return (
    <Menu
      panel
      label="Messages"
      onOpenChange={setOpen}
      trigger={({ toggle, props }) => (
        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
          {...props}
        >
          <MessagesSquare />
          {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <>
          <PanelHead title="Messages" />

          {busy && !data && <PanelBusy />}
          {failed && <PanelEmpty icon={<AlertTriangle size={20} />}>These could not be loaded. Try again in a moment.</PanelEmpty>}

          {data && data.data.length === 0 && (
            <PanelEmpty icon={<Inbox size={20} />}>No conversations yet.</PanelEmpty>
          )}

          {data && data.data.length > 0 && (
            <ul className="panel-list">
              {data.data.map((row) => (
                <li key={row.id} className={`panel-row ${row.unread > 0 ? 'is-unread' : ''}`}>
                  <button
                    type="button"
                    onClick={() => { close(); navigate(`/messages?thread=${encodeURIComponent(row.id)}`); }}
                  >
                    <span className="panel-row-icon" aria-hidden="true">
                      {KIND_ICON[row.kind] ?? <MessagesSquare size={16} />}
                    </span>
                    <span className="panel-row-body">
                      <strong>{row.subject}</strong>
                      <span className="panel-row-note">
                        {row.last_sender ? `${row.last_sender}: ` : ''}{row.last_body ?? 'No messages yet'}
                      </span>
                      <span className="panel-row-time">{ago(row.last_message_at)}</span>
                    </span>
                    {row.unread > 0 && (
                      <span className="panel-row-count">{row.unread > 9 ? '9+' : row.unread}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <footer className="panel-foot">
            <Link to="/messages" onClick={close}>
              Open all messages <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </footer>
        </>
      )}
    </Menu>
  );
}
