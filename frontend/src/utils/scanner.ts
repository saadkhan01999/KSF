/* ==========================================================================
   Telling a barcode scanner from a person at the keyboard
   --------------------------------------------------------------------------
   A USB or Bluetooth scanner in keyboard mode "types" the code, a character
   every few milliseconds, and usually presses Enter at the end — some send
   Tab, some send nothing. Nobody types four characters 50 ms apart, so:

     - characters closer together than `maxGap` belong to one burst;
     - a burst is a scanner once `confirmAfter` characters arrived that fast;
     - it ends at Enter or Tab, or after `endAfter` ms of quiet;
     - and it counts only if it is at least `minLength` characters long.

   Shift (which the scanner holds for capitals) never breaks a burst; a held
   key repeating, or a shortcut with Ctrl, Alt or Cmd, is never a scan.

   Pure: no DOM and no clock. useBarcodeScanner feeds it keys and the time.
   ========================================================================== */

export interface ScanTiming {
  /** The longest gap between two characters of one scan, in ms. */
  maxGap: number;
  /** Characters that must arrive that fast before it counts as a scanner. */
  confirmAfter: number;
  /** The shortest code accepted. */
  minLength: number;
  /** With no Enter or Tab at the end, a scan ends after this much quiet. */
  endAfter: number;
}

export const SCAN_TIMING: ScanTiming = { maxGap: 50, confirmAfter: 4, minLength: 4, endAfter: 100 };

export type ScanStep =
  /** Shift and the like: changes nothing. */
  | { kind: 'passive' }
  /** Not part of a scan: let the key through. */
  | { kind: 'ignore' }
  /** The first character of what may be a scan. */
  | { kind: 'start' }
  /** More of a burst; once `confirmed`, the key belongs to the scanner. */
  | { kind: 'collect'; confirmed: boolean }
  /** Enter or Tab ended a scan: the key belongs to the scanner too. */
  | { kind: 'done'; code: string };

/* Keys a scanner may press alongside the characters without ending a burst. */
const PASSIVE = new Set(['Shift', 'CapsLock', 'NumLock', 'Unidentified', 'Dead']);

export class ScanDetector {
  private buffer = '';
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly timing: ScanTiming = SCAN_TIMING) {}

  /** Only characters that came within `maxGap` of each other stay in the buffer. */
  get confirmed(): boolean { return this.buffer.length >= this.timing.confirmAfter; }

  /**
   * One keydown. `held` is true for a shortcut (Ctrl, Alt or Cmd) or a key
   * repeating because it is held down.
   */
  key(key: string, at: number, held = false): ScanStep {
    if (PASSIVE.has(key)) return { kind: 'passive' };
    if (held) { this.reset(); return { kind: 'ignore' }; }

    const gap = at - this.last;
    if (key === 'Enter' || key === 'Tab') {
      const code = this.buffer;
      /* Some scanners pause a little before the suffix. */
      const scanned = this.confirmed && code.length >= this.timing.minLength && gap <= this.timing.maxGap * 4;
      this.reset();
      return scanned ? { kind: 'done', code } : { kind: 'ignore' };
    }
    /* Arrows, Backspace, F-keys: a person is at the keyboard. */
    if (key.length !== 1) { this.reset(); return { kind: 'ignore' }; }

    if (this.buffer && gap <= this.timing.maxGap) {
      this.buffer += key;
      this.last = at;
      return { kind: 'collect', confirmed: this.confirmed };
    }
    this.buffer = key;
    this.last = at;
    return { kind: 'start' };
  }

  /** After a quiet spell: the end of a scan from a scanner that sends no suffix. */
  settle(at: number): string | null {
    if (!this.buffer || at - this.last < this.timing.endAfter) return null;
    const code = this.confirmed && this.buffer.length >= this.timing.minLength ? this.buffer : null;
    this.reset();
    return code;
  }

  reset(): void {
    this.buffer = '';
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/* A GS1 code (the DataMatrix on a medicine pack), maybe with the scanner's
   "]d2" symbology prefix: the product number follows "01". */
const GS1 = /^(\][A-Za-z]\d)?\(?01\)?\d{14}/;

/** A barcode, as opposed to a word typed into the search. */
export function looksLikeBarcode(code: string): boolean {
  const text = code.trim();
  if (/^\d{6,14}$/.test(text) || GS1.test(text)) return true;
  /* Code 128 and Code 39 labels: capitals, digits and a little punctuation. */
  return /^[A-Z0-9\-./]{6,}$/.test(text) && /\d/.test(text);
}
