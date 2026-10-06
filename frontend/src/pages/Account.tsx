/* My account: the signed-in person's own details, sign-in e-mail, password,
   appearance and security. Open to everybody — a cashier and the platform
   Super Admin alike — because these belong to the person, not the pharmacy. */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Mail, KeyRound, Palette, ShieldCheck, Save, Monitor, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { Button, Card, Tabs, TextInput, Segmented, Modal, Alert, Badge } from '../components/ui';
import { PhotoPicker } from '../components/people';
import { ChangePasswordModal } from '../components/Layout';
import SecurityCentre from './settings/SecurityCentre';
import { ago, dateTime, phone as fmtPhone } from '../utils/format';

type Tab = 'profile' | 'security';

export default function Account() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'security' ? 'security' : 'profile');
  useEffect(() => { setParams(tab === 'profile' ? new URLSearchParams() : new URLSearchParams({ tab }), { replace: true }); }, [tab, setParams]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My account</h1>
          <p className="sub">Your own details, how you sign in, and how KSF looks for you.</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'profile', label: 'Profile', icon: <User size={16} /> },
        { value: 'security', label: 'Sign-in & security', icon: <ShieldCheck size={16} /> }
      ]} />
      {tab === 'profile' ? <Profile /> : <SecurityCentre />}
    </>
  );
}

function Profile() {
  const { user, ok, fail, refreshSession } = useApp();
  const { busy, run } = useAction();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phoneNo, setPhoneNo] = useState(user?.phone ?? '');
  const [emailOpen, setEmailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  useEffect(() => { setFullName(user?.fullName ?? ''); setPhoneNo(user?.phone ?? ''); }, [user?.fullName, user?.phone]);

  const dirty = fullName.trim() !== (user?.fullName ?? '') || phoneNo.trim() !== (user?.phone ?? '');
  const save = () => run(
    () => api.patch('/me', { fullName: fullName.trim(), phone: phoneNo.trim() }),
    () => { ok('Saved', 'Your details have been updated.'); void refreshSession(); }
  );

  return (
    <div className="grid grid-2">
      <Card title="Your details" subtitle="How you appear to everyone you work with" icon={<User size={18} />}>
        <div className="form-grid">
          <TextInput label="Full name" required wrapClass="span-2" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <TextInput label="Mobile number" inputMode="tel" wrapClass="span-2" value={phoneNo} placeholder="0300 1234567" onChange={(event) => setPhoneNo(event.target.value)} />
        </div>
        <dl className="kv mt-5">
          <dt>Role</dt><dd>{user?.roleName}{user?.isOwner ? <> <Badge tone="gold" dot={false}>Registered the pharmacy</Badge></> : null}{user?.isPlatformStaff ? <> <Badge tone="purple" dot={false}>KSF team</Badge></> : null}</dd>
          {user?.jobTitle && <><dt>Job title</dt><dd>{user.jobTitle}</dd></>}
          {user?.pharmacyName && !user.isPlatformAdmin && <><dt>Pharmacy</dt><dd>{user.pharmacyName}</dd></>}
          {user?.branchName && <><dt>Branch</dt><dd>{user.branchName}</dd></>}
          {user?.pharmacistRegNo && <><dt>Registration</dt><dd className="mono">{user.pharmacistRegNo}</dd></>}
          <dt>Last signed in</dt><dd>{user?.lastLoginAt ? `${ago(user.lastLoginAt)} (${dateTime(user.lastLoginAt)})` : '—'}</dd>
          {user?.phone && <><dt>On record</dt><dd>{fmtPhone(user.phone)}</dd></>}
        </dl>
        <div className="row mt-5" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Save size={17} />} loading={busy} disabled={!dirty || !fullName.trim()} onClick={() => { void save(); }}>Save details</Button>
        </div>
      </Card>

      <div className="col" style={{ gap: 'var(--s-5)' }}>
        {(user?.isPlatformAdmin || user?.isPlatformStaff) && <MyPhoto />}
        <Card title="Signing in" icon={<Mail size={18} />}>
          <dl className="kv">
            <dt>E-mail</dt><dd>{user?.email} {user?.emailVerified ? <Badge tone="ok" dot={false}>Confirmed</Badge> : null}</dd>
            <dt>Two-step sign-in</dt><dd>{user?.twoFactorEnabled ? 'On' : 'Off'}</dd>
          </dl>
          <div className="row mt-5" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" icon={<Mail size={16} />} onClick={() => setEmailOpen(true)}>Change e-mail</Button>
            <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => setPasswordOpen(true)}>Change password</Button>
          </div>
          <div className="mt-5"><MySessions /></div>
          {user?.isPlatformAdmin && (
            <div className="mt-4">
              <Alert tone="info">The address and password set in the server's settings were only used to create this account. What you set here is what counts from now on.</Alert>
            </div>
          )}
        </Card>
        <Appearance />
      </div>

      <ChangeEmail open={emailOpen} onClose={() => setEmailOpen(false)} onDone={() => { setEmailOpen(false); void refreshSession(); }} />
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)}
        onDone={() => { setPasswordOpen(false); ok('Password changed', 'Your other devices have been signed out.'); }} onFail={fail} />
    </div>
  );
}

