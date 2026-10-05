import {
  ALL_DISTRICTS,
  BLACK_MARKET_REFUSAL_TEXT,
  CITIES,
  DEFAULT_CITY_ID,
  MAX_NOTORIETY,
  MAX_OPEN_LOTS,
  blackLotId,
  type BlackMarketMutationResponse,
  type BlackMarketResponse,
  type LocationControl,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';

/**
 * Two cities, two back rooms (maintainer's brief, 2026-09-24).
 *
 * `routes/blackmarket-city.test.ts` holds the door and the separate ledgers. What is here is the
 * three things that still read the world when they should have been reading one city:
 *
 *   1. The two-lot limit counted a bare **slot index**, which is 0 to 4 in every city, so two
 *      rooms' slot 3 were one lot and a crew could hold three at once.
 *   2. A bid answered with the shelf in `DEFAULT_CITY_ID` whatever room it landed in.
 *   3. The reserve and the contraband's potency were weighted by a flat average over every base in
 *      the world, so the fence in one city quoted another city's street.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(): Promise<FastifyInstance> {
  // Admin on, as a fixture only: a crew cannot earn a reputation inside a unit test and the fence
  // will not deal with a nobody. Nothing below is waived by it; the lot limit is not an admin gate.
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

/** The away city, read off the map rather than named: the first other one with ground in it. */
const AWAY = CITIES.find(
  (city) => city.id !== DEFAULT_CITY_ID && ALL_DISTRICTS.some((d) => d.cityId === city.id),
);
if (!AWAY) throw new Error('fixture: the atlas has only one city with ground in it');

const AWAY_LOCATIONS = ALL_DISTRICTS.filter((district) => district.cityId === AWAY.id).flatMap(
  (district) => district.locations,
);

interface Crew {
  token: string;
  baseId: string;
}

async function player(app: FastifyInstance, username: string, known = true): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  const baseId = me.json<{ base: { id: string } }>().base.id;
  if (known) {
    const knobs = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { infamy: 5_000_000, notoriety: MAX_NOTORIETY },
    });
    expect(knobs.statusCode, knobs.body).toBe(200);
    // The back room sits inside the Market, whose door is a level.
    openDoors(app, token, 'market');
  }
  return { token, baseId };
}

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

