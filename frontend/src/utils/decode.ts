/* Reading barcodes from the camera or a photo, in every format a pack or a
   shop label uses: the linear ones (EAN-13, EAN-8, UPC-A, UPC-E, Code 128,
   Code 39, Code 93, Codabar, ITF, GS1 DataBar) and the 2D ones (QR,
   DataMatrix, PDF417, Aztec).

   Two readers work at once, and the first to read a code wins:

     - the browser's own BarcodeDetector, where there is one (Chrome on
       Android and macOS), on the whole picture;
     - ZXing, in a worker so the camera never stutters, which looks at each
       frame a different way in turn — the whole frame; the scan area at the
       camera's full resolution; the middle of it enlarged twice over (a tiny
       barcode on a strip or a dropper bottle, far from the lens); turned a
       quarter turn (a barcode printed upright on a narrow pack); sharpened
       (faded or slightly blurred print); a second binariser for low
       contrast; and inverted, for light bars on a dark ground.

   Both are loaded only when the camera is first opened, so the till itself
   stays light. */

import type { DecodeAnswer, DecodeJob } from './decode.core';

interface NativeDetector { detect(source: CanvasImageSource | ImageBitmap): Promise<Array<{ rawValue: string; format?: string }>> }
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

/** A read: the code, and its format in BarcodeDetector's names when known. */
export interface Read { text: string; format: string | null }

/** Every format the browser's detector may know, in its own names. */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code', 'data_matrix', 'pdf417', 'aztec'];

let native: Promise<NativeDetector | null> | null = null;

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

/* ------------------------------------------------------------- the worker */

type Job = Omit<DecodeJob, 'id'>;
let worker: Worker | null = null;
let workerFailed = false;
let nextId = 0;
const waiting = new Map<number, (answer: DecodeAnswer) => void>();

function startWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DecodeAnswer>) => {
      waiting.get(event.data.id)?.(event.data);
      waiting.delete(event.data.id);
    };
    worker.onerror = () => {
      /* No worker here: decode on the main thread instead. */
      workerFailed = true;
      worker?.terminate();
      worker = null;
      for (const [id, answer] of waiting) answer({ id, text: null, format: null });
      waiting.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/** Decode one picture one way, in the worker if there is one. */
async function decode(job: Job): Promise<Read | null> {
  nextId += 1;
  const id = nextId;
  const running = startWorker();
  let answer: DecodeAnswer;
  if (running) {
    answer = await new Promise<DecodeAnswer>((resolve) => {
      waiting.set(id, resolve);
      running.postMessage({ ...job, id }, [job.pixels.buffer]);
    });
  } else {
    const { decodeJob } = await import('./decode.core');
    answer = decodeJob({ ...job, id });
  }
  return answer.text ? { text: answer.text, format: answer.format } : null;
}

/* --------------------------------------------------------- ways of looking */

interface Look {
  /** The whole picture, the scan area, or the very middle of it. */
  area: 'whole' | 'middle' | 'centre';
  /** Enlarge the area this many times (smoothly) before reading it. */
  zoom?: number;
  rotate?: boolean;
  invert?: boolean;
  binarizer?: 'hybrid' | 'global';
  sharpen?: number;
}

/* One per frame, in turn: a second or so sees every way. The likeliest come first. */
const LOOKS: Look[] = [
  { area: 'whole' },
  { area: 'middle' },
  { area: 'centre', zoom: 2 },
  { area: 'middle', rotate: true },
  { area: 'middle', sharpen: 1.5 },
  { area: 'whole', binarizer: 'global' },
  { area: 'middle', invert: true },
  { area: 'centre', zoom: 2, sharpen: 1.5 },
  { area: 'whole', rotate: true },
  { area: 'centre', zoom: 2, rotate: true },
  { area: 'middle', binarizer: 'global', sharpen: 1.5 }
];

/* The whole picture is read at up to this size; the scan area at the camera's
   own resolution, up to this size, so small bars keep their detail. */
const WHOLE_EDGE = 1280;
const MIDDLE_EDGE = 1600;

/** The pixels of `source` for one way of looking. */
function pixelsOf(source: CanvasImageSource, width: number, height: number, look: Look, canvas: HTMLCanvasElement): Job | null {
  /* The scan area: wide for a barcode lying down, tall for one standing up. */
  const SHARES: Record<Look['area'], [number, number]> = { whole: [1, 1], middle: look.rotate ? [0.5, 0.9] : [0.8, 0.55], centre: look.rotate ? [0.3, 0.6] : [0.5, 0.35] };
  const [shareW, shareH] = SHARES[look.area];
  const sw = Math.round(width * shareW);
  const sh = Math.round(height * shareH);
  const sx = Math.round((width - sw) / 2);
  const sy = Math.round((height - sh) / 2);
  const scale = Math.min(look.zoom ?? 1, (look.area === 'whole' ? WHOLE_EDGE : MIDDLE_EDGE) / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  canvas.width = dw;
  canvas.height = dh;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  const { data } = context.getImageData(0, 0, dw, dh);
  return { width: dw, height: dh, pixels: data, rotate: look.rotate, invert: look.invert, binarizer: look.binarizer ?? 'hybrid', sharpen: look.sharpen };
}

const pause = (ms: number) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

/** Starts reading codes off a playing video; returns how to stop. */
export async function decodeVideo(video: HTMLVideoElement, report: (read: Read) => void): Promise<() => void> {
  const detector = await nativeDetector();
  let running = true;

  if (detector) {
    void (async () => {
      while (running) {
        try {
          if (video.readyState >= 2) {
            const [found] = await detector.detect(video);
            if (running && found?.rawValue) report({ text: found.rawValue, format: found.format ?? null });
          }
        } catch { /* a frame that could not be read */ }
        await pause(90);
      }
    })();
  }

  const canvas = document.createElement('canvas');
  void (async () => {
    let turn = 0;
    while (running) {
      if (video.readyState >= 2 && video.videoWidth) {
        const job = pixelsOf(video, video.videoWidth, video.videoHeight, LOOKS[turn % LOOKS.length], canvas);
        turn += 1;
        const read = job ? await decode(job).catch(() => null) : null;
        if (running && read) report(read);
      }
      /* With the browser's detector at work too, ZXing can take its time. */
      await pause(detector ? 140 : 25);
    }
  })();

  return () => { running = false; };
}

/* A phone photo is 12 megapixels; a barcode reads as well, and far faster, at this size. */
const PHOTO_EDGE = 2000;

/** The code in a photo of a barcode, or null if none could be read every way there is. */
export async function decodePhoto(file: Blob): Promise<Read | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const picture = document.createElement('canvas');
    picture.width = Math.round(bitmap.width * scale);
    picture.height = Math.round(bitmap.height * scale);
    picture.getContext('2d')?.drawImage(bitmap, 0, 0, picture.width, picture.height);

    const detector = await nativeDetector();
    if (detector) {
      const [found] = await detector.detect(picture).catch(() => []);
      if (found?.rawValue) return { text: found.rawValue, format: found.format ?? null };
    }
    const canvas = document.createElement('canvas');
    for (const look of LOOKS) {
      const job = pixelsOf(picture, picture.width, picture.height, look, canvas);
      const read = job ? await decode(job).catch(() => null) : null;
      if (read) return read;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
