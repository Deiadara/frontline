import { type UnitsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The Marshalling Yards on the roster (maintainer, 2026-10-09): the marks Box Nine and the Mess
 * Room grant at level 5 are on the cards while they are held, Breaching is drawn in gold, and the
 * Coaling Stage's pace reaches the dialogs that quote a column.
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
    payload: { username: 'yardhand', password: 'hunter2pass' },
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

const rulesOf = (units: UnitsResponse, id: string) =>
  units.units.find((unit) => unit.id === id)?.rules.map((rule) => rule.id) ?? [];

describe('the Marshalling Yards on the cards', () => {
  it('draws Breaching in gold on the Breakers and nowhere else', async () => {
    const units = await roster({});
    const golden = units.units.flatMap((unit) =>
      unit.modifiers.filter((one) => one.golden === true).map((one) => `${unit.id}:${one.label}`),
    );
    expect(golden).toEqual(['breakers:Breaching']);
  });

  it('puts SAFE DISTANCE and DRUNK on the cards at level 5, and not before', async () => {
    const four = await roster({
      'marshalling-yards-signalbox': 4,
      'marshalling-yards-messroom': 4,
    });
    expect(rulesOf(four, 'snipers')).not.toContain('safe_distance');
    expect(rulesOf(four, 'breakers')).not.toContain('drunk');
    const five = await roster({
      'marshalling-yards-signalbox': 5,
      'marshalling-yards-messroom': 5,
    });
    expect(rulesOf(five, 'snipers')).toContain('safe_distance');
    expect(rulesOf(five, 'breakers')).toContain('drunk');
    expect(rulesOf(five, 'razors')).toEqual(rulesOf(four, 'razors'));
  });

  it('hands the dialogs the Coaling Stage`s pace', async () => {
    expect((await roster({})).vehicleSpeedPercent ?? 0).toBe(0);
    expect((await roster({ 'marshalling-yards-coalstage': 3 })).vehicleSpeedPercent).toBe(7);
  });
});
