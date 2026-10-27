/* A hardware barcode scanner, anywhere on the screen.

   A USB or Bluetooth scanner types into whatever has the focus. On the till
   that might be the search box — or a quantity field, where "8964000111222"
   would become the quantity. So the keys are watched before anything else
   sees them (the capture phase on window): once ScanDetector is sure a
   scanner is typing, the rest of its keys are swallowed, the few that got
   through are taken back out of the field they landed in, and the code is
   handed to `onScan`. A person typing is never affected. */

import { useEffect, useRef } from 'react';
import { GS, SCAN_TIMING, ScanDetector } from '../utils/scanner';
import { wakeSound } from '../utils/beep';

type Field = HTMLInputElement | HTMLTextAreaElement;
const TEXT_INPUTS = new Set(['text', 'search', 'number', 'tel', 'email', 'url', 'password', '']);

const fieldOf = (target: EventTarget | null): Field | null => {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)) return target;
  return null;
};

/* Put a field back the way React expects: through the native setter, then an
   input event, so a controlled field's state follows. */
function restore(field: Field, value: string): void {
  if (field.value === value) return;
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const latest = useRef(onScan);
  latest.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;
    const detector = new ScanDetector();
    /* The field the first characters of a scan landed in, and what it held before. */
    let landed: { field: Field; value: string } | null = null;
    let quiet = 0;

    const finish = (code: string) => {
      if (landed) restore(landed.field, landed.value);
      landed = null;
      latest.current(code);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      /* The GS separator of a GS1 DataMatrix: Ctrl+] from most scanners. */
      const separator = event.key === GS || (event.ctrlKey && (event.key === ']' || event.code === 'BracketRight'));
      /* A scanner that types on the number pad with Num Lock off sends
         "End", "ArrowDown"…; the key's place still says which digit it is. */
      const pad = /^Numpad(\d)$/.exec(event.code);
      const key = separator ? GS : pad && event.key.length > 1 ? pad[1] : event.code === 'NumpadDecimal' && event.key.length > 1 ? '.' : event.key;
      const wasScan = detector.confirmed;
      const step = detector.key(key, performance.now(), (!separator && (event.ctrlKey || event.altKey || event.metaKey)) || event.repeat);
      if (step.kind === 'passive') return;
      window.clearTimeout(quiet);

      if (step.kind === 'start') {
        const field = fieldOf(event.target);
        landed = field ? { field, value: field.value } : null;
        /* A key press may start sound; the beep comes after the lookup. */
        wakeSound();
      }
      if (separator && step.kind !== 'ignore') event.preventDefault();
      if (step.kind === 'done' || (step.kind === 'collect' && step.confirmed)) {
        /* Ahead of every other listener, React's included. */
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (step.kind === 'done') { finish(step.code); return; }
      if (step.kind === 'ignore') {
        /* A scan cut short: take its first characters back out of the field too. */
        if (wasScan && landed) restore(landed.field, landed.value);
        landed = null;
        return;
      }

      /* A scanner that sends no Enter or Tab: the scan ends when it goes quiet. */
      quiet = window.setTimeout(() => {
        const code = detector.settle(performance.now());
        if (code) finish(code); else landed = null;
      }, SCAN_TIMING.endAfter + 10);
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(quiet);
    };
  }, [enabled]);
}
