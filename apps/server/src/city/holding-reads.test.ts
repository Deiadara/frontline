import { describe, expect, it, afterEach } from 'vitest';
import { ALL_DISTRICTS } from '@frontline/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import { chooseOverseer } from '../testing/overseer.js';
import { readTheMap, wholeHolderOf } from './holding.js';

/**
 * The faction reads are a sweep over the world, so they are counted rather than timed.
 *
 * `wholeHolderOf` takes the seats and the control rows itself when asked about one district, which
 * is right for one question and wrong for the 36 the battle board asks on every read. Counting the
 * repository calls is the only measurement that stays true on a fast machine and a slow one.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'counter', password: 'hunter2pass' },
  });
  await chooseOverseer(app, registered.json<{ token: string }>().token);
  return app;
}

describe('sweeping the map for whole districts', () => {
  it('reads the seats and the control rows once, not once a district', async () => {
    const app = await world();
    let controls = 0;
    let seats = 0;
    const realControls = app.repos.city.controls.bind(app.repos.city);
    const realSeats = app.repos.factions.everySeat.bind(app.repos.factions);
    app.repos.city.controls = () => {
      controls += 1;
      return realControls();
    };
    app.repos.factions.everySeat = () => {
      seats += 1;
      return realSeats();
    };

    const read = readTheMap(app.repos);
    for (const district of ALL_DISTRICTS) wholeHolderOf(app.repos, district, read);

    expect(ALL_DISTRICTS.length).toBeGreaterThan(30);
    expect(controls, 'control rows read').toBe(1);
    expect(seats, 'seats read').toBe(1);
  });
});