const readShelf = async (
  app: FastifyInstance,
  crew: Crew,
  city?: string,
): Promise<BlackMarketResponse> => {
  const res = await app.inject({
    method: 'GET',
    url: city === undefined ? '/api/black-market' : `/api/black-market?city=${city}`,
    headers: auth(crew.token),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<BlackMarketResponse>();
};

const bid = (
  app: FastifyInstance,
  crew: Crew,
  lot: { slotIndex: number; goodId: string; amount: number },
  city?: string,
) =>
  app.inject({
    method: 'POST',
    url: '/api/black-market/bid',
    headers: auth(crew.token),
    payload: city === undefined ? lot : { ...lot, city },
  });

/** One slot of a shelf, as the bid route wants it: the index, what is in it, and a legal number. */
function offerOn(shelf: BlackMarketResponse, index: number) {
  const offer = shelf.offers[index];
  if (!offer?.lot) throw new Error(`fixture: nothing biddable in slot ${index}`);
  return { slotIndex: offer.slot.index, goodId: offer.slot.goodId, amount: offer.lot.nextBid };
}

/**
 * §H7a's limit, counted by lot and not by shelf position.
 *
 * A slot index is 0 to 4 in every city and `bidsOn(day)` is the whole world's night, so the
 * identity the limit was counting collided as soon as a second room opened: two crates in the
 * default city and a third on the away shelf's slot 0 read as two lots, because 0 was already in
 * the set. The id `blackLotId` mints names the room as well as the slot.
 */
describe('how many crates a crew may have money on', () => {
  it('counts each room on its own, and a full home shelf does not shut the away one', async () => {
    /*
     * The maintainer's ruling of 2026-09-24: the cap is per room.
     *
     * An earlier cut of this file pinned the opposite, on the argument that the infamy a crew is
     * staking is one ledger. The Bar's table cap and the barrow's lot cap both went per city in
     * the same pass, and three rooms in one city obeying two rules is something a player has to
     * memorise rather than reason about. The allowance that really is world-wide is the daily
     * infamy spend, which was ruled that way separately and is not this number.
     */
    const app = await makeApp();
    const one = await player(app, 'fence_capped');
    give(app, AWAY_LOCATIONS[0]!.id, one.baseId);

    const home = await readShelf(app, one);
    expect(MAX_OPEN_LOTS, 'fixture: this case is written for a limit of two').toBe(2);
    for (let slot = 0; slot < MAX_OPEN_LOTS; slot += 1) {
      const placed = await bid(app, one, offerOn(home, slot));
      expect(placed.statusCode, placed.body).toBe(200);
    }
    // Full at home: the third crate in this room is refused, which is the half that has not moved.
    const third = await bid(app, one, offerOn(home, 2));
    expect(third.statusCode, third.body).toBe(409);
    expect(third.json<{ error: { message: string } }>().error.message).toBe(
      BLACK_MARKET_REFUSAL_TEXT.too_many_lots,
    );

    // And the away shelf is a different room with its own allowance.
    const away = await readShelf(app, one, AWAY.id);
    const abroad = await bid(app, one, offerOn(away, 0), AWAY.id);
    expect(abroad.statusCode, abroad.body).toBe(200);

    // The lot ids are what the limit counts, and they differ by room.
    expect(blackLotId(home.day, 0, DEFAULT_CITY_ID)).not.toBe(blackLotId(home.day, 0, AWAY.id));
    expect(app.repos.blackMarket.bidsFor(away.day, blackLotId(away.day, 0, AWAY.id)).length).toBe(
      1,
    );
  });

  it('fills the away room up on its own, and then refuses', async () => {
    const app = await makeApp();
    const one = await player(app, 'fence_two_rooms');
    give(app, AWAY_LOCATIONS[0]!.id, one.baseId);

    // One at home, which must not count against the room abroad.
    const home = await readShelf(app, one);
    expect((await bid(app, one, offerOn(home, 0))).statusCode).toBe(200);

    const away = await readShelf(app, one, AWAY.id);
    for (let slot = 0; slot < MAX_OPEN_LOTS; slot += 1) {
      const placed = await bid(app, one, offerOn(away, slot), AWAY.id);
      expect(placed.statusCode, placed.body).toBe(200);
    }
    // The away room is full on its own count now.
    expect((await bid(app, one, offerOn(away, MAX_OPEN_LOTS), AWAY.id)).statusCode).toBe(409);
    // And home still has one left, which is what "per room" means.
    expect((await bid(app, one, offerOn(home, 1))).statusCode).toBe(200);
  });
});

describe('the shelf a bid answers with', () => {
  it('draws the room the bid landed in, not the default city', async () => {
    const app = await makeApp();
    const one = await player(app, 'fence_answer');
    give(app, AWAY_LOCATIONS[0]!.id, one.baseId);

    const away = await readShelf(app, one, AWAY.id);
    const lot = offerOn(away, 0);
    const placed = await bid(app, one, lot, AWAY.id);
    expect(placed.statusCode, placed.body).toBe(200);
    const shelf = placed.json<BlackMarketMutationResponse>().blackMarket;

    expect(shelf.cityId).toBe(AWAY.id);
    expect(shelf.offers[0]?.slot.goodId).toBe(lot.goodId);
    expect(shelf.offers[0]?.lot?.yourBid, 'the crate just bid on was not on the shelf').toBe(
      lot.amount,
    );
    expect(shelf.offers[0]?.lot?.leading?.yours).toBe(true);
  });
});

/**
 * What the dealer prices against (§A4, `city/access.ts`).
 *
 * `cityLevelFor` was a flat average of every non-bot base in the game, which is one street for
 * every back room there is. The Bar was moved off that onto `calibreOf`, which weighs the crews
 * with a stake in *that* city, a resident at a whole share and a visitor at the share of ten
 * locations they hold, and counts the notoriety ladder at two levels a rung.
 */
describe('the street a back room is stocked against', () => {
  it('prices an away room against the crews holding it, not against the world', async () => {
    const app = await makeApp();
    // Somebody the street has heard of, holding the away city outright, and somebody quiet who
    // lives in the default city and has never left it.
    const loud = await player(app, 'fence_loud');
    await player(app, 'fence_quiet', false);
    for (const location of AWAY_LOCATIONS.slice(0, 10)) give(app, location.id, loud.baseId);

    const home = await readShelf(app, loud);
    const away = await readShelf(app, loud, AWAY.id);

    expect(away.day, 'two different days would make the two numbers incomparable').toBe(home.day);
    expect(
      away.cityLevel,
      'the away room is quoting the whole world rather than the crew holding it',
    ).toBeGreaterThan(home.cityLevel);
    // And the price on the shelf moves with it: the weighting is not merely reported.
    const dearest = (shelf: BlackMarketResponse) =>
      Math.max(...shelf.offers.map((offer) => offer.price));
    expect(dearest(away)).toBeGreaterThan(0);
  });
});
