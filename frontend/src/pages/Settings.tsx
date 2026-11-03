/* Settings: the pharmacy's own details, how the till behaves, security rules
   and branches. Everything here is stored per pharmacy, so a change made once
   applies to every device. */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Store, Receipt, ShieldCheck, Building2, Users, Palette,
  Save, Plus, Pencil, Database, Globe, Award, CreditCard
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import {
  Button, Card, Tabs, TextInput, TextArea, SelectInput, Switch, Modal,
  EmptyState, CardSkeleton, Allow, Alert
} from '../components/ui';
import { number, rupees, phone as fmtPhone } from '../utils/format';
import type { Branch } from '../types';
import Billing from './settings/Billing';
import Migration from './settings/Migration';
import { SetupReminder } from '../components/SetupReminder';
import { VersionCheck } from '../components/VersionCheck';

interface SettingsResponse {
  pharmacy: Record<string, string | number>;
  settings: Record<string, string>;
  stats: { medicines: number; batches: number; sales: number; customers: number; staff: number; logs: number };
}

type Tab = 'pharmacy' | 'till' | 'security' | 'appearance' | 'billing' | 'migration' | 'branches' | 'system';

export default function SettingsPage() {
  const { ok, can, refreshWorkspace } = useApp();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  /* A person's own profile and security moved to My account; old links still land. */
  const requested = params.get('tab');
  useEffect(() => {
    if (requested === 'profile') navigate('/account', { replace: true });
    if (requested === 'centre') navigate('/account?tab=security', { replace: true });
  }, [requested, navigate]);

  const [tab, setTab] = useState<Tab>((requested as Tab) ?? 'pharmacy');
  const { data, loading, reload } = useApiData<SettingsResponse>('/settings');
  const { data: branches, reload: reloadBranches } = useApiData<{ data: Branch[] }>('/branches');

  const [pharmacy, setPharmacy] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  useEffect(() => {
    if (!data) return;
    setPharmacy({
      name: String(data.pharmacy.name ?? ''),
      legalName: String(data.pharmacy.legal_name ?? ''),
      ntn: String(data.pharmacy.ntn ?? ''),
      strn: String(data.pharmacy.strn ?? ''),
      drapLicence: String(data.pharmacy.drap_licence ?? ''),
      phone: String(data.pharmacy.phone ?? ''),
      email: String(data.pharmacy.email ?? ''),
      address: String(data.pharmacy.address ?? ''),
      city: String(data.pharmacy.city ?? ''),
      province: String(data.pharmacy.province ?? ''),
      gstPercent: String(data.pharmacy.gst_percent ?? 0)
    });
    setSettings({ ...data.settings });
    setDirty(false);
  }, [data]);

  /* The address follows the tab. Anything else on it — a payment coming back
     (?payment=paid), a plan picked elsewhere (?choose=yearly) — is left for
     the tab to read, which removes it once it has. */
  useEffect(() => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === 'pharmacy') next.delete('tab'); else next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [tab, setParams]);

  const set = (key: string, value: string) => { setSettings((s) => ({ ...s, [key]: value })); setDirty(true); };
  const setP = (key: string, value: string) => { setPharmacy((p) => ({ ...p, [key]: value })); setDirty(true); };
  const flag = (key: string) => settings[key] === 'true';

  const save = () => run(
    () => api.patch('/settings', { pharmacy, settings }),
    () => { ok('Settings saved', 'The change applies on every device straight away.'); setDirty(false); void reload(true); void refreshWorkspace(); }
  );

  const tabs = [
    { value: 'pharmacy' as Tab, label: 'Pharmacy', icon: <Store size={16} /> },
    { value: 'till' as Tab, label: 'Till & invoices', icon: <Receipt size={16} /> },
    { value: 'security' as Tab, label: 'Security rules', icon: <ShieldCheck size={16} /> },
    { value: 'appearance' as Tab, label: 'Appearance', icon: <Palette size={16} /> },
    { value: 'billing' as Tab, label: 'Billing & Subscription', icon: <CreditCard size={16} /> },
    { value: 'migration' as Tab, label: 'Data migration', icon: <Database size={16} /> },
    { value: 'branches' as Tab, label: 'Branches', icon: <Building2 size={16} /> },
    { value: 'system' as Tab, label: 'System', icon: <Database size={16} /> }
  ];

  if (loading) return <><div className="page-head"><h1>Settings</h1></div><CardSkeleton /></>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">How KSF behaves for your pharmacy, on every device your staff use.</p>
        </div>
        <Allow permission="settings.write">
          {dirty && (
            <div className="actions">
              <Button variant="outline" onClick={() => { void reload(); }}>Discard changes</Button>
              <Button variant="primary" icon={<Save size={18} />} loading={busy} onClick={save}>Save changes</Button>
            </div>
          )}
        </Allow>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      {/* ------------------------ account screens ------------------------ */}
      {tab === 'appearance' && <AppearanceSettings />}
      {tab === 'billing' && <Billing />}
      {tab === 'migration' && <Migration />}

      {/* ============================= PHARMACY ============================= */}
      {tab === 'pharmacy' && (
        <div className="grid grid-2">
          <Allow permission="settings.write">
            {/* The setup checklist does not vanish once it has been put away —
                it lives here, which is what the welcome screen promises. */}
            <SetupReminder always />
          </Allow>
          <Card title="Your pharmacy" subtitle="This appears on every receipt and report">
            <div className="form-grid">
              <TextInput
                label="Trading name" wrapClass="span-2"
                value={pharmacy.name ?? ''} onChange={(e) => setP('name', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="Registered name" wrapClass="span-2"
                hint="As registered with SECP, if different"
                value={pharmacy.legalName ?? ''} onChange={(e) => setP('legalName', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="Phone" inputMode="tel"
                value={pharmacy.phone ?? ''} onChange={(e) => setP('phone', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="Email" type="email"
                value={pharmacy.email ?? ''} onChange={(e) => setP('email', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextArea
                label="Address" className="span-2"
                value={pharmacy.address ?? ''} onChange={(e) => setP('address', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="City"
                value={pharmacy.city ?? ''} onChange={(e) => setP('city', e.target.value)}
                disabled={!can('settings.write')}
              />
              <SelectInput
                label="Province"
                value={pharmacy.province ?? ''} onChange={(e) => setP('province', e.target.value)}
                options={['Sindh', 'Punjab', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu & Kashmir']
                  .map((p) => ({ value: p, label: p }))}
                disabled={!can('settings.write')}
              />
            </div>
          </Card>

          <Card title="Registration and tax" subtitle="Printed on invoices where required">
            <div className="form-grid">
              <TextInput
                label="NTN" placeholder="1234567-8"
                hint="National Tax Number"
                value={pharmacy.ntn ?? ''} onChange={(e) => setP('ntn', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="STRN" placeholder="1234567890123"
                hint="Sales Tax Registration Number"
                value={pharmacy.strn ?? ''} onChange={(e) => setP('strn', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="DRAP drug sale licence" wrapClass="span-2"
                placeholder="DRAP-SND-2024-11847"
                hint="Your licence from the Drug Regulatory Authority of Pakistan"
                value={pharmacy.drapLicence ?? ''} onChange={(e) => setP('drapLicence', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="Default GST rate" type="number" suffix="%" min={0} max={100} step="0.5"
                wrapClass="span-2"
                hint="Applied to new medicines. Each medicine can still override it."
                value={pharmacy.gstPercent ?? '0'} onChange={(e) => setP('gstPercent', e.target.value)}
                disabled={!can('settings.write')}
              />
            </div>

            <div className="mt-5">
              <Alert tone="info" title="Currency and language" icon={<Globe />}>
                KSF is set to Pakistani rupees (Rs) with English (Pakistan) date and number formats.
                Amounts are stored in paisa internally, so rounding never drifts.
              </Alert>
            </div>
          </Card>
        </div>
      )}

      {/* =============================== TILL =============================== */}
      {tab === 'till' && (
        <div className="grid grid-2">
          <Card title="Invoices" subtitle="How receipts are numbered and worded">
            <div className="col" style={{ gap: 18 }}>
              <TextInput
                label="Invoice prefix"
                hint="Invoices are numbered like KSF-000123"
                value={settings['invoice.prefix'] ?? ''} onChange={(e) => set('invoice.prefix', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextArea
                label="Message at the bottom of every receipt"
                value={settings['invoice.footer'] ?? ''} onChange={(e) => set('invoice.footer', e.target.value)}
                disabled={!can('settings.write')}
              />
              <SelectInput
                label="Default payment method at the till"
                value={settings['pos.default_payment'] ?? 'cash'} onChange={(e) => set('pos.default_payment', e.target.value)}
                options={[
                  { value: 'cash', label: 'Cash' },
                  { value: 'card', label: 'Debit / Credit card' },
                  { value: 'easypaisa', label: 'Easypaisa' },
                  { value: 'jazzcash', label: 'JazzCash' }
                ]}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="Biggest discount at the till without a manager (%)"
                hint="A cashier or pharmacist can give up to this much, with a reason. Managers and the Admin can go higher. Every discount is listed in Reports."
                type="number"
                min={0}
                max={100}
                value={settings['pos.max_discount_percent'] ?? '10'}
                onChange={(e) => set('pos.max_discount_percent', e.target.value)}
                disabled={!can('settings.write')}
              />
            </div>
          </Card>

          <Card title="Selling rules" subtitle="What the till will and will not allow">
            <div className="col" style={{ gap: 20 }}>
              <div>
                <Switch
                  checked={settings['pos.require_prescription_check'] !== 'false'}
                  onChange={(v) => set('pos.require_prescription_check', String(v))}
                  label="Require a verified prescription for prescription-only medicine"
                  disabled={!can('settings.write')}
                />
                <p className="hint mt-2">
                  Strongly recommended. Turning this off lets any cashier sell antibiotics and
                  controlled medicine without a pharmacist checking the prescription.
                </p>
              </div>

              <div>
                <Switch
                  checked={flag('pos.allow_negative_stock')}
                  onChange={(v) => set('pos.allow_negative_stock', String(v))}
                  label="Allow selling stock the system says you do not have"
                  disabled={!can('settings.write')}
                />
                <p className="hint mt-2">
                  Leave this off. With it on, your stock figures stop being trustworthy and expiry
                  tracking breaks down.
                </p>
              </div>

              {flag('pos.allow_negative_stock') && (
                <Alert tone="danger" title="This is switched on">
                  The till will now sell items with no recorded stock. Turn it off again as soon as
                  your stock count is corrected.
                </Alert>
              )}

              <hr />

              <TextInput
                label="Warn about expiry this many days ahead" type="number" min={7} max={365}
                suffix="days"
                hint="Batches inside this window appear on Expiry Control and in notifications."
                value={settings['expiry.warn_days'] ?? '90'} onChange={(e) => set('expiry.warn_days', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="Default minimum stock for a new medicine" type="number" min={0}
                value={settings['stock.low_threshold_default'] ?? '10'} onChange={(e) => set('stock.low_threshold_default', e.target.value)}
                disabled={!can('settings.write')}
              />

              <hr />

              <Switch
                checked={settings['loyalty.enabled'] !== 'false'}
                onChange={(v) => set('loyalty.enabled', String(v))}
                label="Give loyalty points to registered customers"
                disabled={!can('settings.write')}
              />
              {settings['loyalty.enabled'] !== 'false' && (
                <TextInput
                  label="Points per Rs 100 spent" type="number" min={0} step="0.5"
                  icon={<Award />}
                  value={settings['loyalty.points_per_100'] ?? '1'} onChange={(e) => set('loyalty.points_per_100', e.target.value)}
                  disabled={!can('settings.write')}
                />
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ============================= SECURITY ============================= */}
      {tab === 'security' && (
        <div className="grid grid-2">
          <Card title="How KSF protects your data" subtitle="These protections are always on">
            <dl className="kv">
              <dt>Passwords</dt>
              <dd>Hashed with PBKDF2-SHA512, 210,000 rounds, and a different random salt for each person. Nobody — including you — can read a stored password.</dd>
              <dt>Sessions</dt>
              <dd>A random 256-bit token in a cookie JavaScript cannot read. Only its fingerprint is stored, so a stolen copy of the database cannot be replayed as a login.</dd>
              <dt>Forms</dt>
              <dd>Every save carries a one-time token, which stops another website from making changes on your behalf.</dd>
              <dt>Brute force</dt>
              <dd>An account locks itself after repeated wrong passwords, and repeated attempts from one place are throttled.</dd>
              <dt>Permissions</dt>
              <dd>Checked on the server for every single request. Hiding a button is a convenience, never the protection.</dd>
              <dt>Audit</dt>
              <dd>Every change is recorded with the person, the time and the address it came from. The trail cannot be edited from inside KSF.</dd>
            </dl>
          </Card>

          <Card title="Rules you can set" subtitle="Applies to everyone who signs in">
            <div className="col" style={{ gap: 18 }}>
              <TextInput
                label="Sign out after this long idle" type="number" min={5} max={240} suffix="minutes"
                hint="A till left unattended is signed out automatically. 45 minutes suits most counters."
                value={settings['security.idle_minutes'] ?? '45'} onChange={(e) => set('security.idle_minutes', e.target.value)}
                disabled={!can('settings.write')}
              />
              <TextInput
                label="Maximum length of a session" type="number" min={1} max={24} suffix="hours"
                hint="Everyone signs in again at least this often, even while working."
                value={settings['security.session_hours'] ?? '10'} onChange={(e) => set('security.session_hours', e.target.value)}
                disabled={!can('settings.write')}
              />
              <div>
                <Switch
                  checked={flag('security.two_person_refund')}
                  onChange={(v) => set('security.two_person_refund', String(v))}
                  label="Refunds need a manager present"
                  disabled={!can('settings.write')}
                />
                <p className="hint mt-2">
                  When on, only staff whose role includes refunds may process one — a common control
                  against till shrinkage.
                </p>
              </div>

              <Alert tone="warn" title="Changing idle or session length">
                Existing sessions keep their current setting. The new value applies the next time
                each person signs in.
              </Alert>
            </div>
          </Card>
        </div>
      )}

      {/* ============================= BRANCHES ============================= */}
      {tab === 'branches' && (
        <>
          <div className="row-between mb-4">
            <p className="t-soft" style={{ maxWidth: '62ch' }}>
              Each branch has its own address and DRAP licence. Staff can be assigned to one, and
              sales record the branch they were rung up at.
            </p>
            <Allow permission="branches.manage">
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => { setEditingBranch(null); setBranchOpen(true); }}>
                Add branch
              </Button>
            </Allow>
          </div>

          <div className="grid grid-3">
            {(branches?.data ?? []).map((branch) => (
              <div className="card card-pad" key={branch.id}>
                <div className="row-between" style={{ gap: 8 }}>
                  <div className="row-tight">
                    <span className="stat-icon"><Building2 size={20} /></span>
                    <div>
                      <h4>{branch.name}</h4>
                      <div className="t-xs t-dim">{branch.code}</div>
                    </div>
                  </div>
                  {!!branch.is_main && <span className="badge badge-gold no-dot">Main</span>}
                </div>

                <div className="col mt-4 t-sm t-soft" style={{ gap: 4 }}>
                  <span>{branch.address}</span>
                  <span>{branch.city}{branch.province ? `, ${branch.province}` : ''}</span>
                  {branch.phone && <span>{fmtPhone(branch.phone)}</span>}
                  {branch.drap_licence && <span className="mono t-xs">Lic {branch.drap_licence}</span>}
                </div>

                <div className="row-between mt-4" style={{ paddingTop: 14, borderTop: '1px solid var(--line-faint)' }}>
                  <div className="t-xs t-dim">
                    {number(branch.staff_count ?? 0)} staff · {number(branch.sales_count ?? 0)} sales
                    <div className="t-semi t-sm t-brand">{rupees(branch.revenue_paisa ?? 0)}</div>
                  </div>
                  <Allow permission="branches.manage">
                    <button className="icon-btn" onClick={() => { setEditingBranch(branch); setBranchOpen(true); }} aria-label={`Edit ${branch.name}`}>
                      <Pencil size={16} />
                    </button>
                  </Allow>
                </div>
              </div>
            ))}
          </div>

          {(branches?.data ?? []).length === 0 && (
            <div className="table-wrap">
              <EmptyState icon={<Building2 size={30} />} title="No branches yet" message="Add your shop so receipts carry the right address and licence." />
            </div>
          )}
        </>
      )}

      {/* ============================== PROFILE ============================== */}
      {/* =============================== SYSTEM =============================== */}
      {tab === 'system' && (
        <div className="grid grid-2">
          <Card title="What is in your database" subtitle="Live counts">
            <div className="grid grid-2">
              <div className="mini-card"><div className="lbl">Medicines</div><div className="val">{number(data?.stats.medicines ?? 0)}</div></div>
              <div className="mini-card"><div className="lbl">Batches</div><div className="val">{number(data?.stats.batches ?? 0)}</div></div>
              <div className="mini-card"><div className="lbl">Invoices</div><div className="val">{number(data?.stats.sales ?? 0)}</div></div>
              <div className="mini-card"><div className="lbl">Customers</div><div className="val">{number(data?.stats.customers ?? 0)}</div></div>
              <div className="mini-card"><div className="lbl">Staff accounts</div><div className="val">{number(data?.stats.staff ?? 0)}</div></div>
              <div className="mini-card"><div className="lbl">Audit entries</div><div className="val">{number(data?.stats.logs ?? 0)}</div></div>
            </div>
          </Card>

          <Card title="About this build" subtitle="KSF Pharmacy Management System">
            <dl className="kv">
              {/* Read from brand.ts rather than typed in. */}
              <dt>Version</dt><dd><VersionCheck /></dd>
              <dt>Front end</dt><dd>React 18 · TypeScript · Vite</dd>
              <dt>Back end</dt><dd>Node.js · Express · TypeScript</dd>
              <dt>Database</dt><dd>MongoDB, with transactions for every sale, refund and stock movement</dd>
              <dt>Sign-in</dt><dd>Short-lived access tokens and rotating refresh tokens</dd>
              <dt>Locale</dt><dd>English (Pakistan) · Pakistani rupee · Asia/Karachi</dd>
            </dl>

            <div className="mt-5">
              <Alert tone="info" title="Your records are backed up by KSF">
                Your pharmacy lives in KSF's database, which is backed up continuously. You can also download
                everything held about your pharmacy at any time from My account, Sign-in and security.
              </Alert>
            </div>
          </Card>
        </div>
      )}

      <BranchModal
        open={branchOpen}
        branch={editingBranch}
        onClose={() => setBranchOpen(false)}
        onSaved={() => { setBranchOpen(false); void reloadBranches(true); }}
      />

    </>
  );
}

/* ------------------------------ branch form ------------------------------ */

function BranchModal({
  open, branch, onClose, onSaved
}: { open: boolean; branch: Branch | null; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [form, setForm] = useState({
    name: '', code: '', address: '', city: 'Karachi', province: 'Sindh', phone: '', drapLicence: '', status: 'active'
  });

  useEffect(() => {
    if (!open) return;
    setForm(branch
      ? {
        name: branch.name, code: branch.code ?? '', address: branch.address ?? '',
        city: branch.city ?? 'Karachi', province: branch.province ?? 'Sindh',
        phone: branch.phone ?? '', drapLicence: branch.drap_licence ?? '', status: branch.status
      }
      : { name: '', code: '', address: '', city: 'Karachi', province: 'Sindh', phone: '', drapLicence: '', status: 'active' });
  }, [open, branch]);

  const save = () => run(
    () => (branch ? api.patch(`/branches/${branch.id}`, form) : api.post('/branches', form)),
    () => { ok(branch ? 'Branch updated' : 'Branch added', form.name); onSaved(); }
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      icon={<Building2 />}
      title={branch ? `Edit ${branch.name}` : 'Add a branch'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim()}>
            {branch ? 'Save changes' : 'Add branch'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextInput label="Branch name" required wrapClass="span-2" placeholder="e.g. Gulshan-e-Iqbal"
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextInput label="Short code" placeholder="e.g. KHI-02"
          value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <TextInput label="Phone" inputMode="tel"
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <TextArea label="Address" className="span-2"
          value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <TextInput label="City"
          value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <TextInput label="Province"
          value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
        <TextInput label="DRAP licence for this branch" wrapClass="span-2"
          hint="Each branch needs its own drug sale licence"
          value={form.drapLicence} onChange={(e) => setForm({ ...form, drapLicence: e.target.value })} />
      </div>
    </Modal>
  );
}

/* ------------------------------ appearance ------------------------------ */

interface AppearanceReply {
  theme: string;
  themes: { key: string; name: string; description: string }[];
  roles: { id: string; name: string; key: string; canChoose: boolean }[];
}

/** The pharmacy's colour theme, and which roles may pick their own. */
function AppearanceSettings() {
  const { ok, can, refreshWorkspace, previewBrand } = useApp();
  const { busy, run } = useAction();
  const { data, setData } = useApiData<AppearanceReply>('/settings/appearance');
  const editable = can('settings.write');

  const save = (body: { theme?: string; roleIds?: string[] }) => run(
    () => api.patch<AppearanceReply & { ok: boolean }>('/settings/appearance', body),
    (reply) => {
      setData((current) => (current ? { ...current, theme: reply.theme, roles: reply.roles } : current));
      ok('Appearance saved', body.theme ? 'Everybody who has not picked their own theme now sees it.' : 'Who may choose their own theme has been updated.');
      void refreshWorkspace();
    }
  );

  const toggleRole = (roleId: string, on: boolean) => {
    if (!data) return;
    const chosen = data.roles.filter((role) => role.key !== 'admin' && (role.id === roleId ? on : role.canChoose)).map((role) => role.id);
    void save({ roleIds: chosen });
  };

  if (!data) return <CardSkeleton count={2} />;
  return (
    <div className="grid grid-2">
      <Card title="The pharmacy's theme" subtitle="What everybody sees unless they have picked their own" icon={<Palette size={18} />}>
        <div className="theme-grid">
          {data.themes.map((option) => (
            <button key={option.key} type="button" disabled={!editable || busy}
              className={`theme-card ${data.theme === option.key ? 'is-selected' : ''}`}
              onMouseEnter={() => previewBrand(option.key)} onMouseLeave={() => previewBrand(null)}
              onClick={() => { void save({ theme: option.key }); }}>
              <span className="theme-swatch" data-swatch={option.key}><i /><i /><i /><i /></span>
              <strong>{option.name}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
        <p className="hint mt-3">Only the colours change. Light and dark mode stay each person's own choice.</p>
      </Card>
      <Card title="Who may choose their own" subtitle="Ticked roles can pick any of the five themes for themselves, under My account" icon={<Users size={18} />}>
        <div className="col" style={{ gap: 10 }}>
          {data.roles.map((role) => (
            <Switch key={role.id} checked={role.canChoose} disabled={!editable || busy || role.key === 'admin'}
              label={<>{role.name}{role.key === 'admin' ? <span className="t-xs t-dim"> — always</span> : null}</>}
              onChange={(on) => toggleRole(role.id, on)} />
          ))}
        </div>
      </Card>
    </div>
  );
}
