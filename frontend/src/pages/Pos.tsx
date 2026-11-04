/* The till.

   Designed around what actually happens at a pharmacy counter: the customer
   is standing there, the queue is behind them, and the person serving may be
   using a phone, a tablet or a keyboard.

     - A USB or Bluetooth barcode scanner works wherever the cursor is, and
       the camera scans where there is no scanner (pages/pos/).
     - Tapping a card adds one; tapping again adds another.
     - Prescription-only medicine cannot be added without a verified
       prescription attached, and the card says so plainly.
     - Out-of-stock and expired stock never appear as sellable.
     - The running total is always visible, including on a phone.
     - After payment the receipt is on screen and one tap from the printer. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, User, Pill, Camera,
  Printer, CheckCircle2, Percent, ChevronRight, Stethoscope, PackageX, Lock, CircleAlert
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApiData, useDebounced, useAction } from '../hooks/useApi';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { api, query } from '../services/api';
import {
  Button, Modal, SelectInput, TextInput, EmptyState, Badge,
  Allow, Alert, Spinner, Segmented, Menu
} from '../components/ui';
import { rupees, toPaisa, date, inDays, payment, PAYMENT_LABELS, shortName } from '../utils/format';
import { beep } from '../utils/beep';
import { looksLikeBarcode } from '../utils/scanner';
import type { Medicine, Customer, Prescription, Sale, CartLine } from '../types';
import { CameraScanner } from './pos/CameraScanner';
import { ScannerPanel, type LastScan } from './pos/ScannerPanel';
import { UnknownBarcode, type UnknownCode } from './pos/UnknownBarcode';
import { ScanToast, type ScanNote } from './pos/ScanToast';
import { Receipt, ReceiptPrint, printReceipt } from '../components/receipt';

/** Where a code came from: typed and Enter, a hardware scanner, or the camera. */
type ScanSource = 'typed' | 'scanner' | 'camera';

interface ScanReply { data: Medicine[]; barcode?: string }
/** Why a medicine did not go in: in full for a message, briefly for the scan card. */
interface Refusal { message: string; short: string }

