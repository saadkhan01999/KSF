/* The live-updates feed, from the browser's side (the server's is
   backend/src/services/live.ts).

   A Server-Sent Events stream read with fetch rather than EventSource,
   because EventSource cannot send the Authorization header and the access
   token never goes in a cookie or an address. The server closes each stream
   after about 50 seconds; this reconnects straight away, quoting the last
   event it saw so nothing in between is lost, and backs off when the server
   cannot be reached. An event only says what changed — the screen then asks
   for the new figures through the ordinary API. */

import { API_BASE_URL, identityHeaders, refreshAccessToken } from './api';

export type LiveEventType = 'plans.changed' | 'subscription.changed' | 'resync';
export interface LiveEvent { type: LiveEventType; data: Record<string, unknown> }

const wait = (ms: number) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

/** Split a stream into events; calls `onBlock` with each one's fields. */
async function readEvents(body: ReadableStream<Uint8Array>, onBlock: (fields: Record<string, string>) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const fields: Record<string, string> = {};
      for (const line of buffer.slice(0, end).split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const name = colon < 0 ? line : line.slice(0, colon);
        fields[name] = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      }
      buffer = buffer.slice(end + 2);
      if (Object.keys(fields).length) onBlock(fields);
    }
  }
}

/**
 * Listen to `/events` (signed in) or `/public/events` (anyone) until the
 * returned function is called.
 */
export function subscribeLive(path: '/events' | '/public/events', onEvent: (event: LiveEvent) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let lastId = '';
  let failures = 0;

  const loop = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream', ...(path === '/events' ? identityHeaders() : {}) };
        if (lastId) headers['Last-Event-ID'] = lastId;
        const response = await fetch(`${API_BASE_URL}${path}`, { headers, credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (response.status === 401 && path === '/events') {
          /* The access token ran out between two streams: get another. */
          if (!await refreshAccessToken()) { failures += 1; await wait(30_000); }
          continue;
        }
        if (!response.ok || !response.body) throw new Error(`The live feed answered ${response.status}.`);
        failures = 0;
        await readEvents(response.body, (fields) => {
          if (fields.id) lastId = fields.id;
          const type = fields.event as LiveEventType | 'ready' | undefined;
          if (!type || type === 'ready') return;
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(fields.data || '{}') as Record<string, unknown>; } catch { /* an event with no detail */ }
          onEvent({ type, data });
        });
      } catch {
        if (stopped) return;
        failures += 1;
      }
      /* A stream the server ended on schedule reconnects at once; a failure
         waits, a little longer each time, up to half a minute. */
      if (!stopped) await wait(failures ? Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) : 100);
    }
  };
  void loop();

  return () => {
    stopped = true;
    controller?.abort();
  };
}
