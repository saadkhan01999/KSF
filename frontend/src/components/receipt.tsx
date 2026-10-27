/* ==========================================================================
   The till's receipt, on screen and on paper.
   --------------------------------------------------------------------------
   Sized for a 76 mm thermal roll, which is what almost every counter printer
   in Pakistan uses.

   On screen the slip sits inside a window (the till's "Sale completed", or
   an invoice in Sales history). A window is fixed to the screen and scrolls
   inside itself, so printing it printed only what fitted — the header, and
   none of the medicines or the total. So the slip is printed from a copy of
   its own, drawn outside the app (<ReceiptPrint>), which flows onto paper in
   full; printReceipt() sets the paper to the slip's exact length, so a roll
   printer neither cuts it short nor feeds blank paper after it.
   ========================================================================== */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { amount, date, payment } from '../utils/format';
import { BRAND } from '../brand';
import type { Sale } from '../types';

export function Receipt({ sale }: { sale: Sale }) {
  return (
    <div className="receipt">
      <h3>{sale.pharmacy?.name ?? 'KSF PHARMACY'}</h3>
      <div className="rc-sub">
        {[sale.pharmacy?.address, sale.pharmacy?.city].filter(Boolean).join(', ')}<br />
        {sale.pharmacy?.phone}<br />
        {sale.pharmacy?.ntn && <>NTN {sale.pharmacy.ntn} · </>}
        {sale.pharmacy?.drap_licence && <>Lic {sale.pharmacy.drap_licence}</>}
      </div>
      <hr />
      <div className="rc-line"><span>Invoice</span><span>{sale.invoice_no}</span></div>
      <div className="rc-line"><span>Date</span><span>{date(sale.sold_at)}</span></div>
      <div className="rc-line"><span>Served by</span><span>{sale.served_by_name}</span></div>
      <div className="rc-line"><span>Customer</span><span>{sale.customer_name || 'Walk-in'}</span></div>
      {sale.prescription_reference && (
        <div className="rc-line"><span>Prescription</span><span>{sale.prescription_reference}</span></div>
      )}
      <hr />
      {(sale.items ?? []).map((item) => (
        <div className="rc-item" key={item.id}>
          <div className="rc-name">{item.medicine_name}</div>
          <div className="rc-line">
            <span>{item.quantity} × {amount(item.unit_price_paisa)}</span>
            <span>{amount(item.line_total_paisa)}</span>
          </div>
          {/* Batch and expiry on the slip, so a return or a recall can be
              traced to the pack that was actually handed over. */}
          {(item.batch_no || item.expiry_date) && (
            <div className="rc-trace">
              {item.batch_no && <>B: {item.batch_no}</>}
              {item.batch_no && item.expiry_date && ' · '}
              {item.expiry_date && <>Exp {item.expiry_date.slice(5, 7)}/{item.expiry_date.slice(2, 4)}</>}
            </div>
          )}
        </div>
      ))}
      <hr />
      <div className="rc-line"><span>Subtotal</span><span>{amount(sale.subtotal_paisa)}</span></div>
      {sale.discount_paisa > 0 && <div className="rc-line"><span>Discount</span><span>-{amount(sale.discount_paisa)}</span></div>}
      {sale.gst_paisa > 0 && <div className="rc-line"><span>GST</span><span>{amount(sale.gst_paisa)}</span></div>}
      <div className="rc-line rc-total"><span>TOTAL</span><span>Rs {amount(sale.total_paisa)}</span></div>
      {sale.payment_method === 'credit' ? (
        <>
          <div className="rc-line"><span>On account (udhaar)</span><span>{amount(sale.total_paisa)}</span></div>
          {typeof sale.loyalty_points === 'number' && (
            <div className="rc-line"><span>Points</span><span>{sale.loyalty_points}</span></div>
          )}
        </>
      ) : (
        <>
          <div className="rc-line"><span>Paid ({payment(sale.payment_method)})</span><span>{amount(sale.paid_paisa)}</span></div>
          {sale.change_paisa > 0 && <div className="rc-line"><span>Change</span><span>{amount(sale.change_paisa)}</span></div>}
        </>
      )}
      <hr />
      <div className="rc-foot">
        {sale.footer}<br /><br />
        {BRAND.name} {BRAND.version}
      </div>
    </div>
  );
}

/**
 * The slip as it is printed: outside the app, hidden on screen. While it is
 * mounted, printing the page — the button, or Ctrl+P — prints the slip alone.
 */
export function ReceiptPrint({ sale }: { sale: Sale | null | undefined }) {
  useEffect(() => {
    if (!sale) return undefined;
    const root = document.documentElement;
    root.dataset.print = 'receipt';
    return () => { if (root.dataset.print === 'receipt') root.removeAttribute('data-print'); };
  }, [sale]);
  if (!sale) return null;
  return createPortal(<div className="receipt-print" aria-hidden="true"><Receipt sale={sale} /></div>, document.body);
}

/* The roll's width, and a little paper after the last line for the tear. */
const ROLL_MM = 76;
const TEAR_MM = 6;
const MM_PER_PX = 25.4 / 96;

/** Print the slip <ReceiptPrint> holds, on paper exactly as long as it is. */
export function printReceipt(): void {
  const holder = document.querySelector<HTMLElement>('.receipt-print');
  if (!holder) { window.print(); return; }
  /* Measure the slip as it will print: laid out at the roll's width, off screen. */
  holder.classList.add('is-measuring');
  const height = holder.getBoundingClientRect().height;
  holder.classList.remove('is-measuring');
  const page = document.createElement('style');
  page.textContent = `@page { size: ${ROLL_MM}mm ${Math.ceil(height * MM_PER_PX + TEAR_MM)}mm; margin: 0; }`;
  document.head.appendChild(page);
  document.documentElement.dataset.print = 'receipt';
  const done = () => {
    page.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
