/* The moment a scan lands: a small card at the top of the till that says
   which medicine went in — or why it did not — for a couple of seconds, then
   slips away on its own. One at a time: the next scan replaces it.

   It is drawn on <body>, not inside the page (whose entrance animation would
   make "fixed" scroll with it), centred over the page's own column. */

import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ScanNote {
  /** A new id restarts the card, even for the same medicine. */
  id: number;
  tone: 'ok' | 'error';
  /** The medicine's name, or the code that was scanned. */
  title: string;
  /** One quiet line: strength, price, how many are in the sale — or the reason. */
  detail: string;
}

const SHOW_FOR = { ok: 2600, error: 3400 };
const LEAVE = 220;

export function ScanToast({ note, onDone }: { note: ScanNote | null; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [centre, setCentre] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!note) return;
    const column = document.querySelector('main.page')?.getBoundingClientRect();
    setCentre(column ? column.left + column.width / 2 : null);
  }, [note]);

  useEffect(() => {
    if (!note) return undefined;
    setLeaving(false);
    const leave = window.setTimeout(() => setLeaving(true), SHOW_FOR[note.tone]);
    const done = window.setTimeout(onDone, SHOW_FOR[note.tone] + LEAVE);
    return () => { window.clearTimeout(leave); window.clearTimeout(done); };
  }, [note, onDone]);

  if (!note) return null;
  const ok = note.tone === 'ok';
  return createPortal(
    <div
      key={note.id}
      style={centre === null ? undefined : { left: centre }}
      className={`scan-toast ${ok ? 'is-ok' : 'is-error'} ${leaving ? 'is-leaving' : ''}`}
      role={ok ? 'status' : 'alert'}
      onClick={() => setLeaving(true)}
    >
      <span className="scan-toast-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          {ok ? <path d="M7.5 12.5l3 3 6-6.5" /> : <path d="M8.5 8.5l7 7m0-7l-7 7" />}
        </svg>
      </span>
      <span className="scan-toast-body">
        <small>{ok ? 'Medicine selected' : 'Not added'}</small>
        <strong>{note.title}</strong>
        <span>{note.detail}</span>
      </span>
      <i className="scan-toast-time" style={{ animationDuration: `${SHOW_FOR[note.tone]}ms` }} aria-hidden="true" />
    </div>,
    document.body
  );
}
