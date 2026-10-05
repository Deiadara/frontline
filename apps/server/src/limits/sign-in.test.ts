import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { AUTH_LIMIT, LOGIN_FAILURE_LIMIT } from './rules.js';

/**
 * The per-account sign-in lock (maintainer, 2026-09-30). The per-address limit already stops one
 * machine guessing; these are the cases it cannot see, where every guess comes from somewhere new.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const PASSWORD = 'hunter2pass';

async function world(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'sign-in-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  for (const username of ['Operator', 'bystander']) {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: PASSWORD },
      remoteAddress: '192.0.2.1',
    });
  }
  return app;
}

/** Every call from an address of its own, so the per-address budget never comes into it. */
let nextAddress = 0;
function signIn(app: FastifyInstance, username: string, password: string) {
  nextAddress += 1;
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
    remoteAddress: `10.${(nextAddress >> 16) & 255}.${(nextAddress >> 8) & 255}.${nextAddress & 255}`,
  });
}

async function missTimes(app: FastifyInstance, username: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1)
    statuses.push((await signIn(app, username, 'wrong')).statusCode);
  return statuses;
}

describe('failed sign-ins against one account', () => {
  it('shuts the account after ten misses from ten different addresses', async () => {
    const app = await world();
    // Well past what one address may try, so only an account-wide count can be what stops it.
    expect(LOGIN_FAILURE_LIMIT.quota).toBeLessThan(AUTH_LIMIT.quota);

    expect(await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota)).toEqual(
      Array<number>(LOGIN_FAILURE_LIMIT.quota).fill(401),
    );
    const locked = await signIn(app, 'Operator', PASSWORD);

    expect(locked.statusCode).toBe(429);
    const { error } = locked.json<{ error: { code: string; message: string } }>();
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toMatch(/too many wrong passwords for this account/i);
    expect(error.message).toMatch(/15 more minutes/);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(14 * 60);
  });

  it('refuses a shut account before it hashes anything', async () => {
    const app = await world();
    await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota);
    const compare = vi.spyOn(bcrypt, 'compare');

    for (let i = 0; i < 5; i += 1) await signIn(app, 'Operator', PASSWORD);

    expect(compare).not.toHaveBeenCalled();
  });

  /** Counted after the hash, every attempt already waiting on one slipped through the count. */
  it('holds at ten however many attempts arrive at once', async () => {
    const app = await world();
    const statuses = await Promise.all(
      Array.from({ length: 30 }, async () => (await signIn(app, 'Operator', 'wrong')).statusCode),
    );

    expect(statuses.filter((status) => status === 401)).toHaveLength(LOGIN_FAILURE_LIMIT.quota);
    expect(statuses.filter((status) => status === 429)).toHaveLength(
      30 - LOGIN_FAILURE_LIMIT.quota,
    );
  });

  it('counts the name however it is capitalised', async () => {
    const app = await world();
    await missTimes(app, 'operator', 4);
    await missTimes(app, 'OPERATOR', 3);
    await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota - 7);

    expect((await signIn(app, 'oPeRaToR', PASSWORD)).statusCode).toBe(429);
  });

  it('shuts a name nobody holds the same way, so the lock says nothing about who exists', async () => {
    const app = await world();
    await missTimes(app, 'nosuchplayer', LOGIN_FAILURE_LIMIT.quota);

    expect((await signIn(app, 'nosuchplayer', PASSWORD)).statusCode).toBe(429);
  });

  it('leaves every other account alone', async () => {
    const app = await world();
    await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota);

    expect((await signIn(app, 'bystander', PASSWORD)).statusCode).toBe(200);
  });

  it('opens again once the window has passed, for the right password', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
    const app = await world();
    await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota);
    expect((await signIn(app, 'Operator', PASSWORD)).statusCode).toBe(429);

    vi.setSystemTime(Date.now() + LOGIN_FAILURE_LIMIT.windowMs + 1_000);

    expect((await signIn(app, 'Operator', PASSWORD)).statusCode).toBe(200);
  });

  it('starts a fresh count after the owner gets in', async () => {
    const app = await world();
    await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota - 1);
    expect((await signIn(app, 'Operator', PASSWORD)).statusCode).toBe(200);

    expect(await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota)).toEqual(
      Array<number>(LOGIN_FAILURE_LIMIT.quota).fill(401),
    );
  });
});
