/* Roles and permissions.

   Five roles ship with every pharmacy, and its Admin can build any other by
   ticking exactly what it may do — a stock controller, a second cashier
   grade, an accountant who only sees money screens.

   Two guard rails are shown here and enforced again on the server:
     - You cannot grant a permission you do not hold yourself.
     - A role you create always sits below your own seniority. */

import { useMemo, useState } from 'react';
import {
  ShieldCheck, Plus, Pencil, Trash2, Copy, Crown, Store, Stethoscope,
  Wallet, Map as MapIcon, Shield, Users, Lock, Search, Check, X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import {
  Button, Modal, TextInput, TextArea, Checkbox, ConfirmDialog, Badge,
  EmptyState, CardSkeleton, Allow, Alert, SearchField, StatCard
} from '../components/ui';
import { number } from '../utils/format';
import { isPharmacyAdmin } from '../types';
import type { Role } from '../types';

interface RolesResponse {
  data: Role[];
  catalogue: { key: string; label: string; group: string }[];
  templates: { key: string; name: string; description: string; permissions: string[] }[];
  myLevel: number;
  myPermissions: string[];
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  crown: <Crown size={22} />, shield: <Shield size={22} />, map: <MapIcon size={22} />,
  store: <Store size={22} />, stethoscope: <Stethoscope size={22} />, wallet: <Wallet size={22} />
};

export default function Roles() {
  const { ok, can, user } = useApp();
  const { busy, run } = useAction();

  const { data, loading, reload } = useApiData<RolesResponse>('/roles');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState(40);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState('');
  const [removing, setRemoving] = useState<Role | null>(null);
  const [duplicating, setDuplicating] = useState<Role | null>(null);
  const [duplicateName, setDuplicateName] = useState('');

  const isAdmin = isPharmacyAdmin(user);
  const myPermissions = useMemo(() => new Set(data?.myPermissions ?? []), [data]);

  /* Grouped so the list reads like a job description, not a config file. */
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; group: string }[]>();
    for (const permission of data?.catalogue ?? []) {
      if (permSearch && !`${permission.label} ${permission.key} ${permission.group}`.toLowerCase().includes(permSearch.toLowerCase())) continue;
      const list = map.get(permission.group) ?? [];
      list.push(permission);
      map.set(permission.group, list);
    }
    return [...map.entries()];
  }, [data, permSearch]);

  const openNew = () => {
    setEditing(null);
    setName(''); setDescription(''); setLevel(40);
    setSelected(new Set(['dashboard.view']));
    setPermSearch('');
    setFormOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setName(role.name);
    setDescription(role.description ?? '');
    setLevel(role.level);
    setSelected(new Set(role.permissions));
    setPermSearch('');
    setFormOpen(true);
  };

  const applyTemplate = (templateKey: string) => {
    const template = data?.templates.find((t) => t.key === templateKey);
    if (!template) return;
    // Only copy across what the current user is themselves allowed to grant.
    const grantable = template.permissions.filter((p) => isAdmin || myPermissions.has(p));
    setSelected(new Set(grantable));
    if (!name) setName(`${template.name} (copy)`);
    ok('Template applied', `${grantable.length} permission(s) ticked. Adjust them as you like.`);
  };

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleGroup = (permissions: { key: string }[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const permission of permissions) {
        if (!isAdmin && !myPermissions.has(permission.key)) continue;
        if (on) next.add(permission.key); else next.delete(permission.key);
      }
      return next;
    });
  };

  const save = () => run(
    () => {
      const payload = { name, description, level, permissions: [...selected] };
      return editing ? api.patch(`/roles/${editing.id}`, payload) : api.post('/roles', payload);
    },
    () => {
      setFormOpen(false);
      ok(editing ? 'Role updated' : 'Role created', `${name} — ${selected.size} permission(s).`);
      void reload(true);
    }
  );

  const roles = data?.data ?? [];
  const systemRoles = roles.filter((r) => r.is_system);
  const customRoles = roles.filter((r) => !r.is_system);
  const editable = (role: Role) => (isAdmin || role.level < (user?.roleLevel ?? 0)) && role.key !== 'admin';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Roles &amp; access</h1>
          <p className="sub">
            A role is a list of things a person may do. Everyone who signs in has exactly one role,
            and KSF checks it on the server every single time — hiding a button is never the only defence.
          </p>
        </div>
        <Allow permission="roles.manage">
          <div className="actions">
            <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Create a role</Button>
          </div>
        </Allow>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Built-in roles" value={number(systemRoles.length)} icon={<ShieldCheck size={20} />} hint="ship with KSF" />
        <StatCard label="Roles you created" value={number(customRoles.length)} icon={<Plus size={20} />} tone="info" />
        <StatCard label="People with access" value={number(roles.reduce((sum, r) => sum + (r.member_count ?? 0), 0))} icon={<Users size={20} />} />
        <StatCard label="Permissions available" value={number(data?.catalogue.length ?? 0)} icon={<Lock size={20} />} tone="gold" hint="to mix into a role" />
      </div>

      {loading
        ? <CardSkeleton count={6} />
        : (
          <>
            <h3 className="mb-3">Built-in roles</h3>
            <p className="t-sm t-soft mb-4">
              These cover most pharmacies. They cannot be deleted, but you can duplicate any of them
              and adjust the copy.
            </p>
            <div className="grid grid-3 mb-6">
              {systemRoles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  canEdit={editable(role) && can('roles.manage')}
                  onEdit={() => openEdit(role)}
                  onDuplicate={() => { setDuplicating(role); setDuplicateName(`${role.name} (copy)`); }}
                />
              ))}
            </div>

            <div className="row-between mb-3">
              <h3>Roles you created</h3>
              {customRoles.length > 0 && <span className="t-sm t-dim">{customRoles.length} custom role(s)</span>}
            </div>

            {customRoles.length === 0
              ? (
                <div className="table-wrap">
                  <EmptyState
                    icon={<ShieldCheck size={30} />}
                    title="No custom roles yet"
                    message="Build a role for anything the six built-in ones do not cover — a stock controller who never touches money, or an accountant who never touches stock."
                    action={can('roles.manage')
                      ? <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>Create your first role</Button>
                      : undefined}
                  />
                </div>
              )
              : (
                <div className="grid grid-3">
                  {customRoles.map((role) => (
                    <RoleCard
                      key={role.id}
                      role={role}
                      canEdit={editable(role) && can('roles.manage')}
                      onEdit={() => openEdit(role)}
                      onDuplicate={() => { setDuplicating(role); setDuplicateName(`${role.name} (copy)`); }}
                      onDelete={() => setRemoving(role)}
                    />
                  ))}
                </div>
              )}
          </>
        )}

      {/* ---------------------------- role editor ---------------------------- */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="xl"
        icon={<ShieldCheck />}
        title={editing ? `Edit ${editing.name}` : 'Create a role'}
        subtitle={editing?.is_system
          ? 'This is a built-in role. You can change what it may do, but not its name.'
          : 'Tick everything this role should be able to do.'}
        footer={
          <>
            <span className="left t-sm t-soft">{selected.size} permission(s) selected</span>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!name.trim() || selected.size === 0}>
              {editing ? 'Save role' : 'Create role'}
            </Button>
          </>
        }
      >
        {!isAdmin && (
          <div className="mb-4">
            <Alert tone="info" title="You can only pass on what you hold">
              Permissions you do not have yourself are shown greyed out. This is what stops anyone
              quietly building a role more powerful than their own.
            </Alert>
          </div>
        )}

        <div className="form-grid mb-4">
          <TextInput
            label="Role name" required
            disabled={!!editing?.is_system}
            placeholder="e.g. Stock Controller"
            value={name} onChange={(e) => setName(e.target.value)}
            hint={editing?.is_system ? 'Built-in role names are fixed' : 'What you would call this job'}
          />
          <TextInput
            label="Seniority" type="number" min={1} max={isAdmin ? 99 : (user?.roleLevel ?? 10) - 1}
            disabled={!!editing?.is_system}
            value={String(level)} onChange={(e) => setLevel(Number(e.target.value))}
            hint={`Higher is more senior. Yours is ${user?.roleLevel}. A role can never outrank its creator.`}
          />
          <TextArea
            label="What is this role for?" className="span-2"
            placeholder="e.g. Counts stock and receives deliveries. No access to money screens."
            value={description} onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {!editing && (data?.templates.length ?? 0) > 0 && (
          <div className="mini-card mb-4">
            <div className="lbl mb-2">Start from a built-in role</div>
            <div className="row wrap" style={{ gap: 8 }}>
              {data?.templates.filter((t) => t.key !== 'admin').map((template) => (
                <button key={template.key} className="chip" onClick={() => applyTemplate(template.key)}>
                  <Copy size={13} /> {template.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="row-between mb-3 wrap" style={{ gap: 12 }}>
          <h4>Permissions</h4>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <SearchField value={permSearch} onChange={setPermSearch} placeholder="Find a permission…" />
          </div>
        </div>

        {groups.map(([group, permissions]) => {
          const grantable = permissions.filter((p) => isAdmin || myPermissions.has(p.key));
          const allOn = grantable.length > 0 && grantable.every((p) => selected.has(p.key));
          return (
            <div className="perm-group" key={group}>
              <h4>
                {group}
                <span className="pill-count">{permissions.filter((p) => selected.has(p.key)).length}/{permissions.length}</span>
                <span className="spacer" />
                {grantable.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleGroup(grantable, !allOn)}
                    style={{ fontWeight: 700 }}
                  >
                    {allOn ? <><X size={14} /> Clear all</> : <><Check size={14} /> Select all</>}
                  </button>
                )}
              </h4>
              <div className="perm-list">
                {permissions.map((permission) => {
                  const locked = !isAdmin && !myPermissions.has(permission.key);
                  return (
                    <div className={`perm-row ${locked ? 'is-locked' : ''}`} key={permission.key}>
                      <Checkbox
                        checked={selected.has(permission.key)}
                        disabled={locked}
                        onChange={() => toggle(permission.key)}
                        label={
                          <>
                            {permission.label}
                            {locked && <Lock size={12} style={{ marginLeft: 6, verticalAlign: -1 }} />}
                          </>
                        }
                        hint={<code>{permission.key}</code>}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {groups.length === 0 && (
          <EmptyState icon={<Search size={28} />} title="No permission matches that search" />
        )}
      </Modal>

      {/* ----------------------------- duplicate ----------------------------- */}
      <Modal
        open={!!duplicating}
        onClose={() => setDuplicating(null)}
        size="sm"
        icon={<Copy />}
        title="Duplicate this role"
        subtitle={duplicating ? `A new role will be created with the same permissions as ${duplicating.name}.` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setDuplicating(null)}>Cancel</Button>
            <Button
              variant="primary" loading={busy} disabled={!duplicateName.trim()}
              onClick={() => run(
                () => api.post(`/roles/${duplicating!.id}/duplicate`, { name: duplicateName }),
                () => { setDuplicating(null); ok('Role duplicated', `${duplicateName} is ready to edit.`); void reload(true); }
              )}
            >
              Create the copy
            </Button>
          </>
        }
      >
        <TextInput
          label="Name for the new role" required
          value={duplicateName} onChange={(e) => setDuplicateName(e.target.value)}
        />
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete(`/roles/${removing!.id}`),
          () => { setRemoving(null); ok('Role deleted'); void reload(true); }
        )}
        loading={busy}
        title="Delete this role?"
        confirmLabel="Delete role"
        message={
          <>
            <b>{removing?.name}</b> will be removed.
            {(removing?.member_count ?? 0) > 0 && (
              <span style={{ display: 'block', marginTop: 10, color: 'var(--danger-600)', fontWeight: 600 }}>
                {removing?.member_count} staff member(s) still use it. Move them to another role first.
              </span>
            )}
          </>
        }
      />
    </>
  );
}

/* ------------------------------- role card ------------------------------- */

function RoleCard({
  role, canEdit, onEdit, onDuplicate, onDelete
}: {
  role: Role; canEdit: boolean;
  onEdit: () => void; onDuplicate: () => void; onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useApiData<RolesResponse>('/roles');
  const labels = useMemo(() => {
    const map = new Map((data?.catalogue ?? []).map((p) => [p.key, p.label]));
    return role.permissions.map((key) => map.get(key) ?? key);
  }, [data, role.permissions]);

  return (
    <div className={`role-card ${role.is_system ? 'is-system' : ''}`}>
      <div className="role-top">
        <span className="role-ico">{ROLE_ICONS[role.icon] ?? <Shield size={22} />}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row-between" style={{ gap: 8 }}>
            <h4 className="truncate">{role.name}</h4>
            {role.is_system
              ? <Badge tone="gold" dot={false}>Built in</Badge>
              : <Badge tone="purple" dot={false}>Custom</Badge>}
          </div>
          <p className="role-desc">{role.description || 'No description.'}</p>
        </div>
      </div>

      <div className="role-stats">
        <div>
          <strong>{role.permissions.length}</strong>
          <span>permissions</span>
        </div>
        <div>
          <strong>{role.member_count ?? 0}</strong>
          <span>staff</span>
        </div>
        <div>
          <strong>{role.level}</strong>
          <span>seniority</span>
        </div>
      </div>

      <button
        className="btn btn-quiet btn-sm btn-block mt-3"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Hide what it can do' : 'See what it can do'}
      </button>

      {expanded && (
        <div className="mt-3" style={{ maxHeight: 210, overflowY: 'auto' }}>
          {labels.map((label) => (
            <div className="row-tight t-sm" key={label} style={{ padding: '3px 0' }}>
              <Check size={14} style={{ color: 'var(--ok-600)', flex: '0 0 14px' }} />
              <span className="t-soft">{label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row-tight mt-4" style={{ paddingTop: 14, borderTop: '1px solid var(--line-faint)' }}>
        <Allow permission="roles.manage">
          {canEdit && (
            <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={onEdit}>Edit</Button>
          )}
          <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={onDuplicate}>Duplicate</Button>
          {onDelete && canEdit && (
            <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onDelete} aria-label={`Delete ${role.name}`}>
              <Trash2 size={16} />
            </button>
          )}
        </Allow>
      </div>
    </div>
  );
}