/** The Super Admin and their team choose the face everybody on the desk sees. */
function MyPhoto() {
  const { user, ok, fail, refreshSession } = useApp();
  const { busy, run } = useAction();
  const change = (image: string | null) => run(
    () => (image ? api.put('/platform/me/avatar', { image }) : api.delete('/platform/me/avatar')),
    () => { ok(image ? 'Photo saved' : 'Photo removed'); void refreshSession(); }
  );
  return (
    <Card title="Your photo" subtitle="Shown beside your name in the platform console" icon={<User size={18} />}>
      <PhotoPicker name={user?.fullName ?? ''} value={user?.avatarUrl ?? null} onChange={(image) => { void change(image); }} onError={(message) => fail(new Error(message))} busy={busy} />
    </Card>
  );
}

function Appearance() {
  const { user, workspace, theme, setTheme, can, ok, refreshWorkspace, previewBrand } = useApp();
  const { run } = useAction();
  const platform = !!user?.isPlatformAdmin || !!user?.isPlatformStaff;
  const chooses = platform || can('appearance.theme') || can('settings.write');
  const mine = user?.theme ?? null;
  const themes = workspace?.themes ?? [];

  const choose = (key: string | null) => run(
    () => api.patch('/me', { theme: key ?? '' }),
    () => { ok('Theme changed', key ? `${themes.find((option) => option.key === key)?.name} is now your theme.` : 'You now see your pharmacy\'s theme.'); void refreshWorkspace(); }
  );

  return (
    <Card title="Appearance" icon={<Palette size={18} />}>
      <div className="field">
        <label className="label">Light or dark</label>
        <Segmented value={theme} onChange={setTheme} label="Light or dark" options={[
          { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Match device' }
        ]} />
        <span className="hint">Saved on this device. Dark is easier on the eyes during a night shift.</span>
      </div>

      <div className="field mt-5">
        <label className="label">Colour theme</label>
        {chooses
          ? (
            <>
              <div className="theme-grid">
                {!platform && (
                  <button type="button" className={`theme-card ${!mine ? 'is-selected' : ''}`} onClick={() => { void choose(null); }}>
                    <span className="theme-swatch" data-swatch={workspace?.pharmacyTheme ?? 'ksf-green'}><i /><i /><i /><i /></span>
                    <strong>{!mine && <Check size={14} />} The pharmacy's theme</strong>
                    <span>Whatever your Admin chooses</span>
                  </button>
                )}
                {themes.map((option) => (
                  <button key={option.key} type="button" className={`theme-card ${mine === option.key ? 'is-selected' : ''}`}
                    onMouseEnter={() => previewBrand(option.key)} onMouseLeave={() => previewBrand(null)}
                    onFocus={() => previewBrand(option.key)} onBlur={() => previewBrand(null)}
                    onClick={() => { void choose(option.key); }}>
                    <span className="theme-swatch" data-swatch={option.key}><i /><i /><i /><i /></span>
                    <strong>{mine === option.key && <Check size={14} />} {option.name}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
              <span className="hint">Point at a theme to preview it. Only you see your choice.</span>
            </>
          )
          : <Alert tone="info" icon={<Monitor />}>Your pharmacy's Admin sets the colour theme. Ask them if you would like to choose your own.</Alert>}
      </div>
    </Card>
  );
}

function ChangeEmail({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setStep(1); setEmail(''); setPassword(''); setCode(''); setNote(''); } }, [open]);

  const start = () => run(
    () => api.post<{ message: string }>('/me/email/start', { email: email.trim(), password }),
    (reply) => { setNote(reply.message); setStep(2); }
  );
  const confirm = () => run(
    () => api.post('/me/email/confirm', { email: email.trim(), code: code.trim() }),
    () => { ok('E-mail changed', `Sign in with ${email.trim()} from now on. A notice has gone to your old address.`); onDone(); }
  );

  return (
    <Modal open={open} onClose={onClose} size="sm" icon={<Mail />} title="Change your sign-in e-mail"
      subtitle={step === 1 ? 'Your password first, then a code sent to the new address proves it is yours.' : note}
      footer={step === 1
        ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!email.trim() || !password} onClick={() => { void start(); }}>Send code</Button></>
        : <><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button variant="primary" loading={busy} disabled={code.trim().length !== 6} onClick={() => { void confirm(); }}>Confirm change</Button></>}>
      {step === 1
        ? (
          <div className="col" style={{ gap: 16 }}>
            <TextInput label="New e-mail address" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <TextInput label="Your current password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
        )
        : <TextInput label="Six-digit code" inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} hint={`Sent to ${email.trim()}. It expires in a few minutes.`} />}
    </Modal>
  );
}

/** Where this person is signed in at the moment. */
function MySessions() {
  const { data } = useApiData<{ data: { id: string; ip: string; userAgent: string; lastSeenAt: string; revokedAt: string | null }[] }>('/me/sessions');
  const live = (data?.data ?? []).filter((session) => !session.revokedAt).slice(0, 5);
  return (
    <div>
      <div className="lbl mb-2">Where you are signed in</div>
      <div className="col" style={{ gap: 8 }}>
        {live.map((session) => (
          <div className="mini-card" key={session.id}>
            <div className="row-between">
              <span className="t-sm t-semi mono">{session.ip || 'this device'}</span>
              <span className="t-xs t-dim">{ago(session.lastSeenAt)}</span>
            </div>
            <div className="t-xs t-dim truncate mt-2">{session.userAgent}</div>
          </div>
        ))}
        {!live.length && <span className="t-sm t-dim">Only here.</span>}
      </div>
    </div>
  );
}
