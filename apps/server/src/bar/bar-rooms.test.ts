import {
  ALL_DISTRICTS,
  CITIES,
  DEFAULT_CITY_ID,
  createCommander,
  maxOpenAuctionsFor,
  type BarAuction,
  type BarResponse,
  type BidResponse,
  type LocationControl,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';
import { reserveFor, settleBarAuctions } from './auction.js';
import {
  BAR_ROSTER_SIZE,
  cityOfRecruit,
  findBarRecruit,
  parseRecruitId,
  recruitId,
  seatOf,
} from './roster.js';
import { crewEffectsFor } from '../crew/standing.js';

/**
 * Two cities, two bars (maintainer's brief, 2026-09-24).
 *
 * `bar-city.test.ts` holds the door: who may walk into which room. This file holds what happens
 * once they are inside an away room, which is where the Bar was broken in four places at once.
 *
 * The worst of them was silent. A recruit id carries the city it was minted in, and `seatOf` was
 * matching `bar-<day>-<seat>-<gen>` with the day interpolated into the pattern, which cannot match
 * `bar-terminus:<day>-<seat>-<gen>`. Nothing threw: the close simply could not rebuild the person
 * the table was about, so **every away table settled as an empty room** with the name `Somebody`
 * and no winner, for ever, while the crews at it were told nothing and charged nothing.
 */

/** Midday in Athens: the open phase, where the ordinary bidding happens. */
const NOW = new Date('2026-08-13T09:00:00.000Z');
/** Half past midnight in Athens: a new day, and yesterday's tables are due. */
const AFTER = new Date('2026-08-13T21:30:00.000Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
  vi.setSystemTime(NOW);
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

/**
 * The away city, read off the map rather than named.
 *
 * Every crew is seeded into the default city, so "away" is the first other city with ground in the
 * atlas. Taken from the data so that renaming or opening a city cannot leave this file testing a
 * place nobody can reach.
 */
const AWAY = CITIES.find(
  (city) => city.id !== DEFAULT_CITY_ID && ALL_DISTRICTS.some((d) => d.cityId === city.id),
);
if (!AWAY) throw new Error('fixture: the atlas has only one city with ground in it');

const AWAY_LOCATIONS = ALL_DISTRICTS.filter((district) => district.cityId === AWAY.id).flatMap(
  (district) => district.locations,
);

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface Player {
  token: string;
  userId: string;
  baseId: string;
  username: string;
}

async function makePlayer(app: FastifyInstance, username: string): Promise<Player> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(registered.statusCode).toBe(201);
  const body = registered.json<{ token: string; user: { id: string } }>();
  const overseer = await chooseOverseer(app, body.token);
  openDoors(app, body.token, 'bar');
  expect(overseer.statusCode).toBe(201);
  // Which character an account is offered is a hash of a UUID, and each carries a signature perk.
  // Pinned, so two runs price the same room.
  pinOverseer(app, body.token);
  return {
    token: body.token,
    userId: body.user.id,
    baseId: overseer.json<{ base: { id: string } }>().base.id,
    username,
  };
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

async function readBar(app: FastifyInstance, player: Player, city?: string): Promise<BarResponse> {
  const res = await app.inject({
    method: 'GET',
    url: city === undefined ? '/api/bar' : `/api/bar?city=${city}`,
    headers: auth(player.token),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<BarResponse>();
}

const bid = (app: FastifyInstance, player: Player, recruit: string, amount: number) =>
  app.inject({
    method: 'POST',
    url: '/api/bar/bid',
    headers: auth(player.token),
    payload: { recruitId: recruit, amount },
  });

/** Every table this crew can actually sit at, in roster order, with the name on the card. */
function openTables(bar: BarResponse): { auction: BarAuction; name: string }[] {
  const willing = bar.recruits.filter((recruit) => recruit.assessment.interested);
  return willing.flatMap((recruit) => {
    const auction = bar.auctions.find((entry) => entry.recruitId === recruit.id);
    return auction ? [{ auction, name: recruit.name }] : [];
  });
}

function firstTable(bar: BarResponse): { auction: BarAuction; name: string } {
  const [table] = openTables(bar);
  if (!table) throw new Error('fixture: nobody in this room will talk to this crew');
  return table;
}

describe('the id a table is filed under', () => {
  const DAY = '2026-08-13';

  it('leaves the default city byte for byte where it was, and names every other one', () => {
    expect(recruitId(DAY, 3)).toBe(`bar-${DAY}-3-0`);
    expect(recruitId(DAY, 3, DEFAULT_CITY_ID)).toBe(`bar-${DAY}-3-0`);
    expect(recruitId(DAY, 3, AWAY.id)).toBe(`bar-${AWAY.id}:${DAY}-3-0`);
  });

  it('parses back to the room, the day and the seat, away as well as home', () => {
    expect(parseRecruitId(recruitId(DAY, 5, AWAY.id))).toEqual({
      cityId: AWAY.id,
      day: DAY,
      seat: 5,
    });
    expect(parseRecruitId(recruitId(DAY, 5))).toEqual({
      cityId: DEFAULT_CITY_ID,
      day: DAY,
      seat: 5,
    });
    expect(cityOfRecruit(recruitId(DAY, 0, AWAY.id))).toBe(AWAY.id);
    expect(cityOfRecruit(recruitId(DAY, 0))).toBe(DEFAULT_CITY_ID);
    expect(cityOfRecruit('not-a-recruit')).toBeNull();
  });

  /**
   * The bug behind the empty away tables, at the level of one function.
   *
   * `seatOf` is what the close uses to rebuild a table's person from its id alone, and it answered
   * `null` for every away id ever minted.
   */
  it('reads the seat out of an away id, and refuses another day’s', () => {
    expect(seatOf(DAY, recruitId(DAY, 5, AWAY.id))).toBe(5);
    expect(seatOf(DAY, recruitId(DAY, 5))).toBe(5);
    expect(seatOf('2026-08-14', recruitId(DAY, 5, AWAY.id))).toBeNull();
  });

  it('finds an away recruit off the id, without being told which room it came from', () => {
    const away = recruitId(DAY, 2, AWAY.id);
    expect(findBarRecruit(DAY, away)?.id).toBe(away);
    // And the two rooms are two rooms: the same seat, two different people.
    expect(findBarRecruit(DAY, away)?.name).not.toBe(findBarRecruit(DAY, recruitId(DAY, 2))?.name);
  });
});

describe('an away table, from the bid to the close', () => {
  /**
   * The close rebuilds the person, signs them, and says who they were.
   *
   * Every assertion here read `Somebody`, `null` and an empty bench before the id grammar was
   * parseable: the table settled as a room nobody had been in.
   */
  it('settles with the person who was on it, not as an empty room', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'away_closer');
    give(app, AWAY_LOCATIONS[0]!.id, one.baseId);

    const bar = await readBar(app, one, AWAY.id);
    const { auction, name } = firstTable(bar);
    expect(auction.recruitId, 'fixture: this is not an away id').toContain(`${AWAY.id}:`);
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    vi.setSystemTime(AFTER);
    expect(settleBarAuctions(app.repos, AFTER)).toBe(1);

    const [result] = app.repos.bar.results(bar.day);
    expect(result?.recruitName, 'the close could not rebuild the away recruit').toBe(name);
    expect(result?.winnerUserId).toBe(one.userId);
    expect(result?.price).toBe(auction.reserve);

    // …and they are actually on the books, under the name the card wore.
    const after = await readBar(app, one, AWAY.id);
    expect(after.slotsUsed).toBe(1);
    expect(after.officers[0]?.commander.name).toBe(name);
    expect(after.results[0]).toMatchObject({ outcome: 'won', price: auction.reserve });
  });

  /** A results panel belongs to the room it is drawn in, not to every room the crew drinks in. */
  it('keeps an away close off the home room’s results panel', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'away_panel');
    give(app, AWAY_LOCATIONS[0]!.id, one.baseId);

    const bar = await readBar(app, one, AWAY.id);
    const { auction } = firstTable(bar);
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    vi.setSystemTime(AFTER);
    settleBarAuctions(app.repos, AFTER);

    expect((await readBar(app, one, AWAY.id)).results).toHaveLength(1);
    expect((await readBar(app, one)).results).toEqual([]);
  });

  /** The 404 every away bid used to get: the route rebuilt the default city's eight and looked there. */
  it('takes a bid and a raise on an away recruit', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'away_bidder');
    const two = await makePlayer(app, 'away_rival');
    give(app, AWAY_LOCATIONS[0]!.id, one.baseId);
    give(app, AWAY_LOCATIONS[1]!.id, two.baseId);

    const bar = await readBar(app, one, AWAY.id);
    const { auction } = firstTable(bar);
    const placed = await bid(app, one, auction.recruitId, auction.reserve);
    expect(placed.statusCode, placed.body).toBe(200);
    const table = placed.json<BidResponse>().auction;
    expect(table.yourBid).toBe(auction.reserve);
    // The table the response draws is the away table, at the away room's own floor.
    expect(table.recruitId).toBe(auction.recruitId);
    expect(table.reserve).toBe(auction.reserve);

    const over = await bid(app, two, auction.recruitId, table.nextBid);
    expect(over.statusCode, over.body).toBe(200);
    expect(over.json<BidResponse>().auction.leading?.yours).toBe(true);
  });

  /** The bid route has a door of its own now, because resolving away ids opened one. */
  it('refuses an away recruit to a crew that holds no ground there', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'away_stranger');
    const two = await makePlayer(app, 'away_holder');
    give(app, AWAY_LOCATIONS[0]!.id, two.baseId);

    // The id is real and the room is open to somebody: the only thing wrong is who is asking.
    const { auction } = firstTable(await readBar(app, two, AWAY.id));
    const refused = await bid(app, one, auction.recruitId, auction.reserve);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('CITY_SHUT');
  });
});

