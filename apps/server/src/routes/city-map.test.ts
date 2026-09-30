import {
  DEFAULT_CITY_ID,
  TERMINUS_CITY_ID,
  districtsOfCity,
  type CityResponse,
  type LocationControl,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The map of a city you do not live in (maintainer, 2026-09-24).
 *
 * The world screen picks a city and the map draws it, so `GET /city` has to answer for a city by
 * name the way the four rooms already do. The door is **not** the rooms' door, and that is the
 * whole point of this file: a room wants ground already held in the city (`city/access.ts`), and a
 * map cannot, because looking at a city is how a player decides to take something in it. What a
 * map needs is ground *drawn* for it.
 *
 * The bug this was found through: with the read answering the crew's own city whatever was asked,
 * every district of an away city arrived with no summary at all, so the away map carried no live
 * data on it: no holdings and no crew names.
 */

const PASSWORD = 'hunter2pass';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app: open, db } of instances.splice(0)) {
    await open.close();
    db.close();
  }
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function player(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  return { token, baseId: me.json<{ base: { id: string } }>().base.id };
}

const readMap = (app: FastifyInstance, token: string, city?: string) =>
  app.inject({
    method: 'GET',
    url: city === undefined ? '/api/city' : `/api/city?city=${city}`,
    headers: auth(token),
  });

/** A district of the away city with something in it to take. */
const AWAY = districtsOfCity(TERMINUS_CITY_ID).find(
  (district) => district.kind === 'contested' && district.locations.length > 0,
)!;

/** Hands one location to a crew, the way winning it would. */
function give(app: FastifyInstance, locationId: string, baseId: string): void {
  const control: LocationControl = {
    locationId,
    holder: { kind: 'crew', baseId },
    level: 1,
    upgradingUntil: null,
    garrison: {},
  };
  app.repos.city.put(control);
}

describe('which city’s map a crew may read', () => {
  it('answers the crew’s own city when nothing is asked for, and says which it is', async () => {
    const app = await makeApp();
    const one = await player(app, 'map_local');

    const response = await readMap(app, one.token);

    expect(response.statusCode, response.body).toBe(200);
    const map = response.json<CityResponse>();
    expect(map.cityId).toBe(DEFAULT_CITY_ID);
    expect(map.districts.map((row) => row.district.id)).toEqual(
      districtsOfCity(DEFAULT_CITY_ID).map((district) => district.id),
    );
    expect(map.districts.filter((row) => row.isHome)).toHaveLength(1);
  });

  it('answers for a city asked for by name', async () => {
    const app = await makeApp();
    const one = await player(app, 'map_traveller');

    const map = (await readMap(app, one.token, TERMINUS_CITY_ID)).json<CityResponse>();

    expect(map.cityId).toBe(TERMINUS_CITY_ID);
    expect(map.districts.map((row) => row.district.id)).toEqual(
      districtsOfCity(TERMINUS_CITY_ID).map((district) => district.id),
    );
    // The crew is still where it was. The map moved, not them.
    expect(map.districts.some((row) => row.isHome)).toBe(false);
    expect(map.homeDistrictId).not.toBe('');
  });

  /**
   * The door: a stranger to the city gets the whole map (maintainer, 2026-09-29: "whole city
   * visible"). A refusal here would be a city a player can never decide to go to.
   */
  it('lets a crew that holds nothing there look, and shows them all of it', async () => {
    const app = await makeApp();
    const one = await player(app, 'map_stranger');

    const response = await readMap(app, one.token, TERMINUS_CITY_ID);

    expect(response.statusCode, response.body).toBe(200);
    const map = response.json<CityResponse>();
    expect(map.districts.length).toBeGreaterThan(0);
    for (const row of map.districts) {
      expect(row.held).toEqual({ mine: 0, total: row.district.locations.length });
      // And a real road, not the zero a home district the map does not hold used to be quoted.
      expect(row.travelMinutes).toBeGreaterThan(0);
    }
  });

  /** One location abroad, and the map of that city counts it. */
  it('carries the holdings of the city being looked at', async () => {
    const app = await makeApp();
    const one = await player(app, 'map_holder');
    const [plot] = AWAY.locations;

    give(app, plot!.id, one.baseId);

    const after = (await readMap(app, one.token, TERMINUS_CITY_ID)).json<CityResponse>();
    const walked = after.districts.find((row) => row.district.id === AWAY.id);
    expect(walked?.held).toEqual({ mine: 1, total: AWAY.locations.length });
    expect(after.districts.filter((row) => row.held.mine > 0)).toHaveLength(1);
  });

  it('refuses a city nobody has drawn', async () => {
    const app = await makeApp();
    const one = await player(app, 'map_nowhere');

    // `redline` is a row in `CITIES` with no districts behind it: a name on the world screen.
    expect((await readMap(app, one.token, 'redline')).statusCode).toBe(404);
    expect((await readMap(app, one.token, 'a-city-nobody-drew')).statusCode).toBe(404);
  });
});
