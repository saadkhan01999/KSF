/* The barcode decoder's worker: utils/decode.ts posts it a picture and a
   way of looking at it (decode.core.ts), and it answers with what it read. */

import { decodeJob, type DecodeJob } from './decode.core';

self.onmessage = (event: MessageEvent<DecodeJob>) => {
  (self as unknown as Worker).postMessage(decodeJob(event.data));
};
