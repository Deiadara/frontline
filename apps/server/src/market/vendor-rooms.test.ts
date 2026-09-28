import {
  ALL_DISTRICTS,
  CITIES,
  DEFAULT_CITY_ID,
  MAX_OPEN_LOTS,
  cityOfVendorLine,
  instantAtHourInZone,
  vendorSessionsFor,
  vendorStockFor,
  type Base,
  type LocationControl,
  type MarketResponse,
  type VendorLine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';
import { placeVendorBid } from './auction.js';

/**
 * Two cities, two barrows (maintainer's brief, 2026-09-24).
 *
 * The read on `/market` has been gated by the city door since the second city opened. The **write**
 * was not gated at all: `POST /market/bid` never asked which room the lot was in, and
 * `findVendorLine` searches every city, so a crew with no stake in an away city could take a lot
 * off its barrow by sending the line id. That is the case this file exists for; the rest of it is
 * the other two things the bid route was doing in the wrong room.
 */

/** A fixed September day, so the barrow, the hours and the close are the same every morning. */
const DAY = '2026-09-15';

/** Half an hour into the day's first visit: he is in, in every city. */
function duringVisit(day: string, session = 0): Date {
  const slot = vendorSessionsFor(day)[session];
  if (!slot) throw new Error(`fixture: no session ${session} on ${day}`);
  return new Date(instantAtHourInZone(day, slot.startHour).getTime() + 30 * 60_000);
}

const WHILE_HE_IS_IN = duringVisit(DAY);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(WHILE_HE_IS_IN);
});

afterAll(() => {
  vi.useRealTimers();
});

/** The away city, read off the map rather than named: the first other one with ground in it. */
const AWAY = CITIES.find(
  (city) => city.id !== DEFAULT_CITY_ID && ALL_DISTRICTS.some((d) => d.cityId === city.id),
);
if (!AWAY) throw new Error('fixture: the atlas has only one city with ground in it');

const AWAY_LOCATIONS = ALL_DISTRICTS.filter((district) => district.cityId === AWAY.id).flatMap(
  (district) => district.locations,
);

const HOME_STOCK = vendorStockFor(DAY);
const AWAY_STOCK = vendorStockFor(DAY, AWAY.id);

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
  vi.setSystemTime(WHILE_HE_IS_IN);
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface Crew {
  userId: string;
  baseId: string;
  token: string;
}

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

async function signIn(app: FastifyInstance, username: string, caps = 1_000_000): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await chooseOverseer(app, token);
  openDoors(app, token, 'market');
  expect(chosen.statusCode).toBe(201);
  // A §F6 signature that takes 15% off a list price would make what a crew can afford depend on
  // which four characters it was offered.
  pinOverseer(app, token);
  const base = chosen.json<{ base: Base }>().base;
  app.repos.bases.updateResources(base.id, { ...base.resources, caps });
  return { userId: user.id, baseId: base.id, token };
}

function baseOf(app: FastifyInstance, crew: Crew): Base {
  const base = app.repos.bases.findById(crew.baseId);
  if (!base) throw new Error('fixture: the crew lost its district');
  return base;
}

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

const postBid = (app: FastifyInstance, crew: Crew, line: VendorLine, amount?: number) =>
  app.inject({
    method: 'POST',
    url: '/api/market/bid',
    headers: auth(crew.token),
    payload: { lineId: line.id, amount: amount ?? line.price },
  });

const errorOf = (body: string): { code: string; message: string } =>
  (JSON.parse(body) as { error: { code: string; message: string } }).error;

describe('the door on a bid', () => {
  it('refuses a lot in a city the crew holds no ground in', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');

    const refused = await postBid(app, ana, AWAY_STOCK[0]!);

    expect(refused.statusCode, refused.body).toBe(403);
    expect(errorOf(refused.body).code).toBe('CITY_SHUT');
    // Nothing was written: a refusal that still filed the bid would be a door with a hole in it.
    expect(app.repos.vendorAuctions.bidsFor(DAY, 0, AWAY_STOCK[0]!.id)).toEqual([]);
  });

  it('opens on one location, and shuts again when it is taken back', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const line = AWAY_STOCK[0]!;

    give(app, AWAY_LOCATIONS[0]!.id, ana.baseId);
    const placed = await postBid(app, ana, line);
    expect(placed.statusCode, placed.body).toBe(200);

    // Thrown out: the ground goes back to nobody's, and the next bid is refused.
    app.repos.city.put({
      locationId: AWAY_LOCATIONS[0]!.id,
      holder: { kind: 'unoccupied' },
      level: 1,
      upgradingUntil: null,
      garrison: {},
    });
    const shut = await postBid(app, ana, line, line.price * 4);
    expect(shut.statusCode).toBe(403);
  });

  it('leaves the home barrow alone', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const placed = await postBid(app, ana, HOME_STOCK[0]!);
    expect(placed.statusCode, placed.body).toBe(200);
  });
});

