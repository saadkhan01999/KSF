/* ==========================================================================
   Settings › Security Centre
   --------------------------------------------------------------------------
   Everything about this account's own security in one place: the password,
   two-factor, the devices that may sign in, the sessions that are open, and
   what has happened recently.

   Anything that weakens security asks for the password again first. That is
   not theatre — a session left open on a counter is exactly how somebody
   would remove the owner's phone from the device list.
   ========================================================================== */

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, Smartphone, Monitor, KeyRound, LogOut, Trash2,
  RefreshCw, Copy, Check, Clock, Fingerprint, FileCheck, Pencil, Download, Mail
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction } from '../../hooks/useApi';
import { api } from '../../services/api';
import {
  Button, Card, Modal, ConfirmDialog, Alert, CardSkeleton, EmptyState,
  Badge, TextInput, StatusBadge
} from '../../components/ui';
import { PasswordField, OtpInput, StatusNote, DetailRow } from '../../components/account-ui';
import { ChangePasswordModal } from '../../components/Layout';
import { ago, dateTime, number } from '../../utils/format';
import type { SecurityCentre as Centre } from '../../types';

interface Privacy {
  collected: { what: string; why: string; retention: string }[];
  notCollected: string[];
}

const EVENT_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.failed': 'Sign-in failed',
  'auth.locked': 'Sign-in refused — account locked',
  'auth.suspended': 'Sign-in refused — account suspended',
  'auth.throttled': 'Sign-in refused — too many attempts',
  'auth.2fa-challenge': 'Two-factor code requested',
  'auth.2fa-failed': 'Two-factor code incorrect',
  'auth.step-up': 'Identity confirmed',
  'auth.step-up-failed': 'Identity confirmation failed',
  'auth.password-changed': 'Password changed',
  'auth.password-reset': 'Password reset',
  'auth.reset-requested': 'Password reset requested',
  'device.limit-reached': 'A new device was refused',
  'device.removed': 'A device was removed',
  'session.revoked': 'A session was ended',
  'session.logout-all': 'Signed out everywhere',
  'auth.refresh-reuse': 'An old sign-in token was replayed — that session was ended',
  '2fa.enabled': 'Two-factor switched on',
  '2fa.disabled': 'Two-factor switched off',
  '2fa.enable-failed': 'Two-factor setup failed',
  '2fa.recovery-regenerated': 'New recovery codes generated',
  'account.created': 'Account created'
};