export default function Pos() {
  const { can, ok, fail, workspace, user, refreshWorkspace } = useApp();
  const { busy, run } = useAction();

  const [term, setTerm] = useState('');
  const search = useDebounced(term, 250);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [prescriptionId, setPrescriptionId] = useState('');
  /* The discount lives in the payment window, with a reason. */
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMode, setDiscountMode] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountNote, setDiscountNote] = useState('');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  /* The amount received follows the total until the cashier types their own. */
  const [tenderedTouched, setTenderedTouched] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [rxPickerOpen, setRxPickerOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const searchBox = useRef<HTMLInputElement>(null);

  const { data: catalogue, loading } = useApiData<{ data: Medicine[] }>(
    `/medicines-lookup${query({ q: search })}`, [search]
  );
  const { data: customers } = useApiData<{ data: Customer[] }>('/customers?size=200');
  const { data: verifiedRx } = useApiData<{ data: Prescription[] }>(
    can('prescriptions.read') ? '/prescriptions?status=verified&size=60' : null
  );

  /* The same array until the catalogue reloads, so the callbacks built on it stay stable. */
  const medicines = useMemo(() => catalogue?.data ?? [], [catalogue]);
  const customer = customers?.data.find((c) => c.id === customerId) ?? null;
  const prescription = verifiedRx?.data.find((r) => r.id === prescriptionId) ?? null;

  useEffect(() => { setMethod(workspace?.settings?.['pos.default_payment'] ?? 'cash'); }, [workspace]);

  /* Keep the caret in the search box: a barcode scanner is just a very fast
     keyboard, and it types wherever the focus happens to be. */
  const focusSearch = useCallback(() => {
    window.setTimeout(() => searchBox.current?.focus(), 30);
  }, []);
  useEffect(() => { focusSearch(); }, [focusSearch]);

  /* ------------------------------- cart ------------------------------- */
  /** Adds one, or says why not. `quiet` leaves the saying to the caller (a scan shows its own card). */
  const add = useCallback((medicine: Medicine, quiet = false): Refusal | null => {
    const refuse = (message: string, short: string): Refusal => {
      if (!quiet) fail(new Error(message));
      return { message, short };
    };
    if (medicine.on_hand <= 0) return refuse(`${medicine.name} is out of stock.`, 'Out of stock');
    if (medicine.requires_prescription && !prescriptionId) {
      setRxPickerOpen(true);
      return refuse(`${medicine.name} is prescription-only. Attach a verified prescription first.`, 'Prescription only: attach a verified prescription first');
    }
    const line = cart.find((l) => l.medicine.id === medicine.id);
    if (line && line.quantity >= medicine.on_hand) {
      return refuse(`Only ${medicine.on_hand} of ${medicine.name} left on the shelf.`, `Only ${medicine.on_hand} on the shelf, all in this sale`);
    }
    setCart((current) => (current.some((l) => l.medicine.id === medicine.id)
      ? current.map((l) => (l.medicine.id === medicine.id ? { ...l, quantity: l.quantity + 1 } : l))
      : [...current, { medicine, quantity: 1, unitPricePaisa: medicine.price_paisa }]));
    setJustAdded(medicine.id);
    window.setTimeout(() => setJustAdded(null), 700);
    setTerm('');
    focusSearch();
    return null;
  }, [cart, fail, prescriptionId, focusSearch]);

  /* The card at the top of the till after a scan: which medicine went in, or why not. */
  const [scanNote, setScanNote] = useState<ScanNote | null>(null);
  const noteId = useRef(0);
  const clearNote = useCallback(() => setScanNote(null), []);
  const announce = useCallback((tone: ScanNote['tone'], title: string, detail: string) => {
    noteId.current += 1;
    setScanNote({ id: noteId.current, tone, title, detail });
  }, []);
  const announceAdded = useCallback((medicine: Medicine, refusal: Refusal | null) => {
    if (refusal) { announce('error', medicine.name, refusal.short); return; }
    const inSale = (cart.find((l) => l.medicine.id === medicine.id)?.quantity ?? 0) + 1;
    announce('ok', medicine.name, [medicine.strength, rupees(medicine.price_paisa), `${inSale} in the sale`].filter(Boolean).join(' · '));
  }, [announce, cart]);

  /* ----------------------------- scanning -----------------------------
     A scanner is a very fast keyboard: it types the whole code and presses
     Enter, all inside a few milliseconds. The list on screen is debounced and
     is still showing the previous search at that moment, so "add the only
     visible match" is not good enough — on a busy counter it adds the wrong
     box. The code is resolved on the server instead, exactly.
     ------------------------------------------------------------------- */
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<LastScan | null>(null);
  /* The scanner button says "Added" or "Not added" for a moment after a scan. */
  const [flash, setFlash] = useState<'ok' | 'error' | null>(null);
  const flashTimer = useRef(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [unknown, setUnknown] = useState<UnknownCode | null>(null);

  const scan = useCallback(async (code: string, source: ScanSource = 'typed') => {
    const trimmed = code.trim();
    if (!trimmed) return;
    /* A scan answers with a sound, the card and the button; so does a barcode
       that arrived in the search box (typed, or from a scanner too slow to be
       told from typing). A word typed into the search does not need to. */
    const scanned = source !== 'typed' || looksLikeBarcode(trimmed);
    const record = (outcome: LastScan['outcome'], name?: string) => {
      setLastScan({ code: trimmed, at: new Date().toISOString(), outcome, name });
      if (!scanned) return;
      const good = outcome === 'added';
      /* The camera beeped the moment it read the code. */
      if (!(good && source === 'camera')) beep(good ? 'ok' : 'error');
      setFlash(good ? 'ok' : 'error');
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
    };
    setScanning(true);
    try {
      const found = await api.get<ScanReply>(`/medicines-scan${query({ code: trimmed })}`);
      const matches = found.data ?? [];
      if (matches.length === 1) {
        const [medicine] = matches;
        const refusal = add(medicine, scanned);
        record(refusal ? 'refused' : 'added', medicine.name);
        if (scanned) announceAdded(medicine, refusal);
        return;
      }
      if (matches.length > 1) {
        /* Two products sharing a code. Show them and let the person choose —
           picking one by sort order is how the wrong medicine gets sold. */
        record('several');
        if (!scanned) fail(new Error(`More than one medicine carries the code ${trimmed}. Pick the right one from the list and fix the duplicate in Medicines.`));
        else announce('error', `${matches.length} medicines share this barcode`, 'Pick the right one from the list, then fix the duplicate in Medicines');
        setTerm(found.barcode ?? trimmed);
        return;
      }
      /* Not a code we know. If a typed search has landed on exactly one
         medicine, that is what the person meant. */
      if (source === 'typed' && medicines.length === 1) { add(medicines[0]); return; }
      if (source !== 'typed' || looksLikeBarcode(trimmed)) {
        record('unknown');
        setCameraOpen(false);
        setUnknown({ code: trimmed, barcode: found.barcode ?? trimmed });
        return;
      }
      fail(new Error(
        medicines.length === 0
          ? `Nothing matches "${trimmed}". Check the spelling, or try the generic name.`
          : `"${trimmed}" is not a barcode in the catalogue. Tap the right medicine from the ${medicines.length} matches.`
      ));
    } catch (problem) {
      if (scanned) beep('error');
      fail(problem);
    } finally {
      setScanning(false);
    }
  }, [add, announce, announceAdded, fail, medicines]);

  /* A hardware scanner, wherever the cursor is. A scan after a finished sale
     starts the next one; while the payment window is open it is held back,
     so nothing is added to a sale that is being paid for. */
  const onHardwareScan = useCallback((code: string) => {
    if (payOpen) {
      beep('error');
      setLastScan({ code, at: new Date().toISOString(), outcome: 'busy' });
      announce('error', 'Payment in progress', 'Finish or close the payment first, then scan the next item');
      return;
    }
    setReceipt(null);
    setUnknown(null);
    setRxPickerOpen(false);
    void scan(code, 'scanner');
  }, [payOpen, announce, scan]);
  useBarcodeScanner(onHardwareScan);

  const setQuantity = (id: string, quantity: number) => {
    setCart((current) => current.flatMap((line) => {
      if (line.medicine.id !== id) return [line];
      if (quantity <= 0) return [];
      return [{ ...line, quantity: Math.min(quantity, line.medicine.on_hand) }];
    }));
  };

  const removeLine = (id: string) => setCart((current) => current.filter((l) => l.medicine.id !== id));
  const clearDiscount = () => {
    setDiscountOpen(false); setDiscountValue(''); setDiscountReason(''); setDiscountNote(''); setDiscountMode('percent');
  };
  const clearCart = () => { setCart([]); clearDiscount(); setPrescriptionId(''); setCustomerId(''); focusSearch(); };

  /* ------------------------------ totals ------------------------------ */
  const subtotal = useMemo(() => cart.reduce((sum, l) => sum + l.unitPricePaisa * l.quantity, 0), [cart]);

  /* Discount: a percentage of the sale or a rupee amount, never more than the
     sale itself. The till limit comes from Settings › Till; the server checks
     it again, so this is a courtesy to the cashier, not the control. */
  const discountLimit = Math.max(0, Number(workspace?.settings?.['pos.max_discount_percent'] ?? 10) || 0);
  const discountAllowedPaisa = Math.floor(subtotal * discountLimit / 100);
  const canOverride = can('pos.discount.override');
  const discountNumber = Math.max(0, Number(discountValue) || 0);
  const discountPaisa = Math.min(
    subtotal,
    discountMode === 'percent' ? Math.round(subtotal * Math.min(discountNumber, 100) / 100) : toPaisa(discountNumber)
  );
  const discountPercent = subtotal > 0 ? Math.round((discountPaisa / subtotal) * 1000) / 10 : 0;
  const discountOverLimit = discountPaisa > discountAllowedPaisa && !canOverride;
  const discountNeedsReason = discountPaisa > 0 && !discountReason;
  const discountNeedsNote = discountPaisa > 0 && discountReason === 'other' && !discountNote.trim();
  const discountBlocked = discountOverLimit || discountNeedsReason || discountNeedsNote;
  const reasonLabel = (key: string) => workspace?.discountReasons?.find((r) => r.value === key)?.label ?? key;
  const discountChips = [5, 10, 15, 20].filter((p) => canOverride || p <= discountLimit);
  const gstPaisa = useMemo(
    () => cart.reduce((sum, l) => sum + (l.medicine.gst_percent > 0
      ? Math.round(l.unitPricePaisa * l.quantity * l.medicine.gst_percent / 100) : 0), 0),
    [cart]
  );
  const total = subtotal - discountPaisa + gstPaisa;
  const tenderedPaisa = toPaisa(tendered || 0);
  const changePaisa = Math.max(0, tenderedPaisa - total);
  const shortfall = method !== 'credit' && tendered !== '' && tenderedPaisa < total;
  const units = cart.reduce((sum, l) => sum + l.quantity, 0);

  /* Cash rounding suggestions — the notes a Pakistani customer actually hands over. */
  const quickCash = useMemo(() => {
    const rupeesDue = Math.ceil(total / 100);
    const steps = [rupeesDue, Math.ceil(rupeesDue / 50) * 50, Math.ceil(rupeesDue / 100) * 100,
      Math.ceil(rupeesDue / 500) * 500, Math.ceil(rupeesDue / 1000) * 1000];
    return [...new Set(steps)].filter((v) => v > 0).slice(0, 4);
  }, [total]);

  /* ----------------------------- checkout ----------------------------- */
  const openPayment = () => {
    if (!cart.length) { fail(new Error('Add something to the sale first.')); return; }
    setTendered(method === 'cash' ? String(Math.ceil(total / 100)) : '');
    setTenderedTouched(false);
    setPayOpen(true);
  };

  /* While the payment window is open, a discount changes what is due; the
     amount received follows it until the cashier types a figure of their own. */
  useEffect(() => {
    if (payOpen && method === 'cash' && !tenderedTouched) setTendered(String(Math.ceil(total / 100)));
  }, [payOpen, method, total, tenderedTouched]);

  const completeSale = () => run(
    () => api.post<{ data: Sale }>('/sales', {
      items: cart.map((l) => ({ medicineId: l.medicine.id, quantity: l.quantity, unitPricePaisa: l.unitPricePaisa })),
      customerId: customerId || undefined,
      prescriptionId: prescriptionId || undefined,
      discountPaisa,
      discountReason: discountPaisa > 0 ? discountReason : undefined,
      discountNote: discountPaisa > 0 ? discountNote.trim() || undefined : undefined,
      paymentMethod: method,
      paidPaisa: method === 'credit' ? 0 : (tenderedPaisa || total)
    }),
    (result) => {
      setReceipt(result.data);
      setPayOpen(false);
      clearCart();
      void refreshWorkspace();
      ok(`Invoice ${result.data.invoice_no} completed`, `${rupees(result.data.total_paisa)} taken by ${payment(result.data.payment_method)}.`);
    }
  );

  /* Attaching a prescription may unlock items already refused. */
  useEffect(() => {
    if (prescription?.customer_id && !customerId) setCustomerId(prescription.customer_id);
  }, [prescription, customerId]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New sale</h1>
          <p className="sub">
            Search or scan a barcode to add items. Press <kbd style={{ padding: '2px 6px', border: '1px solid var(--line-strong)', borderRadius: 5, fontSize: 12 }}>F2</kbd> from anywhere to come back here.
          </p>
        </div>
        <div className="actions">
          {cart.length > 0 && (
            <Button variant="outline" icon={<Trash2 size={17} />} onClick={clearCart}>Clear sale</Button>
          )}
        </div>
      </div>

      <div className="pos">
        {/* ------------------------- catalogue ------------------------- */}
        <div className="pos-catalogue">
          <div className="pos-search">
            <Search />
            <input
              ref={searchBox}
              className="input"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                /* Enter is what a scanner sends at the end of a code, and
                   what a person presses after typing one. Same path. */
                if (e.key === 'Enter') { e.preventDefault(); void scan(term); }
              }}
              placeholder="Scan a barcode, or search by medicine or generic name…"
              aria-label="Scan a barcode or search medicines"
            />
            <div className="pos-search-tools">
              <button type="button" className="icon-btn pos-camera" onClick={() => setCameraOpen(true)} aria-label="Scan with the camera" title="Scan with the camera">
                <Camera size={19} />
              </button>
              <Menu
                panel label="Barcode scanner"
                trigger={({ toggle, props }) => (
                  <button type="button" className={`btn btn-quiet btn-sm scan ${flash ? `is-${flash}` : ''}`} onClick={toggle} {...props}>
                    {scanning ? <Spinner /> : <span className="scan-dot" aria-hidden="true" />}
                    <span className="scan-label">
                      {scanning ? 'Looking up…' : flash === 'ok' ? 'Added' : flash === 'error' ? 'Not added' : 'Scanner ready'}
                    </span>
                  </button>
                )}
              >
                {(close) => <ScannerPanel last={lastScan} onCamera={() => { close(); setCameraOpen(true); }} />}
              </Menu>
            </div>
          </div>

          {prescription && (
            <Alert tone="info" title={`Prescription ${prescription.reference} attached`}>
              Verified by {prescription.verified_by_name ?? 'a pharmacist'} · Dr {prescription.doctor_name}
              {prescription.allergies && (
                <span style={{ display: 'block', marginTop: 4, fontWeight: 700 }}>
                  ⚠ Patient allergies on file: {prescription.allergies}
                </span>
              )}
              <button
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => setPrescriptionId('')}
              >
                Remove prescription
              </button>
            </Alert>
          )}

          <div className="mt-4">
            {loading
              ? <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}><Spinner large /></div>
              : medicines.length === 0
                ? (
                  <EmptyState
                    icon={<Pill size={30} />}
                    title={term ? `Nothing found for “${term}”` : 'No medicines in the catalogue yet'}
                    message={term
                      ? 'Check the spelling, or try the generic name instead of the brand.'
                      : 'Add medicines to the catalogue before using the till.'}
                  />
                )
                : (
                  <div className="pos-grid">
                    {medicines.map((medicine) => {
                      const inCart = cart.find((l) => l.medicine.id === medicine.id);
                      const blocked = medicine.on_hand <= 0;
                      const needsRx = !!medicine.requires_prescription && !prescriptionId;
                      return (
                        <button
                          key={medicine.id}
                          className={`med-card ${blocked || needsRx ? 'is-blocked' : ''} ${justAdded === medicine.id ? 'is-added' : ''}`}
                          onClick={() => add(medicine)}
                          disabled={blocked}
                          title={needsRx ? 'Prescription-only — attach a verified prescription' : medicine.name}
                        >
                          {inCart && <span className="qty-flag">{inCart.quantity}</span>}
                          <span className="med-thumb">
                            {blocked ? <PackageX size={26} /> : needsRx ? <Lock size={24} /> : <Pill size={26} />}
                          </span>
                          <span className="name">{medicine.name}</span>
                          <span className="form">
                            {medicine.form}{medicine.strength ? ` · ${medicine.strength}` : ''}
                            {medicine.pack_size ? ` · ${medicine.pack_size}` : ''}
                          </span>
                          <span className="stock-line">
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%',
                              background: blocked ? 'var(--danger-500)'
                                : medicine.stock_state === 'low-stock' ? 'var(--warn-500)' : 'var(--ok-500)'
                            }} />
                            <span className={blocked ? 't-danger' : 't-soft'}>
                              {blocked ? 'Out of stock' : `${medicine.on_hand} in stock`}
                            </span>
                            {medicine.requires_prescription ? <Badge tone="purple" dot={false}>Rx</Badge> : null}
                          </span>
                          <span className="foot">
                            <span className="price">{rupees(medicine.price_paisa)}</span>
                            {!blocked && !needsRx && (
                              <span className="btn btn-primary btn-sm" style={{ pointerEvents: 'none' }}>
                                <Plus size={15} /> Add
                              </span>
                            )}
                            {needsRx && <span className="badge badge-purple">Needs Rx</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
          </div>
        </div>

        {/* ---------------------------- cart ---------------------------- */}
        <aside className="cart">
          <header className="cart-head">
            <div>
              <h3>Current sale</h3>
              <span className="count">{units} item{units === 1 ? '' : 's'} · served by {shortName(user?.fullName)}</span>
            </div>
            <ShoppingCart size={20} />
          </header>

          <div className="cart-customer">
            <div className="row-tight" style={{ gap: 8 }}>
              <User size={16} className="t-dim" />
              <select
                className="select"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                aria-label="Customer"
                style={{ minHeight: 38 }}
              >
                <option value="">Walk-in customer</option>
                {(customers?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` — ${c.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {customer && customer.allergies && (
              <div className="t-xs t-danger t-semi mt-2 row-tight">
                <CircleAlert size={13} /> Allergies: {customer.allergies}
              </div>
            )}
            {customer && customer.loyalty_points > 0 && (
              <div className="t-xs t-dim mt-2">{customer.loyalty_points} loyalty points on this account</div>
            )}
            <Allow permission="prescriptions.read">
              <button
                className="btn btn-quiet btn-sm btn-block mt-2"
                onClick={() => setRxPickerOpen(true)}
              >
                <Stethoscope size={15} />
                {prescription ? `Prescription ${prescription.reference}` : 'Attach a prescription'}
              </button>
            </Allow>
          </div>

          <div className="cart-items">
            {cart.length === 0
              ? (
                <div className="t-center t-dim" style={{ padding: '32px 12px' }}>
                  <ShoppingCart size={30} style={{ margin: '0 auto 10px', opacity: .35 }} />
                  <div className="t-sm">Nothing added yet.</div>
                  <div className="t-xs mt-2">Search above, or scan the barcode on the pack.</div>
                </div>
              )
              : cart.map((line) => (
                <div className="cart-line" key={line.medicine.id}>
                  <div className="info">
                    <strong>{line.medicine.name}</strong>
                    <span>{rupees(line.unitPricePaisa)} each · {line.medicine.form}</span>
                    <div className="row-tight mt-2" style={{ gap: 8 }}>
                      <div className="qty-stepper">
                        <button onClick={() => setQuantity(line.medicine.id, line.quantity - 1)} aria-label="One less">
                          <Minus size={14} />
                        </button>
                        <input
                          type="number"
                          value={line.quantity}
                          min={1}
                          max={line.medicine.on_hand}
                          onChange={(e) => setQuantity(line.medicine.id, Number(e.target.value))}
                          aria-label={`Quantity of ${line.medicine.name}`}
                        />
                        <button
                          onClick={() => setQuantity(line.medicine.id, line.quantity + 1)}
                          disabled={line.quantity >= line.medicine.on_hand}
                          aria-label="One more"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <button
                        className="icon-btn"
                        style={{ width: 32, height: 32 }}
                        onClick={() => removeLine(line.medicine.id)}
                        aria-label={`Remove ${line.medicine.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {line.quantity >= line.medicine.on_hand && (
                      <div className="t-xs t-warn t-semi mt-2">That is all the stock there is.</div>
                    )}
                  </div>
                  <span className="amount">{rupees(line.unitPricePaisa * line.quantity)}</span>
                </div>
              ))}
          </div>

          <div className="cart-totals">
            <div className="total-row"><span>Subtotal</span><span className="amt">{rupees(subtotal, { decimals: true })}</span></div>
            {/* The discount is given in the payment window, with a reason;
                here it is shown so the cart and the total agree. */}
            {discountPaisa > 0 && (
              <div className="total-row cart-discount">
                <span className="row-tight">
                  <Percent size={13} /> Discount{discountReason ? ` · ${reasonLabel(discountReason)}` : ''}
                </span>
                <span className="amt">−{rupees(discountPaisa, { decimals: true })}</span>
              </div>
            )}
            {gstPaisa > 0 && (
              <div className="total-row"><span>GST</span><span className="amt">{rupees(gstPaisa, { decimals: true })}</span></div>
            )}
            <div className="total-row grand">
              <span>Total</span>
              <span className="amt">{rupees(total)}</span>
            </div>
          </div>

          <div className="cart-actions">
            <Button
              variant="primary"
              size="lg"
              block
              disabled={cart.length === 0}
              icon={<CheckCircle2 size={20} />}
              onClick={openPayment}
            >
              Take payment · {rupees(total)}
            </Button>
          </div>
        </aside>
      </div>

      {/* A phone user always sees the running total, even while scrolling. */}
      {cart.length > 0 && (
        <div className="cart-sticky only-sm">
          <div>
            <small>{units} item{units === 1 ? '' : 's'}</small>
            <span className="amt">{rupees(total)}</span>
          </div>
          <Button variant="gold" onClick={openPayment} icon={<CheckCircle2 size={18} />}>Pay</Button>
        </div>
      )}

      {/* ---------------------------- payment ---------------------------- */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        size="sm"
        icon={<CheckCircle2 />}
        title="Take payment"
        subtitle={`${units} item${units === 1 ? '' : 's'} · ${customer?.name ?? 'Walk-in customer'}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Back</Button>
            <Button variant="primary" loading={busy} disabled={shortfall || discountBlocked} onClick={completeSale}>
              Complete sale
            </Button>
          </>
        }
      >
        <div className="mini-card mb-4 t-center">
          <div className="lbl">Amount due</div>
          {discountPaisa > 0 && (
            <div className="pay-was">{rupees(subtotal + gstPaisa)}</div>
          )}
          <div className="val" style={{ fontSize: 'var(--fs-3xl)', color: 'var(--brand-700)' }}>{rupees(total)}</div>
          {discountPaisa > 0 && (
            <div className={`pay-saving ${discountOverLimit ? 'is-over' : ''}`}>Discount {rupees(discountPaisa)} ({discountPercent}%)</div>
          )}
        </div>

        {/* ---------------------- discount ----------------------------- */}
        <Allow permission="pos.discount">
          {!discountOpen
            ? (
              <button type="button" className="pay-discount-open" onClick={() => setDiscountOpen(true)}>
                <Percent size={16} aria-hidden="true" /> Give a discount
                <span>family, a neighbour, a regular customer…</span>
              </button>
            )
            : (
              <section className="pay-discount" aria-label="Discount">
                <header>
                  <strong><Percent size={15} aria-hidden="true" /> Discount</strong>
                  <button type="button" className="link-button" onClick={clearDiscount}>Remove discount</button>
                </header>

                <div className="pay-discount-row">
                  <Segmented
                    label="Discount as a percentage or in rupees"
                    value={discountMode}
                    onChange={(next) => { setDiscountMode(next); setDiscountValue(''); }}
                    options={[{ value: 'percent', label: '%' }, { value: 'amount', label: 'Rs' }]}
                  />
                  <TextInput
                    label={discountMode === 'percent' ? 'Discount (%)' : 'Discount (Rs)'}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder="0"
                  />
                </div>

                {discountChips.length > 0 && (
                  <div className="row wrap" style={{ gap: 6 }}>
                    {discountChips.map((percent) => (
                      <button
                        key={percent}
                        type="button"
                        className={`chip ${discountMode === 'percent' && discountNumber === percent ? 'is-on' : ''}`}
                        onClick={() => { setDiscountMode('percent'); setDiscountValue(String(percent)); }}
                      >
                        {percent}%
                      </button>
                    ))}
                  </div>
                )}

                <SelectInput
                  label="Why is this discount being given?"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  placeholder="Choose a reason"
                  options={workspace?.discountReasons ?? []}
                  error={discountNeedsReason ? 'Choose a reason — your Admin sees every discount and why.' : undefined}
                />
                <TextInput
                  label={discountReason === 'other' ? 'Note (needed for "Other")' : 'Note (optional)'}
                  value={discountNote}
                  onChange={(e) => setDiscountNote(e.target.value)}
                  placeholder="e.g. Nadia's brother, or a dented box"
                  maxLength={140}
                  error={discountNeedsNote ? 'Write a few words saying why.' : undefined}
                />

                {discountOverLimit
                  ? (
                    <Alert tone="danger" title={`More than the ${discountLimit}% limit`}>
                      You can give up to {rupees(discountAllowedPaisa)} on this sale. Ask a manager to complete
                      a bigger discount.
                    </Alert>
                  )
                  : (
                    <p className="pay-discount-hint">
                      {canOverride
                        ? `You may go above the ${discountLimit}% till limit. Every discount is listed in Reports with your name and the reason.`
                        : `Up to ${discountLimit}% (${rupees(discountAllowedPaisa)} on this sale). Your name and the reason are saved with the invoice.`}
                    </p>
                  )}
              </section>
            )}
        </Allow>

        <SelectInput
          label="Payment method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          options={Object.entries(PAYMENT_LABELS)
            .filter(([key]) => key !== 'credit' || !!customerId)
            .map(([value, label]) => ({ value, label }))}
          hint={!customerId ? 'On-account sales need a registered customer.' : undefined}
        />

        {method !== 'credit' && (
          <>
            <div className="mt-4">
              <TextInput
                label="Amount received"
                type="number"
                inputMode="decimal"
                prefix="Rs"
                value={tendered}
                onChange={(e) => { setTendered(e.target.value); setTenderedTouched(true); }}
                error={shortfall ? `That is ${rupees(total - tenderedPaisa)} short of the total.` : undefined}
              />
            </div>
            {method === 'cash' && (
              <div className="row wrap mt-3" style={{ gap: 8 }}>
                {quickCash.map((value) => (
                  <button key={value} className="chip" onClick={() => { setTendered(String(value)); setTenderedTouched(true); }}>
                    Rs {value.toLocaleString('en-PK')}
                  </button>
                ))}
              </div>
            )}
            {changePaisa > 0 && (
              <div className="alert alert-ok mt-4">
                <CheckCircle2 />
                <div>
                  <strong>Change to give back</strong>
                  <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>{rupees(changePaisa, { decimals: true })}</span>
                </div>
              </div>
            )}
          </>
        )}

        {method === 'credit' && customer && (
          <Alert tone="warn" title="This will be added to the customer account">
            {customer.name} currently owes {rupees(customer.balance_paisa)}.
            {customer.credit_limit_paisa > 0 && ` Their limit is ${rupees(customer.credit_limit_paisa)}.`}
          </Alert>
        )}
      </Modal>

      {/* ------------------------ prescription picker ------------------------ */}
      <Modal
        open={rxPickerOpen}
        onClose={() => setRxPickerOpen(false)}
        size="lg"
        icon={<Stethoscope />}
        title="Attach a verified prescription"
        subtitle="Only prescriptions a pharmacist has already checked can be dispensed against."
        footer={<Button variant="outline" onClick={() => setRxPickerOpen(false)}>Close</Button>}
      >
        {(verifiedRx?.data ?? []).length === 0
          ? (
            <EmptyState
              icon={<Stethoscope size={30} />}
              title="No verified prescriptions waiting"
              message="A pharmacist needs to check the prescription on the Prescriptions screen before it can be dispensed."
            />
          )
          : (
            <div className="col" style={{ gap: 8 }}>
              {(verifiedRx?.data ?? []).map((rx) => (
                <button
                  key={rx.id}
                  className="pick-row"
                  onClick={() => { setPrescriptionId(rx.id); setRxPickerOpen(false); ok(`Prescription ${rx.reference} attached`); }}
                >
                  <span className="avatar sm"><Stethoscope size={14} /></span>
                  <span className="meta">
                    <strong>{rx.reference} · {rx.patient_name}</strong>
                    <span>Dr {rx.doctor_name}{rx.hospital ? ` · ${rx.hospital}` : ''} · {date(rx.prescription_date)}</span>
                  </span>
                  <ChevronRight className="pick-go" size={18} />
                </button>
              ))}
            </div>
          )}
      </Modal>

      {/* ----------------------------- receipt ----------------------------- */}
      <Modal
        open={!!receipt}
        onClose={() => { setReceipt(null); focusSearch(); }}
        size="sm"
        icon={<CheckCircle2 />}
        title="Sale completed"
        subtitle={receipt ? `Invoice ${receipt.invoice_no}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => { setReceipt(null); focusSearch(); }} className="no-print">
              Next customer
            </Button>
            <Button variant="primary" icon={<Printer size={17} />} onClick={printReceipt} className="no-print">
              Print receipt
            </Button>
          </>
        }
      >
        {receipt && <Receipt sale={receipt} />}
      </Modal>
      <ReceiptPrint sale={receipt} />

      {/* ----------------------------- scanning ----------------------------- */}
      <ScanToast note={scanNote} onDone={clearNote} />
      <CameraScanner
        open={cameraOpen}
        onClose={() => { setCameraOpen(false); focusSearch(); }}
        onCode={(code) => { void scan(code, 'camera'); }}
      />
      <UnknownBarcode
        unknown={unknown}
        onClose={() => { setUnknown(null); focusSearch(); }}
        onLinked={(medicine) => {
          setUnknown(null);
          const refusal = add(medicine, true);
          setLastScan({ code: medicine.barcode ?? '', at: new Date().toISOString(), outcome: refusal ? 'refused' : 'added', name: medicine.name });
          beep(refusal ? 'error' : 'ok');
          announceAdded(medicine, refusal);
        }}
      />
    </>
  );
}

/* Kept beside the receipt because both are about a single completed sale. */
export function expiryNote(expiry: string | null | undefined): string {
  if (!expiry) return '';
  const days = Math.ceil((new Date(`${expiry}T00:00:00Z`).getTime() - Date.now()) / 86400000);
  return `Expires ${inDays(days)}`;
}
