/* The application shell: sidebar, top bar, and the mobile bottom bar.

   Two navigations share it. A pharmacy's people see the pharmacy, filtered
   by permission, so a cashier sees a short, calm menu and the Admin sees
   everything. The platform Super Admin sees the platform console, and so
   does each member of their team, filtered by their team role — and, while
   working inside a pharmacy, that pharmacy's full menu under a banner that
   says whose pharmacy it is and how to leave. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Pill, Tags, Boxes, CalendarClock, Truck, ClipboardList,
  ShoppingCart, ReceiptText, Users, Stethoscope, Wallet, BarChart3, UserCog,
  ShieldCheck, Bell, ScrollText, Settings, LogOut, Menu as MenuIcon, X, Search,
  PanelLeftClose, PanelLeftOpen, Sun, Moon, Monitor, KeyRound, User, Palette,
  Store, Plus, MessagesSquare, ChevronsUpDown, LifeBuoy, ChevronDown, CreditCard, Scale,
  Building2, Gauge, BadgeDollarSign, Layers, HeartHandshake, ArrowLeftCircle, UsersRound, Landmark, BookOpen
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandLogo, BrandMark } from './Brand';
import { Menu, MenuItem, Modal, Button, TextInput, Allow } from './ui';
import { NotificationsMenu, MessagesMenu } from './topbar';
import { CalculatorMenu } from './Calculator';
import { api } from '../services/api';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useHomeRoute } from '../hooks/useHomeRoute';
import { PersonAvatar } from './people';
import { SubscriptionBanner } from './SubscriptionBanner';
import { useBusiness } from '../services/business';

interface NavEntry {
  to: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
  badge?: 'notifications' | 'prescriptionsPending' | 'lowStock' | 'expiring' | 'purchasesOpen' | 'messagesUnread' | 'supportOpen';
  badgeTone?: 'alert' | 'muted';
}

interface NavGroup { label: string; items: NavEntry[] }

const NAV: NavGroup[] = [
  {
    label: 'Daily work',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard />, permission: 'dashboard.view' },
      { to: '/pos', label: 'New Sale (Till)', icon: <ShoppingCart />, permission: 'pos.operate' },
      { to: '/sales', label: 'Sales History', icon: <ReceiptText />, permission: 'sales.read' },
      { to: '/messages', label: 'Messages', icon: <MessagesSquare />, permission: 'messages.read', badge: 'messagesUnread', badgeTone: 'alert' },
      { to: '/prescriptions', label: 'Prescriptions', icon: <Stethoscope />, permission: 'prescriptions.read', badge: 'prescriptionsPending', badgeTone: 'alert' },
      { to: '/customers', label: 'Customers', icon: <Users />, permission: 'customers.read' }
    ]
  },
  {
    label: 'Stock',
    items: [
      { to: '/medicines', label: 'Medicines', icon: <Pill />, permission: 'medicines.read' },
      { to: '/categories', label: 'Categories', icon: <Tags />, permission: 'medicines.read' },
      { to: '/directory', label: 'Medicine directory', icon: <BookOpen /> },
      { to: '/inventory', label: 'Inventory', icon: <Boxes />, permission: 'inventory.read', badge: 'lowStock', badgeTone: 'alert' },
      { to: '/expiry', label: 'Expiry Control', icon: <CalendarClock />, permission: 'inventory.read', badge: 'expiring', badgeTone: 'muted' }
    ]
  },
  {
    label: 'Buying & money',
    items: [
      { to: '/suppliers', label: 'Suppliers', icon: <Truck />, permission: 'suppliers.read' },
      { to: '/purchases', label: 'Purchases', icon: <ClipboardList />, permission: 'purchases.read', badge: 'purchasesOpen', badgeTone: 'muted' },
      { to: '/expenses', label: 'Expenses', icon: <Wallet />, permission: 'expenses.read' },
      { to: '/accounts', label: 'Accounts', icon: <Landmark />, permission: 'accounting.view' },
      { to: '/day-close', label: 'Close the Day', icon: <Scale />, permission: 'day-close.manage' },
      { to: '/reports', label: 'Reports', icon: <BarChart3 />, permission: 'reports.view' }
    ]
  },
  {
    label: 'Administration',
    items: [
      { to: '/staff', label: 'Staff', icon: <UserCog />, permission: 'staff.read' },
      { to: '/roles', label: 'Roles & Access', icon: <ShieldCheck />, permission: 'roles.read' },
      { to: '/notifications', label: 'Notifications', icon: <Bell />, badge: 'notifications', badgeTone: 'alert' },
      { to: '/activity', label: 'Activity Log', icon: <ScrollText />, permission: 'audit.read' },
      { to: '/settings', label: 'Settings', icon: <Settings />, permission: 'settings.read' },
      { to: '/support', label: 'Help & Support', icon: <LifeBuoy />, permission: 'support.raise', badge: 'supportOpen', badgeTone: 'alert' }
    ]
  }
];

const THEME_CHOICES: { value: 'light' | 'dark' | 'system'; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={16} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} /> },
  { value: 'system', label: 'Auto', icon: <Monitor size={16} /> }
];

/* The platform console: the Super Admin's menu, and their team's — each
   member sees only what their team role includes. */
