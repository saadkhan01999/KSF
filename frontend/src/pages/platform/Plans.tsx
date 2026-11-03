/* The subscription plans pharmacies choose from — Starter (the free trial),
   Monthly and Yearly on the price sheet. A change to a price or a limit
   applies to new subscriptions and renewals; a pharmacy part-way through a
   paid period keeps what it paid for. */

import { useEffect, useState } from 'react';
import { CreditCard, Pencil, Plus, Users, Building2, Pill, Monitor, Smartphone } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useApiData, useAction, useLiveRefresh } from '../../hooks/useApi';
import { api } from '../../services/api';
import { Button, Card, Badge, Modal, TextInput, TextArea, SelectInput, Checkbox, Switch, CardSkeleton, Alert } from '../../components/ui';
import { rupees, number, toPaisa } from '../../utils/format';
import type { PlanRow } from '../../types/platform';

interface PlansReply { data: PlanRow[]; features: { key: string; name: string; group: string }[] }

const PERIOD: Record<string, string> = { week: 'week', month: 'month', year: 'year', perpetual: 'for ever', trial: 'trial' };
/* -1 is unlimited. */
const limit = (value: number) => (value < 0 ? 'Unlimited' : number(value));

export default function Plans() {
  const { data, loading, reload } = useApiData<PlansReply>('/platform/plans');
  useLiveRefresh(reload, ['plans']);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plans</h1>
          <p className="sub">
            What pharmacies can subscribe to. A saved change reaches the pricing page, every pharmacy's billing and the
            checkout at once; features and limits apply to subscribers straight away, while a new price applies to new
            subscriptions and plan changes.
          </p>
        </div>
        <div className="actions">
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>New plan</Button>
        </div>
      </div>

      {loading && !data
        ? <CardSkeleton count={4} />
        : (
          <div className="grid grid-auto-lg">
            {(data?.data ?? []).map((plan) => (
              <Card key={plan.key} className="plan-card" title={plan.name} subtitle={plan.tagline ?? undefined} icon={<CreditCard size={18} />}
                actions={<button className="icon-btn" onClick={() => setEditing(plan)} aria-label={`Edit ${plan.name}`}><Pencil size={16} /></button>}>
                <div className="price">{plan.isFree ? 'Free' : rupees(plan.pricePaisa)} {!plan.isFree && <small>/ {PERIOD[plan.period] ?? plan.period}</small>}</div>
                {plan.referralPricePaisa !== null && plan.referralPricePaisa < plan.pricePaisa && (
                  <p className="t-sm t-dim">{rupees(plan.referralPricePaisa)} / {PERIOD[plan.period] ?? plan.period} with a referral</p>
                )}
                <div className="row-tight" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {plan.isTrial && <Badge tone="info" dot={false}>Free trial · {plan.trialDays || plan.periodDays} days</Badge>}
                  {plan.isDefault && !plan.isTrial && <Badge tone="info" dot={false}>Default</Badge>}
                  {plan.maxCycles > 0 && <Badge tone="info" dot={false}>Up to {plan.maxCycles} {PERIOD[plan.period] ?? 'period'}(s)</Badge>}
                  {plan.status === 'retired' ? <Badge tone="neutral" dot={false}>Retired</Badge> : <Badge tone="ok" dot={false}>On sale</Badge>}
                  {!plan.isPublic && <Badge tone="purple" dot={false}>Hidden from the website</Badge>}
                  <Badge tone="gold" dot={false}>{number(plan.pharmacies ?? 0)} pharmacies</Badge>
                </div>
                <dl className="kv mt-3">
                  <dt><Users size={14} /> People</dt><dd>{limit(plan.limits.users)}</dd>
                  <dt><Building2 size={14} /> Branches</dt><dd>{limit(plan.limits.branches)}</dd>
                  <dt><Pill size={14} /> Medicines</dt><dd>{limit(plan.limits.medicines)}</dd>
                  <dt><Monitor size={14} /> Computers each</dt><dd>{number(plan.limits.desktopDevices)}</dd>
                  <dt><Smartphone size={14} /> Phones each</dt><dd>{number(plan.limits.mobileDevices)}</dd>
                  <dt>Grace period</dt><dd>{plan.graceDays} day(s)</dd>
                </dl>
                <div className="feature-list mt-3">
                  {plan.features.map((key) => <span key={key} className="badge badge-neutral no-dot">{data?.features.find((feature) => feature.key === key)?.name ?? key}</span>)}
                </div>
              </Card>
            ))}
          </div>
        )}

      <PlanEditor
        open={!!editing || creating}
        plan={editing}
        features={data?.features ?? []}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); void reload(true); }}
      />
    </>
  );
}

