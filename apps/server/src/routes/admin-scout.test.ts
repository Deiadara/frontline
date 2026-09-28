import {
  ALL_DISTRICTS,
  DEFAULT_CITY_ID,
  TERMINUS_CITY_ID,
  districtsOfCity,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * The Console's End game preset hands over eyes as well as everything else (maintainer, 2026-09-24).
 *
 * It was the ceiling on every other axis and left the map dark, so the screens the bench exists to
 * be looked at opened the scout sheet rather than the district. The grant writes real scout marks,
 * not the Console's fog override, so a reviewer sees the state a crew reaches by playing.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function bench(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'true',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'operator', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

describe('granting eyes on the whole world', () => {
  it('leaves most of the map dark before it is asked for', async () => {
    // A guard on the fixture: with everything already scouted the test below proves nothing.
    const { app, baseId } = await bench();
    expect(app.repos.city.scouted(baseId).size).toBeLessThan(ALL_DISTRICTS.length);
  });

  it('marks every district in every city, not just the one the crew lives in', async () => {
    const { app, token, baseId } = await bench();
    const granted = await app.inject({
      method: 'POST',
      url: '/api/admin/grant',
      headers: { authorization: `Bearer ${token}` },
      payload: { scouted: 'all' },
    });
    expect(granted.statusCode, granted.body.slice(0, 300)).toBe(200);

    const seen = app.repos.city.scouted(baseId);
    expect(seen.size).toBe(ALL_DISTRICTS.length);
    // Both playable cities, named rather than counted, because a count can be right for the wrong
    // reason: scouting one city twice would also come to the same total if the other were empty.
    for (const district of districtsOfCity(DEFAULT_CITY_ID)) {
      expect(seen.has(district.id), district.id).toBe(true);
    }
    for (const district of districtsOfCity(TERMINUS_CITY_ID)) {
      expect(seen.has(district.id), district.id).toBe(true);
    }
  });

  it('is idempotent, because a bench button gets pressed twice', async () => {
    const { app, token, baseId } = await bench();
    const press = () =>
      app.inject({
        method: 'POST',
        url: '/api/admin/grant',
        headers: { authorization: `Bearer ${token}` },
        payload: { scouted: 'all' },
      });
    expect((await press()).statusCode).toBe(200);
    const once = app.repos.city.scouted(baseId).size;
    expect((await press()).statusCode).toBe(200);
    expect(app.repos.city.scouted(baseId).size).toBe(once);
  });
});

describe('granting ground in every open city (maintainer, 2026-09-28)', () => {
  const heldIn = (app: FastifyInstance, baseId: string, cityId: string): number =>
    districtsOfCity(cityId)
      .flatMap((district) => district.locations)
      .filter((location) => {
        const holder = app.repos.city.control(location.id)?.holder;
        return holder?.kind === 'crew' && holder.baseId === baseId;
      }).length;

  it('hands the crew one location in Ashfall and one in Terminus, once', async () => {
    const { app, token, baseId } = await bench();
    expect(heldIn(app, baseId, DEFAULT_CITY_ID) + heldIn(app, baseId, TERMINUS_CITY_ID)).toBe(0);
    for (let press = 0; press < 2; press += 1) {
      const granted = await app.inject({
        method: 'POST',
        url: '/api/admin/grant',
        headers: { authorization: `Bearer ${token}` },
        payload: { footholds: 'every-city' },
      });
      expect(granted.statusCode, granted.body.slice(0, 300)).toBe(200);
    }
    // Twice pressed, one each: a city where the crew already holds ground is left alone.
    expect(heldIn(app, baseId, DEFAULT_CITY_ID)).toBe(1);
    expect(heldIn(app, baseId, TERMINUS_CITY_ID)).toBe(1);
  });
});
