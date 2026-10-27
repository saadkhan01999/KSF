/* The barcode decoder itself (ZXing), for one picture and one way of looking
   at it — the whole frame, or the scan area at full camera resolution, turned
   sideways, inverted, or binarised another way. It runs in a worker
   (decode.worker.ts) so the camera view never stutters, and on the main
   thread only if a worker cannot start. */

import {
  BarcodeFormat, BinaryBitmap, DecodeHintType, GlobalHistogramBinarizer, HybridBinarizer, MultiFormatReader, RGBLuminanceSource
} from '@zxing/library';

export interface DecodeJob {
  id: number;
  width: number;
  height: number;
  /** RGBA pixels, as from getImageData. */
  pixels: Uint8ClampedArray;
  /** Read it turned a quarter turn: a barcode printed upright on a narrow pack. */
  rotate?: boolean;
  /** Light bars on a dark ground. */
  invert?: boolean;
  /** The global binariser copes better with some soft, low-contrast prints. */
  binarizer?: 'hybrid' | 'global';
  /** Sharpen across the bars (after any turn): faded or slightly blurred print. */
  sharpen?: number;
}

export interface DecodeAnswer { id: number; text: string | null; format: string | null }

const FORMAT_NAMES: Partial<Record<BarcodeFormat, string>> = {
  [BarcodeFormat.EAN_13]: 'ean_13', [BarcodeFormat.EAN_8]: 'ean_8', [BarcodeFormat.UPC_A]: 'upc_a', [BarcodeFormat.UPC_E]: 'upc_e',
  [BarcodeFormat.CODE_128]: 'code_128', [BarcodeFormat.CODE_39]: 'code_39', [BarcodeFormat.CODE_93]: 'code_93',
  [BarcodeFormat.CODABAR]: 'codabar', [BarcodeFormat.ITF]: 'itf', [BarcodeFormat.RSS_14]: 'databar',
  [BarcodeFormat.QR_CODE]: 'qr_code', [BarcodeFormat.DATA_MATRIX]: 'data_matrix', [BarcodeFormat.PDF_417]: 'pdf417', [BarcodeFormat.AZTEC]: 'aztec'
};

const reader = new MultiFormatReader();
reader.setHints(new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, Object.keys(FORMAT_NAMES).map(Number)],
  [DecodeHintType.TRY_HARDER, true]
]));

/** RGBA to grey, optionally inverted, turned a quarter turn clockwise and sharpened across. */
function luminance({ width, height, pixels, rotate, invert, sharpen }: DecodeJob): { grey: Uint8ClampedArray; width: number; height: number } {
  const grey = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const value = (pixels[at] * 77 + pixels[at + 1] * 150 + pixels[at + 2] * 29) >> 8;
      const to = rotate ? x * height + (height - 1 - y) : y * width + x;
      grey[to] = invert ? 255 - value : value;
    }
  }
  const [w, h] = rotate ? [height, width] : [width, height];
  if (!sharpen) return { grey, width: w, height: h };
  /* An unsharp mask along each row: a soft edge between a bar and a space
     becomes a hard one again, which is what the binariser needs. */
  const sharp = new Uint8ClampedArray(grey.length);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const here = grey[row + x];
      const around = (grey[row + Math.max(0, x - 1)] + grey[row + Math.min(w - 1, x + 1)]) / 2;
      sharp[row + x] = here + sharpen * (here - around);
    }
  }
  return { grey: sharp, width: w, height: h };
}

/** Decode one picture one way; `text` is null when nothing could be read. */
export function decodeJob(job: DecodeJob): DecodeAnswer {
  try {
    const { grey, width, height } = luminance(job);
    const source = new RGBLuminanceSource(grey, width, height);
    const bitmap = new BinaryBitmap(job.binarizer === 'global' ? new GlobalHistogramBinarizer(source) : new HybridBinarizer(source));
    const result = reader.decodeWithState(bitmap);
    return { id: job.id, text: result.getText() || null, format: FORMAT_NAMES[result.getBarcodeFormat()] ?? null };
  } catch {
    /* nothing readable in this picture this way */
    return { id: job.id, text: null, format: null };
  } finally {
    reader.reset();
  }
}
