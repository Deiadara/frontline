import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';

/**
 * The doors the client draws are held by the server too (2026-09-28).
 *
 * Found by the playthrough script: a level-one crew bid at the Bar, started a drill, bought from
 * the Runner and posted to the offers board by calling the routes behind the locked screens. Each
 * write is asked of a crew that has not opened the door, and then of the same crew once it has, so
 * a route that refused everybody would fail as surely as one that let everybody through.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function freshCrew(): Promise<{ app: FastifyInstance; token: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_newcomer', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  return { app, token };
}

const CASES = [
  {
    area: 'training',
    url: '/api/training',
    payload: { subjectId: 'overseer', attribute: 'strength' },
  },
  { area: 'market', url: '/api/market/supply', payload: { key: 'scrap', units: 1 } },
  {
    area: 'offers',
    url: '/api/market/offer',
    payload: { give: { resources: { scrap: 1 } }, want: { resources: { caps: 1 } } },
  },
  {
    area: 'black_market',
    url: '/api/black-market/bid',
    payload: { slotIndex: 0, goodId: 'anything', amount: 1 },
  },
] as const;

describe('a door the crew has not opened', () => {
  for (const { area, url, payload } of CASES) {
    it(`refuses ${url} as locked, and not once the ${area} door is open`, async () => {
      const { app, token } = await freshCrew();
      const headers = { authorization: `Bearer ${token}` };

      const shut = await app.inject({ method: 'POST', url, headers, payload });
      expect(shut.statusCode, shut.body.slice(0, 200)).toBe(403);
      expect(shut.json<{ error: { code: string } }>().error.code).toBe('AREA_LOCKED');

      openDoors(app, token, 'market', area);
      const open = await app.inject({ method: 'POST', url, headers, payload });
      expect(open.json<{ error?: { code: string } }>().error?.code).not.toBe('AREA_LOCKED');
    });
  }

  // The back room and the offers board sit inside the Market, and the client nests the doors.
  for (const { area, url, payload } of CASES.filter(
    (one) => one.area !== 'market' && one.area !== 'training',
  )) {
    it(`refuses ${url} while the Market itself is shut, even with the ${area} door open`, async () => {
      const { app, token } = await freshCrew();
      const headers = { authorization: `Bearer ${token}` };
      openDoors(app, token, area);
      const shut = await app.inject({ method: 'POST', url, headers, payload });
      expect(shut.statusCode, shut.body.slice(0, 200)).toBe(403);
      expect(shut.json<{ error: { code: string } }>().error.code).toBe('AREA_LOCKED');
    });
  }

  it('refuses a bid at the Bar below level 5', async () => {
    const { app, token } = await freshCrew();
    const bid = await app.inject({
      method: 'POST',
      url: '/api/bar/bid',
      headers: { authorization: `Bearer ${token}` },
      payload: { recruitId: 'anybody', amount: 1 },
    });
    expect(bid.statusCode).toBe(403);
    expect(bid.json<{ error: { code: string } }>().error.code).toBe('AREA_LOCKED');
  });

  // The Battle page's Inventory tab reads the stash off this for every crew, rank or no rank.
  it('still lets a crew below the back room read its shelf', async () => {
    const { app, token } = await freshCrew();
    const shelf = await app.inject({
      method: 'GET',
      url: '/api/black-market',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(shelf.statusCode, shelf.body.slice(0, 200)).toBe(200);
  });
});
