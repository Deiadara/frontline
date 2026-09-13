/**
 * `page_found`: a bell whenever a blueprint page lands in the satchel, whatever door it came in.
 *
 * §F puts pages behind five doors and every one of them was silent. The rate at which each door
 * hands one over is measured in shared; what only this level can answer is the chain, once per
 * door: the page really moves, the bell really rings, and the sentence on it names the sheet, the
 * document it belongs to and where it came from.
 *
 * Driven through the functions the routes call, with an explicit `now`, for the reason
 * `vendor-auction.test.ts` gives: the barrow's hours and the fence's shelf are functions of the
 * game day, and a test that took whatever hour the suite runs at could not choose a day with a
 * page on it.
 */
import {
  BLUEPRINTS,
  BLACK_MARKET_GOODS,
  BLACK_MARKET_SLOTS,
  GAME_TIMEZONE,
  ITEM_CATALOG,
  MISSION_TEMPLATES,
  REIMAGINING_RESEARCH_ID,
  blackMarketBoard,
  createCommander,
  instantAtHourInZone,
  nextLotBid,
  vendorSessionsFor,
  vendorStockFor,
  visitClosesAt,
  type Base,
  type ItemId,
  type Mission,
  type Notification,
  type VendorLine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { takeFromBlackMarket } from '../blackmarket/shelf.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { placeVendorBid, settleVendorAuctions } from '../market/auction.js';
import { acceptOffer, postOffer } from '../market/board.js';
import { resolveDueMissions, rollMissionOutcome } from '../missions/resolve.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
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

/** A crew with a district and caps enough that money is never the reason a case fails. */
async function signIn(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode).toBe(201);
  const base = chosen.json<{ base: Base }>().base;
  app.repos.bases.updateResources(base.id, { ...base.resources, caps: 1_000_000 });
  return { userId: user.id, baseId: base.id, token };
}

function baseOf(app: FastifyInstance, crew: Crew): Base {
  const base = app.repos.bases.findById(crew.baseId);
  if (!base) throw new Error('fixture: the crew lost its district');
  return base;
}

function hold(app: FastifyInstance, crew: Crew, inventory: Partial<Record<ItemId, number>>): void {
  const base = baseOf(app, crew);
  app.repos.bases.updateHoldings(base.id, base.resources, inventory);
}

function pageBells(app: FastifyInstance, crew: Crew): Notification[] {
  return app.repos.social.notifications(crew.userId, 50).filter((n) => n.kind === 'page_found');
}

/** The sentence the bell is supposed to carry, built from the catalogue rather than typed out. */
function sentenceFor(pageId: string, where: string, count = 1): string {
  const blueprint = BLUEPRINTS.find((spec) => spec.pages.some((page) => page.id === pageId));
  const page = blueprint?.pages.find((entry) => entry.id === pageId);
  if (!blueprint || !page) throw new Error(`fixture: ${pageId} is not a page`);
  const many = count > 1 ? ` \u00d7${count}` : '';
  return `${page.name}${many}, a page of the ${blueprint.name}, ${where}`;
}

const isPage = (id: string): boolean => ITEM_CATALOG[id as ItemId]?.kind === 'page';

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** A fixed autumn morning to start the searches from, so every case runs the same day twice. */
const AUTUMN = '2026-09-15';
const SEARCH_DAYS = 120;

// --- the mission's prize (§F1) ---

