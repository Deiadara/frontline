/**
 * The live channel, read the way the client reads it: an `EventSource`-shaped stream of
 * `event:` / `data:` frames, every `data:` parsed with the shared `LiveEventSchema`.
 */
import type { ReadableStreamReadResult } from 'node:stream/web';
import { LiveEventSchema, type LiveEvent } from '@frontline/shared';
import { BASE_URL, type Harness, type Player } from './playthrough-harness.js';

export interface LiveStream {
  /** Every frame received so far, in order. */
  events: { event: string; data: unknown }[];
  status: number;
  contentType: string | null;
  /** Resolves once a frame of this kind has arrived, or false after `timeoutMs`. */
  waitFor: (kind: string, timeoutMs?: number) => Promise<boolean>;
  close: () => void;
}

/** Opens the channel for a player. Counts as a call of `GET /api/events` in the coverage table. */
export async function openLiveStream(h: Harness, crew: Player): Promise<LiveStream> {
  const controller = new AbortController();
  const events: { event: string; data: unknown }[] = [];
  const waiters: { kind: string; resolve: (seen: boolean) => void }[] = [];
  const res = await fetch(`${BASE_URL}/api/events`, {
    headers: { authorization: `Bearer ${crew.token}`, 'x-forwarded-for': crew.ip },
    signal: controller.signal,
  });
  const tally = h.coverage.get('GET /api/events');
  if (tally) tally.calls += 1;
  const stream: LiveStream = {
    events,
    status: res.status,
    contentType: res.headers.get('content-type'),
    waitFor: (kind, timeoutMs = 3_000) => {
      if (events.some((one) => one.event === kind)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        waiters.push({
          kind,
          resolve: (seen) => {
            clearTimeout(timer);
            resolve(seen);
          },
        });
      });
    },
    close: () => controller.abort(),
  };

  const reader = res.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let cut = buffer.indexOf('\n\n');
          while (cut !== -1) {
            const frame = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const parsed = parseFrame(frame);
            if (parsed) {
              events.push(parsed);
              for (const waiter of waiters.filter((one) => one.kind === parsed.event)) {
                waiter.resolve(true);
              }
            }
            cut = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Aborted: the stream was closed on purpose.
      }
    })();
  }
  return stream;
}

function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) return null;
    if (line.startsWith('event: ')) event = line.slice(7);
    if (line.startsWith('data: ')) data += line.slice(6);
  }
  if (data === '') return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}

/** Every non-`ready` frame must be a `LiveEvent` whose kind is the frame's event name. */
export function checkLiveFrames(h: Harness, stream: LiveStream, who: string): void {
  for (const frame of stream.events) {
    if (frame.event === 'ready') continue;
    const parsed = LiveEventSchema.safeParse(frame.data);
    h.check(
      parsed.success,
      `${who}: a live frame does not parse as a LiveEvent: ${JSON.stringify(frame)}`,
    );
    if (parsed.success) {
      const event: LiveEvent = parsed.data;
      h.check(
        event.kind === frame.event,
        `${who}: a "${frame.event}" frame carries kind "${event.kind}"`,
      );
    }
  }
}
