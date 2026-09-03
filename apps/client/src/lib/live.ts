import {
  LIVE_SILENCE_TIMEOUT_MS,
  LiveEventSchema,
  type LiveEvent,
  type LiveEventKind,
} from '@frontline/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from './api';
import { queryKeys } from './queries';
import { useSession } from '../store/session';

/**
 * The live channel, from the tab's side.
 *
 * Holds one HTTP request open to `GET /api/events` and turns what comes down it into cache
 * invalidations. It never writes to the cache directly: an event says a screen is stale, React
 * Query refetches it through the ordinary query, and the data on screen has been through exactly
 * one code path whether it arrived from a page load or from a fight that landed ten seconds ago.
 *
 * ## Why `fetch` and not `EventSource`
 *
 * `EventSource` is the browser's SSE client and it reconnects on its own, which is most of this
 * file. It also cannot set a request header, so authenticating one means putting the bearer token
 * in the query string, where it is written to every access log between here and the server. The
 * reconnect loop below is the price of not doing that.
 *
 * ## What this is not
 *
 * Not the only way state arrives. Every screen keeps its polling interval, which is what covers a
 * blocked connection, a corporate proxy that eats streaming responses, and the seconds between a
 * drop and a reconnect. The channel makes the game feel immediate; the polls make it correct. A
 * live feature that is load-bearing for correctness is one outage away from a game that silently
 * stops happening.
 */

/** Which caches a kind of event makes stale. */
const INVALIDATES: Record<LiveEventKind, readonly (readonly unknown[])[]> = {
  notification: [queryKeys.notifications, queryKeys.me],
  // A fight moves the board, the map it was fought over, and the army and stockpile under it.
  battle: [queryKeys.battles, queryKeys.city, queryKeys.me, queryKeys.units, queryKeys.actions],
  message: [queryKeys.messages, queryKeys.me],
  faction: [queryKeys.faction, queryKeys.me],
  base: [queryKeys.me, queryKeys.units, queryKeys.missions, queryKeys.research],
};

function applyEvent(queryClient: QueryClient, event: LiveEvent): void {
  for (const key of INVALIDATES[event.kind]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/**
 * Parses one SSE frame.
 *
 * Frames are separated by a blank line and a line beginning `:` is a comment, which is what the
 * server's heartbeat is. Only `data:` is read: the event name is already in the payload, and
 * trusting one field over two that could disagree is one fewer thing to keep in step.
 */
function parseFrame(frame: string): LiveEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data) return null;
  try {
    const parsed = LiveEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    // A truncated frame from a connection that died mid-write. The reconnect refetches anyway.
    return null;
  }
}

/** Backoff between reconnects: quick at first, then out of the server's way. Jittered. */
function retryDelay(attempt: number): number {
  const base = Math.min(1_000 * 2 ** attempt, 30_000);
  // Without jitter every tab dropped by one server restart comes back in the same millisecond.
  return base * (0.7 + Math.random() * 0.6);
}

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Opens the channel for as long as the component is mounted and there is a session.
 *
 * Mounted once, at the top of the game shell. Returns the connection state so the HUD can say when
 * it is not live, because a strategy game that has silently stopped receiving other people's moves
 * looks exactly like a quiet evening.
 */
export function useLiveEvents(): LiveStatus {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  // Held in a ref so the effect below never restarts when the callback identity changes.
  const clientRef = useRef(queryClient);
  clientRef.current = queryClient;

  useEffect(() => {
    if (!token) {
      setStatus('offline');
      return;
    }

    let cancelled = false;
    let attempt = 0;
    const controllers = new Set<AbortController>();
    /** The backoff sleep in flight, so unmounting does not leave up to 39s of timer behind. */
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function connect(): Promise<void> {
      while (!cancelled) {
        const controller = new AbortController();
        controllers.add(controller);
        // A stream that has gone quiet for longer than several heartbeats is a connection that is
        // open on this side and dead on the other: the case a plain `fetch` never reports, because
        // no error ever arrives. Aborting is what turns it back into a reconnect.
        let silence = setTimeout(() => controller.abort(), LIVE_SILENCE_TIMEOUT_MS);
        try {
          const res = await fetch(`${API_BASE_URL}/events`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);

          if (cancelled) throw new Error('cancelled');
          setStatus('live');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          /*
           * Nothing counts as a connection until a byte of it arrives.
           *
           * The backoff used to reset here, on the response *headers*, which is a weaker claim than
           * it looks: a proxy that accepts the request and then closes the body immediately, an LB
           * idle timeout, or a server in a crash loop all produce `res.ok` with a stream that ends
           * at once. Every one of those iterations counted as a success, so `attempt` never grew
           * past zero and the tab reconnected roughly once a second, forever, taking a full cache
           * invalidation with it each time.
           *
           * The server writes a `ready` frame before anything else precisely so this is cheap to
           * check: on a healthy connection the first read arrives immediately, and on the broken
           * ones above it never arrives at all.
           */
          let delivered = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!delivered) {
              delivered = true;
              attempt = 0;
              // Anything that happened while this tab was disconnected is already in the database
              // and was never pushed. Refetching on connect is what makes a dropped connection cost
              // latency and not a stale screen.
              //
              // `refetchType: 'active'` rather than everything: the shell prefetches around eight
              // screens, and refetching all of them on a reconnect turns a wifi handover into a
              // burst of requests for screens nobody is looking at. The inactive ones are still
              // marked stale, so they refetch the moment they mount.
              void clientRef.current.invalidateQueries({ refetchType: 'active' });
            }
            clearTimeout(silence);
            silence = setTimeout(() => controller.abort(), LIVE_SILENCE_TIMEOUT_MS);
            buffer += decoder.decode(value, { stream: true });
            // Everything up to the last frame boundary; a partial tail waits for the next chunk.
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              const event = parseFrame(frame);
              if (event && !cancelled) applyEvent(clientRef.current, event);
            }
          }
        } catch {
          // Every failure is the same failure: the channel is not up. Which one it was changes
          // nothing about what to do, and the polls are covering the screen in the meantime.
        } finally {
          clearTimeout(silence);
          controllers.delete(controller);
        }

        if (cancelled) return;
        setStatus('offline');
        await new Promise<void>((resolve) => {
          retry = setTimeout(resolve, retryDelay(attempt++));
        });
      }
    }

    void connect();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      for (const controller of controllers) controller.abort();
    };
  }, [token]);

  return status;
}