export function SecurityCentre() {
  const { ok, fail, user, refreshSession } = useApp();
  const { busy, run } = useAction();
  const { data, loading, reload } = useApiData<Centre>('/account/security');

  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState('');
  const [afterStepUp, setAfterStepUp] = useState<(() => void) | null>(null);

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; instructions: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [removeDevice, setRemoveDevice] = useState<{ id: string; label: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [integrity, setIntegrity] = useState<{ ok: boolean; message: string; checked: number } | null>(null);
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [exporting, setExporting] = useState(false);

  /* ------------------------------------------------------------ step up -- */

  /** Run `action`, asking for the password first if that has not been done
      recently. The server enforces this too — this is only so the person is
      asked before the work rather than after it fails. */
  const guarded = useCallback((action: () => void) => {
    if (data?.elevated) { action(); return; }
    setAfterStepUp(() => action);
    setStepUpPassword('');
    setStepUpCode('');
    setStepUpError('');
    setStepUpOpen(true);
  }, [data?.elevated]);

  const confirmIdentity = async () => {
    setStepUpError('');
    try {
      await api.post('/auth/verify-identity', {
        password: stepUpPassword,
        code: stepUpCode || undefined
      });
      setStepUpOpen(false);
      await reload(true);
      const next = afterStepUp;
      setAfterStepUp(null);
      next?.();
    } catch (problem) {
      setStepUpError(problem instanceof Error ? problem.message : 'That could not be confirmed.');
    }
  };

  /* ---------------------------------------------------------- two-factor -- */

  const startTwoFactor = () => guarded(async () => {
    const reply = await run(() => api.post<{ secret: string; otpauthUrl: string; instructions: string }>('/account/2fa/start'));
    if (reply) { setSetup(reply); setConfirmCode(''); setTwoFactorOpen(true); }
  });

  const enableTwoFactor = async () => {
    const reply = await run(() => api.post<{ recoveryCodes: string[]; message: string }>('/account/2fa/enable', { code: confirmCode }));
    if (!reply) return;
    setRecoveryCodes(reply.recoveryCodes);
    setTwoFactorOpen(false);
    setSetup(null);
    ok('Two-factor authentication is on');
    await reload(true);
    await refreshSession();
  };

  const disableTwoFactor = () => guarded(async () => {
    const reply = await run(() => api.post<{ message: string }>('/account/2fa/disable'));
    if (!reply) return;
    setDisableOpen(false);
    ok('Two-factor authentication is off');
    await reload(true);
    await refreshSession();
  });

  const regenerate = () => guarded(async () => {
    const reply = await run(() => api.post<{ recoveryCodes: string[] }>('/account/2fa/recovery-codes'));
    if (reply) { setRecoveryCodes(reply.recoveryCodes); ok('New recovery codes generated'); await reload(true); }
  });

  /* ------------------------------------------------------------- devices -- */

  const doRemoveDevice = () => guarded(async () => {
    if (!removeDevice) return;
    const reply = await run(() => api.delete<{ message: string; sessionsEnded: number }>(`/account/devices/${removeDevice.id}`));
    if (reply) { ok(reply.message); setRemoveDevice(null); await reload(true); }
  });

  const saveDeviceName = async () => {
    if (!renaming) return;
    const reply = await run(() => api.patch(`/account/devices/${renaming.id}`, { label: renaming.label }));
    if (reply) { ok('Device renamed'); setRenaming(null); await reload(true); }
  };

  const endSession = async (id: string) => {
    const reply = await run(() => api.delete(`/account/sessions/${id}`));
    if (reply) { ok('That session has been ended'); await reload(true); }
  };

  const logoutEverywhere = async () => {
    const reply = await run(() => api.post<{ ended: number; message: string }>('/account/sessions/logout-all'));
    if (reply) { ok(reply.message); setLogoutAllOpen(false); await reload(true); }
  };

  /* ----------------------------------------------------------- integrity -- */

  useEffect(() => {
    api.get<{ ok: boolean; message: string; checked: number }>('/account/audit-integrity')
      .then(setIntegrity)
      .catch(() => setIntegrity(null));
    api.get<Privacy>('/account/privacy')
      .then(setPrivacy)
      .catch(() => setPrivacy(null));
  }, []);

  /* The file is built in the browser from what the API returns, so the
     download never becomes a URL somebody could share by accident. */
  const exportData = async () => {
    setExporting(true);
    try {
      const reply = await api.get<{ data: unknown }>('/account/export');
      const blob = new Blob([JSON.stringify(reply.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ksf-pharmacy-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      ok('Your data has been downloaded');
    } catch (problem) {
      fail(problem);
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <CardSkeleton count={3} />;
  if (!data) return <EmptyState title="The Security Centre could not be loaded" message="Try again in a moment." />;

  return (
    <div className="grid grid-2">
      {/* -------------------------------- password -------------------------- */}
      <Card
        title="Password"
        subtitle="Stored only as a hash that cannot be reversed"
        icon={<KeyRound size={18} />}
      >
        <dl className="detail-list">
          <DetailRow label="Last changed">
            {data.password.changedAt ? `${dateTime(data.password.changedAt)} (${ago(data.password.changedAt)})` : 'Never'}
          </DetailRow>
          <DetailRow label="Hashing algorithm">
            <code>{data.password.algorithm}</code>
          </DetailRow>
          <DetailRow label="Minimum length">{data.password.minLength} characters</DetailRow>
        </dl>

        {data.password.mustChange && (
          <Alert tone="warn" title="You are using a temporary password">
            It was set for you by somebody else. Change it before doing anything else.
          </Alert>
        )}

        <Button variant="secondary" onClick={() => setChangePasswordOpen(true)}>
          Change my password
        </Button>
        <p className="card-note">
          Changing your password signs out every other device and replaces the token this
          browser is using.
        </p>
      </Card>

      {/* ------------------------------ two-factor -------------------------- */}
      <Card
        title="Two-factor authentication"
        subtitle="A code from your phone, as well as your password"
        icon={data.twoFactor.enabled ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
      >
        {data.twoFactor.enabled ? (
          <>
            <div className="inline-status">
              <Badge tone="ok">On</Badge>
              <span>Switched on {ago(data.twoFactor.confirmedAt)}</span>
            </div>

            <dl className="detail-list">
              <DetailRow label="Recovery codes left">
                {data.twoFactor.recoveryCodesLeft}
                {data.twoFactor.recoveryCodesLeft <= 2 && (
                  <span className="tone-warn"> — generate a new set soon</span>
                )}
              </DetailRow>
              <DetailRow label="Codes generated">{ago(data.twoFactor.recoveryGeneratedAt)}</DetailRow>
            </dl>

            <div className="card-actions">
              <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={regenerate} loading={busy}>
                New recovery codes
              </Button>
              <Button variant="ghost" onClick={() => setDisableOpen(true)}>Switch it off</Button>
            </div>
          </>
        ) : (
          <>
            <StatusNote tone="warn" title="Not switched on">
              With two-factor on, somebody who learns your password still cannot sign in. It
              takes about a minute to set up and works with Google Authenticator, Microsoft
              Authenticator, Authy and 1Password.
            </StatusNote>
            <Button variant="primary" onClick={startTwoFactor} loading={busy}>
              Set up two-factor authentication
            </Button>
          </>
        )}
      </Card>

      {/* -------------------------------- devices --------------------------- */}
      <Card
        title="Registered devices"
        subtitle={`${data.deviceLimits.desktop} computer(s) and ${data.deviceLimits.mobile} phone(s) or tablet(s) allowed`}
        icon={<Fingerprint size={18} />}
        className="span-2"
      >
        <StatusNote tone="info" title="How KSF recognises a device">
          By an identifier this server issued to it, held in a cookie the browser will not let
          scripts read. KSF does not fingerprint your machine. Clearing cookies therefore looks
          like a new device — remove the old row here when that happens.
        </StatusNote>

        {data.devices.length === 0 ? (
          <EmptyState title="No devices registered" message="The machine you are using now will appear here." />
        ) : (
          <ul className="device-list">
            {data.devices.map((device) => (
              <li key={device.id} className="device-row">
                <span className="device-icon" aria-hidden="true">
                  {device.category === 'desktop' ? <Monitor size={18} /> : <Smartphone size={18} />}
                </span>
                <div className="device-detail">
                  <strong>{device.label}</strong>
                  <span>
                    {device.browser} {device.browserVersion} on {device.platform} · {device.lastSeenFrom}
                  </span>
                  <span className="device-meta">
                    Registered {ago(device.registeredAt)} · last used {ago(device.lastActiveAt)}
                  </span>
                </div>
                <div className="device-actions">
                  <Button variant="ghost" icon={<Pencil size={14} />} onClick={() => setRenaming({ id: device.id, label: device.label })}>
                    Rename
                  </Button>
                  <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => setRemoveDevice({ id: device.id, label: device.label })}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------- sessions --------------------------- */}
      <Card
        title="Where you are signed in"
        subtitle="Every open session on this account"
        icon={<Clock size={18} />}
        actions={
          data.sessions.length > 1 && (
            <Button variant="ghost" icon={<LogOut size={15} />} onClick={() => setLogoutAllOpen(true)}>
              Sign out everywhere else
            </Button>
          )
        }
      >
        <ul className="session-list">
          {data.sessions.map((session) => (
            <li key={session.id} className={session.current ? 'is-current' : ''}>
              <div>
                <strong>
                  {session.device}
                  {session.current && <Badge tone="ok">This device</Badge>}
                </strong>
                <span>{session.from} · started {ago(session.createdAt)} · active {ago(session.lastSeenAt)}</span>
              </div>
              {!session.current && (
                <Button variant="ghost" onClick={() => { void endSession(session.id); }} loading={busy}>
                  End
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {/* ------------------------------- activity --------------------------- */}
      <Card
        title="Recent security activity"
        subtitle="What has happened on this account"
        icon={<ShieldCheck size={18} />}
      >
        {data.events.length === 0 ? (
          <EmptyState title="Nothing recorded yet" message="Sign-ins and security changes will appear here." />
        ) : (
          <ul className="event-list">
            {data.events.slice(0, 12).map((event) => (
              <li key={event.id} className={`tone-${event.severity}`}>
                <div>
                  <strong>{EVENT_LABELS[event.type] ?? event.type}</strong>
                  <span>{event.from}{event.detail ? ` · ${event.detail}` : ''}</span>
                </div>
                <time dateTime={event.at}>{ago(event.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------- your data -------------------------- */}
      <Card
        title="Your data"
        subtitle="What KSF holds, and how to take a copy of it"
        icon={<Download size={18} />}
      >
        {privacy ? (
          <>
            <ul className="privacy-list">
              {privacy.collected.map((item) => (
                <li key={item.what}>
                  <strong>{item.what}</strong>
                  <span>{item.why}</span>
                  <em>Kept: {item.retention}</em>
                </li>
              ))}
            </ul>

            <StatusNote tone="ok" title="Never collected">
              <ul className="cross-list">
                {privacy.notCollected.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </StatusNote>
          </>
        ) : (
          <CardSkeleton count={1} />
        )}

        <div className="card-actions">
          <Button
            variant="secondary" icon={<Download size={15} />} loading={exporting}
            onClick={exportData}
          >
            Export everything as JSON
          </Button>
        </div>
        <p className="card-note">
          A complete copy of this pharmacy — medicines, batches, sales,
          purchases, prescriptions, customers, staff and settings. Passwords and
          authenticator keys are deliberately left out, because a copy of those
          would be a liability rather than a record.
        </p>
      </Card>

      {/* ------------------------------ e-mail ------------------------------ */}
      {data.mail && (
        <Card
          title="E-mail"
          subtitle="Verification codes, password resets and billing notices"
          icon={<Mail size={18} />}
          className="span-2"
        >
          {!data.mail.configured && (
            <StatusNote tone="danger" title="No mail server is configured">
              Nobody can complete a registration or recover a forgotten password until this is set
              up. It is a server setting — see <code>docs/ENVIRONMENT.md</code>, the e-mail section.
            </StatusNote>
          )}

          {data.mail.failed > 0 && (
            <StatusNote tone="warn" title={`${data.mail.failed} message(s) never got through`}>
              They were retried and have been given up on. The most likely causes are a wrong
              password on the mail account, a sending address the domain does not authorise, or a
              provider that has suspended the account for volume.
            </StatusNote>
          )}

          <dl className="detail-list">
            <DetailRow label="Transport">{data.mail.transport}</DetailRow>
            <DetailRow label="Sent">{number(data.mail.sent)}</DetailRow>
            <DetailRow label="Waiting to retry">{number(data.mail.queued)}</DetailRow>
            <DetailRow label="Given up on">{number(data.mail.failed)}</DetailRow>
          </dl>

          {data.mail.recent.length > 0 && (
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">To</th>
                    <th scope="col">What</th>
                    <th scope="col">When</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mail.recent.map((row) => (
                    <tr key={row.id}>
                      {/* Masked by the server. A delivery list is not a place
                          to hand somebody an address book. */}
                      <td>{row.to_address}</td>
                      <td>
                        {row.subject}
                        {row.template && <div className="muted">{row.template}</div>}
                      </td>
                      <td>{ago(row.created_at)}</td>
                      <td>
                        <StatusBadge status={row.status} />
                        {row.last_error && <div className="muted">{row.last_error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="card-note">
            Bodies are not stored. A verification code lives in the message that was sent and
            nowhere else, which is why a code that failed to send is not retried — ask for a new
            one instead.
          </p>
        </Card>
      )}

      {/* ------------------------------ audit chain ------------------------- */}
      {integrity && (
        <Card
          title="Audit trail integrity"
          subtitle="Sensitive actions are hash-chained, and the chain can be checked"
          icon={<FileCheck size={18} />}
          className="span-2"
        >
          <div className="inline-status">
            <StatusBadge status={integrity.ok ? 'verified' : 'failed'} />
            <span>{integrity.message}</span>
          </div>
          <p className="card-note">
            Each audit entry carries the hash of the entry before it. If a record were altered
            or removed directly in the database, every hash after it would stop matching and
            this check would name the first one that failed.
          </p>
        </Card>
      )}

      {/* ================================ modals ============================ */}

      <ChangePasswordModal
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        onDone={() => { setChangePasswordOpen(false); void reload(true); ok('Your password has been changed'); }}
        onFail={fail}
      />

      {/* step-up */}
      <Modal
        open={stepUpOpen}
        onClose={() => { setStepUpOpen(false); setAfterStepUp(null); }}
        title="Confirm it is you"
        subtitle="Security changes need your password, even though you are signed in"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setStepUpOpen(false); setAfterStepUp(null); }}>Cancel</Button>
            <Button variant="primary" onClick={confirmIdentity} disabled={!stepUpPassword}>Confirm</Button>
          </>
        }
      >
        {stepUpError && <Alert tone="danger">{stepUpError}</Alert>}
        <PasswordField
          label="Your password" value={stepUpPassword} onChange={setStepUpPassword}
          showRules={false} autoComplete="current-password" autoFocus
        />
        {user?.twoFactorEnabled && (
          <TextInput
            label="Authenticator code" inputMode="numeric" maxLength={6}
            hint="The six digits showing in your app right now"
            value={stepUpCode} onChange={(e) => setStepUpCode(e.target.value)}
          />
        )}
      </Modal>

      {/* two-factor setup */}
      <Modal
        open={twoFactorOpen}
        onClose={() => { setTwoFactorOpen(false); setSetup(null); }}
        title="Set up two-factor authentication"
        subtitle="Scan the key with your authenticator app, then type what it shows"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setTwoFactorOpen(false); setSetup(null); }}>Cancel</Button>
            <Button variant="primary" onClick={enableTwoFactor} loading={busy} disabled={confirmCode.length !== 6}>
              Switch it on
            </Button>
          </>
        }
      >
        {setup && (
          <>
            <ol className="setup-steps">
              <li>Open Google Authenticator, Microsoft Authenticator, Authy or 1Password.</li>
              <li>Choose "add account", then "enter a setup key".</li>
              <li>Type the key below, with KSF as the account name.</li>
              <li>Enter the six digits it shows.</li>
            </ol>

            <div className="secret-block">
              <code>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
              <Button
                variant="ghost" icon={<Copy size={15} />}
                onClick={() => { void navigator.clipboard.writeText(setup.secret).then(() => ok('Key copied')); }}
              >
                Copy
              </Button>
            </div>

            <label className="label">The six digits from your app</label>
            <OtpInput value={confirmCode} onChange={setConfirmCode} onComplete={() => { void enableTwoFactor(); }} />
          </>
        )}
      </Modal>

      {/* recovery codes, shown once */}
      <Modal
        open={!!recoveryCodes}
        onClose={() => setRecoveryCodes(null)}
        title="Save these recovery codes"
        subtitle="They will not be shown again"
        size="md"
        footer={
          <Button variant="primary" onClick={() => setRecoveryCodes(null)}>
            I have saved them
          </Button>
        }
      >
        <Alert tone="warn" title="This is the only time you will see these">
          Print them, or write them down and keep them somewhere other than your phone. Each
          one works once, and they are the way back into your account if you lose the device
          with your authenticator app on it.
        </Alert>

        <ul className="recovery-codes">
          {recoveryCodes?.map((code) => <li key={code}><code>{code}</code></li>)}
        </ul>

        <div className="card-actions">
          <Button
            variant="secondary" icon={<Copy size={15} />}
            onClick={() => { void navigator.clipboard.writeText((recoveryCodes ?? []).join('\n')).then(() => ok('Codes copied')); }}
          >
            Copy all
          </Button>
          <Button variant="ghost" icon={<Check size={15} />} onClick={() => window.print()}>Print</Button>
        </div>
      </Modal>

      {/* rename a device */}
      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Name this device"
        subtitle="Something you will recognise in the list"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveDeviceName} loading={busy}>Save</Button>
          </>
        }
      >
        <TextInput
          label="Device name" autoFocus placeholder="Counter PC"
          value={renaming?.label ?? ''}
          onChange={(e) => setRenaming((current) => (current ? { ...current, label: e.target.value } : null))}
        />
      </Modal>

      <ConfirmDialog
        open={!!removeDevice}
        onCancel={() => setRemoveDevice(null)}
        onConfirm={doRemoveDevice}
        tone="danger"
        title={`Remove ${removeDevice?.label ?? 'this device'}?`}
        message="Anybody signed in on it will be signed out immediately, and it will have to be registered again the next time it is used. You will be asked for your password."
        confirmLabel="Remove the device"
        loading={busy}
      />

      <ConfirmDialog
        open={disableOpen}
        onCancel={() => setDisableOpen(false)}
        onConfirm={disableTwoFactor}
        tone="danger"
        title="Switch off two-factor authentication?"
        message="Your account will be protected by its password alone. Your recovery codes will stop working. You will be asked for your password first."
        confirmLabel="Switch it off"
        loading={busy}
      />

      <ConfirmDialog
        open={logoutAllOpen}
        onCancel={() => setLogoutAllOpen(false)}
        onConfirm={logoutEverywhere}
        tone="warn"
        title="Sign out everywhere else?"
        message="Every other session on every other device will end immediately. The one you are using now stays open."
        confirmLabel="Sign them all out"
        loading={busy}
      />
    </div>
  );
}

export default SecurityCentre;
