/* My team — the Super Admin's own people.

   The people who help run the platform: a help desk, a finance desk, an
   operations manager. Each signs in with their own e-mail address, has a
   photo, and holds one team role; a role is exactly the platform
   permissions ticked for it. There can be as many roles as the business
   needs.

   Everything here is the Super Admin's alone, and the server enforces it:
   no role can include managing the team, so nobody can promote themselves.
   A change of role, a suspension or a removal applies at once. */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  UserPlus, UsersRound, ShieldCheck, Pencil, KeyRound, LogOut, Ban, Trash2, MoreVertical,
  Mail, Phone, CircleAlert, Clock, Plus, Check, BadgeCheck, Briefcase
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction } from '../../hooks/useApi';
import { api } from '../../services/api';
import {
  Button, Modal, TextInput, TextArea, SelectInput, Checkbox, ConfirmDialog, StatusBadge,
  Badge, EmptyState, CardSkeleton, Alert, Menu, MenuItem, StatCard, Tabs
} from '../../components/ui';
import { PasswordField } from '../../components/account-ui';
import { PersonAvatar, PhotoPicker } from '../../components/people';
import { ago, number, phone as fmtPhone } from '../../utils/format';
import type { TeamMember, TeamResponse, TeamRole } from '../../types/platform';

type Tab = 'members' | 'roles';

/* What a permission needs to be useful — the server adds the same. */
const IMPLIES: Record<string, string[]> = {
  'platform.pharmacies.manage': ['platform.pharmacies.view'],
  'platform.pharmacies.enter': ['platform.pharmacies.view'],
  'platform.finance.manage': ['platform.finance.view']
};

export default function Team() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'roles' ? 'roles' : 'members');
  const { data, loading, reload } = useApiData<TeamResponse>('/platform/team');
  const refresh = () => { void reload(true); };

  const [memberForm, setMemberForm] = useState<{ open: boolean; member: TeamMember | null }>({ open: false, member: null });
  const [roleForm, setRoleForm] = useState<{ open: boolean; role: TeamRole | null }>({ open: false, role: null });

  const members = data?.data ?? [];
  const roles = data?.roles ?? [];
  const active = members.filter((member) => member.status === 'active');

  const switchTab = (next: Tab) => {
    setTab(next);
    setParams(next === 'members' ? new URLSearchParams() : new URLSearchParams({ tab: next }), { replace: true });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My team</h1>
          <p className="sub">The people who help you run KSF. Each signs in with their own e-mail and sees only what their role allows.</p>
        </div>
        <div className="actions">
          <Button variant="outline" icon={<ShieldCheck size={17} />} onClick={() => { switchTab('roles'); setRoleForm({ open: true, role: null }); }}>New role</Button>
          <Button variant="primary" icon={<UserPlus size={17} />} onClick={() => { switchTab('members'); setMemberForm({ open: true, member: null }); }}>Add team member</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Active members" value={number(active.length)} icon={<UsersRound size={20} />} />
        <StatCard label="Team roles" value={number(roles.length)} icon={<ShieldCheck size={20} />} tone="info" />
        <StatCard
          label="Signed in this week" icon={<Clock size={20} />} tone="gold"
          value={number(members.filter((member) => member.last_login_at && Date.now() - new Date(member.last_login_at).getTime() < 7 * 86_400_000).length)}
        />
        <StatCard
          label="Need attention" icon={<CircleAlert size={20} />} tone="warn" hint="suspended, locked or temporary password"
          value={number(members.filter((member) => member.status !== 'active' || member.locked || member.must_change_password).length)}
        />
      </div>

      <Tabs value={tab} onChange={switchTab} tabs={[
        { value: 'members', label: 'Team members', count: members.length, icon: <UsersRound size={16} /> },
        { value: 'roles', label: 'Roles', count: roles.length, icon: <ShieldCheck size={16} /> }
      ]} />

      {loading && !data
        ? <CardSkeleton count={4} />
        : tab === 'members'
          ? <Members data={data} onEdit={(member) => setMemberForm({ open: true, member })} onAdd={() => setMemberForm({ open: true, member: null })} onNewRole={() => { switchTab('roles'); setRoleForm({ open: true, role: null }); }} refresh={refresh} />
          : <Roles data={data} onEdit={(role) => setRoleForm({ open: true, role })} onAdd={() => setRoleForm({ open: true, role: null })} refresh={refresh} />}

      <MemberForm
        open={memberForm.open} member={memberForm.member} roles={roles}
        onClose={() => setMemberForm({ open: false, member: null })} onSaved={refresh}
        onNewRole={() => { setMemberForm({ open: false, member: null }); switchTab('roles'); setRoleForm({ open: true, role: null }); }}
      />
      <RoleForm open={roleForm.open} role={roleForm.role} data={data} onClose={() => setRoleForm({ open: false, role: null })} onSaved={refresh} />
    </>
  );
}

