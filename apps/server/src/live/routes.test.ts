import { LiveEventSchema, type LiveEvent } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { liveHub } from './hub.js';

/**
 * `GET /events` over a real socket.
 *
 * Fastify's `inject` cannot be used here and that is the whole reason this file is separate: it
 * buffers a response and hands it over when the handler finishes, and this handler never finishes.
 * A test written against `inject` would hang, or worse, pass against a route that had quietly
 * stopped streaming. So the app listens on a real port and the test reads the body as it arrives,
 * which is also the only way to prove the parts that only exist on the wire: the frame format, and
 * that the subscription is dropped when the socket is.
 */

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  userId: string;
  url: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeStack(username: string): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  // Asserted rather than assumed: a username the validator rejects otherwise surfaces three lines
  // later as "cannot read properties of undefined", which is a fixture bug wearing a test failure.
  expect(registered.statusCode).toBe(201);
  const body = registered.json<{ token: string; user: { id: string } }>();

  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, db, token: body.token, userId: body.user.id, url: `${app.listeningOrigin}/api` };
}

/** Reads SSE frames off a live response until `wanted` of them have arrived. */
async function readFrames(
  body: ReadableStream<Uint8Array>,
  wanted: number,
  timeoutMs = 5_000,
): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  while (frames.length < wanted && Date.now() < deadline) {
    /*
     * Raced against the clock, because `read()` blocks until bytes arrive and this channel is
     * silent by design: on a quiet game the next thing down it is a heartbeat twenty seconds
     * later. Checking `deadline` only between reads made `timeoutMs` decorative, and the test that
     * asserts *nothing* arrives sat on a blocked read until vitest killed it at five seconds.
     */
    const next = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
    ]);
    if (next === null) break;
    const { done, value } = next;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    // Comment lines are the heartbeat, and SSE defines them as ignorable. Not frames.
    frames.push(...parts.filter((part) => part.trim() !== '' && !part.startsWith(':')));
  }
  void reader.cancel();
  return frames;
}

function payloadOf(frame: string): LiveEvent {
  const data = frame
    .split('\n')
    .find((line) => line.startsWith('data:'))!
    .slice(5)
    .trim();
  return LiveEventSchema.parse(JSON.parse(data));
}

describe('the live channel over the wire', () => {
  it('refuses a caller with no token, like every other route', async () => {
    const stack = await makeStack('anon');
    const res = await fetch(`${stack.url}/events`);
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it('opens as an event stream and says so before anything has happened', async () => {
    const stack = await makeStack('opener');
    const controller = new AbortController();
    const res = await fetch(`${stack.url}/events`, {
      headers: { authorization: `Bearer ${stack.token}` },
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // The header that decides whether this works behind nginx at all.
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const [ready] = await readFrames(res.body!, 1);
    expect(ready).toContain('event: ready');
    controller.abort();
  });

  /** The delivery itself: something happens on the server, and it arrives on an open socket. */
  it('delivers an event published while the socket is open', async () => {
    const stack = await makeStack('listener');
    const controller = new AbortController();
    const res = await fetch(`${stack.url}/events`, {
      headers: { authorization: `Bearer ${stack.token}` },
      signal: controller.signal,
    });

    // Published only once the hub has seen the subscription: publishing into an empty hub is a
    // no-op by design, so a test that raced it would be testing its own timing.
    const frames = readFrames(res.body!, 2);
    await vi.waitFor(() => expect(liveHub.isConnected(stack.userId)).toBe(true));
    liveHub.publish(stack.userId, 'battle', new Date('2026-08-31T12:00:00.000Z'));

    const [, event] = await frames;
    expect(event).toContain('event: battle');
    expect(payloadOf(event!)).toEqual({ kind: 'battle', at: '2026-08-31T12:00:00.000Z' });
    controller.abort();
  });

  it('sends a player nothing that was addressed to somebody else', async () => {
    const stack = await makeStack('mindingmyown');
    const controller = new AbortController();
    const res = await fetch(`${stack.url}/events`, {
      headers: { authorization: `Bearer ${stack.token}` },
      signal: controller.signal,
    });

    const frames = readFrames(res.body!, 2, 300);
    await vi.waitFor(() => expect(liveHub.isConnected(stack.userId)).toBe(true));
    liveHub.publish('a-different-account', 'battle', new Date());

    // Only the `ready` frame: the other account's event never reaches this socket.
    expect(await frames).toHaveLength(1);
    controller.abort();
  });

  /**
   * The leak. A subscriber that outlives its socket is a listener the hub will call forever, and a
   * player who reloads twenty times leaves twenty of them.
   */
  it('drops the subscription when the tab goes away', async () => {
    const stack = await makeStack('closer');
    const controller = new AbortController();
    const res = await fetch(`${stack.url}/events`, {
      headers: { authorization: `Bearer ${stack.token}` },
      signal: controller.signal,
    });
    await readFrames(res.body!, 1);
    await vi.waitFor(() => expect(liveHub.isConnected(stack.userId)).toBe(true));

    controller.abort();

    await vi.waitFor(() => expect(liveHub.isConnected(stack.userId)).toBe(false), {
      timeout: 5_000,
    });
  });
});
