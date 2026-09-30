import { DEFAULT_CITY_ID, TERMINUS_CITY_ID, districtsOfCity } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * The Console's footholds grant: a location in every open city, so the multi-city screens have
 * ground to read on the bench.
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