describe('the board a bid answers with', () => {
  it('draws the barrow the bid landed at, not the crew’s own', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    give(app, AWAY_LOCATIONS[0]!.id, ana.baseId);
    const line = AWAY_STOCK[0]!;

    const placed = await postBid(app, ana, line);
    expect(placed.statusCode, placed.body).toBe(200);
    const board = placed.json<{ market: MarketResponse }>().market;

    expect(board.cityId).toBe(AWAY.id);
    const lot = board.vendor.stock.find((entry) => entry.line.id === line.id);
    expect(lot, 'the lot just bid on was not on the board that came back').toBeDefined();
    expect(lot?.auction?.yourBid).toBe(line.price);
    expect(lot?.auction?.leading?.yours).toBe(true);
  });

  /**
   * The Runner keeps one timetable and two barrows (maintainer's brief, 2026-09-24).
   *
   * `vendorSessionsFor` takes no city and that is the decision, not an oversight: he is one man,
   * in both yards in the same two-hour windows, carrying different stock. The close depends on it.
   * A lot is settled out of `vendor_bids`, which names a day, a session and a line and nothing
   * else, and the instant a visit ends is `visitClosesAt(day, session)`; per-city hours would make
   * one `(day, session)` pair two different instants.
   */
  it('keeps one timetable across the cities and two different barrows', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    give(app, AWAY_LOCATIONS[0]!.id, ana.baseId);

    const read = async (city?: string) => {
      const res = await app.inject({
        method: 'GET',
        url: city === undefined ? '/api/market' : `/api/market?city=${city}`,
        headers: auth(ana.token),
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json<MarketResponse>();
    };
    const home = await read();
    const away = await read(AWAY.id);

    expect(away.vendor.sessions).toEqual(home.vendor.sessions);
    expect(away.vendor.session).toBe(home.vendor.session);
    expect(away.vendor.closesAt).toBe(home.vendor.closesAt);
    const ids = (board: MarketResponse) => board.vendor.stock.map((entry) => entry.line.id);
    expect(ids(away)).not.toEqual(ids(home));
    expect(ids(away).some((id) => ids(home).includes(id))).toBe(false);
  });
});

/**
 * §H7a's cap, per barrow.
 *
 * `vendor_bids` is keyed `(day, session, line_id, user_id)` with no city, so the count was every
 * lot the crew had money on anywhere: two in the default city and the away barrow refused a crew
 * its first lot there. A line id carries the room it was drawn for, so the split is a filter.
 */
describe('how many lots a crew may hold', () => {
  it('counts them per city, and still refuses one lot too many in the same room', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    give(app, AWAY_LOCATIONS[0]!.id, ana.baseId);
    const now = WHILE_HE_IS_IN;
    const bidOn = (line: VendorLine) =>
      placeVendorBid(app.repos, {
        base: baseOf(app, ana),
        userId: ana.userId,
        lineId: line.id,
        amount: line.price,
        now,
      });

    for (const line of HOME_STOCK.slice(0, MAX_OPEN_LOTS)) {
      expect(bidOn(line)).toEqual({ kind: 'placed' });
    }
    // The allowance is spent in the room it was spent in.
    expect(bidOn(HOME_STOCK[MAX_OPEN_LOTS]!)).toMatchObject({ reason: 'too_many_lots' });

    // …and not in the other one, where this crew has nothing down.
    for (const line of AWAY_STOCK.slice(0, MAX_OPEN_LOTS)) {
      expect(cityOfVendorLine(line.id), 'fixture: that is not an away line').toBe(AWAY.id);
      expect(bidOn(line)).toEqual({ kind: 'placed' });
    }
    expect(bidOn(AWAY_STOCK[MAX_OPEN_LOTS]!)).toMatchObject({ reason: 'too_many_lots' });
  });
});