/* ================================ members ================================ */

function Members({
  data, onEdit, onAdd, onNewRole, refresh
}: { data: TeamResponse | null; onEdit: (member: TeamMember) => void; onAdd: () => void; onNewRole: () => void; refresh: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [suspending, setSuspending] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const members = data?.data ?? [];

  if (!members.length) {
    return (
      <div className="table-wrap">
        <EmptyState
          icon={<UsersRound size={30} />}
          title="Nobody on the team yet"
          message={data?.roles.length
            ? 'Add the people who help you — a help desk, a finance desk — and choose what each of them may do.'
            : 'Start with a role — what a help desk or a finance desk may do — then add the people who hold it.'}
          action={data?.roles.length
            ? <Button variant="primary" icon={<UserPlus size={17} />} onClick={onAdd}>Add team member</Button>
            : <Button variant="primary" icon={<ShieldCheck size={17} />} onClick={onNewRole}>Create the first role</Button>}
        />
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-auto-lg">
        {members.map((member) => (
          <div className="card card-pad team-card" key={member.id}>
            <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
              <PersonAvatar name={member.full_name} url={member.avatar_url} size="lg" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 className="truncate" style={{ fontSize: 'var(--fs-md)' }}>{member.full_name}</h3>
                    {member.job_title && <div className="t-sm t-soft truncate">{member.job_title}</div>}
                  </div>
                  <Menu
                    trigger={({ toggle, props }) => (
                      <button className="icon-btn" onClick={toggle} aria-label={`Actions for ${member.full_name}`} {...props}>
                        <MoreVertical size={17} />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem icon={<Pencil />} onClick={() => { close(); onEdit(member); }}>Edit details, role and photo</MenuItem>
                        <MenuItem icon={<KeyRound />} onClick={() => { close(); setResetting(member); }}>Reset password</MenuItem>
                        <MenuItem
                          icon={<LogOut />}
                          onClick={() => { close(); void run(() => api.post(`/platform/team/${member.id}/sign-out`, {}), () => { ok('Signed out', `${member.full_name} has been signed out of every device.`); refresh(); }); }}
                        >
                          Sign out of every device
                        </MenuItem>
                        <div className="menu-sep" />
                        <MenuItem icon={<Ban />} danger onClick={() => { close(); setSuspending(member); }}>
                          {member.status === 'active' ? 'Suspend access' : 'Restore access'}
                        </MenuItem>
                        <MenuItem icon={<Trash2 />} danger onClick={() => { close(); setRemoving(member); }}>Remove from the team</MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
                <div className="row-tight wrap mt-2">
                  <Badge tone="purple" dot={false} icon={<ShieldCheck size={12} />}>{member.role_name ?? 'No role'}</Badge>
                  <StatusBadge status={member.status} />
                  {member.locked && <Badge tone="danger" dot={false}>Locked</Badge>}
                  {member.must_change_password && <Badge tone="warn" dot={false}>Temporary password</Badge>}
                  {member.two_factor && <Badge tone="ok" dot={false} icon={<BadgeCheck size={12} />}>Two-step on</Badge>}
                </div>
              </div>
            </div>

            <div className="col mt-4" style={{ gap: 6 }}>
              <a className="row-tight t-sm t-soft truncate" href={`mailto:${member.email}`}><Mail size={14} /> {member.email}</a>
              {member.phone && <a className="row-tight t-sm t-soft" href={`tel:${member.phone}`}><Phone size={14} /> {fmtPhone(member.phone)}</a>}
            </div>

            <div className="row-between mt-4" style={{ paddingTop: 14, borderTop: '1px solid var(--line-faint)' }}>
              <span className="t-xs t-dim">{member.last_login_at ? `Last signed in ${ago(member.last_login_at)}` : 'Has not signed in yet'}</span>
              <span className="t-xs t-dim">Joined {ago(member.created_at)}</span>
            </div>
          </div>
        ))}
      </div>

      <ResetPassword member={resetting} onClose={() => setResetting(null)} onDone={refresh} />
      <ConfirmDialog
        open={!!suspending}
        onCancel={() => setSuspending(null)}
        onConfirm={() => run(
          () => api.patch(`/platform/team/${suspending!.id}`, { status: suspending!.status === 'active' ? 'suspended' : 'active' }),
          () => {
            ok(suspending!.status === 'active' ? 'Access suspended' : 'Access restored', suspending!.status === 'active'
              ? `${suspending!.full_name} has been signed out and cannot sign in.`
              : `${suspending!.full_name} can sign in again.`);
            setSuspending(null); refresh();
          }
        )}
        loading={busy}
        tone="warn"
        title={suspending?.status === 'active' ? 'Suspend access?' : 'Restore access?'}
        confirmLabel={suspending?.status === 'active' ? 'Suspend' : 'Restore'}
        message={suspending?.status === 'active'
          ? <><b>{suspending?.full_name}</b> is signed out of every device at once and cannot sign in until you restore access. Nothing they did is lost.</>
          : <><b>{suspending?.full_name}</b> will be able to sign in again with their existing password.</>}
      />
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/platform/team/${removing!.id}`),
          () => { ok('Removed from the team', `${removing!.full_name} can no longer sign in.`); setRemoving(null); refresh(); }
        )}
        loading={busy}
        title="Remove from the team?"
        confirmLabel="Remove"
        message={<><b>{removing?.full_name}</b> is signed out and can no longer sign in. Their name stays on the replies and records they made, and any open requests they held go back to the desk.</>}
      />
    </>
  );
}

function ResetPassword({ member, onClose, onDone }: { member: TeamMember | null; onClose: () => void; onDone: () => void }) {
  const { ok, workspace } = useApp();
  const { busy, run } = useAction();
  const [password, setPassword] = useState('');
  const close = () => { setPassword(''); onClose(); };
  return (
    <Modal
      open={!!member} onClose={close} size="sm" icon={<KeyRound />} tone="warn" title="Reset this password"
      subtitle={member ? `${member.full_name} is signed out everywhere and must choose a new password at their next sign-in.` : ''}
      footer={
        <>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button
            variant="danger" loading={busy} disabled={password.length < (workspace?.passwordMinLength ?? 12)}
            onClick={() => run(
              () => api.post(`/platform/team/${member!.id}/reset-password`, { password }),
              () => { close(); ok('Password reset', 'Give them the new password in person, not by e-mail.'); onDone(); }
            )}
          >
            Reset password
          </Button>
        </>
      }
    >
      <PasswordField label="Temporary password" value={password} onChange={setPassword} required autoFocus />
    </Modal>
  );
}

function MemberForm({
  open, member, roles, onClose, onSaved, onNewRole
}: { open: boolean; member: TeamMember | null; roles: TeamRole[]; onClose: () => void; onSaved: () => void; onNewRole: () => void }) {
  const { ok, fail } = useApp();
  const { busy, run } = useAction();
  const [values, setValues] = useState({ fullName: '', email: '', phone: '', jobTitle: '', roleId: '', password: '' });
  /* A fresh data: URL when a photo was chosen, null when it was removed, undefined when untouched. */
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastOpened, setLastOpened] = useState<string | null>(null);

  /* Fill the form each time it opens, for whoever it opens for. */
  const key = open ? member?.id ?? 'new' : null;
  if (key !== lastOpened) {
    setLastOpened(key);
    if (open) {
      setValues({
        fullName: member?.full_name ?? '', email: member?.email ?? '', phone: member?.phone ?? '', jobTitle: member?.job_title ?? '',
        roleId: member?.role_id ?? roles[0]?.id ?? '', password: ''
      });
      setPhoto(undefined);
      setErrors({});
    }
  }

  const set = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const shown = photo === undefined ? member?.avatar_url ?? null : photo;

  const save = () => run(async () => {
    setErrors({});
    const body = { fullName: values.fullName.trim(), phone: values.phone.trim(), jobTitle: values.jobTitle.trim(), roleId: values.roleId };
    try {
      if (member) {
        await api.patch(`/platform/team/${member.id}`, body);
        if (photo) await api.put(`/platform/team/${member.id}/avatar`, { image: photo });
        else if (photo === null && member.avatar_url) await api.delete(`/platform/team/${member.id}/avatar`);
      } else {
        await api.post('/platform/team', { ...body, email: values.email.trim(), password: values.password, ...(photo ? { image: photo } : {}) });
      }
    } catch (problem) {
      const field = (problem as { field?: string }).field;
      if (field) setErrors({ [field]: (problem as Error).message });
      throw problem;
    }
  }, () => {
    ok(member ? 'Saved' : 'Team member added', member ? `${values.fullName.trim()} has been updated.` : `${values.fullName.trim()} can sign in now. Give them the temporary password in person.`);
    onClose();
    onSaved();
  });

  return (
    <Modal
      open={open} onClose={onClose} size="lg" icon={member ? <Pencil /> : <UserPlus />}
      title={member ? `Edit ${member.full_name}` : 'Add a team member'}
      subtitle={member ? 'Their e-mail address is how they sign in; they change it themselves under My account.' : 'They sign in with this e-mail address and the temporary password, and choose their own password straight away.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!roles.length} onClick={() => { void save(); }}>{member ? 'Save changes' : 'Add to the team'}</Button>
        </>
      }
    >
      {!roles.length && (
        <div className="mb-4">
          <Alert tone="warn" title="Create a role first">
            A team member holds one role — what they may do. <button type="button" className="link-button" onClick={onNewRole}>Create a role</button>
          </Alert>
        </div>
      )}
      <div className="mb-5">
        <PhotoPicker name={values.fullName} value={shown} onChange={setPhoto} onError={(message) => fail(new Error(message))} busy={busy} />
      </div>
      <div className="form-grid">
        <TextInput label="Full name" required value={values.fullName} onChange={set('fullName')} error={errors.fullName} autoComplete="off" />
        <TextInput label="Job title" value={values.jobTitle} onChange={set('jobTitle')} placeholder="Support lead" icon={<Briefcase size={16} />} error={errors.jobTitle} />
        <TextInput
          label="E-mail address" required type="email" value={values.email} onChange={set('email')} disabled={!!member}
          error={errors.email} hint={member ? undefined : 'Their own address — this is how they sign in.'} autoComplete="off"
        />
        <TextInput label="Mobile number" inputMode="tel" value={values.phone} onChange={set('phone')} placeholder="0300 1234567" error={errors.phone} />
        <SelectInput
          label="Role" required wrapClass="span-2" value={values.roleId} onChange={set('roleId')} error={errors.roleId}
          options={roles.map((role) => ({ value: role.id, label: role.name }))} placeholder={roles.length ? undefined : 'No roles yet'}
          hint={roles.find((role) => role.id === values.roleId)?.description ?? undefined}
        />
        {!member && (
          <div className="span-2">
            <PasswordField label="Temporary password" value={values.password} onChange={(value) => setValues((current) => ({ ...current, password: value }))} required error={errors.password} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ================================== roles ================================== */

function Roles({ data, onEdit, onAdd, refresh }: { data: TeamResponse | null; onEdit: (role: TeamRole) => void; onAdd: () => void; refresh: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [deleting, setDeleting] = useState<TeamRole | null>(null);
  const labels = useMemo(() => new Map((data?.catalogue ?? []).map((entry) => [entry.key, entry.label])), [data]);
  const roles = data?.roles ?? [];

  if (!roles.length) {
    return (
      <div className="table-wrap">
        <EmptyState
          icon={<ShieldCheck size={30} />}
          title="No team roles yet"
          message="A role is a name and exactly what it may do — a help desk answers pharmacies' requests, a finance desk confirms payments. Make as many as you need."
          action={<Button variant="primary" icon={<Plus size={17} />} onClick={onAdd}>Create a role</Button>}
        />
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-auto-lg">
        {roles.map((role) => (
          <div className="card card-pad" key={role.id}>
            <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <h3 className="truncate" style={{ fontSize: 'var(--fs-md)' }}>{role.name}</h3>
                <div className="t-sm t-soft">{role.members === 1 ? '1 member' : `${number(role.members)} members`} · {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}</div>
              </div>
              <div className="row-tight" style={{ flex: '0 0 auto' }}>
                <button className="icon-btn" onClick={() => onEdit(role)} aria-label={`Edit ${role.name}`} title="Edit"><Pencil size={17} /></button>
                <button
                  className="icon-btn" onClick={() => setDeleting(role)} aria-label={`Delete ${role.name}`}
                  title={role.members ? 'Give its members another role first' : 'Delete'} disabled={role.members > 0}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            {role.description && <p className="t-sm t-soft mt-2">{role.description}</p>}
            <ul className="team-perm-list mt-4">
              {role.permissions.map((key) => <li key={key}><Check size={14} /> {labels.get(key) ?? key}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={() => run(() => api.delete(`/platform/team/roles/${deleting!.id}`), () => { ok('Role deleted'); setDeleting(null); refresh(); })}
        loading={busy}
        title="Delete this role?"
        confirmLabel="Delete"
        message={<>The role <b>{deleting?.name}</b> will be deleted. Nobody holds it, so nobody loses access.</>}
      />
    </>
  );
}

function RoleForm({ open, role, data, onClose, onSaved }: { open: boolean; role: TeamRole | null; data: TeamResponse | null; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastOpened, setLastOpened] = useState<string | null>(null);

  const key = open ? role?.id ?? 'new' : null;
  if (key !== lastOpened) {
    setLastOpened(key);
    if (open) {
      setName(role?.name ?? '');
      setDescription(role?.description ?? '');
      setSelected(new Set(role?.permissions ?? []));
      setErrors({});
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string }[]>();
    for (const entry of data?.catalogue ?? []) map.set(entry.group, [...(map.get(entry.group) ?? []), entry]);
    return [...map.entries()];
  }, [data]);

  /* Ticking "manage" ticks the "view" it needs; unticking "view" unticks what needs it. */
  const toggle = (permission: string, on: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (on) {
      next.add(permission);
      for (const needed of IMPLIES[permission] ?? []) next.add(needed);
    } else {
      next.delete(permission);
      for (const [dependent, needs] of Object.entries(IMPLIES)) if (needs.includes(permission)) next.delete(dependent);
    }
    return next;
  });
  const requiredBy = (permission: string) => Object.entries(IMPLIES).some(([dependent, needs]) => needs.includes(permission) && selected.has(dependent));

  const applyTemplate = (template: TeamResponse['templates'][number]) => {
    if (!name.trim()) setName(template.name);
    if (!description.trim()) setDescription(template.description);
    setSelected(new Set(template.permissions));
  };

  const save = () => run(async () => {
    setErrors({});
    const body = { name: name.trim(), description: description.trim(), permissions: [...selected] };
    try {
      if (role) await api.patch(`/platform/team/roles/${role.id}`, body);
      else await api.post('/platform/team/roles', body);
    } catch (problem) {
      const field = (problem as { field?: string }).field;
      if (field) setErrors({ [field]: (problem as Error).message });
      throw problem;
    }
  }, () => {
    ok(role ? 'Role saved' : 'Role created', role && role.members ? `It applies to its ${role.members === 1 ? 'member' : `${role.members} members`} straight away.` : undefined);
    onClose();
    onSaved();
  });

  return (
    <Modal
      open={open} onClose={onClose} size="xl" icon={<ShieldCheck />}
      title={role ? `Edit ${role.name}` : 'New team role'}
      subtitle="Tick exactly what people with this role may do. Changes apply to everybody who holds it at once."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || !selected.size} onClick={() => { void save(); }}>{role ? 'Save role' : 'Create role'}</Button>
        </>
      }
    >
      {!role && !!data?.templates.length && (
        <div className="mb-5">
          <div className="label mb-2">Start from</div>
          <div className="row-tight wrap">
            {data.templates.map((template) => (
              <button key={template.key} type="button" className="chip" onClick={() => applyTemplate(template)} title={template.description}>{template.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="form-grid">
        <TextInput label="Role name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Help desk" error={errors.name} />
        <TextArea label="What this role is for" wrapClass="span-2" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Answers pharmacies' requests and helps people who cannot sign in." />
      </div>
      <h4 className="mt-5 mb-2">What it may do</h4>
      {errors.permissions && <div className="mb-3"><Alert tone="danger">{errors.permissions}</Alert></div>}
      {groups.map(([group, permissions]) => (
        <div className="perm-group" key={group}>
          <h4>
            {group}
            <span className="pill-count">{permissions.filter((permission) => selected.has(permission.key)).length}/{permissions.length}</span>
          </h4>
          <div className="perm-list">
            {permissions.map((permission) => (
              <div className="perm-row" key={permission.key}>
                <Checkbox
                  checked={selected.has(permission.key)}
                  onChange={(on) => toggle(permission.key, on)}
                  label={permission.label}
                  hint={requiredBy(permission.key) ? 'Needed by another permission you ticked' : undefined}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Alert tone="info">
        Managing the team and its roles is never part of a role: it stays with you, so nobody can give themselves more access.
      </Alert>
    </Modal>
  );
}
