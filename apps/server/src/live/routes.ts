import { LIVE_HEARTBEAT_MS, type LiveEvent } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { registerLiveBroadcast } from './broadcast.js';
import { liveHub } from './hub.js';
import { AppError } from '../errors.js';
import { addressBucket } from '../limits/plugin.js';

/**
 * `GET /events`: the open channel a tab keeps to hear what happened to it.
 *
 * ## Server-sent events, not a WebSocket
 *
 * Everything this game pushes goes one way. The client never sends anything down this channel: it
 * acts by calling the same REST routes it always has, so a socket's second direction would be a
 * capability with no caller and an authorisation surface with no purpose. What is left is a
 * long-lived HTTP response, which is what SSE is, and it arrives with the operational details
 * already solved: it is ordinary HTTP so it passes proxies and needs no upgrade handshake, and the
 * browser reconnects on its own.
 *
 * A WebSocket becomes the right answer the day the client has something to say that a request
 * cannot carry, and the shape here does not stand in the way of that: the client reads a stream of
 * `LiveEvent`, and where that stream comes from is one file's problem.
 *
 * ## Why the token is not in the query string
 *
 * `EventSource`, the browser's built-in SSE client, cannot set headers, so the usual way to
 * authenticate one is `?token=...`. That puts a bearer token in access logs, proxy logs and
 * `Referer` headers, where it lives as long as the logs do. The client here reads the stream with
 * `fetch` instead and sends the ordinary `Authorization` header, which costs a reconnect loop it
 * has to write itself (`lib/live.ts`) and keeps credentials out of URLs.
 */
/**
 * How many streams the process holds, and how many one address may (hardening pass, 2026-09-27).
 *
 * The hub caps a single account at eight, but accounts are cheap to make, and each stream is a
 * socket and a heartbeat timer held for as long as the other end likes. Past the whole-server cap
 * a new stream is refused with a 503, which the client treats like any dropped stream: it waits
 * and tries again, and polling carries the screen meanwhile.
 */
export const MAX_STREAMS_TOTAL = 2_000;
export const MAX_STREAMS_PER_ADDRESS = 40;

export function registerLiveRoutes(app: FastifyInstance): void {
  const perAddress = new Map<string, number>();
  // Every successful write to the shared world tells every open tab. See `broadcast.ts`.
  registerLiveBroadcast(app);

  app.get('/events', { preHandler: app.authenticate }, (request, reply) => {
    const userId = request.currentUser.id;
    const address = addressBucket(request.ip);
    const fromHere = perAddress.get(address) ?? 0;
    if (liveHub.connectionCount() >= MAX_STREAMS_TOTAL || fromHere >= MAX_STREAMS_PER_ADDRESS) {
      throw new AppError(
        'SERVER_BUSY',
        'The live channel is full. The screen keeps itself current.',
      );
    }
    perAddress.set(address, fromHere + 1);

    // From here the socket is written by hand, so Fastify is told to stay out of it: without this
    // it tries to send the handler's return value as a body on a response already under way. The
    // headers the hooks set so far (CORS, the rate limit) are carried over by hand for the same
    // reason, since `writeHead` does not know about them.
    const carried = Object.fromEntries(
      Object.entries(reply.getHeaders()).filter(
        (entry): entry is [string, string | number | string[]] => entry[1] !== undefined,
      ),
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      ...carried,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx and friends buffer responses by default, which would hold every event until the
      // buffer filled: the one deployment detail that turns a working live channel into a broken
      // one, and it is invisible in development.
      'X-Accel-Buffering': 'no',
    });

    const write = (line: string): boolean => {
      // `write` on a socket the client has already dropped throws rather than returning false.
      try {
        return reply.raw.write(line);
      } catch {
        return false;
      }
    };

    // Sent before anything else so the client can tell "connected" from "still connecting" without
    // waiting for the first thing to happen in the game, which may be hours.
    write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

    const send = (event: LiveEvent): void => {
      write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // `close` is how the hub shuts this stream if the account opens too many (`MAX_STREAMS_PER_ACCOUNT`).
    const unsubscribe = liveHub.subscribe(userId, send, () => close());

    // A comment line, which SSE defines as a no-op the client ignores. It exists to keep the
    // connection from being reaped: a proxy or a mobile network will close a TCP connection that
    // has carried nothing for a minute or two, and a quiet game is quiet for hours.
    const heartbeat = setInterval(() => {
      if (!write(': beat\n\n')) close();
    }, LIVE_HEARTBEAT_MS);
    heartbeat.unref?.();

    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      const left = (perAddress.get(address) ?? 1) - 1;
      if (left <= 0) perAddress.delete(address);
      else perAddress.set(address, left);
      try {
        reply.raw.end();
      } catch {
        // Already gone. Nothing to do and nothing worth logging.
      }
    }

    // Both, and not just `close`: `aborted` is what fires when the tab is closed or the laptop lid
    // comes down, and a subscriber that is never removed is a leak that grows with every reload.
    request.raw.on('close', close);
    request.raw.on('aborted', close);
    reply.raw.on('error', close);

    // Fastify must not try to serialise a reply that is already streaming.
    return reply;
  });
}
