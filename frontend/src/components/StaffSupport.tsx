/* ==========================================================================
   Helping staff who are stuck
   --------------------------------------------------------------------------
   A cashier rings: "I cannot sign in." The owner or the Super Admin opens
   the dashboard, sees why, and fixes it there, without going looking:

     locked out              → Unlock
     wrong password          → Give a new password
     too many computers      → Remove one they no longer use
     lost phone (two-step)   → Switch two-step sign-in off
     suspended               → Restore access

   The same windows are used from the Staff page. Every action is checked
   again on the server (staff.manage, and the seniority rule), and every one
   is written to the activity log against the name of whoever did it.
   ========================================================================== */

import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LifeBuoy, Lock, KeyRound, Monitor, Smartphone, ShieldOff, Ban, Trash2, RefreshCw, Users
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { Button, Card, ConfirmDialog, EmptyState, Modal, TextInput, Badge, Allow } from './ui';
import { StepUpDialog } from './account-ui';
import { ago } from '../utils/format';
import type { Device, StaffHelpItem } from '../types';

/** Who a help window is for. */
export interface HelpPerson { id: string; name: string }

/* ------------------------------------------------------- new password -- */

export function ResetPasswordDialog({
  person, onClose, onDone
}: { person: HelpPerson | null; onClose: () => void; onDone?: () => void }) {
  const { ok, workspace } = useApp();
  const { busy, run } = useAction();
  const [password, setPassword] = useState('');
  const minLength = workspace?.passwordMinLength ?? 12;

  const close = () => { setPassword(''); onClose(); };

  return (
    <Modal
      open={!!person}
      onClose={close}
      size="sm"
      icon={<KeyRound />}
      tone="warn"
      title="Reset this password"
      subtitle={person ? `${person.name} will be signed out everywhere and must change it again on their next sign-in.` : ''}
      footer={
        <>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button
            variant="danger" loading={busy} disabled={password.length < minLength}
            onClick={() => run(
              () => api.post(`/staff/${person!.id}/reset-password`, { password }),
              () => { close(); ok('Password reset', 'Give them the new password in person.'); onDone?.(); }
            )}
          >
            Reset password
          </Button>
        </>
      }
    >
      <TextInput
        label="New temporary password" required type="text"
        value={password} onChange={(e) => setPassword(e.target.value)}
        hint={`At least ${minLength} characters with a capital, a small letter, a number and a symbol.`}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------ devices -- */

export function DevicesDialog({
  person, onClose, onDone
}: { person: HelpPerson | null; onClose: () => void; onDone?: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [removing, setRemoving] = useState<Device | null>(null);
  const { data, reload } = useApiData<{ data: Device[]; limits: { desktop: number; mobile: number } }>(
    person ? `/staff/${person.id}/devices` : null, [person?.id]
  );
  const devices = data?.data ?? [];

  return (
    <>
      <Modal
        open={!!person && !removing}
        onClose={onClose}
        size="lg"
        icon={<Monitor />}
        title={person ? `${person.name}'s computers and phones` : ''}
        subtitle={data
          ? `Each person may use ${data.limits.desktop} computer(s) and ${data.limits.mobile} phone(s) or tablet(s). Remove one they no longer use, and they can sign in on the new one.`
          : 'Loading…'}
        footer={<Button variant="outline" onClick={onClose}>Close</Button>}
      >
        {devices.length === 0
          ? <EmptyState title="No devices registered" message="They can sign in on any computer now." />
          : (
            <ul className="device-list">
              {devices.map((device) => (
                <li key={device.id} className="device-row">
                  <span className="device-icon" aria-hidden="true">
                    {device.category === 'desktop' ? <Monitor size={18} /> : <Smartphone size={18} />}
                  </span>
                  <div className="device-detail">
                    <strong>{device.label}</strong>
                    <span>{device.browser} {device.browserVersion} on {device.platform} · {device.lastSeenFrom}</span>
                    <span className="device-meta">Registered {ago(device.registeredAt)} · last used {ago(device.lastActiveAt)}</span>
                  </div>
                  <div className="device-actions">
                    <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => setRemoving(device)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(
          () => api.delete<{ message: string }>(`/staff/${person!.id}/devices/${removing!.id}`),
          (reply) => { setRemoving(null); ok('Device removed', reply.message); void reload(true); onDone?.(); }
        )}
        loading={busy}
        tone="warn"
        title={`Remove ${removing?.label ?? 'this device'}?`}
        confirmLabel="Remove the device"
        message={<>Anyone still signed in as <b>{person?.name}</b> on it is signed out. It frees a place, so they can sign in on another computer.</>}
      />
    </>
  );
}

/* ---------------------------------------------------- two-step sign-in -- */

export function TwoStepOffDialog({
  person, onClose, onDone
}: { person: HelpPerson | null; onClose: () => void; onDone?: () => void }) {
  const { ok, user } = useApp();
  const { run } = useAction();

  return (
    <StepUpDialog
      open={!!person}
      onClose={onClose}
      needsCode={!!user?.twoFactorEnabled}
      reason={person
        ? `Switching off two-step sign-in lets ${person.name} sign in with only their password, so they can set it up again on their new phone. Confirm your own password to do it.`
        : undefined}
      onVerified={() => {
        const who = person;
        if (!who) return;
        void run(
          () => api.post<{ message: string }>(`/staff/${who.id}/reset-2fa`, {}),
          (reply) => { ok('Two-step sign-in switched off', reply.message); onDone?.(); }
        );
      }}
    />
  );
}

/* ------------------------------------------------- the dashboard card -- */

const KIND_ICON: Record<StaffHelpItem['kind'], ReactElement> = {
  locked: <Lock size={18} />,
  'wrong-password': <KeyRound size={18} />,
  'device-limit': <Monitor size={18} />,
  'two-step': <ShieldOff size={18} />,
  suspended: <Ban size={18} />
};

const FIX_LABEL: Record<StaffHelpItem['fix'], string> = {
  unlock: 'Unlock',
  'reset-password': 'Give a new password',
  devices: 'Free up a computer',
  'reset-2fa': 'Switch two-step off',
  restore: 'Restore access'
};

/** "Staff who need your help" — only shown when somebody does. */
export function StaffHelpCard() {
  const { ok } = useApp();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const { data, reload } = useApiData<{ data: StaffHelpItem[] }>('/staff/help');
  const [resetting, setResetting] = useState<HelpPerson | null>(null);
  const [devicesFor, setDevicesFor] = useState<HelpPerson | null>(null);
  const [twoStepFor, setTwoStepFor] = useState<HelpPerson | null>(null);
  const [restoring, setRestoring] = useState<HelpPerson | null>(null);

  const items = data?.data ?? [];
  const refresh = () => { void reload(true); };

  const fix = (item: StaffHelpItem) => {
    const person = { id: item.userId, name: item.name };
    if (item.fix === 'unlock') {
      void run(() => api.post(`/staff/${item.userId}/unlock`, {}), () => { ok('Account unlocked', `${item.name} can sign in again.`); refresh(); });
    } else if (item.fix === 'reset-password') setResetting(person);
    else if (item.fix === 'devices') setDevicesFor(person);
    else if (item.fix === 'reset-2fa') setTwoStepFor(person);
    else setRestoring(person);
  };

  if (items.length === 0) return null;

  return (
    <div className="mb-5">
      <Card
        icon={<LifeBuoy size={18} />}
        title="Staff who need your help"
        subtitle="Someone could not sign in. Fix it here, then ask them to try again."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={15} />} onClick={refresh}>Check again</Button>
            <Button size="sm" variant="ghost" icon={<Users size={15} />} onClick={() => navigate('/staff')}>All staff</Button>
          </>
        }
      >
        <ul className="device-list">
          {items.map((item) => (
            <li key={item.id} className="device-row">
              <span className="device-icon" aria-hidden="true">{KIND_ICON[item.kind]}</span>
              <div className="device-detail">
                <strong>{item.name} · {item.title}</strong>
                <span>{item.detail}</span>
                <span className="device-meta">{item.role} · {ago(item.at)}</span>
              </div>
              <div className="device-actions">
                <Badge tone={item.kind === 'suspended' ? 'warn' : 'danger'} dot={false}>Needs help</Badge>
                <Button size="sm" variant="primary" loading={busy && item.fix === 'unlock'} onClick={() => fix(item)}>
                  {FIX_LABEL[item.fix]}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ResetPasswordDialog person={resetting} onClose={() => setResetting(null)} onDone={refresh} />
      <DevicesDialog person={devicesFor} onClose={() => { setDevicesFor(null); refresh(); }} onDone={refresh} />
      <TwoStepOffDialog person={twoStepFor} onClose={() => setTwoStepFor(null)} onDone={refresh} />
      <ConfirmDialog
        open={!!restoring}
        onCancel={() => setRestoring(null)}
        onConfirm={() => run(
          () => api.patch(`/staff/${restoring!.id}`, { status: 'active' }),
          () => { ok('Access restored', `${restoring!.name} can sign in again.`); setRestoring(null); refresh(); }
        )}
        loading={busy}
        tone="warn"
        title="Restore access?"
        confirmLabel="Restore"
        message={<><b>{restoring?.name}</b> will be able to sign in again with their existing password.</>}
      />
    </div>
  );
}

/** The card, for the people allowed to help. */
export function StaffHelp() {
  return (
    <Allow permission="staff.manage">
      <StaffHelpCard />
    </Allow>
  );
}
