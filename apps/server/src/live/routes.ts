import { LIVE_HEARTBEAT_MS, type LiveEvent } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { liveHub } from './hub.js';

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
export function registerLiveRoutes(app: FastifyInstance): void {
  app.get('/events', { preHandler: app.authenticate }, (request, reply) => {
    const userId = request.currentUser.id;

    reply.raw.writeHead(200, {
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

    const unsubscribe = liveHub.subscribe(userId, send);

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
