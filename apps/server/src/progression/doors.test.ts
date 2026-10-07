import { buildingLevel } from '@frontline/shared';
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

/*
 * Bug pass, 2026-10-06: the crew door was read off the row before the settle, so a crew whose
 * finished build banked the level that opens it was refused until some other read settled it.
 */
describe('a door opened by work that finished unread', () => {
  it('lets the crew through on the request that banks it', async () => {
    const { app, token } = await freshCrew();
    const headers = { authorization: `Bearer ${token}` };
    const base = app.repos.bases.findByOwnerId(app.jwt.decode<{ sub: string }>(token)?.sub ?? '')!;
    expect(base.level).toBeLessThan(5);
    app.repos.bases.updateDistrict(base.id, base.buildings, [
      {
        id: 'finished',
        kind: 'lab',
        level: buildingLevel(base.buildings, 'lab') + 1,
        startedAt: new Date(Date.now() - 3_600_000).toISOString(),
        durationSeconds: 60,
        xp: 1_000_000,
        paid: {},
        parts: {},
      },
    ]);
    const reassign = await app.inject({
      method: 'POST',
      url: '/api/crew/reassign',
      headers,
      payload: { officerId: 'nobody', role: 'fixer' },
    });
    expect(reassign.json<{ error?: { code: string } }>().error?.code).not.toBe('AREA_LOCKED');
  });
});
