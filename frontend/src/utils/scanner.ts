/* ==========================================================================
   Telling a barcode scanner from a person at the keyboard
   --------------------------------------------------------------------------
   A USB or Bluetooth scanner in keyboard mode "types" the code, a character
   every few milliseconds, and usually presses Enter at the end — some send
   Tab, some send nothing. Nobody keeps up 40 ms a key, so:

     - characters closer together than `maxGap` belong to one burst (a slow
       Bluetooth scanner can stutter, so this is generous);
     - a burst is a scanner once `confirmAfter` characters arrived at an
       average of `averageGap` or faster;
     - it ends at Enter or Tab, or after `endAfter` ms of quiet;
     - and it counts only if it is at least `minLength` characters long.

   Shift (which the scanner holds for capitals) never breaks a burst; a held
   key repeating, or a shortcut with Ctrl, Alt or Cmd, is never a scan. The
   GS separator inside a GS1 DataMatrix arrives as Ctrl+] from most
   scanners; useBarcodeScanner hands it over as the character itself.

   Pure: no DOM and no clock. useBarcodeScanner feeds it keys and the time.
   ========================================================================== */

export interface ScanTiming {
  /** The longest gap between two characters of one scan, in ms. */
  maxGap: number;
  /** The average gap, in ms, a burst must keep to be a scanner. */
  averageGap: number;
  /** Characters that must arrive that fast before it counts as a scanner. */
  confirmAfter: number;
  /** The shortest code accepted. */
  minLength: number;
  /** With no Enter or Tab at the end, a scan ends after this much quiet. */
  endAfter: number;
}

export const SCAN_TIMING: ScanTiming = { maxGap: 80, averageGap: 40, confirmAfter: 4, minLength: 4, endAfter: 110 };

/** The GS character (FNC1) that separates the fields of a GS1 code. */
export const GS = '\u001d';

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

/* Keys a scanner may press alongside the characters without ending a burst.
   A modifier on its own (the Ctrl of Ctrl+], the GS separator) changes
   nothing either: only a key pressed *with* it decides. */
const PASSIVE = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Fn', 'CapsLock', 'NumLock', 'Unidentified', 'Dead']);

export class ScanDetector {
  private buffer = '';
  private first = 0;
  private last = Number.NEGATIVE_INFINITY;
  private sure = false;

  constructor(private readonly timing: ScanTiming = SCAN_TIMING) {}

  /** Once sure, a burst stays the scanner's to its end. */
  get confirmed(): boolean {
    if (!this.sure && this.buffer.length >= this.timing.confirmAfter) {
      this.sure = (this.last - this.first) / (this.buffer.length - 1) <= this.timing.averageGap;
    }
    return this.sure;
  }

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
      const scanned = this.confirmed && code.length >= this.timing.minLength && gap <= this.timing.maxGap * 3;
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
    this.first = at;
    this.last = at;
    this.sure = false;
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
    this.first = 0;
    this.last = Number.NEGATIVE_INFINITY;
    this.sure = false;
  }
}

/* A GS1 code (the DataMatrix on a medicine pack), maybe with the scanner's
   "]d2" symbology prefix: the product number follows "01". */
const GS1 = /^(\][A-Za-z]\d)?\u001d?\(?01\)?\d{14}/;
/* A GS1 Digital Link in a QR code: a web address with /01/ and the product number. */
const DIGITAL_LINK = /^https?:\/\/[^\s]+\/(01|gtin)\/(\d{8}|\d{12,14})(\/|\?|$)/i;

/** A barcode, as opposed to a word typed into the search. */
export function looksLikeBarcode(code: string): boolean {
  const text = code.trim();
  if (/^\d{6,14}$/.test(text) || GS1.test(text) || DIGITAL_LINK.test(text)) return true;
  /* Code 128 and Code 39 labels: capitals, digits and a little punctuation. */
  return /^[A-Z0-9\-./]{6,}$/.test(text) && /\d/.test(text);
}

/** A code as a person reads it: the invisible GS separators as spaces. */
export const readable = (code: string): string => code.replace(/\u001d/g, ' ').trim();

/* ------------------------------------------------- believing a camera read
   A camera sees a barcode many times a second, at angles and in glare.
   Codes that carry a check digit or error correction (EAN, UPC, Code 128,
   GS1 DataBar, and every 2D code) are believed at the first read. The rest
   — Code 39, Code 93, Codabar, a short ITF — can be misread from a smudge, so
   they must read the same twice in a row before anything happens. */
const SELF_CHECKING = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'databar', 'qr_code', 'data_matrix', 'pdf417', 'aztec']);

/** The GS1 check digit of an EAN-8, UPC-A, EAN-13 or GTIN-14 is right. */
export function gtinValid(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export class ReadConfirmer {
  private last: { text: string; at: number } | null = null;

  constructor(private readonly within = 1500) {}

  /** Whether to act on this read now. */
  accept(text: string, format: string | null, at: number): boolean {
    if (!format || SELF_CHECKING.has(format) || (format === 'itf' && gtinValid(text))) { this.last = null; return true; }
    const again = !!this.last && this.last.text === text && at - this.last.at <= this.within;
    this.last = { text, at };
    return again;
  }
}