/**
 * One sheet on the card and on the contract.
 *
 * The read stocks a room off the crews with a stake in that city, counting the notoriety ladder
 * alongside the district level, frozen for the day (`barRoomOf`). The bid routes rebuilt the same
 * seats off `bases.averageLevel()`, a flat mean of every base in the world, so the person a player
 * bid on was generated at one calibre and the person the server priced was generated at another.
 */
describe('the calibre a bid is judged at', () => {
  it('prices a bid against the sheet the card was drawn from', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'calibre_bidder');

    // A crew the street has heard of. The room reads the ladder at two levels a rung, so this
    // pulls it well clear of the flat average the bid routes used to rebuild it at.
    const base = app.repos.bases.findById(one.baseId)!;
    app.repos.bases.updateEconomy(one.baseId, { ...base.economy, notoriety: 12 });

    const bar = await readBar(app, one);
    const { auction } = firstTable(bar);

    // The positive control: the level-1 version of this same person is a different person, so the
    // two numbers below genuinely have room to disagree.
    const flat = findBarRecruit(bar.day, auction.recruitId, app.repos.bases.averageLevel());
    expect(flat, 'fixture: the id does not resolve at all').toBeDefined();
    expect(
      reserveFor(flat!),
      'fixture: the two calibres draw the same reserve, so nothing is proved',
    ).not.toBe(auction.reserve);

    const placed = await bid(app, one, auction.recruitId, auction.reserve);
    expect(placed.statusCode, placed.body).toBe(200);
    expect(placed.json<BidResponse>().auction.reserve).toBe(auction.reserve);
  });
});