const PLATFORM_NAV: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { to: '/platform', label: 'Overview', icon: <Gauge />, permission: 'platform.overview' },
      { to: '/platform/pharmacies', label: 'Pharmacies', icon: <Building2 />, permission: 'platform.pharmacies.view' },
      { to: '/platform/support', label: 'Support desk', icon: <LifeBuoy />, permission: 'platform.support', badge: 'supportOpen', badgeTone: 'alert' },
      { to: '/platform/help', label: 'People who need help', icon: <HeartHandshake />, permission: 'platform.help' },
      { to: '/platform/directory', label: 'Medicine directory', icon: <BookOpen /> }
    ]
  },
  {
    label: 'Money',
    items: [
      { to: '/platform/accounts', label: 'Accounts', icon: <Landmark />, permission: 'platform.finance.view' },
      { to: '/platform/income', label: 'Income', icon: <BadgeDollarSign />, permission: 'platform.finance.view' },
      { to: '/platform/plans', label: 'Plans', icon: <Layers />, permission: 'platform.plans.manage' }
    ]
  },
  {
    label: 'Team',
    items: [
      { to: '/platform/team', label: 'My team', icon: <UsersRound />, permission: 'platform.team.manage' }
    ]
  },
  {
    label: 'Records',
    items: [
      { to: '/platform/activity', label: 'Activity', icon: <ScrollText />, permission: 'platform.activity' },
      { to: '/platform/notifications', label: 'Notifications', icon: <Bell />, badge: 'notifications', badgeTone: 'alert' },
      { to: '/account', label: 'My account', icon: <User /> }
    ]
  }
];

const PLATFORM_MOBILE_NAV: NavEntry[] = [
  { to: '/platform', label: 'Overview', icon: <Gauge />, permission: 'platform.overview' },
  { to: '/platform/pharmacies', label: 'Pharmacies', icon: <Building2 />, permission: 'platform.pharmacies.view' },
  { to: '/platform/support', label: 'Support', icon: <LifeBuoy />, permission: 'platform.support' },
  { to: '/platform/income', label: 'Income', icon: <BadgeDollarSign />, permission: 'platform.finance.view' },
  { to: '/platform/help', label: 'Help', icon: <HeartHandshake />, permission: 'platform.help' },
  { to: '/platform/notifications', label: 'Alerts', icon: <Bell /> },
  { to: '/account', label: 'Account', icon: <User /> }
];

/* A link whose address begins another link's ("/platform" before
   "/platform/pharmacies") matches its own page exactly; otherwise both light
   up at once. A detail page under a link ("/platform/pharmacies/PH-1",
   "/sales/INV-7") still lights the link it belongs to. */
const EVERY_PATH = [...NAV, ...PLATFORM_NAV].flatMap((group) => group.items.map((item) => item.to));
const exactOnly = (to: string): boolean => EVERY_PATH.some((other) => other !== to && other.startsWith(`${to}/`));

/* Which subscription statuses count as "nothing to worry about" for the pill
   in the account menu. Anything else — grace, past due, suspended — should
   look different, because it is something the owner has to act on. */
const ACTIVE_PLAN = new Set(['active', 'trial']);

