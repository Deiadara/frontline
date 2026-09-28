import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { SESSION_HEADER, SESSION_TTL_SECONDS } from './session.js';

/**
 * Sessions that end (maintainer, 2026-09-27): thirty days, renewed while a player plays, and
 * revocable. Each case reads the answer a real request gets, because the rule lives in
 * `authenticate` and a unit test of the helpers alone would not see it wired.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(): Promise<{ app: FastifyInstance; token: string; userId: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'session-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'sessions', password: 'hunter2pass' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { app, token: body.token, userId: body.user.id };
}

const me = (app: FastifyInstance, token: string) =>
  app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('a session', () => {
  it('lasts thirty days from when it was signed', async () => {
    const { app, token } = await world();
    const payload = app.jwt.decode<{ iat: number; exp: number }>(token)!;
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
    expect((await me(app, token)).statusCode).toBe(200);
  });

  it('is refused once it has expired', async () => {
    const { app, userId } = await world();
    const stale = app.jwt.sign({
      sub: userId,
      ver: 0,
      iat: nowSeconds() - SESSION_TTL_SECONDS - 60,
      exp: nowSeconds() - 60,
    });
    expect((await me(app, stale)).statusCode).toBe(401);
  });

  it('refuses a token signed before sessions could end, with no expiry or version on it', async () => {
    const { app, userId } = await world();
    // Signed the way tokens were before 0121: a subject and nothing else.
    const legacy = app.jwt.sign({ sub: userId } as unknown as { sub: string; ver: number });
    expect((await me(app, legacy)).statusCode).toBe(401);
  });

  it('is renewed in a header once it is a day old, and not before', async () => {
    const { app, token, userId } = await world();
    expect((await me(app, token)).headers[SESSION_HEADER]).toBeUndefined();

    const dayOld = app.jwt.sign({
      sub: userId,
      ver: 0,
      iat: nowSeconds() - 25 * 60 * 60,
      exp: nowSeconds() + SESSION_TTL_SECONDS,
    });
    const renewed = (await me(app, dayOld)).headers[SESSION_HEADER];
    expect(typeof renewed).toBe('string');
    const fresh = app.jwt.decode<{ iat: number }>(renewed as string)!;
    expect(nowSeconds() - fresh.iat).toBeLessThan(60);
    expect((await me(app, renewed as string)).statusCode).toBe(200);
  });
});

describe('ending every session at once', () => {
  it('logs every other tab out, and keeps the one that asked', async () => {
    const { app, token } = await world();
    const otherTab = token;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout-all',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const kept = res.headers[SESSION_HEADER];
    expect(typeof kept).toBe('string');

    expect((await me(app, otherTab)).statusCode).toBe(401);
    expect((await me(app, kept as string)).statusCode).toBe(200);
  });

  it('happens on a password change too', async () => {
    const { app, token } = await world();
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { newPassword: 'another-good-one' },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect((await me(app, token)).statusCode).toBe(401);
    expect((await me(app, res.headers[SESSION_HEADER] as string)).statusCode).toBe(200);
  });

  it('leaves sessions alone when nothing asked for it', async () => {
    const { app, token } = await world();
    await me(app, token);
    await me(app, token);
    expect((await me(app, token)).statusCode).toBe(200);
  });
});

describe('what a signed-in player can store', () => {
  it('keeps only tutorial steps the game has', async () => {
    const { app, token, userId } = await world();
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/tutorial',
      headers: { authorization: `Bearer ${token}` },
      payload: { steps: ['welcome', 'made-up-1', 'made-up-2'] },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(app.repos.users.findById(userId)!.tutorialSeen).toEqual(['welcome']);
  });
});
