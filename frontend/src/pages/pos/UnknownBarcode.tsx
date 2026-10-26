/* A barcode the catalogue does not know yet. Usually the medicine is there —
   it was added by name, without its barcode — so the quickest fix is to say
   which one it is: the code is saved on that medicine (the next scan finds it
   straight away) and the pack goes into the sale. A medicine the pharmacy
   has never had opens in a new tab — filled in from what KSF knows about the
   barcode — so the sale on the till is not lost. */

import { useEffect, useState } from 'react';
import { Barcode, ExternalLink, Link2, PackagePlus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAction, useApiData, useDebounced } from '../../hooks/useApi';
import { api, query } from '../../services/api';
import { Alert, Button, Modal, SearchField, Spinner } from '../../components/ui';
import { rupees } from '../../utils/format';
import type { Medicine } from '../../types';
import { productLine, type BarcodeInfo } from '../../utils/barcodeInfo';

export interface UnknownCode { code: string; barcode: string }

export function UnknownBarcode({ unknown, onClose, onLinked }: { unknown: UnknownCode | null; onClose: () => void; onLinked: (medicine: Medicine) => void }) {
  const { ok, can } = useApp();
  const { busy, run } = useAction();
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const canLink = can('medicines.write');
  useEffect(() => { setTerm(''); }, [unknown]);

  const { data, loading } = useApiData<{ data: Medicine[] }>(
    unknown && canLink ? `/medicines-lookup${query({ q: search })}` : null, [unknown, search]
  );
  /* What KSF knows about the pack, for adding it as a new medicine. */
  const { data: info } = useApiData<BarcodeInfo>(
    unknown && canLink ? `/medicines-barcode-info${query({ code: unknown.code })}` : null, [unknown]
  );
  const known = info?.fields && info.code === unknown?.code.trim() ? info : null;

  const link = (medicine: Medicine) => run(
    () => api.patch(`/medicines/${medicine.id}`, { barcode: unknown!.barcode }),
    () => {
      ok('Barcode saved', `${medicine.name} now scans as ${unknown!.barcode}.`);
      onLinked({ ...medicine, barcode: unknown!.barcode });
    }
  );

  const addNew = () => window.open(`/medicines?barcode=${encodeURIComponent(unknown?.barcode ?? '')}`, '_blank', 'noopener');

  return (
    <Modal
      open={!!unknown} onClose={onClose} size="md" icon={<Barcode />}
      title="This barcode is not in your catalogue"
      subtitle={unknown ? <>Scanned <code className="mono">{unknown.barcode}</code></> : undefined}
      footer={(
        <>
          {canLink && !known && <Button variant="outline" icon={<ExternalLink size={16} />} onClick={addNew}>Add as a new medicine</Button>}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      )}
    >
      {!canLink ? (
        <Alert tone="info" title="Ask someone who manages medicines">
          Your role cannot change the catalogue. Ask your Admin or manager to add this barcode to the medicine in Medicines; after
          that it scans straight into the sale.
        </Alert>
      ) : (
        <>
          {known?.fields && (
            <div className="pack-found">
              <span className="pack-found-icon" aria-hidden="true"><PackagePlus size={20} /></span>
              <div className="grow">
                <small>KSF knows this pack</small>
                <strong>{known.fields.name}</strong>
                {productLine(known.fields) && <span>{productLine(known.fields)}</span>}
              </div>
              <Button variant="primary" size="sm" icon={<ExternalLink size={15} />} onClick={addNew}>Add with these details</Button>
            </div>
          )}
          <p className="t-sm t-soft mb-3">
            {known ? 'Or, if you stock it already under another name, choose it' : 'Which medicine is it? Choose it once'} — the barcode is saved on it, and the pack goes into the sale.
          </p>
          <SearchField value={term} onChange={setTerm} placeholder="Find the medicine by name or generic name…" autoFocus />
          <ul className="link-list" aria-busy={loading || undefined}>
            {loading && !data ? <li className="link-empty"><Spinner /></li> : null}
            {data?.data.length === 0 && <li className="link-empty">Nothing matches. Try another name, or add it as a new medicine.</li>}
            {data?.data.slice(0, 8).map((medicine) => (
              <li key={medicine.id}>
                <button type="button" onClick={() => { void link(medicine); }} disabled={busy}>
                  <span className="grow">
                    <strong>{medicine.name}</strong>
                    <small>
                      {[medicine.form, medicine.strength].filter(Boolean).join(' · ')} · {rupees(medicine.price_paisa)} · {medicine.on_hand} in stock
                      {medicine.barcode ? ` · replaces ${medicine.barcode}` : ''}
                    </small>
                  </span>
                  <Link2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