/* The five things counter staff reach for on a phone. */
const MOBILE_NAV: NavEntry[] = [
  { to: '/dashboard', label: 'Home', icon: <LayoutDashboard />, permission: 'dashboard.view' },
  { to: '/inventory', label: 'Stock', icon: <Boxes />, permission: 'inventory.read' },
  { to: '/pos', label: 'Sell', icon: <Plus />, permission: 'pos.operate' },
  { to: '/messages', label: 'Chat', icon: <MessagesSquare />, permission: 'messages.read' },
  { to: '/sales', label: 'Sales', icon: <ReceiptText />, permission: 'sales.read' }
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, workspace, subscription, can, hasFeature, signOut, theme, setTheme, ok, fail, refreshWorkspace, isPlatform, leaveSupport } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ksf-rail') === '1');
  const [search, setSearch] = useState('');
  /* A phone has room in the top bar for the word, not the sentence: cut to
     "Sea", the sentence read as a broken field. */
  const narrow = useMediaQuery('(max-width: 479px)');
  /* The isolated university copy says so, so it is never mistaken for the live service. */
  const { edition } = useBusiness();
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  /* Refresh the badge counts on navigation, so a low-stock count drops the
     moment stock is received and a message badge clears once it is read. */
  useEffect(() => { void refreshWorkspace(); }, [location.pathname, refreshWorkspace]);

  useEffect(() => { localStorage.setItem('ksf-rail', collapsed ? '1' : '0'); }, [collapsed]);

  /* Keyboard: "/" focuses search, F2 opens the till. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        document.getElementById('ksf-global-search')?.focus();
      }
      if (event.key === 'F2' && can('pos.operate')) {
        event.preventDefault();
        navigate('/pos');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, can]);

  const badges = workspace?.badges;
  const badgeFor = useCallback((key?: NavEntry['badge']) => (key && badges ? badges[key] ?? 0 : 0), [badges]);

  const groups = useMemo(
    () => (isPlatform ? PLATFORM_NAV : NAV)
      .map((group) => ({ ...group, items: group.items.filter((item) => !item.permission || can(item.permission)) }))
      .filter((group) => group.items.length > 0),
    [can, isPlatform]
  );

  const mobileItems = useMemo(
    () => {
      const items = (isPlatform ? PLATFORM_MOBILE_NAV : MOBILE_NAV).filter((item) => !item.permission || can(item.permission));
      /* Five fit a phone. On the platform, Account always keeps its place. */
      return isPlatform && items.length > 5 ? [...items.slice(0, 4), items[items.length - 1]] : items.slice(0, 5);
    },
    [can, isPlatform]
  );

  const home = useHomeRoute();
  const admin = !!user && (user.isPlatformAdmin || user.roleKey === 'admin');

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = search.trim();
    if (term) navigate(isPlatform ? `/platform/pharmacies?q=${encodeURIComponent(term)}` : `/medicines?q=${encodeURIComponent(term)}`);
  };

  const backToPlatform = async () => {
    const pharmacyId = user?.pharmacyId;
    await leaveSupport();
    navigate(pharmacyId ? `/platform/pharmacies/${pharmacyId}` : '/platform');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  /* Who and where, under the name: "Admin · Khan Pharmacy", "Super Admin · KSF platform". */
  const whereLine = user?.supportMode
    ? `Support · ${user.pharmacyName ?? workspace?.pharmacy?.name ?? ''}`
    : [user?.roleName, isPlatform ? 'KSF platform' : workspace?.pharmacy?.name].filter(Boolean).join(' · ');

  const accountMenu = (close: () => void) => (
    <>
      <div className="menu-account">
        <PersonAvatar name={user?.fullName} url={user?.avatarUrl} tone={admin ? 'gold' : undefined} />
        <span className="menu-account-meta">
          <strong>{user?.fullName}</strong>
          <span className="truncate">{user?.email}</span>
          <span className="menu-account-tags">
            <span className="badge badge-neutral no-dot">{user?.roleName}</span>
            {subscription && (
              <span className={`badge no-dot ${ACTIVE_PLAN.has(subscription.status) ? 'badge-ok' : 'badge-warn'}`}>
                {subscription.planName}
              </span>
            )}
          </span>
        </span>
      </div>
      <div className="menu-sep" />
      <MenuItem icon={<User />} onClick={() => { close(); navigate('/account'); }}>My account</MenuItem>
      {!isPlatform && (
        <Allow permission="settings.read">
          <MenuItem icon={<Store />} onClick={() => { close(); navigate('/settings'); }}>Pharmacy settings</MenuItem>
          <MenuItem icon={<CreditCard />} onClick={() => { close(); navigate('/settings?tab=billing'); }}>Subscription and billing</MenuItem>
        </Allow>
      )}
      <MenuItem icon={<ShieldCheck />} onClick={() => { close(); navigate('/account?tab=security'); }}>Security centre</MenuItem>
      <MenuItem icon={<KeyRound />} onClick={() => { close(); setPasswordOpen(true); }}>Change password</MenuItem>
      <div className="menu-sep" />
      <div className="menu-label">Appearance</div>
      <div className="theme-switch" role="radiogroup" aria-label="Light or dark">
        {THEME_CHOICES.map((choice) => (
          <button
            key={choice.value} type="button" role="radio" aria-checked={theme === choice.value}
            className={theme === choice.value ? 'is-on' : ''} onClick={() => setTheme(choice.value)}
          >
            {choice.icon}<span>{choice.label}</span>
          </button>
        ))}
      </div>
      <MenuItem icon={<Palette />} onClick={() => { close(); navigate('/account'); }}>Colour theme</MenuItem>
      <div className="menu-sep" />
      {user?.supportMode && <MenuItem icon={<ArrowLeftCircle />} onClick={() => { close(); void backToPlatform(); }}>Back to the platform</MenuItem>}
      {!isPlatform && !user?.supportMode && (
        <Allow permission="support.raise">
          <MenuItem icon={<LifeBuoy />} onClick={() => { close(); navigate('/support'); }}>Help &amp; Support</MenuItem>
        </Allow>
      )}
      <MenuItem icon={<LogOut />} danger onClick={() => { close(); void handleSignOut(); }}>Sign out</MenuItem>
    </>
  );

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''}`}>
      {drawerOpen && <div className="scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${drawerOpen ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <Link to={home} style={{ textDecoration: 'none' }} aria-label="KSF home">
            {collapsed ? <BrandMark size={46} /> : (
              <span className="sidebar-brand-stack">
                <BrandLogo size={42} />
                {edition === 'university' && <span className="edition-tag">University edition</span>}
              </span>
            )}
          </Link>
          <button
            className="icon-btn nav-toggle"
            style={{ marginLeft: 'auto' }}
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>

        <nav className="sidebar-scroll" aria-label="Main">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const count = badgeFor(item.badge);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={exactOnly(item.to)}
                    className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''} ${count > 0 ? 'has-badge' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    {item.icon}
                    <span className="nav-item-text">{item.label}</span>
                    {count > 0 && (
                      <span className={`nav-count ${item.badgeTone === 'muted' ? 'is-muted' : ''}`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <Menu
            align="left"
            trigger={({ toggle, props }) => (
              <button className="account-card" onClick={toggle} aria-label="Account menu" {...props}>
                <span className="account-card-avatar">
                  <PersonAvatar name={user?.fullName} url={user?.avatarUrl} tone={admin ? 'gold' : undefined} />
                  <i className="presence" aria-hidden="true" />
                </span>
                <span className="meta">
                  <strong>{user?.fullName}</strong>
                  <span>{whereLine}</span>
                </span>
                <span className="account-card-caret" aria-hidden="true"><ChevronsUpDown size={15} /></span>
              </button>
            )}
          >
            {accountMenu}
          </Menu>

          <button className="collapse-btn" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse menu</>}
          </button>
        </div>
      </aside>

      <div className="main">
        {user?.supportMode && (
          <div className="support-banner" role="status">
            <HeartHandshake size={18} aria-hidden="true" />
            <span className="grow">
              You are working inside <strong>{user.pharmacyName ?? workspace?.pharmacy?.name ?? 'a pharmacy'}</strong>{user.isPlatformStaff ? ' for the KSF team' : ' as the Super Admin'}.
              {user.isPlatformStaff
                ? <> Everything you do is recorded under your name, as “KSF team (support)”.</>
                : <> Everything you do is recorded as “Super Admin (support)”.</>}
            </span>
            <Button size="sm" variant="outline" icon={<ArrowLeftCircle size={15} />} onClick={() => { void backToPlatform(); }}>Back to the platform</Button>
          </div>
        )}
        {!isPlatform && <SubscriptionBanner />}
        <header className="topbar">
          <button
            className="icon-btn nav-toggle"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>

          <form className="topbar-search" onSubmit={submitSearch} role="search">
            <Search size={17} />
            <input
              id="ksf-global-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={narrow ? 'Search' : isPlatform ? 'Search pharmacies, cities, Admins…' : 'Search medicines, customers, invoices…'}
              aria-label="Search"
            />
            <kbd>/</kbd>
          </form>

          <div className="spacer" style={{ flex: 1 }} />

          <Allow permission="pos.operate">
            <Button
              variant="primary"
              size="sm"
              icon={<ShoppingCart size={16} />}
              className="hide-sm"
              onClick={() => navigate('/pos')}
            >
              New sale
            </Button>
          </Allow>

          {hasFeature('messaging.internal') && (
            <Allow permission="messages.read">
              <MessagesMenu unread={badges?.messagesUnread ?? 0} />
            </Allow>
          )}

          {/* The counter calculator opens in place, so a sale in progress is never lost. */}
          <CalculatorMenu />

          <NotificationsMenu unread={badges?.notifications ?? 0} />

          <Menu
            label="Account"
            trigger={({ toggle, props }) => (
              <button className="user-chip" onClick={toggle} aria-label="Account menu" {...props}>
                <PersonAvatar name={user?.fullName} url={user?.avatarUrl} tone={admin ? 'gold' : undefined} />
                <span className="meta hide-sm">
                  <strong>{user?.fullName}</strong>
                  <span>{isPlatform ? (user?.isPlatformAdmin ? 'Super Admin' : user?.roleName) : subscription?.planName ?? user?.roleName}</span>
                </span>
                <ChevronDown size={15} className="user-chip-chev hide-sm" aria-hidden="true" />
              </button>
            )}
          >
            {accountMenu}
          </Menu>
        </header>

        <main className="page">{children}</main>
      </div>

      <nav className="mobile-bar" aria-label="Quick navigation">
        {mobileItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={exactOnly(item.to)}
            className={({ isActive }) => `${isActive ? 'is-active' : ''} ${item.to === '/pos' ? 'is-pos' : ''}`}
          >
            {item.to === '/pos' ? <span className="pos-fab">{item.icon}</span> : item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onDone={() => { setPasswordOpen(false); ok('Password changed', 'Your other devices have been signed out.'); }}
        onFail={fail}
      />
    </div>
  );
}

/* --------------------------- change password ---------------------------- */

export function ChangePasswordModal({
  open, onClose, onDone, onFail, forced = false
}: {
  open: boolean; onClose: () => void; onDone: () => void;
  onFail: (error: unknown) => void; forced?: boolean;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* The server's own minimum, so the rules shown here match what it enforces. */
  const { workspace } = useApp();
  const minLength = workspace?.passwordMinLength ?? 12;

  useEffect(() => {
    if (open) { setCurrent(''); setNext(''); setConfirm(''); setError(''); }
  }, [open]);

  const rules = [
    { label: `At least ${minLength} characters`, pass: next.length >= minLength },
    { label: 'One capital letter', pass: /[A-Z]/.test(next) },
    { label: 'One small letter', pass: /[a-z]/.test(next) },
    { label: 'One number', pass: /\d/.test(next) },
    { label: 'One symbol, for example ! or @', pass: /[^A-Za-z0-9]/.test(next) }
  ];
  const strong = rules.every((r) => r.pass);
  const matches = next.length > 0 && next === confirm;

  const submit = async () => {
    setError('');
    if (!strong) { setError('The new password does not meet all the rules below.'); return; }
    if (!matches) { setError('The two new passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      onDone();
    } catch (problem) {
      onFail(problem);
      setError(problem instanceof Error ? problem.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={forced ? () => undefined : onClose}
      closeOnBackdrop={!forced}
      size="sm"
      icon={<KeyRound />}
      title={forced ? 'Choose your own password' : 'Change password'}
      subtitle={forced
        ? 'Your account was created with a temporary password. Please set your own before you carry on.'
        : 'You will stay signed in here. All your other devices will be signed out.'}
      footer={
        <>
          {!forced && <Button variant="outline" onClick={onClose}>Cancel</Button>}
          <Button variant="primary" loading={busy} onClick={submit} disabled={!strong || !matches || !current}>
            Save new password
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        {error && <div className="auth-error"><X size={18} /> {error}</div>}
        <TextInput
          label="Current password" type="password" required autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)}
        />
        <TextInput
          label="New password" type="password" required autoComplete="new-password"
          value={next} onChange={(e) => setNext(e.target.value)}
        />
        <TextInput
          label="Type the new password again" type="password" required autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)}
          error={confirm && !matches ? 'These do not match.' : undefined}
        />
        <div className="mini-card">
          <div className="lbl mb-2">Password rules</div>
          {rules.map((rule) => (
            <div key={rule.label} className="row-tight t-sm" style={{ padding: '2px 0' }}>
              <span style={{ color: rule.pass ? 'var(--ok-600)' : 'var(--ink-300)', fontWeight: 700, width: 16 }}>
                {rule.pass ? '✓' : '○'}
              </span>
              <span className={rule.pass ? '' : 't-dim'}>{rule.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
