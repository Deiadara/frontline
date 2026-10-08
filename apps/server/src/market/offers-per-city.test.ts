import {
  BLUEPRINTS,
  CITY_DISTRICTS,
  REIMAGINING_RESEARCH_ID,
  claimUntil,
  createCommander,
  type ItemId,
  type MarketMutationResponse,
  type MarketOffer,
  type MarketResponse,
} from '@frontline/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';

/**
 * The District Offers board is a city's (maintainer, 2026-09-29).
 *
 * Every city tab showed the same listings, so a crew living in Terminus with nothing in Ashfall
 * was refused Ashfall's market and still read and took an Ashfall crew's listing off its own
 * Terminus board. A listing now belongs to the city it was posted in, a counter to its listing's,
 * and reading, posting, countering and taking all stand behind the city's door.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const TERMINUS_HOME = 'coldwater-halt';
const LISTING = {
  give: { resources: { scrap: 100 }, items: {} },
  want: { resources: { caps: 50 }, items: {} },
};

interface World {
  app: FastifyInstance;
  db: AppDatabase;
  /** Lives in Ashfall and holds nothing anywhere else. */
  ashfall: string;
  /** Lives in Terminus and holds nothing in Ashfall until a test gives it a place there. */
  terminus: string;
}

async function crew(app: FastifyInstance, username: string): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  openDoors(app, token, 'market', 'offers');
  const base = baseOf(app, username);
  app.repos.bases.updateHoldings(base.id, { ...base.resources, scrap: 200, caps: 500 }, {});
  return token;
}

function baseOf(app: FastifyInstance, username: string) {
  const user = app.repos.users.findByUsername(username);
  const base = app.repos.bases.findByOwnerId(user?.id ?? '');
  if (!base) throw new Error('no base');
  return base;
}

async function world(): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const ashfall = await crew(app, 'ashfall_crew');
  const terminus = await crew(app, 'terminus_crew');
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(
    TERMINUS_HOME,
    baseOf(app, 'terminus_crew').id,
  );
  return { app, db, ashfall, terminus };
}

/** Gives the Terminus crew one place in Ashfall, which is what opens Ashfall's rooms to it. */
function footholdInAshfall(w: World): void {
  const location = CITY_DISTRICTS.find((one) => one.id === 'chrome-row')!.locations[0]!;
  const control = w.app.repos.city.control(location.id)!;
  w.app.repos.city.put({
    ...control,
    holder: { kind: 'crew', baseId: baseOf(w.app, 'terminus_crew').id },
  });
}

async function boardOf(w: World, token: string, city?: string) {
  return w.app.inject({
    method: 'GET',
    url: city === undefined ? '/api/market' : `/api/market?city=${city}`,
    headers: auth(token),
  });
}

async function post(w: World, token: string, payload: Record<string, unknown>) {
  return w.app.inject({ method: 'POST', url: '/api/market/offer', headers: auth(token), payload });
}

async function accept(w: World, token: string, offerId: string) {
  return w.app.inject({
    method: 'POST',
    url: '/api/market/accept',
    headers: auth(token),
    payload: { offerId },
  });
}

async function postedListing(w: World): Promise<MarketOffer> {
  const res = await post(w, w.ashfall, LISTING);
  expect(res.statusCode, res.body).toBe(200);
  const listing = res.json<MarketMutationResponse>().market.mine[0]!;
  expect(listing.cityId).toBe('ashfall');
  return listing;
}