describe('a page off a mission', () => {
  function runHome(app: FastifyInstance, crew: Crew): string {
    const base = baseOf(app, crew);
    const started = new Date(Date.now() - 8 * 3600 * 1000);
    const mission: Mission = {
      id: 'm-page',
      baseId: base.id,
      templateId: MISSION_TEMPLATES[0]!.id,
      areaId: 'misc',
      payPercent: 0,
      xp: 10,
      force: { razors: 4 },
      vehicles: {},
      pricedMinutes: 0,
      startedAt: started.toISOString(),
      travelMinutes: 1,
      durationMinutes: 1,
      status: 'active',
      officerId: null,
      overseerLed: false,
      lost: {},
      reported: true,
      outcome: null,
      rewards: {},
      spoils: {},
      resolvedAt: null,
      recalledAt: null,
      pagePrize: 'unit',
      pageWon: null,
      found: {},
    };
    // A seed that rolls a success, found by asking rather than by hoping: a run that failed would
    // carry no page and make the whole case vacuous.
    const seed = [...Array(200).keys()].find(
      (candidate) =>
        rollMissionOutcome({ mission, seed: candidate, successChance: 100 }) === 'success',
    );
    expect(seed, 'no seed produced a success').toBeDefined();
    app.repos.missions.insert({ mission, seed: seed!, successChance: 100 });

    const settled = resolveDueMissions(app.repos, base, new Date());
    expect(settled.resolved, 'the mission was not due').toHaveLength(1);
    const won = settled.resolved[0]!.pageWon;
    expect(won, 'a successful run carrying a page won nothing').not.toBeNull();
    return won!;
  }

  it('rings, and names the sheet, the document and the job', async () => {
    const app = await makeApp();
    const crew = await signIn(app, 'runner');
    const won = runHome(app, crew);

    const rung = pageBells(app, crew);
    expect(rung, 'nothing rang for a page that came home').toHaveLength(1);
    expect(rung[0]!.title).toBe(sentenceFor(won, 'off a mission'));
    expect(rung[0]!.link).toBe('/game/research/blueprints');
    expect(rung[0]!.subjectId).toBe(won);
  });

  it('says nothing for a run that brought no page back', async () => {
    const app = await makeApp();
    const crew = await signIn(app, 'empty_handed');
    const base = baseOf(app, crew);
    const started = new Date(Date.now() - 8 * 3600 * 1000);
    const mission: Mission = {
      id: 'm-nothing',
      baseId: base.id,
      templateId: MISSION_TEMPLATES[0]!.id,
      areaId: 'misc',
      payPercent: 0,
      xp: 10,
      force: { razors: 4 },
      vehicles: {},
      pricedMinutes: 0,
      startedAt: started.toISOString(),
      travelMinutes: 1,
      durationMinutes: 1,
      status: 'active',
      officerId: null,
      overseerLed: false,
      lost: {},
      reported: true,
      outcome: null,
      rewards: {},
      spoils: {},
      resolvedAt: null,
      recalledAt: null,
      pagePrize: null,
      pageWon: null,
      found: {},
    };
    app.repos.missions.insert({ mission, seed: 1, successChance: 100 });
    resolveDueMissions(app.repos, base, new Date());
    expect(pageBells(app, crew), 'a run with no page prize rang anyway').toHaveLength(0);
  });
});

// --- the Runner's close (§F3) ---

describe('a page off the Runner', () => {
  /** The first barrow from {@link AUTUMN} on that carries a page, and the line it is on. */
  function aBarrowWithAPage(): { day: string; line: VendorLine } {
    let day = AUTUMN;
    for (let step = 0; step < SEARCH_DAYS; step += 1) {
      const line = vendorStockFor(day).find((candidate) => isPage(candidate.item));
      if (line) return { day, line };
      day = nextDay(day);
    }
    throw new Error('fixture: no page on the barrow in the next four months');
  }

  function duringVisit(day: string, session: number): Date {
    const slot = vendorSessionsFor(day)[session];
    if (!slot) throw new Error(`fixture: no session ${session} on ${day}`);
    return new Date(instantAtHourInZone(day, slot.startHour).getTime() + 30 * 60_000);
  }

  it('rings for the winner, alongside the bell for the lot itself', async () => {
    const app = await makeApp();
    const crew = await signIn(app, 'bidder');
    const { day, line } = aBarrowWithAPage();
    const open = duringVisit(day, 0);

    const placed = placeVendorBid(app.repos, {
      base: baseOf(app, crew),
      userId: crew.userId,
      lineId: line.id,
      amount: nextLotBid(line.price, null),
      now: open,
    });
    expect(placed.kind, 'the bid was refused').toBe('placed');

    settleVendorAuctions(app.repos, new Date(visitClosesAt(day, 0).getTime() + 60_000));

    expect(baseOf(app, crew).inventory[line.item as ItemId], 'the page never changed hands').toBe(
      1,
    );
    const rung = pageBells(app, crew);
    expect(rung, 'the close handed over a page and said nothing about it').toHaveLength(1);
    expect(rung[0]!.title).toBe(sentenceFor(line.item, "off the Runner's barrow"));
    expect(rung[0]!.link).toBe('/game/research/blueprints');
    expect(rung[0]!.subjectId).toBe(line.item);

    // §F3 keeps both: one says a lot closed with you on top, the other says which sheet you got.
    const won = app.repos.social
      .notifications(crew.userId, 50)
      .filter((n) => n.kind === 'market_won');
    expect(won, 'the lot bell went missing').toHaveLength(1);
  });
});

