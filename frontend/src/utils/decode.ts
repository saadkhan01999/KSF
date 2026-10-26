/* Reading barcodes from the camera or a photo, in every format a pack or a
   shop label uses: the linear ones (EAN-13, EAN-8, UPC-A, UPC-E, Code 128,
   Code 39, Code 93, Codabar, ITF, GS1 DataBar) and the 2D ones (QR,
   DataMatrix, PDF417, Aztec).

   The browser's own BarcodeDetector is used where it exists (Chrome on
   Android and macOS); everywhere else the ZXing decoder is loaded the first
   time it is needed, so the till itself stays light. */

interface NativeDetector { detect(source: CanvasImageSource | ImageBitmap): Promise<Array<{ rawValue: string; format?: string }>> }
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}
interface ZxingReader {
  decodeFromVideoElement(video: HTMLVideoElement, callback: (result: { getText(): string } | undefined) => void): Promise<{ stop(): void }>;
  decodeFromCanvas(canvas: HTMLCanvasElement): { getText(): string };
}

/** Every format the browser's detector may know, in its own names. */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code', 'data_matrix', 'pdf417', 'aztec'];

let native: Promise<NativeDetector | null> | null = null;
let zxing: Promise<ZxingReader> | null = null;

/** The browser's own detector with every format it supports, or null if it has none that reads EAN-13. */
export function nativeDetector(): Promise<NativeDetector | null> {
  native ??= (async () => {
    const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
    if (!Native) return null;
    const supported = await Native.getSupportedFormats?.().catch(() => [] as string[]) ?? [];
    const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
    return formats.includes('ean_13') ? new Native({ formats }) : null;
  })();
  return native;
}

/** ZXing, loaded on first use, reading every format it reads reliably. */
export function zxingReader(): Promise<ZxingReader> {
  zxing ??= (async () => {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
    const hints = new Map<unknown, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR, BarcodeFormat.ITF, BarcodeFormat.RSS_14,
        BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417, BarcodeFormat.AZTEC
      ]],
      [DecodeHintType.TRY_HARDER, true]
    ]);
    return new BrowserMultiFormatReader(hints as Map<never, unknown>, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 400 }) as unknown as ZxingReader;
  })();
  return zxing;
}

/** Starts reading codes off a playing video; returns how to stop. */
export async function decodeVideo(video: HTMLVideoElement, report: (code: string) => void): Promise<() => void> {
  const detector = await nativeDetector();
  if (detector) {
    let running = true;
    const look = async () => {
      if (!running) return;
      try {
        if (video.readyState >= 2) {
          const [found] = await detector.detect(video);
          if (found?.rawValue) report(found.rawValue);
        }
      } catch { /* a frame that could not be read */ }
      if (running) window.setTimeout(() => { void look(); }, 120);
    };
    void look();
    return () => { running = false; };
  }
  const controls = await (await zxingReader()).decodeFromVideoElement(video, (result) => { if (result) report(result.getText()); });
  return () => controls.stop();
}

/* A phone photo is 12 megapixels; a barcode reads as well, and far faster, at this size. */
const PHOTO_EDGE = 1600;

/** The code in a photo of a barcode, or null if none could be read. */
export async function decodePhoto(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const detector = await nativeDetector();
    if (detector) {
      const [found] = await detector.detect(canvas).catch(() => []);
      if (found?.rawValue) return found.rawValue;
    }
    try { return (await zxingReader()).decodeFromCanvas(canvas).getText() || null; } catch { return null; }
  } finally {
    bitmap.close();
  }
}