describe('a board belongs to a city', () => {
  it('keeps an Ashfall listing off the board of a Terminus crew with no ground in Ashfall', async () => {
    const w = await world();
    const listing = await postedListing(w);

    const home = await boardOf(w, w.terminus);
    expect(home.statusCode).toBe(200);
    expect(home.json<MarketResponse>().cityId).toBe('terminus');
    expect(home.json<MarketResponse>().offers.map((offer) => offer.id)).toEqual([]);
    expect((await boardOf(w, w.terminus, 'ashfall')).statusCode).toBe(403);

    // Nor can it be taken or answered by id: the door is on the write, not only on the screen.
    const caps = baseOf(w.app, 'terminus_crew').resources.caps;
    const taken = await accept(w, w.terminus, listing.id);
    expect(taken.statusCode).toBe(403);
    expect(taken.json<{ error: { code: string } }>().error.code).toBe('CITY_SHUT');
    const countered = await post(w, w.terminus, { ...LISTING, counterTo: listing.id });
    expect(countered.statusCode).toBe(403);
    expect(baseOf(w.app, 'terminus_crew').resources.caps).toBe(caps);
    expect(w.app.repos.market.findById(listing.id)?.status).toBe('open');
  });

  it('opens the listing to the same crew once it holds a place in Ashfall, on the Ashfall tab', async () => {
    const w = await world();
    const listing = await postedListing(w);
    footholdInAshfall(w);

    const own = (await boardOf(w, w.terminus)).json<MarketResponse>();
    expect(own.offers.map((offer) => offer.id)).toEqual([]);
    const ashfall = (await boardOf(w, w.terminus, 'ashfall')).json<MarketResponse>();
    expect(ashfall.offers.map((offer) => offer.id)).toEqual([listing.id]);

    const taken = await accept(w, w.terminus, listing.id);
    expect(taken.statusCode, taken.body).toBe(200);
    // It answers with the board the listing was taken off, not the crew's home city's.
    expect(taken.json<MarketMutationResponse>().market.cityId).toBe('ashfall');
  });

  it('posts on the tab it was posted from, behind that city’s door', async () => {
    const w = await world();
    // The Ashfall crew holds nothing in Terminus.
    const shut = await post(w, w.ashfall, { ...LISTING, cityId: 'terminus' });
    expect(shut.statusCode).toBe(403);

    footholdInAshfall(w);
    const posted = await post(w, w.terminus, { ...LISTING, cityId: 'ashfall' });
    expect(posted.statusCode, posted.body).toBe(200);
    const market = posted.json<MarketMutationResponse>().market;
    expect(market.cityId).toBe('ashfall');
    expect(market.mine.map((offer) => offer.cityId)).toEqual(['ashfall']);

    // On Ashfall's board for the Ashfall crew, and on nobody's Terminus board.
    const seen = (await boardOf(w, w.ashfall)).json<MarketResponse>().offers;
    expect(seen.map((offer) => offer.sellerName)).toEqual([baseOf(w.app, 'terminus_crew').name]);
    const home = (await boardOf(w, w.terminus)).json<MarketResponse>();
    // Its own listings are listed wherever they stand, because Withdraw has to reach them.
    expect(home.mine.map((offer) => offer.cityId)).toEqual(['ashfall']);
  });

  it('pins a counter to its listing’s city, whichever tab it was sent from', async () => {
    const w = await world();
    const listing = await postedListing(w);
    footholdInAshfall(w);

    const sent = await post(w, w.terminus, {
      ...LISTING,
      counterTo: listing.id,
      cityId: 'terminus',
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const counter = sent.json<MarketMutationResponse>().market.mine[0]!;
    expect(counter.counterTo).toBe(listing.id);
    expect(counter.cityId).toBe('ashfall');
    expect(
      (await boardOf(w, w.ashfall)).json<MarketResponse>().offers.map((one) => one.id),
    ).toEqual([counter.id]);
  });
});

/**
 * Every market write answers with the whole board, and it has to be the board it was made at (bug
 * pass, 2026-10-07).
 *
 * `/market/bid` reads the city off the lot it names and `/market/offer` off the listing it posts,
 * which is what they were fixed to do. Five writes had no such reading and called `board(base,
 * now)`, the crew's **home** city: a crew standing at another city's barrow got back a payload
 * whose `cityId`, Runner's stock and listings were all somebody else's. The client keys its cache
 * on that `cityId` (`setBoard` in `lib/queries.ts`), so the tab the trade was made on kept the
 * pre-trade board until a refetch answered it.
 *
 * Four of them take the city the way the read does, off the query, and refuse nothing: a blueprint
 * assembled out of the inventory, a trade at the Lab, the Broker and the day's ration all happen
 * wherever the crew is standing. Claim reads it off the listing the goods came from, the way
 * Accept does.
 */
describe('a market write answers with the barrow it was made at', () => {
  const PAGES = BLUEPRINTS[0].pages.map((page) => page.id as ItemId);

  /** Enough caps and scrap for any one trade below, plus whatever `holding` the test needs. */
  function stockUp(w: World, holding: Partial<Record<ItemId, number>> = {}): void {
    const base = baseOf(w.app, 'terminus_crew');
    w.app.repos.bases.updateHoldings(
      base.id,
      { ...base.resources, caps: 50_000, scrap: 1_000 },
      holding,
    );
  }

  /** Seats a Researcher and banks the rung: the two halves of the §G4 gate on the Lab. */
  function openTheLab(w: World): void {
    const base = baseOf(w.app, 'terminus_crew');
    w.app.repos.bases.updateCommanders(base.id, [
      createCommander('off-lab', 'Vell Ashgrove', 'researcher'),
    ]);
    w.app.repos.bases.updateResearch(base.id, {
      ...base.research,
      technologies: [REIMAGINING_RESEARCH_ID],
    });
  }

  /** A write by the Terminus crew, at the city tab named, the way the read names one. */
  async function writeAt(
    w: World,
    path: string,
    payload: Record<string, unknown>,
    city?: string,
  ): Promise<LightMyRequestResponse> {
    return w.app.inject({
      method: 'POST',
      url: city === undefined ? `/api/${path}` : `/api/${path}?city=${city}`,
      headers: auth(w.terminus),
      payload,
    });
  }

  /**
   * The board a write answered with, checked against the one thing only Ashfall's board carries:
   * the Ashfall crew's standing listing. `cityId` alone would pass on a payload that merely
   * relabelled the home barrow.
   */
  function ashfallBoard(res: LightMyRequestResponse, listing: MarketOffer): MarketResponse {
    expect(res.statusCode, res.body).toBe(200);
    const market = res.json<MarketMutationResponse>().market;
    expect(market.cityId).toBe('ashfall');
    expect(market.offers.map((offer) => offer.id)).toEqual([listing.id]);
    return market;
  }

  it('barters at the barrow the request was made at', async () => {
    const w = await world();
    const listing = await postedListing(w);
    footholdInAshfall(w);
    stockUp(w);

    const traded = await writeAt(
      w,
      'market/barter',
      { give: 'scrap', want: 'supplies', amount: 100, acceptWaste: true },
      'ashfall',
    );

    ashfallBoard(traded, listing);
  });

  it('runs the day’s ration at the barrow the request was made at', async () => {
    const w = await world();
    const listing = await postedListing(w);
    footholdInAshfall(w);
    stockUp(w);

    const bought = await writeAt(
      w,
      'market/supply',
      { key: 'scrap', units: 1, acceptWaste: true },
      'ashfall',
    );

    ashfallBoard(bought, listing);
  });

  it('assembles a blueprint and answers with the barrow the request was made at', async () => {
    const w = await world();
    const listing = await postedListing(w);
    footholdInAshfall(w);
    stockUp(w, Object.fromEntries(PAGES.map((page) => [page, 1])));

    const unlocked = await writeAt(
      w,
      'blueprints/unlock',
      { blueprintId: BLUEPRINTS[0].id },
      'ashfall',
    );

    ashfallBoard(unlocked, listing);
  });

  it('trades at the Lab and answers with the barrow the request was made at', async () => {
    const w = await world();
    const listing = await postedListing(w);
    footholdInAshfall(w);
    // Four copies, because the bench only takes spares: one has to stay for the document.
    stockUp(w, { [PAGES[0]!]: 4 });
    openTheLab(w);

    const reimagined = await writeAt(
      w,
      'blueprints/reimagine',
      { pages: [PAGES[0], PAGES[0], PAGES[0]] },
      'ashfall',
    );

    ashfallBoard(reimagined, listing);
  });

  /**
   * Claim takes no city at all: a claim is pinned to the listing its goods came off, and that is
   * the board the player pressing Claim is looking at, wherever they are standing.
   */
  it('claims goods on the board the listing they came off stood on', async () => {
    const w = await world();
    const listing = await postedListing(w);
    footholdInAshfall(w);
    const mine = baseOf(w.app, 'terminus_crew');
    const createdAt = new Date();
    w.app.repos.market.insertClaim({
      id: 'held-in-ashfall',
      baseId: mine.id,
      offer: listing,
      reason: 'taken',
      goods: { resources: { scrap: 10 }, items: {} },
      takenBy: 'somebody',
      createdAt: createdAt.toISOString(),
      claimUntil: claimUntil(createdAt).toISOString(),
    });

    const claimed = await writeAt(w, 'market/claim', {
      claimId: 'held-in-ashfall',
      acceptWaste: true,
    });

    const market = ashfallBoard(claimed, listing);
    expect(market.claims, 'the goods are still being held').toEqual([]);
  });
});
