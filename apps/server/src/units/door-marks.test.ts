import { type UnitsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * A door's rules on the roster (2026-10-14): the card prints the rules the Stage pays at the level
 * held, and none it does not, off the same fold the engine builds the Dancer's stack with. Before
 * this the fold was the engine's alone, so her fights stripped armour and her card never said so.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function roster(holdings: Record<string, number>): Promise<UnitsResponse> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'stagehand', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;
  for (const [locationId, level] of Object.entries(holdings)) {
    const control = app.repos.city.control(locationId)!;
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
  }
  const read = await app.inject({
    method: 'GET',
    url: '/api/units',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(read.statusCode, read.body.slice(0, 300)).toBe(200);
  return read.json<UnitsResponse>();
}

const doorRules = (units: UnitsResponse, id: string) =>
  units.units
    .find((unit) => unit.id === id)
    ?.rules.map((rule) => rule.id)
    .filter((rule) => rule !== 'strikes_first') ?? [];

describe("the door's rules on the cards", () => {
  it('prints the rules the Stage pays at the level held, and none below it', async () => {
    expect(doorRules(await roster({}), 'the_crimson_dancer')).toEqual([]);
    expect(doorRules(await roster({ 'bloodstone-stage': 3 }), 'the_crimson_dancer')).toEqual([
      'spectacle',
    ]);
    expect(doorRules(await roster({ 'bloodstone-stage': 5 }), 'the_crimson_dancer')).toEqual([
      'spectacle',
      'papercut',
    ]);
  });
});
