import {
  ALL_DISTRICTS,
  DEFAULT_CITY_ID,
  MAX_NOTORIETY,
  SALTMARCH_CITY_ID,
  blackLotId,
  cityOfBlackLot,
  type BlackMarketResponse,
  type LocationControl,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The door on a city's back room (maintainer, 2026-09-17).
 *
 * The fence was the last of the three shops to get one. The Runner's barrow and the Bar's room have
 * belonged to a city since the access rule landed; this screen carried a *tag* instead, because the
 * shelf, the lot ids and the turnover counter were keyed by the day and the slot alone, so a picker
 * would have changed the word over the crates without changing the crates.
 *
 * `bar-city.test.ts` covers the door itself, and the rule behind both is unit tested in
 * `city/access.test.ts`. What is asserted here is the half that was the actual work: that the two
 * rooms are **separate ledgers** rather than one shelf with two labels. Three things have to be
 * true of that, and each of them was a real defect before the change:
 *
 *   1. Two cities carry different crates on the same day.
 *   2. A bid placed in one room does not appear in the other, which is what the lot id's room
 *      prefix buys: both tables that hold a bid are keyed on that id.
 *   3. Every city is named in that prefix, with no exception for the open one, so the scheme has
 *      no case in it that a future reader has to remember.
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
  // Admin on, as a fixture only: a crew cannot earn a reputation inside a unit test and the fence
  // will not deal with a nobody. Nothing here is priced in resources or measured in seconds.
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'true',
  });
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
  const baseId = me.json<{ base: { id: string } }>().base.id;
  const knobs = await app.inject({
    method: 'POST',
    url: '/api/admin/knobs',
    headers: auth(token),
    payload: { infamy: 500_000, notoriety: MAX_NOTORIETY },
  });
  expect(knobs.statusCode, knobs.body).toBe(200);
  return { token, baseId };
}

const readShelf = (app: FastifyInstance, token: string, city?: string) =>
  app.inject({
    method: 'GET',
    url: city === undefined ? '/api/black-market' : `/api/black-market?city=${city}`,
    headers: auth(token),
  });

/** A location in a city the crew does not live in, which is what makes them a visitor to it. */
const AWAY_LOCATION = ALL_DISTRICTS.filter(
  (district) => district.cityId === SALTMARCH_CITY_ID && district.locations.length > 0,
)[0]!.locations[0]!;

function give(app: FastifyInstance, locationId: string, baseId: string): void {
  const control: LocationControl = {
    locationId,
    holder: { kind: 'crew', baseId },
    level: 1,
    upgradingUntil: null,
    fortification: 0,
    fortifyingUntil: null,
    garrison: {},
  };
  app.repos.city.put(control);
}

describe('which back room a crew may stand in', () => {
  it('opens their own city without being asked, and says which that is', async () => {
    const app = await makeApp();
    const one = await player(app, 'fence_local');

    const response = await readShelf(app, one.token);

    expect(response.statusCode, response.body).toBe(200);
    const shelf = response.json<BlackMarketResponse>();
    expect(shelf.cityId).toBe(DEFAULT_CITY_ID);
    expect(shelf.cities).toEqual([DEFAULT_CITY_ID]);
    expect(shelf.offers.length).toBeGreaterThan(0);
  });

  it('refuses a city the crew holds no ground in, rather than answering with their own', async () => {
    const app = await makeApp();
    const one = await player(app, 'fence_stranger');

    const response = await readShelf(app, one.token, SALTMARCH_CITY_ID);

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('CITY_SHUT');
  });

  /**
   * One location, and the room opens with different crates in it.
   *
   * Both halves in one case on purpose: a door that opens onto the same five things a crew can
   * already see at home is a door with nothing behind it, which is exactly the state this screen
   * was in before the change.
   */
  it('opens on one location held, and carries its own crates', async () => {
    const app = await makeApp();
    const one = await player(app, 'fence_visitor');
    give(app, AWAY_LOCATION.id, one.baseId);

    const away = await readShelf(app, one.token, SALTMARCH_CITY_ID);
    expect(away.statusCode, away.body).toBe(200);
    const saltmarch = away.json<BlackMarketResponse>();
    expect(saltmarch.cityId).toBe(SALTMARCH_CITY_ID);
    expect(saltmarch.cities).toContain(SALTMARCH_CITY_ID);

    const home = (await readShelf(app, one.token)).json<BlackMarketResponse>();
    expect(home.day, 'the two reads have to be the same day or the crates prove nothing').toBe(
      saltmarch.day,
    );
    expect(saltmarch.offers.map((offer) => offer.slot.goodId)).not.toEqual(
      home.offers.map((offer) => offer.slot.goodId),
    );
  });

  /**
   * And the two ledgers are separate, which is the half the lot id's prefix is for.
   *
   * A bid is stored against `(day, lot_id, user_id)` and a result against `(day, lot_id)`. Before
   * the prefix, slot 3 in Saltmarch and slot 3 in Ashfall were one lot id, so this crew would have
   * been leading a lot in a city they had never been to.
   */
  it('keeps a bid in the room it was placed in', async () => {
    const app = await makeApp();
    const one = await player(app, 'fence_bidder');
    give(app, AWAY_LOCATION.id, one.baseId);

    const saltmarch = (
      await readShelf(app, one.token, SALTMARCH_CITY_ID)
    ).json<BlackMarketResponse>();
    const lot = saltmarch.offers[0]!;
    const placed = await app.inject({
      method: 'POST',
      url: '/api/black-market/bid',
      headers: auth(one.token),
      payload: {
        slotIndex: lot.slot.index,
        goodId: lot.slot.goodId,
        amount: lot.price + 100,
        city: SALTMARCH_CITY_ID,
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);

    const away = (await readShelf(app, one.token, SALTMARCH_CITY_ID)).json<BlackMarketResponse>();
    expect(away.offers[lot.slot.index]?.lot?.yourBid).toBe(lot.price + 100);

    const home = (await readShelf(app, one.token)).json<BlackMarketResponse>();
    expect(
      home.offers[lot.slot.index]?.lot?.yourBid,
      'a bid in Saltmarch is showing on the Ashfall shelf',
    ).toBeNull();
  });

  /**
   * Every city names its own lots, the open one included.
   *
   * Pinned as literals rather than against the function, because the function is the thing that
   * could change: both tables that hold a bid are keyed on this string, so a scheme that quietly
   * started folding one city to a bare id would compile, pass every other test in this file, and
   * put two cities' slot 3 back into one auction.
   *
   * It used to fold Ashfall to an empty prefix so that ids already in the database kept their
   * names. Nothing is released, so nothing needs keeping, and one scheme with no exception in it is
   * worth more than the trick (maintainer, 2026-09-17).
   */
  it('names every city in its lot ids, with no exception for the open one', () => {
    expect(blackLotId('2026-09-17', 3)).toBe('ashfall:2026-09-17-black-3');
    expect(blackLotId('2026-09-17', 3, DEFAULT_CITY_ID)).toBe('ashfall:2026-09-17-black-3');
    expect(blackLotId('2026-09-17', 3, SALTMARCH_CITY_ID)).toBe('saltmarch:2026-09-17-black-3');
    // ...and the prefix is what the close reads back to find the room again.
    expect(cityOfBlackLot(blackLotId('2026-09-17', 3))).toBe(DEFAULT_CITY_ID);
    expect(cityOfBlackLot(blackLotId('2026-09-17', 3, SALTMARCH_CITY_ID))).toBe(SALTMARCH_CITY_ID);
  });
});
