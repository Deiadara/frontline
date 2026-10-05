import { CITY_DISTRICTS, cityOfDistrict, findLocation } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { sendColumn } from '../battle/movement.js';
import { cancelUpgrade, startUpgrade, upgradingSince } from '../city/upgrade.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { ADMIN_ACTION_SECONDS } from './mode.js';

/**
 * Admin mode's clocks (maintainer ruling, 2026-09-29: speed everything). A location upgrade, a
 * drill and a column the player sends ran on the real clock while everything else took five
 * seconds, so a reviewer waited hours per rung of a location's ladder.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const FIVE = ADMIN_ACTION_SECONDS * 1000;

async function bench() {
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
    payload: { username: 'clockwatcher', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateArmy(baseId, { ...base.army, razors: 20 }, base.musterQueue);
  // A location of the crew's own, in its own city, for the upgrade and the move.
  const city = cityOfDistrict(base.districtId);
  const location = CITY_DISTRICTS.filter((one) => one.cityId === city)
    .flatMap((one) => one.locations)
    .find((one) => app.repos.city.control(one.id)?.holder.kind === 'unoccupied')!;
  const control = app.repos.city.control(location.id)!;
  app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  return { app, token, baseId, locationId: location.id };
}

describe('admin mode flattens the slow clocks too', () => {
  it('runs a location upgrade in five seconds, with its cancel window open from the start', async () => {
    const { app, baseId, locationId } = await bench();
    const now = new Date();
    const location = findLocation(locationId)!;
    const started = startUpgrade(app.repos, {
      base: app.repos.bases.findById(baseId)!,
      location,
      control: app.repos.city.control(locationId)!,
      now,
      admin: true,
    });
    expect(started.kind).toBe('started');
    if (started.kind !== 'started') return;
    expect(Date.parse(started.until) - now.getTime()).toBe(FIVE);
    expect(upgradingSince(location, started.control, true)).toBe(now.toISOString());

    const cancelled = cancelUpgrade(app.repos, {
      base: app.repos.bases.findById(baseId)!,
      location,
      control: started.control,
      now,
      admin: true,
    });
    expect(cancelled.kind).toBe('cancelled');
  });

  it('runs a drill in five seconds', async () => {
    const { app, token, baseId } = await bench();
    await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { playerLevel: 3 },
    });
    const drilled = await app.inject({
      method: 'POST',
      url: '/api/training',
      headers: auth(token),
      payload: { subjectId: 'overseer', attribute: 'strength' },
    });
    expect(drilled.statusCode, drilled.body.slice(0, 200)).toBe(200);
    const [session] = app.repos.bases.findById(baseId)!.training.sessions;
    expect(session?.durationSeconds).toBe(ADMIN_ACTION_SECONDS);
  });

  it('walks a column the player sends in five seconds', async () => {
    const { app, token, baseId, locationId } = await bench();
    const before = Date.now();
    const sent = await app.inject({
      method: 'POST',
      url: '/api/actions/move',
      headers: auth(token),
      payload: {
        from: { kind: 'district' },
        to: { kind: 'location', locationId },
        army: { razors: 10 },
        vehicles: {},
      },
    });
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
    const [move] = app.repos.moves.activeFor(baseId);
    expect(Date.parse(move!.arrivesAt) - Date.parse(move!.departedAt)).toBe(FIVE);
    expect(Date.parse(move!.departedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(move!.travelMinutes).toBe(0);
  });

  it('marches a column to a fight in five seconds', async () => {
    const { app, token, baseId } = await bench();
    const rival = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'caller', password: 'hunter2pass' },
    });
    await chooseOverseer(app, rival.json<{ token: string }>().token);
    const called = await app.inject({
      method: 'POST',
      url: '/api/admin/mock-battle',
      headers: auth(token),
      payload: {},
    });
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    const [fight] = app.repos.sieges.pending();
    const now = new Date();
    const column = sendColumn(app.repos, {
      base: app.repos.bases.findById(baseId)!,
      battleId: fight!.id,
      side: 'defender',
      toDistrictId: fight!.target.districtId,
      army: { razors: 5 },
      perimeter: {},
      now,
      admin: true,
    });
    expect(Date.parse(column.arrivesAt) - now.getTime()).toBe(FIVE);
  });
});