/**
 * §H7a's cap, per room (maintainer's brief, 2026-09-24): a table is a room you are standing in.
 *
 * `bar_bids` is keyed `(user_id, day)` with no city, so the count was the crew's tables everywhere
 * at once: two in the default city and the away room refused a crew its first table there.
 */
describe('how many tables a crew may hold', () => {
  it('counts them per city, and still refuses a third in the same room', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'two_rooms');
    give(app, AWAY_LOCATIONS[0]!.id, one.baseId);

    const home = await readBar(app, one);
    const allowed = maxOpenAuctionsFor(home.level);
    expect(home.auctionsAllowed).toBe(allowed);
    const tables = openTables(home);
    expect(tables.length, 'fixture: not enough open tables to fill the allowance').toBeGreaterThan(
      allowed,
    );

    for (const table of tables.slice(0, allowed)) {
      expect((await bid(app, one, table.auction.recruitId, table.auction.reserve)).statusCode).toBe(
        200,
      );
    }

    // The cap still bites in the room it was spent in.
    const third = tables[allowed]!;
    const refused = await bid(app, one, third.auction.recruitId, third.auction.reserve);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('TOO_MANY_AUCTIONS');

    // …and not in the other one.
    const away = await readBar(app, one, AWAY.id);
    expect(away.auctionsUsed, 'the away room counted the home tables').toBe(0);
    const table = firstTable(away);
    const placed = await bid(app, one, table.auction.recruitId, table.auction.reserve);
    expect(placed.statusCode, placed.body).toBe(200);
    expect(placed.json<BidResponse>().auctionsUsed).toBe(1);
    expect((await readBar(app, one)).auctionsUsed).toBe(allowed);
  });
});

/**
 * Eight people, for every crew (maintainer, 2026-09-30).
 *
 * Charisma, Diplomacy and a handful of perks and rungs used to seat up to four more people for the
 * crew that had them. That is gone, and their sources pay other channels now. The fixture crew
 * carries everything that used to widen the room the most, and the control is that the officer is
 * really on its books: their Charisma shows up where it pays today, on training speed.
 */
describe('the size of the room', () => {
  it('seats the same eight for a charismatic crew as for a plain one', async () => {
    const app = await makeApp();
    const plain = await makePlayer(app, 'room_plain');
    const loud = await makePlayer(app, 'room_loud');

    const base = app.repos.bases.findById(loud.baseId)!;
    const before = crewEffectsFor(app.repos, base).trainingSpeedPercent;
    app.repos.bases.updateCommanders(base.id, [
      ...base.commanders,
      createCommander('room-talker', 'Talker', 'consigliere', { charisma: 100, diplomacy: 100 }, [
        'bar_regular',
        'talent_scout',
        'sig_headhunter',
      ]),
    ]);
    const after = crewEffectsFor(app.repos, app.repos.bases.findById(loud.baseId)!);
    expect(
      after.trainingSpeedPercent,
      'fixture: the officer never reached the crew',
    ).toBeGreaterThan(before);

    const plainIds = (await readBar(app, plain)).recruits.map((one) => one.id);
    const loudIds = (await readBar(app, loud)).recruits.map((one) => one.id);
    expect(plainIds).toHaveLength(BAR_ROSTER_SIZE);
    expect(loudIds).toEqual(plainIds);
  });
});
