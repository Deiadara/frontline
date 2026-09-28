import { MESSAGES_PER_DAY, VEHICLE_IDS } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * What a crafted request is refused for, and how fast (hardening pass, 2026-09-27).
 *
 * The fuzz suite proves nothing answers 500. These pin the specific doors an audit found open,
 * each by the refusal it gets and by the time it takes, since the failure they guard against was a
 * request the server accepted and spent seconds on.
 */

let app: FastifyInstance;
let db: AppDatabase;
let token = '';
let userId = '';

beforeAll(async () => {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'bounds-secret' });
  db = openDatabase(config.databasePath);
  runMigrations(db);
  app = await buildApp({ config, db, logger: false });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'bounds', password: 'hunter2pass' },
  });
  const body = registered.json<{ token: string; user: { id: string } }>();
  token = body.token;
  userId = body.user.id;
  await chooseOverseer(app, token);
});

afterAll(async () => {
  await app.close();
  db.close();
});

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });

describe('a move quote', () => {
  const quote = (vehicles: Record<string, number>) =>
    post('/api/actions/move/quote', {
      from: { kind: 'district' },
      to: { kind: 'gate' },
      army: { razors: 1 },
      vehicles,
    });

  /*
   * It used to price whatever it was handed. The ride's arithmetic lays out one seat per vehicle,
   * and twenty million phantom trucks held the server for 700ms (measured 2026-09-27); two billion
   * would have held it for minutes.
   */
  it('refuses vehicles the crew does not have, before counting them', async () => {
    const started = performance.now();
    const res = await quote({ [VEHICLE_IDS[0]]: 90_000 });
    expect(res.statusCode).toBe(409);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('refuses a count past any real yard at the door', async () => {
    expect((await quote({ [VEHICLE_IDS[0]]: 2_000_000_000 })).statusCode).toBe(400);
  });
});

describe('ids and names', () => {
  it('refuses an id longer than any the game makes', async () => {
    const res = await post('/api/messages/read', { id: 'x'.repeat(10_000) });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a login name or password past its length', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'x'.repeat(5_000), password: 'y' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the mute list', () => {
  it('stores each kind once however often it is sent', async () => {
    const res = await post('/api/notifications/settings', {
      muted: Array.from({ length: 20 }, () => 'market_outbid'),
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const muted = app.repos.social.settings(userId).muted;
    expect(muted.filter((kind) => kind === 'market_outbid')).toHaveLength(1);
  });
});

describe('the post', () => {
  it('takes a day of letters and refuses the next one', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'penpal', password: 'hunter2pass' },
    });
    const letter = { toUsernames: ['penpal'], subject: 'Hello', body: 'Again.' };
    for (let sent = 0; sent < MESSAGES_PER_DAY; sent += 1) {
      const res = await post('/api/messages', letter);
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    }
    const refused = await post('/api/messages', letter);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('too_many_today');
  });
});
