import {
  ALL_DISTRICTS,
  DEFAULT_CITY_ID,
  SALTMARCH_CITY_ID,
  type BarResponse,
  type LocationControl,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The door on a city's bar (maintainer request, 2026-09-17).
 *
 * "If you own even a single location in a district, you can access its bar and its market. If you
 * are kicked out you lose that privilege."
 *
 * The rule itself is unit tested in `@frontline/shared` (`city/access.test.ts`) against plain
 * records. What only a real server answers is whether the rule is actually **on the door**: that a
 * crew reading their own city is let in without asking, that naming a city they hold nothing in is
 * refused rather than quietly answered with their own room, that taking one location opens it, and
 * that losing that location shuts it again. The last is the whole of "if you are kicked out", and it
 * is the one a permission granted at capture time would get wrong.
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
  const body = me.json<{ base: { id: string } }>();
  return { token, baseId: body.base.id };
}

const readBar = (app: FastifyInstance, token: string, city?: string) =>
  app.inject({
    method: 'GET',
    url: city === undefined ? '/api/bar' : `/api/bar?city=${city}`,
    headers: auth(token),
  });

/** Saltmarch's locations: the ground every crew in these fixtures is a visitor to. */
const SALTMARCH_LOCATIONS = ALL_DISTRICTS.filter(
  (district) => district.cityId === SALTMARCH_CITY_ID,
).flatMap((district) => district.locations);

/** A location in a city the crew does not live in, for the visitor cases. */
const AWAY_LOCATION = ALL_DISTRICTS.filter(
  (district) => district.cityId === SALTMARCH_CITY_ID && district.locations.length > 0,
)[0]!.locations[0]!;

/** A control row for a location, held by whoever is named. */
function control(locationId: string, holder: LocationControl['holder']): LocationControl {
  return {
    locationId,
    holder,
    level: 1,
    upgradingUntil: null,
    fortification: 0,
    fortifyingUntil: null,
    garrison: {},
  };
}

/** Hands one location to a crew, the way winning it would. */
function give(app: FastifyInstance, locationId: string, baseId: string): void {
  app.repos.city.put(control(locationId, { kind: 'crew', baseId }));
}

/** And takes it off them, the way losing it would: back to nobody's. */
function take(app: FastifyInstance, locationId: string): void {
  app.repos.city.put(control(locationId, { kind: 'unoccupied' }));
}

describe('which bar a crew may drink in', () => {
  it('opens their own city without being asked, and says which that is', async () => {
    const app = await makeApp();
    const one = await player(app, 'bar_local');

    const response = await readBar(app, one.token);

    expect(response.statusCode, response.body).toBe(200);
    const bar = response.json<BarResponse>();
    expect(bar.cityId).toBe(DEFAULT_CITY_ID);
    expect(bar.cities).toEqual([DEFAULT_CITY_ID]);
    expect(bar.recruits.length).toBeGreaterThan(0);
  });

  it('refuses a city the crew holds no ground in, rather than answering with their own', async () => {
    const app = await makeApp();
    const one = await player(app, 'bar_stranger');

    const response = await readBar(app, one.token, SALTMARCH_CITY_ID);

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('CITY_SHUT');
  });

  it('refuses a city that is not on the map at all', async () => {
    const app = await makeApp();
    const one = await player(app, 'bar_nowhere');
    const response = await readBar(app, one.token, 'a-city-nobody-drew');
    expect(response.statusCode).toBe(403);
  });

  /**
   * One location is the whole price, and losing it is the whole revocation.
   *
   * Both halves in one test on purpose: a permission granted at capture time passes the first half
   * and fails the second, and that is the bug this mechanic is most likely to be written with.
   */
  it('opens on one location and shuts again when it is taken back', async () => {
    const app = await makeApp();
    const one = await player(app, 'bar_visitor');

    expect((await readBar(app, one.token, SALTMARCH_CITY_ID)).statusCode).toBe(403);

    give(app, AWAY_LOCATION.id, one.baseId);
    const inside = await readBar(app, one.token, SALTMARCH_CITY_ID);
    expect(inside.statusCode, inside.body).toBe(200);
    const bar = inside.json<BarResponse>();
    expect(bar.cityId).toBe(SALTMARCH_CITY_ID);
    // The picker carries both rooms, the crew's own first.
    expect(bar.cities).toEqual([DEFAULT_CITY_ID, SALTMARCH_CITY_ID]);

    take(app, AWAY_LOCATION.id);
    expect((await readBar(app, one.token, SALTMARCH_CITY_ID)).statusCode).toBe(403);
  });

  /**
   * Two cities are two rooms, not the same eight people twice.
   *
   * The roster is a pure function of the day, so without the city in its seed every city in the
   * world would be running the same bar, and a player with a stake in two of them would see one
   * room drawn twice with the same names in it.
   */
  it('puts different people in different cities on the same day', async () => {
    const app = await makeApp();
    const one = await player(app, 'bar_two_rooms');
    give(app, AWAY_LOCATION.id, one.baseId);

    const home = (await readBar(app, one.token)).json<BarResponse>();
    const away = (await readBar(app, one.token, SALTMARCH_CITY_ID)).json<BarResponse>();

    expect(away.day).toBe(home.day);
    expect(away.recruits.map((one) => one.id)).not.toEqual(home.recruits.map((one) => one.id));
    // And no recruit id is shared, or a bid in one room would name somebody in the other.
    const homeIds = new Set(home.recruits.map((recruit) => recruit.id));
    expect(away.recruits.some((recruit) => homeIds.has(recruit.id))).toBe(false);
  });
});