// --- the fence's shelf (§F2) ---

describe('a page out of the back room', () => {
  /** The first shelf from {@link AUTUMN} on that has a page on it. */
  function aShelfWithAPage(): { now: Date; slotIndex: number; goodId: string; pageId: string } {
    let day = AUTUMN;
    for (let step = 0; step < SEARCH_DAYS; step += 1) {
      const board = blackMarketBoard(day, Array<number>(BLACK_MARKET_SLOTS).fill(0));
      const slot = board.find(
        (entry) => BLACK_MARKET_GOODS[entry.goodId]?.kind === 'blueprint_page',
      );
      if (slot) {
        const pageId = Object.keys(BLACK_MARKET_GOODS[slot.goodId]!.grants ?? {})[0]!;
        return {
          // Noon in the game's own zone, so the day the shelf is drawn for is the day searched.
          now: instantAtHourInZone(day, 12),
          slotIndex: slot.index,
          goodId: slot.goodId,
          pageId,
        };
      }
      day = nextDay(day);
    }
    throw new Error('fixture: the fence has no pages in the next four months');
  }

  it('rings when the page comes off the shelf', async () => {
    const app = await makeApp();
    const crew = await signIn(app, 'fence_customer');
    const { now, slotIndex, goodId, pageId } = aShelfWithAPage();

    const base = baseOf(app, crew);
    // A crew cannot earn a reputation inside a unit test, and the fence takes nothing else.
    app.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: 5_000 });

    const taken = takeFromBlackMarket(
      app.repos,
      baseOf(app, crew),
      slotIndex,
      goodId,
      now,
      GAME_TIMEZONE,
    );
    expect(taken.kind, 'the fence refused the take').toBe('taken');
    expect(baseOf(app, crew).inventory[pageId as ItemId]).toBe(1);

    const rung = pageBells(app, crew);
    expect(rung, 'a page came off the shelf in silence').toHaveLength(1);
    expect(rung[0]!.title).toBe(sentenceFor(pageId, 'from the back room'));
    expect(rung[0]!.link).toBe('/game/research/blueprints');
    expect(rung[0]!.subjectId).toBe(pageId);
  });
});

// --- the Lab's trade (§G3) ---

