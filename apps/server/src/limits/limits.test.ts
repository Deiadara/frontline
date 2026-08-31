import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { RateLimiter } from './bucket.js';
import { AUTH_LIMIT, READ_LIMIT, STREAM_LIMIT, WRITE_LIMIT, ruleFor } from './rules.js';

describe('the window', () => {
  it('lets a caller spend exactly its quota and no more', () => {
    const limiter = new RateLimiter(() => 0);
    const rule = { quota: 3, windowMs: 1_000 };

    expect([1, 2, 3].map(() => limiter.take('a', rule).allowed)).toEqual([true, true, true]);
    expect(limiter.take('a', rule).allowed).toBe(false);
  });

  it('counts each caller separately', () => {
    const limiter = new RateLimiter(() => 0);
    const rule = { quota: 1, windowMs: 1_000 };

    expect(limiter.take('a', rule).allowed).toBe(true);
    expect(limiter.take('a', rule).allowed).toBe(false);
    expect(limiter.take('b', rule).allowed).toBe(true);
  });

  it('opens again once the window has rolled', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { quota: 1, windowMs: 1_000 };

    expect(limiter.take('a', rule).allowed).toBe(true);
    expect(limiter.take('a', rule).allowed).toBe(false);

    now = 1_001;
    expect(limiter.take('a', rule).allowed).toBe(true);
  });

  /**
   * A caller that keeps knocking stays out for the rest of the window.
   *
   * The alternative, only counting calls that were allowed, lets somebody sit exactly on the limit
   * for ever: every refusal is free, so they retry until one lands and start again.
   */
  it('keeps counting refused calls, so hammering does not shorten the wait', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { quota: 1, windowMs: 10_000 };
    limiter.take('a', rule);

    for (let i = 0; i < 50; i += 1) limiter.take('a', rule);
    now = 9_999;

    expect(limiter.take('a', rule).allowed).toBe(false);
  });

  it('says how long to wait, and how much is left', () => {
    const limiter = new RateLimiter(() => 0);
    const rule = { quota: 5, windowMs: 30_000 };

    const first = limiter.take('a', rule);
    expect(first.remaining).toBe(4);
    expect(first.retryAfterSeconds).toBe(30);
  });

  /** The leak: without a sweep the map grows by one entry per address that ever knocked. */
  it('forgets callers whose window has passed', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { quota: 1, windowMs: 1_000 };
    limiter.take('a', rule);
    limiter.take('b', rule);
    expect(limiter.size()).toBe(2);

    now = 2_000;
    limiter.sweep();

    expect(limiter.size()).toBe(0);
  });

  it('keeps a caller whose window is still open', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    limiter.take('a', { quota: 1, windowMs: 10_000 });

    now = 5_000;
    limiter.sweep();

    expect(limiter.size()).toBe(1);
  });
});

describe('which rule a request falls under', () => {
  it.each([
    ['POST', '/api/auth/login', AUTH_LIMIT],
    ['POST', '/api/auth/register', AUTH_LIMIT],
    ['GET', '/api/events', STREAM_LIMIT],
    ['GET', '/api/me', READ_LIMIT],
    ['HEAD', '/api/city', READ_LIMIT],
    ['POST', '/api/missions', WRITE_LIMIT],
    ['PATCH', '/api/settings', WRITE_LIMIT],
    ['DELETE', '/api/factions/x', WRITE_LIMIT],
  ] as const)('%s %s', (method, path, expected) => {
    expect(ruleFor(method, path).rule).toBe(expected);
  });

  /** The default is the strict one: a route nobody classified is limited as a write. */
  it('treats an unknown write as a write', () => {
    expect(ruleFor('POST', '/api/something-invented-tomorrow').rule).toBe(WRITE_LIMIT);
  });

  /** Signing in is bucketed apart from reading, so a poll cannot use up a login's budget. */
  it('scopes the classes apart', () => {
    expect(ruleFor('POST', '/api/auth/login').scope).not.toBe(ruleFor('GET', '/api/me').scope);
  });
});

describe('over HTTP', () => {
  const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

  afterEach(async () => {
    for (const { app, db } of instances.splice(0)) {
      await app.close();
      db.close();
    }
  });

  async function makeApp(): Promise<FastifyInstance> {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });
    return app;
  }

  it('refuses a flood of sign-in attempts with a 429 and a Retry-After', async () => {
    const app = await makeApp();
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'nobody', password: 'wrongpassword' },
      });

    let last = await attempt();
    for (let i = 0; i < AUTH_LIMIT.quota + 2 && last.statusCode !== 429; i += 1)
      last = await attempt();

    expect(last.statusCode).toBe(429);
    expect(last.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });

  /**
   * The limit a real player must never reach.
   *
   * The shell polls `/me` and `/city` every five seconds, so an idle game makes about 24 reads a
   * minute and an active one several times that. This walks a whole minute's worth of the busiest
   * plausible session through the reader's budget and expects every one of them through.
   */
  it('lets an ordinary session read as much as it actually reads', async () => {
    const app = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'busyplayer', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;

    const statuses = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: `Bearer ${token}` },
      });
      statuses.add(res.statusCode);
    }

    expect([...statuses]).toEqual([200]);
  });

  it('tells every caller what their budget is', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/me' });

    expect(res.headers['x-ratelimit-limit']).toBe(String(READ_LIMIT.quota));
    expect(Number(res.headers['x-ratelimit-remaining'])).toBe(READ_LIMIT.quota - 1);
  });

  /**
   * Two accounts from one address do not share a budget.
   *
   * The reason the limiter decodes the token itself in `onRequest` rather than waiting for
   * `authenticate`: keyed on the address, everybody behind one office NAT would share one bucket,
   * and one busy player would lock out their colleagues.
   */
  it('counts two signed-in players apart even from one address', async () => {
    const app = await makeApp();
    const tokens: string[] = [];
    for (const username of ['playerone', 'playertwo']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username, password: 'hunter2pass' },
      });
      tokens.push(res.json<{ token: string }>().token);
    }

    const readAs = (token: string) =>
      app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

    for (let i = 0; i < 20; i += 1) await readAs(tokens[0]!);
    const first = await readAs(tokens[0]!);
    const second = await readAs(tokens[1]!);

    expect(Number(second.headers['x-ratelimit-remaining'])).toBeGreaterThan(
      Number(first.headers['x-ratelimit-remaining']),
    );
  });
});
