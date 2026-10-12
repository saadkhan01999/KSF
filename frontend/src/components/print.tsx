/* Printing an A4 document — a statement of accounts, a subscription invoice —
   as opposed to the till's 76 mm slip, which owns the default print rules.

   The sheet is rendered outside the application root, through a portal, so
   while it prints the whole app can be taken out of the layout and the sheet
   flows onto as many pages as it needs. On screen it is never shown. */

import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { BrandLogo } from './Brand';
import { dateTime } from '../utils/format';

/** Print the page's <PrintSheet> on A4. */
export function printSheet(): void {
  const root = document.documentElement;
  const page = document.createElement('style');
  page.textContent = '@page { size: A4; margin: 14mm; }';
  document.head.appendChild(page);
  root.dataset.print = 'sheet';
  const done = () => {
    root.removeAttribute('data-print');
    page.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/**
 * The printed document: a letterhead with the KSF mark and whose document it
 * is, then the content. `issuer` is the business named at the top right.
 */
export function PrintSheet({
  title, subtitle, issuer, children, footer
}: { title: string; subtitle?: ReactNode; issuer?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return createPortal(
    <section className="print-sheet" aria-hidden="true">
      <header className="ps-head">
        <BrandLogo size={30} tone="mono" />
        {issuer && <div className="ps-issuer">{issuer}</div>}
      </header>
      <h1 className="ps-title">{title}</h1>
      {subtitle && <p className="ps-sub">{subtitle}</p>}
      <div className="ps-body">{children}</div>
      <footer className="ps-foot">
        {footer}
        <span>Printed {dateTime(new Date().toISOString())} from KSF Pharmacy Management System</span>
      </footer>
    </section>,
    document.body
  );
}
