/* ==========================================================================
   Finishing the setup, after the account exists.
   --------------------------------------------------------------------------
   This is the other half of the shortened sign-up: everything the old
   eight-step wizard demanded before it would create anything is asked for
   here, where the person is already inside their own pharmacy and can see
   what the answers are for.

   Three properties matter more than the layout:

     - Every card can be skipped. Nothing on this screen blocks the till.
     - Progress is worked out from the records, not from a flag, so a
       percentage cannot drift away from the truth.
     - Leaving is free. Each card saves on its own, and the checklist is
       still under Settings afterwards.
   ========================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Check, Store, MapPin, FileBadge, Users, Package, CreditCard,
  PartyPopper, Clock
} from 'lucide-react';
import {
  Button, TextInput, SelectInput, Card, PageLoader, Alert
} from '../../components/ui';
import { StatusNote } from '../../components/account-ui';
import { useApp } from '../../context/AppContext';
import { api, ApiError } from '../../services/api';
import { BRAND } from '../../brand';
import type { SetupState } from '../../types';

const TYPE_LABEL: Record<string, string> = {
  retail: 'Retail pharmacy / medical store',
  chain: 'Chain of pharmacies',
  hospital: 'Hospital pharmacy',
  clinic: 'Clinic dispensary',
  wholesale: 'Wholesale / distribution',
  online: 'Online pharmacy',
  compounding: 'Compounding pharmacy'
};

const STEP_ICON: Record<string, React.ReactNode> = {
  pharmacy: <Store size={17} />,
  address: <MapPin size={17} />,
  licence: <FileBadge size={17} />,
  plan: <CreditCard size={17} />,
  staff: <Users size={17} />,
  medicines: <Package size={17} />
};

export default function Setup() {
  const navigate = useNavigate();
  const { ok, fail, refreshSession, live } = useApp();

  const [state, setState] = useState<SetupState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [identity, setIdentity] = useState({ name: '', type: 'retail' });
  const [place, setPlace] = useState({ address: '', city: '', province: 'Sindh', postcode: '', phone: '' });
  const [papers, setPapers] = useState({ drapLicence: '', ntn: '', registrationNo: '', website: '' });

  const adopt = useCallback((next: SetupState) => {
    setState(next);
    setIdentity({
      name: next.pharmacy.placeholderName ? '' : next.pharmacy.name,
      type: next.pharmacy.type || 'retail'
    });
    setPlace({
      address: next.pharmacy.address,
      city: next.pharmacy.city,
      province: next.pharmacy.province || 'Sindh',
      postcode: next.pharmacy.postcode,
      phone: next.pharmacy.phone
    });
    setPapers({
      drapLicence: next.pharmacy.drapLicence,
      ntn: next.pharmacy.ntn,
      registrationNo: next.pharmacy.registrationNo,
      website: next.pharmacy.website
    });
  }, []);

  /* Loaded again when the plans change, so the prices offered are the platform's current ones. */
  useEffect(() => {
    let live = true;
    api.get<{ data: SetupState }>('/setup/state')
      .then((reply) => { if (live) adopt(reply.data); })
      .catch((problem) => { if (live) fail(problem, 'The setup checklist could not be loaded.'); });
    return () => { live = false; };
  }, [adopt, fail, live.plans]);

  const save = async (what: string, path: string, body: unknown) => {
    setBusy(what);
    setErrors({});
    try {
      const reply = await api.post<{ data: SetupState; message?: string }>(path, body);
      adopt(reply.data);
      ok(reply.message ?? 'Saved');
      /* The pharmacy's name is in the session payload, so the sidebar and the
         receipt header would otherwise keep the placeholder until a reload. */
      if (what === 'pharmacy') void refreshSession();
    } catch (problem) {
      if (problem instanceof ApiError && problem.field) setErrors({ [problem.field]: problem.message });
      else fail(problem);
    } finally {
      setBusy(null);
    }
  };

  const later = async () => {
    try {
      await api.post('/setup/dismiss', { dismissed: true });
      ok('Put away for now', 'The checklist is still under Settings whenever you want it.');
      navigate('/dashboard');
    } catch (problem) {
      fail(problem);
    }
  };

  if (!state) return <PageLoader message="Opening your setup checklist…" />;

  const typeOptions = state.options.types.map((value) => ({ value, label: TYPE_LABEL[value] ?? value }));
  const provinceOptions = state.options.provinces.map((value) => ({ value, label: value }));
  /* The percentage counts required steps only, so the caption under it has to
     as well — otherwise the ring reads 100% next to the words "1 thing left". */
  const outstanding = state.steps.filter((step) => !step.done && !step.optional);
  const optionalLeft = state.steps.filter((step) => !step.done && step.optional).length;

  return (
    <div className="setup">
      <header className="setup-head">
        <div>
          <span className="eyebrow">Welcome to {BRAND.name}</span>
          <h1>{state.complete ? 'Your pharmacy is set up' : 'Finish setting up your pharmacy'}</h1>
          <p>
            {state.complete
              ? 'Everything required is in place. The optional items below are here whenever you want them.'
              : 'None of this blocks the till — you can sell today and come back to it. Each card saves on its own.'}
          </p>
        </div>

        <div className="setup-progress" role="group" aria-label="Setup progress">
          <div className="setup-ring" style={{ '--percent': `${state.percent}` } as React.CSSProperties}>
            <span>{state.percent}%</span>
          </div>
          <p>
            {outstanding.length > 0
              ? `${outstanding.length} thing${outstanding.length === 1 ? '' : 's'} left`
              : optionalLeft > 0
                ? `${optionalLeft} optional left`
                : 'Nothing outstanding'}
          </p>
        </div>
      </header>

      {state.complete && (
        <Alert tone="ok" title="That is everything" icon={<PartyPopper size={18} />}>
          Your pharmacy is ready to trade. Open the till from the sidebar, or take a look at the
          dashboard.
        </Alert>
      )}

      {/* --------------------------- the checklist ---------------------- */}
      <ol className="setup-checklist">
        {state.steps.map((step) => (
          <li key={step.key} className={step.done ? 'is-done' : ''}>
            <span className="setup-tick" aria-hidden="true">
              {step.done ? <Check size={14} /> : STEP_ICON[step.key]}
            </span>
            <div>
              <strong>
                {step.label}
                {step.optional && <span className="setup-optional">optional</span>}
              </strong>
              <span>{step.note}</span>
            </div>
            <span className="setup-state">{step.done ? 'Done' : 'To do'}</span>
          </li>
        ))}
      </ol>

      {/* ------------------------------ identity ------------------------ */}
      <Card
        title="Name your pharmacy"
        subtitle="This appears on every receipt, report and e-mail your customers see."
        icon={<Store size={18} />}
      >
        <form
          className="setup-form"
          onSubmit={(event) => { event.preventDefault(); void save('pharmacy', '/setup/pharmacy', identity); }}
        >
          <TextInput
            label="Pharmacy name" required autoFocus
            placeholder="Al-Shifa Medical Store"
            value={identity.name} error={errors.name}
            onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
          />
          <SelectInput
            label="What kind of pharmacy is it?" required
            options={typeOptions} value={identity.type} error={errors.type}
            onChange={(e) => setIdentity({ ...identity, type: e.target.value })}
          />
          <div className="setup-actions">
            <Button type="submit" variant="primary" loading={busy === 'pharmacy'} disabled={!identity.name}>
              Save the name
            </Button>
          </div>
        </form>
      </Card>

      {/* ------------------------------- place -------------------------- */}
      <Card
        title="Where you are"
        subtitle="Printed on receipts, and used on returns to your suppliers."
        icon={<MapPin size={18} />}
      >
        <form
          className="setup-form"
          onSubmit={(event) => { event.preventDefault(); void save('address', '/setup/address', place); }}
        >
          <TextInput
            label="Street address" required
            value={place.address} error={errors.address}
            onChange={(e) => setPlace({ ...place, address: e.target.value })}
          />
          <div className="grid-3">
            <TextInput
              label="City" required value={place.city} error={errors.city}
              onChange={(e) => setPlace({ ...place, city: e.target.value })}
            />
            <SelectInput
              label="Province" options={provinceOptions} value={place.province} error={errors.province}
              onChange={(e) => setPlace({ ...place, province: e.target.value })}
            />
            <TextInput
              label="Postcode" value={place.postcode} error={errors.postcode}
              onChange={(e) => setPlace({ ...place, postcode: e.target.value })}
            />
          </div>
          <TextInput
            label="Telephone" required inputMode="tel" placeholder="021 34567890"
            hint="The number customers and suppliers should call."
            value={place.phone} error={errors.phone}
            onChange={(e) => setPlace({ ...place, phone: e.target.value })}
          />
          <div className="setup-actions">
            <Button type="submit" variant="primary" loading={busy === 'address'}>
              Save the address
            </Button>
          </div>
        </form>
      </Card>

      {/* ------------------------------ papers -------------------------- */}
      <Card
        title="Licence and tax details"
        subtitle="Optional here, and required on receipts in some cities. You can add them any time."
        icon={<FileBadge size={18} />}
      >
        <form
          className="setup-form"
          onSubmit={(event) => { event.preventDefault(); void save('licence', '/setup/licence', papers); }}
        >
          <div className="grid-2">
            <TextInput
              label="DRAP licence number" value={papers.drapLicence}
              onChange={(e) => setPapers({ ...papers, drapLicence: e.target.value })}
            />
            <TextInput
              label="NTN" value={papers.ntn}
              onChange={(e) => setPapers({ ...papers, ntn: e.target.value })}
            />
            <TextInput
              label="Business registration number" value={papers.registrationNo}
              onChange={(e) => setPapers({ ...papers, registrationNo: e.target.value })}
            />
            <TextInput
              label="Website" placeholder="https://" value={papers.website} error={errors.website}
              onChange={(e) => setPapers({ ...papers, website: e.target.value })}
            />
          </div>
          <div className="setup-actions">
            <Button type="submit" variant="primary" loading={busy === 'licence'}>Save these</Button>
          </div>
        </form>
      </Card>

      {/* ---------------------------- what next ------------------------- */}
      <Card title="Then the parts that make it yours" icon={<ArrowRight size={18} />}>
        <div className="setup-next">
          <Link to="/settings?tab=migration" className="setup-next-card">
            <span aria-hidden="true"><Package size={20} /></span>
            <strong>Bring your medicines across</strong>
            <span>A CSV or Excel export from your old system. Nothing is written until you have seen it.</span>
          </Link>
          <Link to="/staff" className="setup-next-card">
            <span aria-hidden="true"><Users size={20} /></span>
            <strong>Add your staff</strong>
            <span>Each person gets their own account, so every sale has a name against it.</span>
          </Link>
          <Link to="/settings?tab=billing" className="setup-next-card">
            <span aria-hidden="true"><CreditCard size={20} /></span>
            <strong>Choose a plan</strong>
            <span>You are on the 15-day free trial. Choose Monthly or Yearly before it ends — nothing is charged until a payment is confirmed.</span>
          </Link>
        </div>
      </Card>

      <StatusNote tone="info" icon={<Clock size={17} />} title="You can leave this and come back">
        Everything you have saved stays saved. The checklist lives under Settings, and the
        dashboard keeps a quiet reminder until the required parts are done.
      </StatusNote>

      <div className="setup-foot">
        <Button variant="ghost" onClick={() => { void later(); }}>Continue later</Button>
        <Button variant="primary" onClick={() => navigate('/dashboard')} iconRight={<ArrowRight size={16} />}>
          Go to the dashboard
        </Button>
      </div>
    </div>
  );
}
