import {
  ALL_DISTRICTS,
  SALTMARCH_CITY_ID,
  startingControl,
  type Base,
  type District,
  type Location,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { releaseClosedCityGround } from './closed-ground.js';
import { mayEnter } from './stakes.js';

/**
 * Saltmarch ground claimed before its doors were shut (maintainer, 2026-09-29).
 *
 * One column of five Razors claimed The Salt House, and the Bar, the back room, the Runner, the
 * market and the mission board of a city no screen draws all answered that crew. The ruling: hand
 * the ground back to the holder the atlas gave it, walk the units home, and keep every room in a
 * closed city shut to everybody.
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
  return app;
}

async function crew(app: FastifyInstance, username: string): Promise<Base> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const chosen = await chooseOverseer(app, registered.json<{ token: string }>().token);
  expect(chosen.statusCode).toBe(201);
  return chosen.json<{ base: Base }>().base;
}

function groundIn(cityId: string): { location: Location; district: District } {
  for (const district of ALL_DISTRICTS) {
    if (district.cityId !== cityId) continue;
    const [location] = district.locations;
    if (location) return { location, district };
  }
  throw new Error(`fixture: ${cityId} has no ground`);
}

describe('ground held in a city that is not open', () => {
  it('goes back to the atlas, and the units on it walk home', async () => {
    const app = await world();
    const holder = await crew(app, 'salt_holder');
    const ally = await crew(app, 'salt_ally');
    const salt = groundIn(SALTMARCH_CITY_ID);
    const home = groundIn('ashfall');

    app.repos.city.put({
      locationId: salt.location.id,
      holder: { kind: 'crew', baseId: holder.id },
      level: 3,
      upgradingUntil: null,
      garrison: { razors: 5 },
    });
    app.repos.alliedGarrisons.set(salt.location.id, ally.id, { razors: 2 });
    const ashfallHeld = {
      locationId: home.location.id,
      holder: { kind: 'crew' as const, baseId: holder.id },
      level: 2,
      upgradingUntil: null,
      garrison: { razors: 4 },
    };
    app.repos.city.put(ashfallHeld);

    // The rooms are shut before the sweep runs: held ground in a closed city opens nothing.
    const holding = app.repos.bases.findById(holder.id)!;
    expect(mayEnter(app.repos, holding, SALTMARCH_CITY_ID)).toBe(false);

    const now = new Date();
    expect(releaseClosedCityGround(app.repos, now)).toEqual({ locations: 1, unitsSentHome: 7 });

    expect(app.repos.city.control(salt.location.id)).toEqual(
      startingControl(salt.location, salt.district),
    );
    expect(app.repos.alliedGarrisons.at(salt.location.id)).toEqual([]);
    // Walked, not teleported: nothing sends units anywhere instantly.
    expect(app.repos.moves.activeFor(holder.id).map((move) => move.army)).toEqual([{ razors: 5 }]);
    expect(app.repos.moves.activeFor(ally.id).map((move) => move.army)).toEqual([{ razors: 2 }]);
    // Ground in an open city is nobody's business here.
    expect(app.repos.city.control(home.location.id)).toEqual(ashfallHeld);

    // Once is all it takes: the second boot finds nothing to hand back.
    expect(releaseClosedCityGround(app.repos, now)).toEqual({ locations: 0, unitsSentHome: 0 });
  });
});