/**
 * Who is in a city decides what its rooms offer (maintainer request, 2026-09-17).
 *
 * "You affect the drops as well if you can participate, as a percentage of how many locations you
 * own, and if you own 10 locations you max out. A player who is already there affects it by a
 * constant amount since they have their home district there. Both your infamy level and your
 * district level count towards it."
 *
 * The arithmetic is unit tested in `@frontline/shared`. What is pinned here is that it is actually
 * wired to a room: the Bar used the flat average level of every base in the world, and a weighting
 * nothing reads is a rule that does not exist. Measured on the sum of every attribute on the
 * roster, which is what a calibre moves and the one number on the response that cannot be moved by
 * anything else in these fixtures.
 */
describe('what a city’s room is stocked against', () => {
  const sheetTotal = (bar: BarResponse): number =>
    bar.recruits.reduce(
      (total, recruit) =>
        total + Object.values(recruit.attributes).reduce((sum, value) => sum + value, 0),
      0,
    );

  it('climbs with the rank of the crews standing in it, not only their levels', async () => {
    const app = await makeApp();
    const one = await player(app, 'bar_calibre');

    const before = sheetTotal((await readBar(app, one.token)).json<BarResponse>());

    // The same crew, further up the ladder. Nothing else about the world moves.
    const base = app.repos.bases.findById(one.baseId)!;
    app.repos.bases.updateEconomy(one.baseId, { ...base.economy, notoriety: 8 });

    const after = sheetTotal((await readBar(app, one.token)).json<BarResponse>());
    expect(after, 'the ladder counts for nothing in the room').toBeGreaterThan(before);
  });

  /**
   * And a visitor's ground counts, in proportion to how much of it there is.
   *
   * Measured in a city neither crew lives in, which is the only place a visitor's weight is visible
   * at all: everybody is seeded into Ashfall, so in Ashfall every crew is a resident carrying a
   * whole share already and holding ground there adds nothing to their say (which is the rule, and
   * it is what the first version of this test got wrong). Abroad they are both visitors, so the one
   * holding ten locations pulls ten times as hard as the one holding one.
   */
  it('lets a visitor holding more ground pull an away room further towards their standing', async () => {
    const app = await makeApp();
    const quiet = await player(app, 'bar_away_quiet');
    const loud = await player(app, 'bar_away_loud');

    const base = app.repos.bases.findById(loud.baseId)!;
    app.repos.bases.updateEconomy(loud.baseId, { ...base.economy, notoriety: 10 });

    // A location each: both through the door, both pulling a tenth of a share.
    give(app, SALTMARCH_LOCATIONS[0]!.id, quiet.baseId);
    give(app, SALTMARCH_LOCATIONS[1]!.id, loud.baseId);
    const even = sheetTotal(
      (await readBar(app, quiet.token, SALTMARCH_CITY_ID)).json<BarResponse>(),
    );

    // The loud one takes nine more, which is the ceiling: a whole share against the other's tenth.
    for (const location of SALTMARCH_LOCATIONS.slice(2, 11)) give(app, location.id, loud.baseId);
    const tilted = sheetTotal(
      (await readBar(app, quiet.token, SALTMARCH_CITY_ID)).json<BarResponse>(),
    );

    expect(tilted, 'ground held in a city buys no say in it').toBeGreaterThan(even);
  });
});
