/* Staff accounts.

   The pharmacy Admin adds people here and chooses their role. Two rules are
   visible here and enforced again on the server: you cannot act on somebody
   at or above your own level, and only an Admin can make another Admin.
   The "help a stuck member of staff" windows sit alongside: the computers
   and phones they use, and switching two-step sign-in off. */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus, UserCog, Pencil, KeyRound, Ban, LogOut, Unlock, ShieldCheck,
  Mail, Phone, Building2, Trash2, MoreVertical, CircleAlert, Users, Clock, Monitor, ShieldOff
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, Modal, TextInput, SelectInput, ConfirmDialog, StatusBadge,
  Badge, EmptyState, CardSkeleton, Allow, Alert, Menu, MenuItem, StatCard
} from '../components/ui';
import { initials, ago, phone as fmtPhone, cnicMask, number } from '../utils/format';
import { ResetPasswordDialog, DevicesDialog, TwoStepOffDialog, type HelpPerson } from '../components/StaffSupport';
import { isPharmacyAdmin } from '../types';
import type { Branch, Role, StaffMember } from '../types';

const empty = {
  fullName: '', email: '', phone: '', cnic: '', pharmacistRegNo: '',
  roleId: '', branchId: '', password: '', status: 'active'
};

export default function Staff() {
  const { ok, can, user, workspace } = useApp();
  /* The server's own minimum, not a number typed here. */
  const minLength = workspace?.passwordMinLength ?? 12;
  const passwordHint = `At least ${minLength} characters with a capital, a small letter, a number and a symbol.`;
  const { busy, run } = useAction();
  const navigate = useNavigate();

  const [term, setTerm] = useState('');
  const search = useDebounced(term);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [form, setForm] = useState(empty);
  const [resetting, setResetting] = useState<HelpPerson | null>(null);
  const [devicesFor, setDevicesFor] = useState<HelpPerson | null>(null);
  const [twoStepFor, setTwoStepFor] = useState<HelpPerson | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [suspending, setSuspending] = useState<StaffMember | null>(null);

  const { data, loading, reload } = useApiData<{ data: StaffMember[] }>(`/staff${query({ q: search })}`, [search]);
  const { data: roles } = useApiData<{ data: Role[] }>(can('roles.read') ? '/roles' : null);
  const { data: branches } = useApiData<{ data: Branch[] }>(can('settings.read') ? '/branches' : null);

  const staff = data?.data ?? [];
  const myLevel = user?.roleLevel ?? 0;
  const isAdmin = isPharmacyAdmin(user);

  /* You can only assign a role below your own, unless you are the Admin. */
  const assignableRoles = (roles?.data ?? []).filter((role) => isAdmin || role.level < myLevel);
  const canActOn = (member: StaffMember) => isAdmin || member.role_level < myLevel;

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty, roleId: assignableRoles.find((r) => r.key === 'cashier')?.id ?? assignableRoles[0]?.id ?? '' });
    setFormOpen(true);
  };

  const openEdit = (member: StaffMember) => {
    setEditing(member);
    setForm({
      fullName: member.full_name, email: member.email, phone: member.phone ?? '',
      cnic: member.cnic ?? '', pharmacistRegNo: member.pharmacist_reg_no ?? '',
      roleId: member.role_id, branchId: member.branch_id ?? '',
      password: '', status: member.status
    });
    setFormOpen(true);
  };

  const chosenRole = (roles?.data ?? []).find((r) => r.id === form.roleId);

  const save = () => run(
    () => (editing
      ? api.patch(`/staff/${editing.id}`, {
        fullName: form.fullName, phone: form.phone, cnic: form.cnic,
        pharmacistRegNo: form.pharmacistRegNo, roleId: form.roleId,
        branchId: form.branchId, status: form.status
      })
      : api.post('/staff', form)),
    () => {
      setFormOpen(false);
      ok(editing ? 'Staff member updated' : 'Staff member added',
        editing ? form.fullName : `${form.fullName} can now sign in with ${form.email}.`);
      void reload(true);
    }
  );

  const active = staff.filter((s) => s.status === 'active');
  const online = staff.filter((s) => s.active_sessions > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff</h1>
          <p className="sub">
            Everyone who can sign in to KSF, and what each of them is allowed to do.
          </p>
        </div>
        <div className="actions">
          <Allow permission="roles.read">
            <Button variant="outline" icon={<ShieldCheck size={17} />} onClick={() => navigate('/roles')}>
              Manage roles
            </Button>
          </Allow>
          <Allow permission="staff.invite">
            <Button variant="primary" icon={<UserPlus size={18} />} onClick={openNew}>Add staff member</Button>
          </Allow>
        </div>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Active accounts" value={number(active.length)} icon={<Users size={20} />} />
        <StatCard label="Signed in right now" value={number(online.length)} icon={<Clock size={20} />} tone="info" />
        <StatCard label="Roles in use" value={number(new Set(staff.map((s) => s.role_key)).size)} icon={<ShieldCheck size={20} />} />
        <StatCard
          label="Need attention"
          value={number(staff.filter((s) => s.must_change_password || s.locked_until || s.status !== 'active').length)}
          icon={<CircleAlert size={20} />}
          tone="warn"
          hint="locked, suspended or temporary password"
        />
      </div>

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by name, email or role…" />
      </div>

      {loading
        ? <CardSkeleton count={6} />
        : staff.length === 0
          ? (
            <div className="table-wrap">
              <EmptyState
                icon={<UserCog size={30} />}
                title="No staff found"
                message="Add the people who work at the counter so each of them signs in as themselves."
              />
            </div>
          )
          : (
            <div className="grid grid-auto-lg">
              {staff.map((member) => {
                const locked = member.locked_until && new Date(member.locked_until) > new Date();
                const actionable = canActOn(member) && member.id !== user?.id;
                return (
                  <div className="card card-pad" key={member.id}>
                    <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                      <span className={`avatar lg ${member.role_key === 'admin' ? 'gold' : ''}`}>
                        {initials(member.full_name)}
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row-between" style={{ gap: 8 }}>
                          <h3 className="truncate" style={{ fontSize: 'var(--fs-md)' }}>
                            {member.full_name}
                            {member.id === user?.id && <span className="t-xs t-dim"> (you)</span>}
                          </h3>
                          <Allow any={['staff.manage']}>
                            {actionable && (
                              <Menu
                                trigger={({ toggle }) => (
                                  <button className="icon-btn" onClick={toggle} aria-label={`Actions for ${member.full_name}`}>
                                    <MoreVertical size={17} />
                                  </button>
                                )}
                              >
                                {(close) => (
                                  <>
                                    <MenuItem icon={<Pencil />} onClick={() => { close(); openEdit(member); }}>Edit details</MenuItem>
                                    <MenuItem icon={<KeyRound />} onClick={() => { close(); setResetting({ id: member.id, name: member.full_name }); }}>
                                      Reset password
                                    </MenuItem>
                                    <MenuItem icon={<Monitor />} onClick={() => { close(); setDevicesFor({ id: member.id, name: member.full_name }); }}>
                                      Devices they use ({member.devices})
                                    </MenuItem>
                                    {!!member.totp_enabled && (
                                      <MenuItem icon={<ShieldOff />} onClick={() => { close(); setTwoStepFor({ id: member.id, name: member.full_name }); }}>
                                        Switch two-step sign-in off
                                      </MenuItem>
                                    )}
                                    {member.active_sessions > 0 && (
                                      <MenuItem
                                        icon={<LogOut />}
                                        onClick={() => { close(); void run(() => api.post(`/staff/${member.id}/sign-out`, {}), () => { ok('Signed out of all devices'); void reload(true); }); }}
                                      >
                                        Sign out of all devices
                                      </MenuItem>
                                    )}
                                    {locked && (
                                      <MenuItem
                                        icon={<Unlock />}
                                        onClick={() => { close(); void run(() => api.post(`/staff/${member.id}/unlock`, {}), () => { ok('Account unlocked'); void reload(true); }); }}
                                      >
                                        Unlock the account
                                      </MenuItem>
                                    )}
                                    <div className="menu-sep" />
                                    <MenuItem icon={<Ban />} danger onClick={() => { close(); setSuspending(member); }}>
                                      {member.status === 'active' ? 'Suspend access' : 'Restore access'}
                                    </MenuItem>
                                    <MenuItem icon={<Trash2 />} danger onClick={() => { close(); setRemoving(member); }}>
                                      Remove from the team
                                    </MenuItem>
                                  </>
                                )}
                              </Menu>
                            )}
                          </Allow>
                        </div>

                        <div className="row-tight wrap mt-2">
                          <Badge tone={member.role_key === 'admin' ? 'gold' : member.role_is_system ? 'ok' : 'purple'} dot={false}>
                            {member.role_name}
                          </Badge>
                          <StatusBadge status={member.status} />
                          {member.active_sessions > 0 && <Badge tone="info" dot>Online</Badge>}
                          {locked && <Badge tone="danger" dot={false}>Locked</Badge>}
                          {!!member.must_change_password && <Badge tone="warn" dot={false}>Temporary password</Badge>}
                        </div>
                      </div>
                    </div>

                    <div className="col mt-4" style={{ gap: 6 }}>
                      <span className="row-tight t-sm t-soft truncate"><Mail size={14} /> {member.email}</span>
                      {member.phone && <span className="row-tight t-sm t-soft"><Phone size={14} /> {fmtPhone(member.phone)}</span>}
                      {member.branch_name && <span className="row-tight t-sm t-soft"><Building2 size={14} /> {member.branch_name}</span>}
                      {member.pharmacist_reg_no && (
                        <span className="row-tight t-sm t-soft"><ShieldCheck size={14} /> Reg. {member.pharmacist_reg_no}</span>
                      )}
                    </div>

                    <div className="row-between mt-4" style={{ paddingTop: 14, borderTop: '1px solid var(--line-faint)' }}>
                      <span className="t-xs t-dim">
                        {member.last_login_at ? `Last signed in ${ago(member.last_login_at)}` : 'Never signed in'}
                      </span>
                      <span className="t-xs t-dim">{number(member.sales_count)} sales</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

      {/* ------------------------------ form ------------------------------ */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="lg"
        icon={<UserCog />}
        title={editing ? `Edit ${editing.full_name}` : 'Add a staff member'}
        subtitle={editing
          ? 'The email address cannot be changed, because it is how they sign in.'
          : 'They will be asked to choose their own password the first time they sign in.'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              variant="primary" loading={busy} onClick={save}
              disabled={!form.fullName.trim() || !form.roleId || (!editing && (!form.email.trim() || form.password.length < minLength))}
            >
              {editing ? 'Save changes' : 'Create the account'}
            </Button>
          </>
        }
      >
        {chosenRole && (
          <div className="mb-4">
            <Alert tone="info" title={`${chosenRole.name} — what this role can do`}>
              {chosenRole.description}
              <span style={{ display: 'block', marginTop: 6, fontWeight: 700 }}>
                {chosenRole.permissions.length} permission{chosenRole.permissions.length === 1 ? '' : 's'} granted.
              </span>
            </Alert>
          </div>
        )}

        <div className="form-grid">
          <TextInput
            label="Full name" required wrapClass="span-2"
            value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <TextInput
            label="Email address" required type="email" icon={<Mail />}
            disabled={!!editing}
            hint={editing ? 'Cannot be changed' : 'This is their username'}
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <TextInput
            label="Mobile number" icon={<Phone />} inputMode="tel" placeholder="+92 300 1234567"
            value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <SelectInput
            label="Role" required
            value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}
            placeholder="Choose a role"
            options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))}
            hint={isAdmin ? 'You can grant any role.' : 'You can only grant roles below your own.'}
          />
          <SelectInput
            label="Branch"
            value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            placeholder="No fixed branch"
            options={(branches?.data ?? []).map((branch) => ({ value: branch.id, label: branch.name }))}
          />
          <TextInput
            label="CNIC" inputMode="numeric" placeholder="12345-1234567-1"
            value={form.cnic} onChange={(e) => setForm({ ...form, cnic: cnicMask(e.target.value) })}
          />
          <TextInput
            label="Pharmacy Council registration"
            placeholder="e.g. PCP-SND-14872"
            hint={chosenRole?.key === 'pharmacist' ? 'Required for a pharmacist account' : 'Only needed for pharmacists'}
            required={chosenRole?.key === 'pharmacist'}
            value={form.pharmacistRegNo} onChange={(e) => setForm({ ...form, pharmacistRegNo: e.target.value })}
          />

          {!editing && (
            <TextInput
              label="Temporary password" required type="text" wrapClass="span-2"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              hint={`${passwordHint} Tell them in person — KSF never emails passwords.`}
              error={form.password && form.password.length < minLength ? 'Too short.' : undefined}
            />
          )}

          {editing && (
            <SelectInput
              label="Account status" wrapClass="span-2"
              value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={[
                { value: 'active', label: 'Active — can sign in' },
                { value: 'suspended', label: 'Suspended — cannot sign in' }
              ]}
            />
          )}
        </div>
      </Modal>

      {/* ---------------- reset password, devices, two-step ---------------------- */}
      <ResetPasswordDialog person={resetting} onClose={() => setResetting(null)} onDone={() => void reload(true)} />
      <DevicesDialog person={devicesFor} onClose={() => { setDevicesFor(null); void reload(true); }} />
      <TwoStepOffDialog person={twoStepFor} onClose={() => setTwoStepFor(null)} onDone={() => void reload(true)} />

      <ConfirmDialog
        open={!!suspending}
        onCancel={() => setSuspending(null)}
        onConfirm={() => run(
          () => api.patch(`/staff/${suspending!.id}`, {
            status: suspending!.status === 'active' ? 'suspended' : 'active'
          }),
          () => {
            const wasActive = suspending!.status === 'active';
            setSuspending(null);
            ok(wasActive ? 'Access suspended' : 'Access restored');
            void reload(true);
          }
        )}
        loading={busy}
        tone={suspending?.status === 'active' ? 'danger' : 'warn'}
        title={suspending?.status === 'active' ? 'Suspend this account?' : 'Restore access?'}
        confirmLabel={suspending?.status === 'active' ? 'Suspend' : 'Restore'}
        message={
          suspending?.status === 'active'
            ? <><b>{suspending?.full_name}</b> will be signed out immediately and will not be able to sign in again until you restore them. Their history is kept.</>
            : <><b>{suspending?.full_name}</b> will be able to sign in again with their existing password.</>
        }
      />

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/staff/${removing!.id}`),
          () => { setRemoving(null); ok('Staff member removed'); void reload(true); }
        )}
        loading={busy}
        title="Remove from the team?"
        confirmLabel="Remove"
        message={
          <>
            <b>{removing?.full_name}</b> will be archived and signed out everywhere.
            Every invoice they rang up keeps their name, so your records stay complete.
          </>
        }
      />
    </>
  );
}