describe('a page out of the Lab', () => {
  it('rings for the one that came back and not for the three that went in', async () => {
    const app = await makeApp();
    const crew = await signIn(app, 'drafter');
    const base = baseOf(app, crew);
    app.repos.bases.updateCommanders(base.id, [
      createCommander('off-1', 'Vell Ashgrove', 'head_of_research'),
    ]);
    app.repos.bases.updateResearch(base.id, {
      ...base.research,
      technologies: [REIMAGINING_RESEARCH_ID],
    });
    // Four copies of one page: the payment comes off a single sheet, so no document is completed
    // by accident and the page that comes back is the only one that moved upward.
    const spare = BLUEPRINTS[0].pages[0].id as ItemId;
    hold(app, crew, { [spare]: 4 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/blueprints/reimagine',
      headers: auth(crew.token),
      payload: { pages: [spare, spare, spare] },
    });
    expect(res.statusCode).toBe(200);
    const gained = res.json<{ gained: string }>().gained;

    const rung = pageBells(app, crew);
    expect(rung, 'the Lab handed a page back in silence').toHaveLength(1);
    expect(rung[0]!.title).toBe(sentenceFor(gained, 'out of the Lab'));
    expect(rung[0]!.subjectId).toBe(gained);
    // The three that were spent are not news, and the page that came back is not one of them.
    expect(rung[0]!.subjectId).not.toBe(spare);
  });
});

// --- a settled offer (§F4) ---

describe('a page out of somebody else’s offer', () => {
  it('rings on both sides, each naming the other crew', async () => {
    const app = await makeApp();
    const seller = await signIn(app, 'seller');
    const buyer = await signIn(app, 'buyer');

    // A page each way, so one settlement exercises both halves: what the listing gives and what
    // it asks for. Two different documents, so neither side's bell can stand in for the other's.
    const sold = BLUEPRINTS[0].pages[0].id as ItemId;
    const paid = BLUEPRINTS[1].pages[0].id as ItemId;
    expect(sold).not.toBe(paid);
    hold(app, seller, { [sold]: 1 });
    hold(app, buyer, { [paid]: 1 });

    const now = new Date();
    const posted = postOffer(
      app.repos,
      baseOf(app, seller),
      { resources: {}, items: { [sold]: 1 } },
      { resources: {}, items: { [paid]: 1 } },
      undefined,
      now,
    );
    expect(posted.kind, 'the listing was refused').toBe('done');
    // Escrow is not an arrival: the seller's own page leaving does not ring anything.
    expect(pageBells(app, seller), 'posting a listing rang a bell').toHaveLength(0);

    const settled = acceptOffer(app.repos, baseOf(app, buyer), posted.offer!.id, now);
    expect(settled.kind, 'the settlement was refused').toBe('done');

    const buyerName = baseOf(app, buyer).name;
    const sellerName = baseOf(app, seller).name;

    const buyerBells = pageBells(app, buyer);
    expect(buyerBells, 'the buyer was told nothing about the page they bought').toHaveLength(1);
    expect(buyerBells[0]!.title).toBe(sentenceFor(sold, `from ${sellerName}'s offer`));
    expect(buyerBells[0]!.subjectId).toBe(sold);

    const sellerBells = pageBells(app, seller);
    expect(sellerBells, 'the seller was told nothing, and nobody was on their screen').toHaveLength(
      1,
    );
    expect(sellerBells[0]!.title).toBe(sentenceFor(paid, `from ${buyerName}'s offer`));
    expect(sellerBells[0]!.subjectId).toBe(paid);
  });
});

// --- what the bell says when two of the same sheet arrive at once ---

describe('two copies of one page', () => {
  it('ring once, with the count on the title', async () => {
    const app = await makeApp();
    const seller = await signIn(app, 'wholesaler');
    const buyer = await signIn(app, 'collector');

    const sold = BLUEPRINTS[0].pages[0].id as ItemId;
    hold(app, seller, { [sold]: 2 });

    const now = new Date();
    const posted = postOffer(
      app.repos,
      baseOf(app, seller),
      { resources: {}, items: { [sold]: 2 } },
      { resources: { caps: 10 }, items: {} },
      undefined,
      now,
    );
    expect(posted.kind).toBe('done');
    expect(acceptOffer(app.repos, baseOf(app, buyer), posted.offer!.id, now).kind).toBe('done');

    const rung = pageBells(app, buyer);
    expect(rung, 'a pair of sheets is one delivery and one row').toHaveLength(1);
    expect(rung[0]!.title).toBe(sentenceFor(sold, `from ${baseOf(app, seller).name}'s offer`, 2));
  });
});
