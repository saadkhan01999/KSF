/* One pharmacy, as the platform sees it: its figures, its plan and payments,
   its people and who among them is stuck, its support requests and what
   happened there lately — with every action the Super Admin can take on it. */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Building2, LogIn, Pencil, CreditCard, Wallet, Ban, PlayCircle, Users, LifeBuoy, ScrollText,
  Receipt, Boxes, TrendingUp, BadgeCheck, RotateCcw, AlertTriangle, Phone, Mail, MapPin
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import {
  Button, Card, Tabs, StatCard, StatusBadge, Badge, Modal, TextInput, TextArea, SelectInput, ConfirmDialog,
  EmptyState, CardSkeleton, Alert
} from '../../components/ui';
import { rupees, rupeesShort, number, date, dateTime, ago, toPaisa, phone as fmtPhone } from '../../utils/format';
import type { PharmacyDetail as Detail, PlatformPayment, PaymentAttemptRow, PlanRow, HelpItem } from '../../types/platform';

type Tab = 'overview' | 'people' | 'billing' | 'support' | 'activity';

export default function PharmacyDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { enterSupport, ok, fail, can, user } = useApp();
  /* What this person's team role allows here; the server checks again. */
  const manages = can('platform.pharmacies.manage');
  const handlesMoney = can('platform.finance.manage');
  const entersPharmacies = can('platform.pharmacies.enter');
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>('overview');
  const { data, loading, reload } = useApiData<Detail>(`/platform/pharmacies/${id}`, [id]);
  useLiveRefresh(reload, ['subscription']);

  const [editOpen, setEditOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [statusTo, setStatusTo] = useState<'suspended' | 'closed' | 'active' | null>(null);
  const [verifying, setVerifying] = useState<PaymentAttemptRow | null>(null);
  const [refunding, setRefunding] = useState<PlatformPayment | null>(null);

  if (loading && !data) return <><div className="page-head"><h1>Pharmacy</h1></div><CardSkeleton count={6} /></>;
  if (!data) return <EmptyState icon={<Building2 size={30} />} title="That pharmacy could not be found" action={<Button onClick={() => navigate('/platform/pharmacies')}>All pharmacies</Button>} />;

  const pharmacy = data.data;
  const figures = data.figures;
  const subscription = data.subscription;

  const goInside = async (path = '/dashboard') => {
    try {
      await enterSupport(pharmacy.id);
      ok(`Working inside ${pharmacy.name}`, user?.isPlatformAdmin ? 'Everything you do is recorded as Super Admin (support).' : 'Everything you do is recorded under your name, as the KSF team.');
      navigate(path);
    } catch (problem) {
      fail(problem);
    }
  };

  const changeStatus = (reason: string) => run(
    () => api.post<{ message: string }>(`/platform/pharmacies/${pharmacy.id}/status`, { status: statusTo, reason }),
    (reply) => { setStatusTo(null); ok('Done', reply.message); void reload(true); }
  );

  return (
    <>
      <button className="link-button mb-3" onClick={() => navigate('/platform/pharmacies')}><ArrowLeft size={15} /> All pharmacies</button>
      <div className="page-head">
        <div>
          <div className="row-tight" style={{ flexWrap: 'wrap' }}>
            <h1>{pharmacy.name}</h1>
            <StatusBadge status={pharmacy.status} large />
          </div>
          <p className="sub">
            {[pharmacy.city, pharmacy.province].filter(Boolean).join(', ') || 'Address not set'} · joined {date(pharmacy.created_at)}
            {pharmacy.pharmacy_type ? ` · ${pharmacy.pharmacy_type}` : ''}
          </p>
        </div>
        <div className="actions">
          {manages && <Button variant="outline" icon={<Pencil size={16} />} onClick={() => setEditOpen(true)}>Edit details</Button>}
          {manages && <Button variant="outline" icon={<CreditCard size={16} />} onClick={() => setPlanOpen(true)}>Plan</Button>}
          {handlesMoney && <Button variant="outline" icon={<Wallet size={16} />} onClick={() => setPaymentOpen(true)}>Record payment</Button>}
          {manages && (pharmacy.status === 'active'
            ? <Button variant="danger" icon={<Ban size={16} />} onClick={() => setStatusTo('suspended')}>Suspend</Button>
            : <Button variant="secondary" icon={<PlayCircle size={16} />} onClick={() => setStatusTo('active')}>Reactivate</Button>)}
          {entersPharmacies && <Button variant="primary" icon={<LogIn size={16} />} onClick={() => { void goInside(); }} disabled={pharmacy.status === 'closed'}>Work inside</Button>}
        </div>
      </div>

      {pharmacy.status !== 'active' && (
        <div className="mb-4">
          <Alert tone="danger" title={`This pharmacy is ${pharmacy.status}`}>
            Nobody at {pharmacy.name} can sign in. {pharmacy.platform_note ? `Reason recorded: ${pharmacy.platform_note}` : ''} Nothing has been deleted.
          </Alert>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview', icon: <Building2 size={16} /> },
          { value: 'people', label: 'People', icon: <Users size={16} />, count: data.help.length || undefined },
          { value: 'billing', label: 'Plan & payments', icon: <CreditCard size={16} /> },
          { value: 'support', label: 'Support', icon: <LifeBuoy size={16} />, count: data.tickets.filter((t) => !['resolved', 'closed'].includes(t.status)).length || undefined },
          { value: 'activity', label: 'Activity', icon: <ScrollText size={16} /> }
        ]}
      />

      {tab === 'overview' && (
        <>
          <div className="grid grid-4 mb-5">
            <StatCard label="Sold today" value={rupeesShort(figures.todayPaisa)} icon={<Receipt size={20} />} hint={`${number(figures.todayInvoices)} invoices`} />
            <StatCard label="Sold this month" value={rupeesShort(figures.monthPaisa)} icon={<TrendingUp size={20} />} hint={`${rupeesShort(figures.monthProfitPaisa)} gross profit`} />
            <StatCard label="Medicines" value={number(figures.medicines)} icon={<Boxes size={20} />} tone={figures.lowStock ? 'warn' : 'brand'} hint={`${number(figures.lowStock)} low on stock`} />
            <StatCard label="Since joining" value={rupeesShort(figures.allTimePaisa)} icon={<Wallet size={20} />} tone="gold" hint={`${number(figures.allTimeInvoices)} invoices · ${number(figures.customers)} customers`} />
          </div>
          <div className="grid grid-2">
            <Card title="Pharmacy" icon={<Building2 size={18} />}>
              <dl className="kv">
                <dt>Registered name</dt><dd>{pharmacy.legal_name ?? '—'}</dd>
                <dt>Phone</dt><dd>{pharmacy.phone ? <a href={`tel:${pharmacy.phone}`}>{fmtPhone(pharmacy.phone)}</a> : '—'}</dd>
                <dt>E-mail</dt><dd>{pharmacy.email ? <a href={`mailto:${pharmacy.email}`}>{pharmacy.email}</a> : '—'}</dd>
                <dt>Address</dt><dd>{pharmacy.address ?? '—'}</dd>
                <dt>DRAP licence</dt><dd>{pharmacy.drap_licence ?? '—'}</dd>
                <dt>NTN</dt><dd>{pharmacy.ntn ?? '—'}</dd>
                <dt>Branches</dt><dd>{data.branches.map((branch) => branch.name).join(', ') || '—'}</dd>
                <dt>Platform note</dt><dd>{pharmacy.platform_note ?? '—'}</dd>
              </dl>
            </Card>
            <Card title="The Admin" subtitle="Registered the pharmacy and runs it" icon={<BadgeCheck size={18} />}>
              {data.owner
                ? (
                  <dl className="kv">
                    <dt>Name</dt><dd>{data.owner.full_name}</dd>
                    <dt>E-mail</dt><dd><a href={`mailto:${data.owner.email}`}>{data.owner.email}</a></dd>
                    <dt>Phone</dt><dd>{data.owner.phone ? <a href={`tel:${data.owner.phone}`}>{fmtPhone(data.owner.phone)}</a> : '—'}</dd>
                    <dt>Status</dt><dd><StatusBadge status={data.owner.status} /></dd>
                    <dt>Last signed in</dt><dd>{data.owner.last_login_at ? ago(data.owner.last_login_at) : 'never'}</dd>
                    <dt>Two-step sign-in</dt><dd>{data.owner.totp_enabled ? 'On' : 'Off'}</dd>
                  </dl>
                )
                : <EmptyState title="No Admin on record" />}
              {subscription && (
                <div className="mt-5">
                  <div className="lbl mb-2">Subscription</div>
                  <div className="row-tight" style={{ flexWrap: 'wrap' }}>
                    <Badge tone="info" dot={false}>{subscription.planName}</Badge>
                    <StatusBadge status={subscription.status} />
                    {subscription.periodEnd && <span className="t-sm t-dim">until {date(subscription.periodEnd)}</span>}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {tab === 'people' && <People data={data} onHelp={entersPharmacies ? (path) => { void goInside(path); } : undefined} />}
      {tab === 'billing' && (
        <Billing
          data={data}
          onPlan={manages ? () => setPlanOpen(true) : undefined}
          onPayment={handlesMoney ? () => setPaymentOpen(true) : undefined}
          onVerify={handlesMoney ? setVerifying : undefined}
          onRefund={handlesMoney ? setRefunding : undefined}
        />
      )}

      {tab === 'support' && (
        <Card title="Support requests" subtitle="Everything this pharmacy has asked KSF for" pad={false}>
          {data.tickets.length === 0
            ? <EmptyState icon={<LifeBuoy size={28} />} title="No requests" message="This pharmacy has not asked for help yet." />
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <thead><tr><th>Request</th><th>Raised by</th><th>Status</th><th>Last activity</th></tr></thead>
                  <tbody>
                    {data.tickets.map((ticket) => (
                      <tr key={ticket.id} onClick={() => navigate(`/platform/support/${ticket.id}`)} style={{ cursor: 'pointer' }}>
                        <td className="cell-title"><div className="cell-main">{ticket.subject}</div><div className="cell-sub mono">{ticket.reference}</div></td>
                        <td data-label="Raised by" className="t-sm">{ticket.raised_by_name}<div className="cell-sub">{ticket.raised_by_role}</div></td>
                        <td data-label="Status"><StatusBadge status={ticket.status} /> <StatusBadge status={ticket.priority} /></td>
                        <td data-label="Last activity" className="t-sm">{ago(ticket.last_activity_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      )}

      {tab === 'activity' && (
        <Card title="Recent activity" subtitle="The last 25 things that happened at this pharmacy" pad={false}>
          {data.activity.length === 0
            ? <EmptyState title="Nothing yet" />
            : (
              <div className="table-scroll">
                <table className="tbl responsive">
                  <tbody>
                    {data.activity.map((row) => (
                      <tr key={row.id}>
                        <td className="cell-title"><div className="t-sm">{row.summary ?? row.action}</div><div className="cell-sub">{row.actor_name} · {row.actor_role}</div></td>
                        <td data-label="When" className="t-sm t-right">{dateTime(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      )}

      <EditModal open={editOpen} detail={data} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void reload(true); }} />
      <PlanModal open={planOpen} detail={data} onClose={() => setPlanOpen(false)} onSaved={() => { setPlanOpen(false); void reload(true); }} />
      <PaymentModal open={paymentOpen} detail={data} onClose={() => setPaymentOpen(false)} onSaved={() => { setPaymentOpen(false); void reload(true); }} />
      <VerifyModal attempt={verifying} onClose={() => setVerifying(null)} onSaved={() => { setVerifying(null); void reload(true); }} />
      <RefundModal payment={refunding} onClose={() => setRefunding(null)} onSaved={() => { setRefunding(null); void reload(true); }} />

      <ConfirmDialog
        open={!!statusTo}
        onCancel={() => setStatusTo(null)}
        onConfirm={(reason) => { void changeStatus(reason); }}
        loading={busy}
        tone={statusTo === 'active' ? 'warn' : 'danger'}
        title={statusTo === 'active' ? `Reactivate ${pharmacy.name}?` : `Suspend ${pharmacy.name}?`}
        message={statusTo === 'active'
          ? 'Everyone at the pharmacy will be able to sign in again, exactly as before.'
          : 'Everyone at the pharmacy is signed out at once and cannot sign in until you reactivate it. Nothing is deleted. The pharmacy is told the reason you give.'}
        confirmLabel={statusTo === 'active' ? 'Reactivate' : 'Suspend pharmacy'}
        requireReason={statusTo !== 'active'}
        reasonLabel="Reason the pharmacy will see"
      />
    </>
  );
}

/* --------------------------------------------------------------- people */
function People({ data, onHelp }: { data: Detail; onHelp?: (path: string) => void }) {
  return (
    <div className="col" style={{ gap: 'var(--s-5)' }}>
      {data.help.length > 0 && (
        <Card title="Who needs help right now" subtitle="Fix it from inside the pharmacy — Staff › Help" icon={<AlertTriangle size={18} />}>
          <div className="col" style={{ gap: 10 }}>
            {data.help.map((item: HelpItem) => (
              <div key={item.id} className="row-between mini-card" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="t-semi">{item.name} <span className="t-dim t-sm">· {item.role}</span></div>
                  <div className="t-sm"><Badge tone="warn" dot={false}>{item.title}</Badge> <span className="t-dim">{item.detail}</span></div>
                </div>
                {onHelp && <Button size="sm" variant="primary" icon={<LogIn size={15} />} onClick={() => onHelp('/staff')}>Fix it</Button>}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Staff" subtitle={`${data.staff.length} account(s)`} pad={false}
        actions={onHelp && <Button size="sm" variant="outline" icon={<LogIn size={15} />} onClick={() => onHelp('/staff')}>Manage inside</Button>}>
        <div className="table-scroll">
          <table className="tbl responsive">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last signed in</th></tr></thead>
            <tbody>
              {data.staff.map((person) => (
                <tr key={person.id}>
                  <td className="cell-title">
                    <div className="row-tight"><span className="cell-main">{person.full_name}</span>{person.is_owner ? <Badge tone="gold" dot={false}>Admin</Badge> : null}</div>
                    <div className="cell-sub">{person.email}{person.phone ? ` · ${fmtPhone(person.phone)}` : ''}</div>
                  </td>
                  <td data-label="Role" className="t-sm">{person.role_name ?? '—'}<div className="cell-sub">{person.branch_name ?? 'No fixed branch'}</div></td>
                  <td data-label="Status">
                    <StatusBadge status={person.status} />
                    {person.locked_until && new Date(person.locked_until) > new Date() && <Badge tone="danger" dot={false}>Locked</Badge>}
                  </td>
                  <td data-label="Last signed in" className="t-sm">{person.last_login_at ? ago(person.last_login_at) : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- billing */
function Billing({ data, onPlan, onPayment, onVerify, onRefund }: {
  data: Detail; onPlan?: () => void; onPayment?: () => void;
  onVerify?: (attempt: PaymentAttemptRow) => void; onRefund?: (payment: PlatformPayment) => void;
}) {
  const subscription = data.subscription;
  const open = data.attempts.filter((attempt) => ['created', 'pending'].includes(attempt.status));
  return (
    <div className="col" style={{ gap: 'var(--s-5)' }}>
      <Card title="Subscription" icon={<CreditCard size={18} />}
        actions={<>{onPlan && <Button size="sm" variant="outline" onClick={onPlan}>Change or extend</Button>}{onPayment && <Button size="sm" variant="primary" onClick={onPayment}>Record payment</Button>}</>}>
        {subscription
          ? (
            <dl className="kv">
              <dt>Plan</dt><dd>{subscription.planName} <StatusBadge status={subscription.status} /></dd>
              <dt>Current period</dt><dd>{date(subscription.periodStart)} – {date(subscription.periodEnd)}{subscription.daysLeft !== null ? ` (${subscription.daysLeft} day(s) left)` : ''}</dd>
              <dt>Automatic renewal</dt><dd>{subscription.autoRenew ? 'On' : 'Off'}</dd>
              <dt>Limits</dt><dd>{subscription.limits.users ?? '—'} people · {subscription.limits.branches ?? '—'} branch(es) · {number(subscription.limits.medicines ?? 0)} medicines</dd>
              {subscription.trial && <><dt>Trial</dt><dd>until {date(subscription.trial.expiresAt)} ({subscription.trial.source})</dd></>}
              {subscription.graceUntil && <><dt>Grace until</dt><dd>{date(subscription.graceUntil)}</dd></>}
            </dl>
          )
          : <EmptyState title="No subscription" />}
      </Card>

      {open.length > 0 && (
        <Card title="Payments waiting to be confirmed" subtitle="Bank transfers are confirmed by you, against your bank statement" pad={false}>
          <div className="table-scroll">
            <table className="tbl responsive">
              <thead><tr><th>Reference</th><th>Method</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
              <tbody>
                {open.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="cell-title"><div className="cell-main mono">{attempt.reference}</div><div className="cell-sub">{attempt.plan_key} · started {ago(attempt.created_at)}</div></td>
                    <td data-label="Method">{attempt.provider}</td>
                    <td data-label="Amount" className="t-right num t-semi">{rupees(attempt.amount_paisa)}</td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        {attempt.provider === 'bank-transfer' && onVerify && <Button size="sm" variant="primary" icon={<BadgeCheck size={15} />} onClick={() => onVerify(attempt)}>Confirm</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Payments received" pad={false}>
        {data.payments.length === 0
          ? <EmptyState icon={<Wallet size={28} />} title="No payments yet" />
          : (
            <div className="table-scroll">
              <table className="tbl responsive">
                <thead><tr><th>When</th><th>How</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                <tbody>
                  {data.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="cell-title"><div className="cell-main">{date(payment.paid_at ?? payment.created_at)}</div><div className="cell-sub mono">{payment.provider_reference ?? '—'}</div></td>
                      <td data-label="How" className="t-sm">{payment.provider ?? 'manual'}{payment.method ? ` · ${payment.method}` : ''}<div className="cell-sub">{payment.kind}</div></td>
                      <td data-label="Status"><StatusBadge status={payment.status} />{payment.refunded_paisa ? <div className="cell-sub">{rupees(payment.refunded_paisa)} refunded</div> : null}</td>
                      <td data-label="Amount" className="t-right num t-semi">{rupees(payment.amount_paisa)}</td>
                      <td data-label="Actions">
                        <div className="row-actions">
                          {onRefund && payment.status === 'succeeded' && (payment.refunded_paisa ?? 0) < payment.amount_paisa && (
                            <button className="icon-btn" onClick={() => onRefund(payment)} aria-label="Refund" title="Refund"><RotateCcw size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- modals */
function EditModal({ open, detail, onClose, onSaved }: { open: boolean; detail: Detail; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const blank = () => ({
    name: detail.data.name, legalName: detail.data.legal_name ?? '', email: detail.data.email ?? '', phone: detail.data.phone ?? '',
    address: detail.data.address ?? '', city: detail.data.city ?? '', province: detail.data.province ?? '', ntn: detail.data.ntn ?? '',
    drapLicence: detail.data.drap_licence ?? '', platformNote: detail.data.platform_note ?? '',
    deviceLimitDesktop: detail.data.device_limit_desktop === null ? '' : String(detail.data.device_limit_desktop),
    deviceLimitMobile: detail.data.device_limit_mobile === null ? '' : String(detail.data.device_limit_mobile)
  });
  const [form, setForm] = useState(blank);
  useEffect(() => { if (open) setForm(blank()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = (key: keyof ReturnType<typeof blank>) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const save = () => run(
    () => api.patch(`/platform/pharmacies/${detail.data.id}`, {
      ...form, deviceLimitDesktop: form.deviceLimitDesktop === '' ? null : Number(form.deviceLimitDesktop),
      deviceLimitMobile: form.deviceLimitMobile === '' ? null : Number(form.deviceLimitMobile)
    }),
    () => { ok('Pharmacy updated', form.name); onSaved(); }
  );

  return (
    <Modal open={open} onClose={onClose} size="lg" icon={<Pencil />} title={`Edit ${detail.data.name}`}
      subtitle="Recorded in the pharmacy's audit trail as a change made by the platform."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim()}>Save</Button></>}>
      <div className="form-grid">
        <TextInput label="Trading name" required value={form.name} onChange={set('name')} wrapClass="span-2" />
        <TextInput label="Registered name" value={form.legalName} onChange={set('legalName')} wrapClass="span-2" />
        <TextInput label="E-mail" type="email" icon={<Mail size={16} />} value={form.email} onChange={set('email')} />
        <TextInput label="Phone" icon={<Phone size={16} />} value={form.phone} onChange={set('phone')} />
        <TextInput label="Address" icon={<MapPin size={16} />} value={form.address} onChange={set('address')} wrapClass="span-2" />
        <TextInput label="City" value={form.city} onChange={set('city')} />
        <TextInput label="Province" value={form.province} onChange={set('province')} />
        <TextInput label="NTN" value={form.ntn} onChange={set('ntn')} />
        <TextInput label="DRAP licence" value={form.drapLicence} onChange={set('drapLicence')} />
        <TextInput label="Computers allowed per person" type="number" min={1} max={100} hint="Empty means the plan's limit" value={form.deviceLimitDesktop} onChange={set('deviceLimitDesktop')} />
        <TextInput label="Phones allowed per person" type="number" min={1} max={100} hint="Empty means the plan's limit" value={form.deviceLimitMobile} onChange={set('deviceLimitMobile')} />
        <TextArea label="Platform note" hint="Only you see this." value={form.platformNote} onChange={set('platformNote')} wrapClass="span-2" />
      </div>
    </Modal>
  );
}

function PlanModal({ open, detail, onClose, onSaved }: { open: boolean; detail: Detail; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const { data: plans } = useApiData<{ data: PlanRow[] }>(open ? '/platform/plans' : null, [open]);
  const [planKey, setPlanKey] = useState('');
  const [extendDays, setExtendDays] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setPlanKey(''); setExtendDays(''); setNote(''); } }, [open]);

  const save = () => run(
    () => api.post<{ message: string }>(`/platform/pharmacies/${detail.data.id}/subscription`, { planKey: planKey || undefined, extendDays: Number(extendDays) || undefined, note }),
    (reply) => { ok('Subscription updated', reply.message); onSaved(); }
  );

  return (
    <Modal open={open} onClose={onClose} icon={<CreditCard />} title="Change or extend the plan"
      subtitle="Takes effect at once, without a payment — for a negotiated plan, a goodwill extension or a correction."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!planKey && !Number(extendDays)}>Apply</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        <SelectInput
          label="Move to plan" value={planKey} onChange={(event) => setPlanKey(event.target.value)} placeholder="Keep the current plan"
          options={(plans?.data ?? []).filter((plan) => plan.status !== 'retired').map((plan) => ({ value: plan.key, label: `${plan.name} — ${plan.isFree ? 'free' : `${rupees(plan.pricePaisa)} / ${plan.period}`}` }))}
          hint={detail.subscription ? `Now: ${detail.subscription.planName}, ${detail.subscription.status}` : undefined}
        />
        <TextInput label="Extend the current period by" type="number" min={1} max={3660} suffix="days" value={extendDays} onChange={(event) => setExtendDays(event.target.value)} />
        <TextArea label="Note for the record" value={note} onChange={(event) => setNote(event.target.value)} placeholder="For example: launch offer agreed on the phone" />
      </div>
    </Modal>
  );
}

function PaymentModal({ open, detail, onClose, onSaved }: { open: boolean; detail: Detail; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  useEffect(() => { if (open) { setAmount(''); setMethod('cash'); setReference(''); } }, [open]);

  const save = () => run(
    () => api.post<{ message: string }>(`/platform/pharmacies/${detail.data.id}/payments`, { amountPaisa: toPaisa(amount), method, reference }),
    (reply) => { ok('Payment recorded', reply.message); onSaved(); }
  );

  return (
    <Modal open={open} onClose={onClose} icon={<Wallet />} title="Record a payment received"
      subtitle="Money paid outside the online checkout — cash at the office, a cheque, a direct transfer. It extends the subscription by one period."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!(Number(amount) > 0) || !reference.trim()}>Record payment</Button></>}>
      <div className="form-grid">
        <TextInput label="Amount" prefix="Rs" type="number" min={1} required value={amount} onChange={(event) => setAmount(event.target.value)} />
        <SelectInput label="Paid by" value={method} onChange={(event) => setMethod(event.target.value)}
          options={[{ value: 'cash', label: 'Cash' }, { value: 'cheque', label: 'Cheque' }, { value: 'transfer', label: 'Bank transfer' }, { value: 'wallet', label: 'Easypaisa / JazzCash' }]} />
        <TextInput label="Receipt, cheque or slip number" required wrapClass="span-2" value={reference} onChange={(event) => setReference(event.target.value)} hint="A reference is recorded once for each pharmacy, so the same payment is never counted twice." />
      </div>
    </Modal>
  );
}

function VerifyModal({ attempt, onClose, onSaved }: { attempt: PaymentAttemptRow | null; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [statement, setStatement] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { setStatement(''); setNote(''); }, [attempt]);
  const save = () => run(
    () => api.post<{ message: string }>(`/platform/payments/attempts/${attempt!.id}/verify`, { statementReference: statement, note }),
    (reply) => { ok('Transfer confirmed', reply.message); onSaved(); }
  );
  return (
    <Modal open={!!attempt} onClose={onClose} icon={<BadgeCheck />} title={`Confirm ${attempt?.reference ?? ''}`}
      subtitle={attempt ? `${rupees(attempt.amount_paisa)} for the ${attempt.plan_key} plan. Only confirm once you can see the money on your bank statement.` : ''}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!statement.trim()}>Confirm payment</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        <TextInput label="Bank statement reference" required value={statement} onChange={(event) => setStatement(event.target.value)} hint="The line on your statement this transfer matches." />
        <TextArea label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
    </Modal>
  );
}

function RefundModal({ payment, onClose, onSaved }: { payment: PlatformPayment | null; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const left = payment ? payment.amount_paisa - (payment.refunded_paisa ?? 0) : 0;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { setAmount(left ? String(left / 100) : ''); setReason(''); }, [payment, left]);
  const save = () => run(
    () => api.post<{ message: string }>(`/platform/payments/${payment!.id}/refund`, { amountPaisa: toPaisa(amount), reason }),
    (reply) => { ok('Refund recorded', reply.message); onSaved(); }
  );
  return (
    <Modal open={!!payment} onClose={onClose} tone="warn" icon={<RotateCcw />} title="Refund a payment"
      subtitle={payment ? `${rupees(left)} of ${rupees(payment.amount_paisa)} can still be refunded.` : ''}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={save} disabled={!(Number(amount) > 0) || reason.trim().length < 3}>Refund</Button></>}>
      <div className="col" style={{ gap: 16 }}>
        <TextInput label="Amount to refund" prefix="Rs" type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} />
        <TextArea label="Reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </Modal>
  );
}
