import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { AUTH_LIMIT, LOGIN_FAILURE_LIMIT } from './rules.js';

/**
 * The sign-in lock: wrong passwords counted per account and per address (maintainer, 2026-09-30;
 * 2026-10-06). The per-address limit stops one machine guessing at everything; this stops it
 * guessing at one account, and it shuts only the address that did the guessing, so a stranger
 * missing on purpose cannot keep the owner out.
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

/** Where the guesses come from, unless a case says otherwise. Not where the accounts registered. */
const GUESSER = '198.51.100.7';
const OWNER = '203.0.113.9';

function signIn(app: FastifyInstance, username: string, password: string, from = GUESSER) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
    remoteAddress: from,
  });
}

async function missTimes(
  app: FastifyInstance,
  username: string,
  times: number,
  from = GUESSER,
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1)
    statuses.push((await signIn(app, username, 'wrong', from)).statusCode);
  return statuses;
}

describe('failed sign-ins against one account', () => {
  it('shuts the account to an address after ten misses from it', async () => {
    const app = await world();
    // Under what one address may try, so it is this lock and not the address's budget that stops it.
    expect(LOGIN_FAILURE_LIMIT.quota).toBeLessThan(AUTH_LIMIT.quota);

    expect(await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota)).toEqual(
      Array<number>(LOGIN_FAILURE_LIMIT.quota).fill(401),
    );
    const locked = await signIn(app, 'Operator', PASSWORD);

    expect(locked.statusCode).toBe(429);
    const { error } = locked.json<{ error: { code: string; message: string } }>();
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toMatch(/too many wrong passwords for this account from here/i);
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

  it("lets the owner in from their own address while a stranger's is shut", async () => {
    const app = await world();
    await missTimes(app, 'Operator', LOGIN_FAILURE_LIMIT.quota);
    expect((await signIn(app, 'Operator', PASSWORD)).statusCode).toBe(429);

    expect((await signIn(app, 'Operator', PASSWORD, OWNER)).statusCode).toBe(200);
    // ...and the owner getting in does not reopen the stranger's door.
    expect((await signIn(app, 'Operator', PASSWORD)).statusCode).toBe(429);
  });

  it('counts one IPv6 /64 as one address', async () => {
    const app = await world();
    for (let host = 0; host < LOGIN_FAILURE_LIMIT.quota; host += 1) {
      await signIn(app, 'Operator', 'wrong', `2001:db8:1:2::${(host + 1).toString(16)}`);
    }

    expect((await signIn(app, 'Operator', PASSWORD, '2001:db8:1:2::ff')).statusCode).toBe(429);
    expect((await signIn(app, 'Operator', PASSWORD, '2001:db8:1:3::1')).statusCode).toBe(200);
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
