/* Prescriptions.

   The workflow is deliberately narrow: Pending → Verified → Dispensed, with
   Rejected as the exit. Only a pharmacist can verify, and only a verified
   prescription can be dispensed against at the till. That single rule is what
   makes prescription-only medicine safe to stock. */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Stethoscope, Eye, Check, X, ClipboardCheck, Trash2, CircleAlert,
  UserRound, Building2, CalendarDays, PackageCheck
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { api, query } from '../services/api';
import {
  Button, SearchField, StatCard, StatusBadge, Modal, TextInput, TextArea,
  SelectInput, ConfirmDialog, EmptyState, TableSkeleton, Pager, Allow, Alert,
  Tabs, Badge
} from '../components/ui';
import { date, dateTime, number, todayIso } from '../utils/format';
import type { Customer, Medicine, Paged, Prescription } from '../types';

interface RxResponse extends Paged<Prescription> {
  counts: { pending: number; verified: number; dispensed: number; rejected: number };
}

interface DraftItem { key: number; medicineId: string; medicineText: string; dosage: string; duration: string; quantity: string }

let itemSeed = 0;
const newItem = (): DraftItem => ({ key: (itemSeed += 1), medicineId: '', medicineText: '', dosage: '', duration: '', quantity: '1' });

export default function Prescriptions() {
  const { ok } = useApp();
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();

  const [status, setStatus] = useState(params.get('status') ?? 'pending');
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Prescription | null>(null);
  const [verifying, setVerifying] = useState<Prescription | null>(null);

  const path = `/prescriptions${query({ status, q: search, page, size: 20 })}`;
  const { data, loading, reload } = useApiData<RxResponse>(path, [status, search, page]);
  const { data: detail } = useApiData<{ data: Prescription }>(viewing ? `/prescriptions/${viewing}` : null, [viewing]);

  useEffect(() => { setPage(1); }, [status, search]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (status !== 'pending') next.set('status', status);
    setParams(next, { replace: true });
  }, [status, setParams]);

  const counts = data?.counts;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Prescriptions</h1>
          <p className="sub">
            A pharmacist must verify a prescription before the till will dispense against it.
            That is what keeps prescription-only medicine controlled.
          </p>
        </div>
        <Allow permission="prescriptions.read">
          <div className="actions">
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setFormOpen(true)}>Record a prescription</Button>
          </div>
        </Allow>
      </div>

      <div className="grid grid-4 mb-5">
        <StatCard label="Waiting for a pharmacist" value={number(counts?.pending ?? 0)} icon={<CircleAlert size={20} />} tone="warn" onClick={() => setStatus('pending')} />
        <StatCard label="Verified, ready to dispense" value={number(counts?.verified ?? 0)} icon={<ClipboardCheck size={20} />} tone="info" onClick={() => setStatus('verified')} />
        <StatCard label="Dispensed" value={number(counts?.dispensed ?? 0)} icon={<PackageCheck size={20} />} onClick={() => setStatus('dispensed')} />
        <StatCard label="Rejected" value={number(counts?.rejected ?? 0)} icon={<X size={20} />} tone="danger" onClick={() => setStatus('rejected')} />
      </div>

      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'pending', label: 'Pending', count: counts?.pending },
          { value: 'verified', label: 'Verified', count: counts?.verified },
          { value: 'dispensed', label: 'Dispensed', count: counts?.dispensed },
          { value: 'rejected', label: 'Rejected', count: counts?.rejected },
          { value: 'all', label: 'All' }
        ]}
      />

      <div className="toolbar">
        <SearchField value={term} onChange={setTerm} placeholder="Search by reference, patient or doctor…" />
      </div>

      <div className="table-wrap">
        {loading
          ? <TableSkeleton columns={5} />
          : !data?.data.length
            ? (
              <EmptyState
                icon={<Stethoscope size={30} />}
                title={status === 'pending' ? 'Nothing waiting' : 'No prescriptions here'}
                message={status === 'pending'
                  ? 'Every prescription has been dealt with. Well done.'
                  : 'Try another tab, or record a new prescription.'}
              />
            )
            : (
              <>
                <div className="table-scroll">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Patient</th>
                        <th>Prescribed by</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((rx) => (
                        <tr key={rx.id}>
                          <td className="cell-title">
                            <span className="cell-main">{rx.reference}</span>
                            <div className="cell-sub">{date(rx.prescription_date)} · {rx.item_count} medicine{rx.item_count === 1 ? '' : 's'}</div>
                          </td>
                          <td data-label="Patient">
                            <div className="row-tight">
                              <span className="t-sm t-semi">{rx.patient_name || rx.customer_name || 'Patient'}</span>
                              {rx.allergies && <Badge tone="danger" dot={false}>Allergy</Badge>}
                            </div>
                            <div className="cell-sub">{rx.customer_phone || 'no phone on file'}</div>
                          </td>
                          <td data-label="Prescribed by">
                            <div className="t-sm">{rx.doctor_name}</div>
                            <div className="cell-sub">{rx.hospital || rx.pmdc_number || '—'}</div>
                          </td>
                          <td data-label="Status">
                            <StatusBadge status={rx.status} />
                            {rx.verified_by_name && <div className="cell-sub">by {rx.verified_by_name}</div>}
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions wrap" style={{ gap: 6 }}>
                              <button className="icon-btn" onClick={() => setViewing(rx.id)} aria-label="View prescription"><Eye size={17} /></button>
                              <Allow permission="prescriptions.verify">
                                {rx.status === 'pending' && (
                                  <>
                                    <button className="btn btn-primary btn-sm" onClick={() => setVerifying(rx)}>
                                      <Check size={14} /> Verify
                                    </button>
                                    <button className="btn btn-danger-soft btn-sm" onClick={() => setRejecting(rx)}>
                                      <X size={14} /> Reject
                                    </button>
                                  </>
                                )}
                              </Allow>
                              {rx.status === 'verified' && (
                                <Badge tone="info" dot={false}>Ready at the till</Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} />
              </>
            )}
      </div>

      <PrescriptionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void reload(true); }}
      />

      {/* ----------------------------- detail ----------------------------- */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        icon={<Stethoscope />}
        title={detail?.data?.reference ?? 'Prescription'}
        subtitle={detail?.data ? `${detail.data.patient_name} · ${date(detail.data.prescription_date)}` : ''}
        footer={<Button variant="outline" onClick={() => setViewing(null)}>Close</Button>}
      >
        {!detail?.data
          ? <TableSkeleton rows={5} columns={3} />
          : (
            <>
              {detail.data.allergies && (
                <div className="mb-4">
                  <Alert tone="danger" title="Patient allergies" icon={<CircleAlert />}>
                    {detail.data.allergies} — check every item on this prescription against it before verifying.
                  </Alert>
                </div>
              )}

              <div className="row-tight wrap mb-4">
                <StatusBadge status={detail.data.status} large />
                {detail.data.invoice_no && <Badge tone="ok" dot={false}>Dispensed on {detail.data.invoice_no}</Badge>}
              </div>

              <dl className="kv mb-5">
                <dt>Patient</dt><dd>{detail.data.patient_name}</dd>
                <dt>Registered as</dt><dd>{detail.data.customer_name || 'Not linked to a customer record'}</dd>
                <dt>Doctor</dt><dd>{detail.data.doctor_name}</dd>
                <dt>Hospital or clinic</dt><dd>{detail.data.hospital || '—'}</dd>
                <dt>PMDC number</dt><dd className="mono">{detail.data.pmdc_number || '—'}</dd>
                <dt>Prescribed on</dt><dd>{date(detail.data.prescription_date)}</dd>
                {detail.data.verified_at && (<><dt>Verified</dt><dd>{dateTime(detail.data.verified_at)} by {detail.data.verified_by_name}</dd></>)}
                {detail.data.dispensed_at && (<><dt>Dispensed</dt><dd>{dateTime(detail.data.dispensed_at)} by {detail.data.dispensed_by_name}</dd></>)}
              </dl>

              <h4 className="mb-3">What was prescribed</h4>
              <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr><th>Medicine</th><th>Dosage</th><th>Duration</th><th className="t-right">Qty</th><th className="t-right">In stock</th></tr>
                  </thead>
                  <tbody>
                    {(detail.data.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="cell-main">{item.medicine_text}</div>
                          {item.catalogue_name && item.catalogue_name !== item.medicine_text && (
                            <div className="cell-sub">matched to {item.catalogue_name}</div>
                          )}
                        </td>
                        <td className="t-sm">{item.dosage || '—'}</td>
                        <td className="t-sm">{item.duration || '—'}</td>
                        <td className="t-right num">{item.quantity}</td>
                        <td className="t-right">
                          {item.medicine_id
                            ? (
                              <span className={`t-semi num ${(item.on_hand ?? 0) <= 0 ? 't-danger' : ''}`}>
                                {number(item.on_hand ?? 0)}
                              </span>
                            )
                            : <span className="t-dim t-sm">not in catalogue</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.data.notes && (
                <div className="mt-4">
                  <div className="lbl mb-2">Notes</div>
                  <p className="t-sm t-soft" style={{ whiteSpace: 'pre-wrap' }}>{detail.data.notes}</p>
                </div>
              )}
            </>
          )}
      </Modal>

      <ConfirmDialog
        open={!!verifying}
        onCancel={() => setVerifying(null)}
        onConfirm={() => run(
          () => api.post(`/prescriptions/${verifying!.id}/verify`, {}),
          () => { setVerifying(null); ok('Prescription verified', 'It can now be dispensed at the till.'); void reload(true); }
        )}
        loading={busy}
        tone="warn"
        title="Verify this prescription?"
        confirmLabel="Yes, I have checked it"
        message={
          <>
            You are confirming, as a pharmacist, that prescription <b>{verifying?.reference}</b> is
            genuine, legible, correctly dosed and safe for this patient.
            {verifying?.allergies && (
              <span style={{ display: 'block', marginTop: 10, color: 'var(--danger-600)', fontWeight: 600 }}>
                Allergies on file: {verifying.allergies}
              </span>
            )}
            <span style={{ display: 'block', marginTop: 10 }}>
              Your name and the time are recorded against it permanently.
            </span>
          </>
        }
      />

      <ConfirmDialog
        open={!!rejecting}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => run(
          () => api.post(`/prescriptions/${rejecting!.id}/reject`, { reason }),
          () => { setRejecting(null); ok('Prescription rejected'); void reload(true); }
        )}
        loading={busy}
        requireReason
        reasonLabel="Why can it not be dispensed?"
        reasonHint="The patient may be shown this, so keep it clear and factual."
        title="Reject this prescription?"
        confirmLabel="Reject it"
        message={<>Prescription <b>{rejecting?.reference}</b> will be marked rejected and cannot be dispensed.</>}
      />
    </>
  );
}

/* ------------------------------- the form ------------------------------- */

function PrescriptionForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { ok } = useApp();
  const { busy, run } = useAction();

  const [customerId, setCustomerId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [hospital, setHospital] = useState('');
  const [pmdc, setPmdc] = useState('');
  const [rxDate, setRxDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([newItem()]);

  const { data: customers } = useApiData<Paged<Customer>>(open ? '/customers?size=200' : null, [open]);
  const { data: medicines } = useApiData<{ data: Medicine[] }>(open ? '/medicines-lookup' : null, [open]);

  useEffect(() => {
    if (!open) return;
    setCustomerId(''); setPatientName(''); setDoctorName(''); setHospital('');
    setPmdc(''); setRxDate(todayIso()); setNotes(''); setItems([newItem()]);
  }, [open]);

  /* Choosing a registered customer fills in the patient name. */
  useEffect(() => {
    const customer = customers?.data.find((c) => c.id === customerId);
    if (customer) setPatientName(customer.name);
  }, [customerId, customers]);

  const setItem = (key: number, patch: Partial<DraftItem>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const ready = !!doctorName.trim() && items.every((item) => item.medicineText.trim());

  const submit = () => run(
    () => api.post('/prescriptions', {
      customerId: customerId || undefined,
      patientName, doctorName, hospital, pmdcNumber: pmdc,
      prescriptionDate: rxDate, notes,
      items: items.map((item) => ({
        medicineId: item.medicineId || undefined,
        medicineText: item.medicineText,
        dosage: item.dosage,
        duration: item.duration,
        quantity: Number(item.quantity || 1)
      }))
    }),
    () => { ok('Prescription recorded', 'It is now waiting for a pharmacist to verify.'); onSaved(); }
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Stethoscope />}
      title="Record a prescription"
      subtitle="It will sit in the pending queue until a pharmacist verifies it."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!ready}>Save prescription</Button>
        </>
      }
    >
      <div className="form-grid mb-5">
        <SelectInput
          label="Registered customer"
          value={customerId} onChange={(e) => setCustomerId(e.target.value)}
          placeholder="Not a registered customer"
          options={(customers?.data ?? []).map((c) => ({ value: c.id, label: `${c.name}${c.phone ? ` — ${c.phone}` : ''}` }))}
          hint="Linking lets you see their allergies and history"
        />
        <TextInput
          label="Patient name" icon={<UserRound />}
          value={patientName} onChange={(e) => setPatientName(e.target.value)}
        />
        <TextInput
          label="Prescribing doctor" required placeholder="e.g. Dr. Farhan Siddiqui"
          value={doctorName} onChange={(e) => setDoctorName(e.target.value)}
        />
        <TextInput
          label="Hospital or clinic" icon={<Building2 />} placeholder="e.g. Aga Khan University Hospital"
          value={hospital} onChange={(e) => setHospital(e.target.value)}
        />
        <TextInput
          label="PMDC number" placeholder="e.g. PMDC-45219-S"
          hint="The doctor's registration number, printed on the prescription"
          value={pmdc} onChange={(e) => setPmdc(e.target.value)}
        />
        <TextInput
          label="Date on the prescription" type="date" icon={<CalendarDays />} max={todayIso()}
          value={rxDate} onChange={(e) => setRxDate(e.target.value)}
        />
      </div>

      <h4 className="mb-3">Medicines prescribed</h4>
      <div className="col" style={{ gap: 12 }}>
        {items.map((item, index) => (
          <div className="mini-card" key={item.key}>
            <div className="row-between mb-3">
              <span className="lbl">Medicine {index + 1}</span>
              {items.length > 1 && (
                <button
                  className="icon-btn" style={{ width: 30, height: 30 }}
                  onClick={() => setItems((current) => current.filter((i) => i.key !== item.key))}
                  aria-label={`Remove medicine ${index + 1}`}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <div className="form-grid">
              <SelectInput
                label="From the catalogue" className="span-2"
                value={item.medicineId}
                onChange={(e) => {
                  const medicine = medicines?.data.find((m) => m.id === e.target.value);
                  setItem(item.key, { medicineId: e.target.value, medicineText: medicine?.name ?? item.medicineText });
                }}
                placeholder="Not stocked — type the name below"
                options={(medicines?.data ?? []).map((m) => ({ value: m.id, label: `${m.name} — ${m.form}${m.strength ? ` ${m.strength}` : ''}` }))}
              />
              <TextInput
                label="As written on the prescription" required wrapClass="span-2"
                value={item.medicineText} onChange={(e) => setItem(item.key, { medicineText: e.target.value })}
              />
              <TextInput
                label="Dosage" placeholder="e.g. 1 tablet twice daily"
                value={item.dosage} onChange={(e) => setItem(item.key, { dosage: e.target.value })}
              />
              <TextInput
                label="Duration" placeholder="e.g. 7 days"
                value={item.duration} onChange={(e) => setItem(item.key, { duration: e.target.value })}
              />
              <TextInput
                label="Quantity" type="number" min={1}
                value={item.quantity} onChange={(e) => setItem(item.key, { quantity: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <Button variant="secondary" icon={<Plus size={17} />} className="mt-3" onClick={() => setItems((c) => [...c, newItem()])}>
        Add another medicine
      </Button>

      <TextArea
        label="Notes" className="mt-4"
        placeholder="Anything the pharmacist should know before verifying"
        value={notes} onChange={(e) => setNotes(e.target.value)}
      />
    </Modal>
  );
}