function PlanEditor({ open, plan, features, onClose, onSaved }: {
  open: boolean; plan: PlanRow | null; features: PlansReply['features']; onClose: () => void; onSaved: () => void;
}) {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const blank = () => ({
    key: plan?.key ?? '', name: plan?.name ?? '', tagline: plan?.tagline ?? '', description: plan?.description ?? '',
    period: plan?.period ?? 'month', price: plan ? String(plan.pricePaisa / 100) : '', graceDays: String(plan?.graceDays ?? 7),
    referralPrice: plan?.referralPricePaisa !== null && plan?.referralPricePaisa !== undefined ? String(plan.referralPricePaisa / 100) : '',
    maxCycles: String(plan?.maxCycles ?? 0), trialDays: String(plan?.trialDays ?? 15),
    users: String(plan?.limits.users ?? -1), branches: String(plan?.limits.branches ?? -1), medicines: String(plan?.limits.medicines ?? -1),
    desktopDevices: String(plan?.limits.desktopDevices ?? 3), mobileDevices: String(plan?.limits.mobileDevices ?? 3),
    features: plan?.features ?? features.map((feature) => feature.key), isPublic: plan?.isPublic ?? true,
    status: plan?.status ?? 'active'
  });
  const [form, setForm] = useState(blank);
  useEffect(() => { if (open) setForm(blank()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, plan]);
  const text = (key: keyof ReturnType<typeof blank>) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggle = (key: string, on: boolean) => setForm((current) => ({ ...current, features: on ? [...current.features, key] : current.features.filter((item) => item !== key) }));

  const save = () => {
    const body = {
      name: form.name, tagline: form.tagline, description: form.description, pricePaisa: toPaisa(form.price || 0), graceDays: Number(form.graceDays),
      referralPricePaisa: form.referralPrice.trim() === '' ? null : toPaisa(form.referralPrice), maxCycles: Number(form.maxCycles) || 0,
      ...(plan?.isTrial ? { trialDays: Number(form.trialDays) || 15 } : {}),
      limits: { users: Number(form.users), branches: Number(form.branches), medicines: Number(form.medicines), desktopDevices: Number(form.desktopDevices), mobileDevices: Number(form.mobileDevices) },
      features: form.features, isPublic: form.isPublic, status: form.status
    };
    return run(
      () => (plan ? api.patch(`/platform/plans/${plan.key}`, body) : api.post('/platform/plans', { ...body, key: form.key, period: form.period })),
      () => { ok(plan ? 'Plan updated' : 'Plan created', form.name); onSaved(); }
    );
  };

  const groups = [...new Set(features.map((feature) => feature.group))];

  return (
    <Modal open={open} onClose={onClose} size="lg" icon={<CreditCard />} title={plan ? `Edit ${plan.name}` : 'New plan'}
      subtitle="Applies to new subscriptions and renewals. Pharmacies part-way through a paid period are not affected until they renew."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => { void save(); }} disabled={!form.name.trim()}>{plan ? 'Save plan' : 'Create plan'}</Button></>}>
      <div className="form-grid">
        <TextInput label="Name" required value={form.name} onChange={text('name')} />
        {plan
          ? <TextInput label="Key" value={form.key} disabled hint="Fixed once a plan exists." />
          : <TextInput label="Key" value={form.key} onChange={text('key')} hint="Short and unique, e.g. clinic-annual." />}
        <TextInput label="Tagline" wrapClass="span-2" value={form.tagline} onChange={text('tagline')} />
        <TextArea label="Description" wrapClass="span-2" value={form.description} onChange={text('description')} />
        <TextInput label="Price" prefix="Rs" type="number" min={0} value={form.price} onChange={text('price')} hint="0 makes the plan free." disabled={plan?.isDefault} />
        <SelectInput label="Billed every" value={form.period} onChange={text('period')} disabled={!!plan}
          options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'perpetual', label: 'Never (free for ever)' }]} />
        {plan?.isTrial
          ? <TextInput label="Free trial length" type="number" min={1} max={90} suffix="days" value={form.trialDays} onChange={text('trialDays')} hint="Every new pharmacy starts with this many days." />
          : (
            <>
              <TextInput label="Referral price" prefix="Rs" type="number" min={0} value={form.referralPrice} onChange={text('referralPrice')} hint="What a pharmacy that came through a referral pays. Empty for none." />
              <TextInput label="Periods a pharmacy may buy" type="number" min={0} max={120} value={form.maxCycles} onChange={text('maxCycles')} hint="0 for no limit. Monthly on the price sheet: 3." />
            </>
          )}
        <TextInput label="People" type="number" min={-1} value={form.users} onChange={text('users')} hint="-1 for unlimited." />
        <TextInput label="Branches" type="number" min={-1} value={form.branches} onChange={text('branches')} hint="-1 for unlimited." />
        <TextInput label="Medicines" type="number" min={-1} value={form.medicines} onChange={text('medicines')} hint="-1 for unlimited." />
        <TextInput label="Grace period" type="number" min={0} max={60} suffix="days" value={form.graceDays} onChange={text('graceDays')} />
        <TextInput label="Computers per person" type="number" min={1} value={form.desktopDevices} onChange={text('desktopDevices')} />
        <TextInput label="Phones per person" type="number" min={1} value={form.mobileDevices} onChange={text('mobileDevices')} />
      </div>

      <div className="mt-5">
        <div className="lbl mb-2">Features</div>
        {groups.map((group) => (
          <div key={group} className="mb-3">
            <div className="t-xs t-dim t-semi mb-2">{group}</div>
            <div className="check-grid">
              {features.filter((feature) => feature.group === group).map((feature) => (
                <Checkbox key={feature.key} label={feature.name} checked={form.features.includes(feature.key)} onChange={(on) => toggle(feature.key, on)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="row mt-4" style={{ gap: 24, flexWrap: 'wrap' }}>
        <Switch label="Show on the website and in Billing" checked={form.isPublic} onChange={(on) => setForm((current) => ({ ...current, isPublic: on }))} />
        <Switch label="On sale" checked={form.status !== 'retired'} disabled={plan?.isDefault} onChange={(on) => setForm((current) => ({ ...current, status: on ? 'active' : 'retired' }))} />
      </div>
      {plan?.isDefault && (
        <div className="mt-4"><Alert tone="info">This is the free trial every new pharmacy starts on, so it stays free and on sale. When it ends, the pharmacy is asked to choose a paid plan.</Alert></div>
      )}
    </Modal>
  );
}
