import {
  MAX_LOCATION_LEVEL,
  instantAtHourInZone,
  nextLotBid,
  vendorSessionsFor,
  vendorStockFor,
  visitClosesAt,
  type Base,
  type MarketResponse,
  type VendorLine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { standingEffectsFor } from '../crew/standing.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import {
  discountedCaps,
  latestLotResultsFor,
  placeVendorBid,
  settleVendorAuctions,
} from './auction.js';
import { marketRefusalText, projectMarket } from './board.js';

/**
 * The Runner's barrow, as an auction (board 2026-09-08).
 *
 * The ranking and the visit are pinned in `packages/shared`; what is here is the part only a server
 * can be wrong about: that a bid is stored against the right visit, that the close moves goods and
 * caps **once**, that a crew who cannot pay at the close passes the lot on rather than going
 * overdrawn, and that everybody who bid is told how it ended.
 *
 * Everything is driven through the functions the routes call, with an explicit `now`. The Runner's
 * hours are a function of the game day, so a test that went over HTTP would get whatever hour the
 * suite happens to run at and could not choose whether he is in. The two cases that are about the
 * routes themselves are at the bottom and say so.
 */

/** A fixed September day, so the barrow, the hours and the close are the same every morning. */
const SEPTEMBER = '2026-09-15';

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** The first barrow from {@link SEPTEMBER} on that carries what a case needs. */
function aDayWhere(wanted: (lines: VendorLine[]) => boolean): string {
  let day = SEPTEMBER;
  for (let step = 0; step < 90; step += 1) {
    if (wanted(vendorStockFor(day))) return day;
    day = nextDay(day);
  }
  throw new Error('fixture: no barrow like that in the next ninety days');
}

/** A line the catalogue rations to one: one lot, and then it is gone for the day. */
function rationedLine(day: string): VendorLine {
  const line = vendorStockFor(day).find((candidate) => candidate.stock === 1);
  if (!line) throw new Error(`fixture: nothing rationed on the ${day} barrow`);
  return line;
}

function lineWithSpare(day: string): VendorLine {
  const line = vendorStockFor(day).find((candidate) => candidate.stock >= 2);
  if (!line) throw new Error(`fixture: nothing with a spare on the ${day} barrow`);
  return line;
}

/** Half an hour into one of the day's visits, and a minute after it ends. */
function duringVisit(day: string, session: number): Date {
  const slot = vendorSessionsFor(day)[session];
  if (!slot) throw new Error(`fixture: no session ${session} on ${day}`);
  return new Date(instantAtHourInZone(day, slot.startHour).getTime() + 30 * 60_000);
}

function afterVisit(day: string, session: number): Date {
  return new Date(visitClosesAt(day, session).getTime() + 60_000);
}

/** An hour of the day he is nowhere near the district. */
function whileHeIsAway(day: string): Date {
  const busy = new Set(
    vendorSessionsFor(day).flatMap((slot) =>
      Array.from({ length: slot.hours }, (_, step) => slot.startHour + step),
    ),
  );
  const free = Array.from({ length: 24 }, (_, hour) => hour).find((hour) => !busy.has(hour));
  if (free === undefined) throw new Error('fixture: the Runner never leaves that day');
  return new Date(instantAtHourInZone(day, free).getTime() + 30 * 60_000);
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

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

/** A crew with a district and enough caps that money is never the reason a case fails. */
async function signIn(app: FastifyInstance, username: string, caps = 1_000_000): Promise<Crew> {
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
  app.repos.bases.updateResources(base.id, { ...base.resources, caps });
  return { userId: user.id, baseId: base.id, token };
}

function baseOf(app: FastifyInstance, crew: Crew): Base {
  const base = app.repos.bases.findById(crew.baseId);
  if (!base) throw new Error('fixture: the crew lost its district');
  return base;
}

function capsOf(app: FastifyInstance, crew: Crew): number {
  return baseOf(app, crew).resources.caps;
}

function bid(
  app: FastifyInstance,
  crew: Crew,
  lot: { lineId: string; amount: number; now: Date },
): ReturnType<typeof placeVendorBid> {
  return placeVendorBid(app.repos, {
    base: baseOf(app, crew),
    userId: crew.userId,
    lineId: lot.lineId,
    amount: lot.amount,
    now: lot.now,
  });
}

function bells(app: FastifyInstance, crew: Crew, kind: 'market_won' | 'market_outbid') {
  return app.repos.social.notifications(crew.userId, 50).filter((note) => note.kind === kind);
}

/** The lot as this crew sees it on the board, or null when there is nothing left on the line. */
function lotOn(app: FastifyInstance, crew: Crew, lineId: string, now: Date) {
  const view = projectMarket(app.repos, baseOf(app, crew), now);
  return view.vendor.stock.find((offer) => offer.line.id === lineId)?.auction ?? null;
}

describe('bidding on a lot', () => {
  it('takes a bid at the reserve and puts it on the board under the crew that made it', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);

    expect(bid(app, ana, { lineId: line.id, amount: line.price, now })).toEqual({ kind: 'placed' });

    const lot = lotOn(app, ana, line.id, now);
    expect(lot).not.toBeNull();
    expect(lot?.reserve).toBe(line.price);
    expect(lot?.session).toBe(0);
    expect(lot?.closesAt).toBe(visitClosesAt(day, 0).toISOString());
    expect(lot?.leading).toMatchObject({ username: 'ana', amount: line.price, yours: true });
    expect(lot?.yourBid).toBe(line.price);
    expect(lot?.bidders).toBe(1);
    expect(lot?.nextBid).toBe(nextLotBid(line.price, line.price));
    // Nothing is escrowed at the bid: caps move at the close and only at the close.
    expect(capsOf(app, ana)).toBe(1_000_000);
  });

  it('is a fresh lot on his second visit, with nobody leading it', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere((lines) => lines.some((line) => line.stock >= 2));
    const line = lineWithSpare(day);

    expect(
      bid(app, ana, { lineId: line.id, amount: line.price, now: duringVisit(day, 0) }),
    ).toEqual({ kind: 'placed' });

    const second = duringVisit(day, 1);
    settleVendorAuctions(app.repos, second);
    const lot = lotOn(app, ana, line.id, second);
    expect(lot?.session, 'the morning lot leaked into the afternoon').toBe(1);
    expect(lot?.leading).toBeNull();
    expect(lot?.yourBid).toBeNull();
  });

  it('refuses a bid while he is out of the district', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;

    expect(
      bid(app, ana, { lineId: line.id, amount: line.price, now: whileHeIsAway(day) }),
    ).toMatchObject({ kind: 'refused', reason: 'vendor_closed' });
  });

  it('refuses a line that is not on today’s barrow', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(() => true);

    expect(
      bid(app, ana, { lineId: 'yesterday-0-neural_shunt', amount: 500, now: duringVisit(day, 0) }),
    ).toMatchObject({ kind: 'refused', reason: 'unknown_line' });
  });

  it('refuses a line the city has already cleared out', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(() => true);
    const line = rationedLine(day);
    const now = duringVisit(day, 0);
    app.repos.market.recordVendorSale(day, line.id, line.stock, now.toISOString());

    expect(bid(app, ana, { lineId: line.id, amount: line.price, now })).toMatchObject({
      kind: 'refused',
      reason: 'sold_out',
    });
    expect(lotOn(app, ana, line.id, now), 'a cleared line still had a lot on it').toBeNull();
  });

  it('refuses a crew that is already the highest bid', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    expect(bid(app, ana, { lineId: line.id, amount: line.price * 2, now })).toMatchObject({
      kind: 'refused',
      reason: 'outbid_yourself',
    });
  });

  it('refuses a bid under the next one, and the refusal names the figures', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const bex = await signIn(app, 'bex');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);

    // Nobody on it yet: the floor is the reserve and the sentence says so with no second number.
    const first = bid(app, bex, { lineId: line.id, amount: line.price - 1, now });
    expect(first).toMatchObject({ kind: 'refused', reason: 'too_low', minimum: line.price });
    if (first.kind !== 'refused') throw new Error('unreachable');
    expect(marketRefusalText(first.reason, first)).toBe(`He will not take under ${line.price}`);

    bid(app, bex, { lineId: line.id, amount: line.price, now });
    const behind = bid(app, ana, { lineId: line.id, amount: line.price, now });
    expect(behind).toMatchObject({
      kind: 'refused',
      reason: 'too_low',
      minimum: nextLotBid(line.price, line.price),
      leading: line.price,
    });
    if (behind.kind !== 'refused') throw new Error('unreachable');
    expect(marketRefusalText(behind.reason, behind)).toBe(
      `Somebody is at ${line.price}. You need at least ${nextLotBid(line.price, line.price)}`,
    );
  });

  it('refuses a bid the crew could not cover', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana', 10);
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;

    expect(
      bid(app, ana, { lineId: line.id, amount: line.price, now: duringVisit(day, 0) }),
    ).toMatchObject({ kind: 'refused', reason: 'cannot_afford' });
  });

  it('keeps one row when a crew raises itself out of second place', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const bex = await signIn(app, 'bex');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    bid(app, bex, { lineId: line.id, amount: nextLotBid(line.price, line.price), now });
    const raised = nextLotBid(line.price, nextLotBid(line.price, line.price));
    expect(bid(app, ana, { lineId: line.id, amount: raised, now })).toEqual({ kind: 'placed' });

    const rows = app.repos.vendorAuctions.bidsFor(day, 0, line.id);
    expect(rows.filter((row) => row.userId === ana.userId)).toHaveLength(1);
    const lot = lotOn(app, ana, line.id, now);
    expect(lot?.yourBid).toBe(raised);
    expect(lot?.bidders).toBe(2);
    expect(lot?.leading?.amount).toBe(raised);
  });
});

describe('the close', () => {
  it('hands the unit to the highest bidder and takes their caps', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const bex = await signIn(app, 'bex');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);
    const winning = nextLotBid(line.price, line.price);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    bid(app, bex, { lineId: line.id, amount: winning, now });
    settleVendorAuctions(app.repos, afterVisit(day, 0));

    expect(baseOf(app, bex).inventory[line.item as keyof Base['inventory']]).toBe(1);
    expect(capsOf(app, bex)).toBe(1_000_000 - winning);
    expect(baseOf(app, ana).inventory[line.item as keyof Base['inventory']] ?? 0).toBe(0);
    expect(capsOf(app, ana), 'a losing bid took caps off the crew that made it').toBe(1_000_000);
    // The city's counter moved, which is what makes a line one visit shorter.
    expect(app.repos.market.vendorSold(day, line.id)).toBe(1);
  });

  it('tells the winner and everybody who bid against them', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const bex = await signIn(app, 'bex');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);
    const winning = nextLotBid(line.price, line.price);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    bid(app, bex, { lineId: line.id, amount: winning, now });
    settleVendorAuctions(app.repos, afterVisit(day, 0));

    const won = bells(app, bex, 'market_won');
    expect(won).toHaveLength(1);
    expect(won[0]?.title).toContain(`off the Runner for ${winning}`);
    expect(won[0]?.link).toBe('/game/market');
    expect(bells(app, bex, 'market_outbid'), 'the winner was told they lost as well').toHaveLength(
      0,
    );

    const lost = bells(app, ana, 'market_outbid');
    expect(lost).toHaveLength(1);
    expect(lost[0]?.title).toContain(`went to bex for ${winning}`);
    expect(lost[0]?.link).toBe('/game/market');
  });

  /**
   * §A4's Downtown Market, where it lands now.
   *
   * The floor used to come off the price on the card. It cannot: the reserve is what every crew in
   * the city bids against. So it comes off what the winner is charged, and nothing anybody else can
   * see moves at all: the result row and both bells carry the number the lot closed at.
   */
  it('charges the winner’s ground, and still says what the lot closed at', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const bex = await signIn(app, 'bex');
    const control = app.repos.city.control('chrome-row-exchange');
    if (!control) throw new Error('fixture: no control row for the Downtown Market');
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: ana.baseId },
      level: MAX_LOCATION_LEVEL,
      garrison: {},
    });

    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);
    const percent = standingEffectsFor(app.repos, baseOf(app, ana), now).marketDiscountPercent;
    // The fixture actually handed over a floor, or the assertion below measures nothing.
    expect(percent, 'holding the Exchange bought no discount').toBeGreaterThan(0);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    settleVendorAuctions(app.repos, afterVisit(day, 0));

    const charged = discountedCaps(line.price, percent);
    expect(charged).toBeLessThan(line.price);
    expect(capsOf(app, ana)).toBe(1_000_000 - charged);
    // Everything shared carries the bid, not the talked-down figure.
    const result = app.repos.vendorAuctions.results(day, 0)[0];
    expect(result?.price).toBe(line.price);
    expect(bells(app, ana, 'market_won')[0]?.title).toContain(`for ${line.price}`);
    void bex;
  });

  it('passes the lot down when the leading crew cannot cover their bid', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const bex = await signIn(app, 'bex');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);
    const winning = nextLotBid(line.price, line.price);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    bid(app, bex, { lineId: line.id, amount: winning, now });
    // Nothing is escrowed at the bid, so a crew can spend its way out of a lot it is leading.
    app.repos.bases.updateResources(bex.baseId, { ...baseOf(app, bex).resources, caps: 1 });
    settleVendorAuctions(app.repos, afterVisit(day, 0));

    expect(baseOf(app, ana).inventory[line.item as keyof Base['inventory']]).toBe(1);
    expect(capsOf(app, ana)).toBe(1_000_000 - line.price);
    expect(baseOf(app, bex).inventory[line.item as keyof Base['inventory']] ?? 0).toBe(0);
    expect(capsOf(app, bex), 'the crew that passed was charged anyway').toBe(1);

    const results = latestLotResultsFor(app.repos, bex.userId, afterVisit(day, 0));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ outcome: 'passed', winner: 'ana', price: line.price });
  });

  /**
   * Nobody could pay, and the two crews are told two different things.
   *
   * `passed` and `unsold` are the same lot seen from two places: the crew that was top of the
   * ranking could not cover its own bid, and the crew under it was never reached. Collapsing them
   * into one word would tell the leader they were outbid by nobody.
   */
  it('records a lot nobody could pay for, and tells them it went unsold', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const bex = await signIn(app, 'bex');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);
    const winning = nextLotBid(line.price, line.price);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    bid(app, bex, { lineId: line.id, amount: winning, now });
    for (const crew of [ana, bex]) {
      app.repos.bases.updateResources(crew.baseId, { ...baseOf(app, crew).resources, caps: 0 });
    }
    const closed = afterVisit(day, 0);
    settleVendorAuctions(app.repos, closed);

    const result = app.repos.vendorAuctions.results(day, 0)[0];
    expect(
      result,
      'an unsold lot left no result row and would settle again for ever',
    ).toBeDefined();
    expect(result).toMatchObject({ winnerUserId: null, price: null, item: line.item });
    expect(app.repos.market.vendorSold(day, line.id)).toBe(0);
    expect(baseOf(app, ana).inventory[line.item as keyof Base['inventory']] ?? 0).toBe(0);
    expect(baseOf(app, bex).inventory[line.item as keyof Base['inventory']] ?? 0).toBe(0);

    for (const crew of [ana, bex]) {
      const lost = bells(app, crew, 'market_outbid');
      expect(lost).toHaveLength(1);
      expect(lost[0]?.title).toContain('went unsold');
    }
    expect(latestLotResultsFor(app.repos, bex.userId, closed)[0]).toMatchObject({
      outcome: 'passed',
      price: null,
      winner: null,
      yourBid: winning,
    });
    expect(latestLotResultsFor(app.repos, ana.userId, closed)[0]).toMatchObject({
      outcome: 'unsold',
      price: null,
      winner: null,
      yourBid: line.price,
    });
  });

  it('settles a lot once, however many times it is asked to', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;

    bid(app, ana, { lineId: line.id, amount: line.price, now: duringVisit(day, 0) });
    const closed = afterVisit(day, 0);
    settleVendorAuctions(app.repos, closed);
    settleVendorAuctions(app.repos, closed);
    settleVendorAuctions(app.repos, new Date(closed.getTime() + 86_400_000));

    expect(baseOf(app, ana).inventory[line.item as keyof Base['inventory']]).toBe(1);
    expect(capsOf(app, ana)).toBe(1_000_000 - line.price);
    expect(app.repos.market.vendorSold(day, line.id)).toBe(1);
    expect(bells(app, ana, 'market_won')).toHaveLength(1);
  });

  it('leaves a lot alone while its visit is still running', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(() => true);
    const line = vendorStockFor(day)[0]!;
    const now = duringVisit(day, 0);

    bid(app, ana, { lineId: line.id, amount: line.price, now });
    settleVendorAuctions(app.repos, now);

    expect(app.repos.vendorAuctions.results(day, 0)).toEqual([]);
    expect(capsOf(app, ana)).toBe(1_000_000);
  });

  it('takes a one-of-a-kind line off the barrow and leaves a spare one up again', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const day = aDayWhere(
      (lines) => lines.some((line) => line.stock === 1) && lines.some((line) => line.stock >= 2),
    );
    const oneOff = rationedLine(day);
    const spare = lineWithSpare(day);
    const first = duringVisit(day, 0);

    bid(app, ana, { lineId: oneOff.id, amount: oneOff.price, now: first });
    bid(app, ana, { lineId: spare.id, amount: spare.price, now: first });
    const second = duringVisit(day, 1);
    settleVendorAuctions(app.repos, second);

    const board = projectMarket(app.repos, baseOf(app, ana), second);
    const gone = board.vendor.stock.find((offer) => offer.line.id === oneOff.id);
    expect(gone?.line.stock).toBe(0);
    expect(gone?.auction, 'a line with nothing left still had a lot on it').toBeNull();

    const again = board.vendor.stock.find((offer) => offer.line.id === spare.id);
    expect(again?.line.stock).toBe(spare.stock - 1);
    expect(again?.auction?.session).toBe(1);
    expect(again?.auction?.leading).toBeNull();
  });
});

describe('the barrow over HTTP', () => {
  it('closes a visit that ended while nobody was looking, on the next read', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    // A visit two days in the past, so it has certainly closed whatever hour the suite runs at.
    const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const line = vendorStockFor(day)[0]!;
    app.repos.vendorAuctions.placeBid({
      day,
      session: 0,
      lineId: line.id,
      userId: ana.userId,
      baseId: ana.baseId,
      amount: line.price,
      at: duringVisit(day, 0).toISOString(),
    });

    const res = await app.inject({ method: 'GET', url: '/api/market', headers: auth(ana.token) });
    expect(res.statusCode).toBe(200);
    const view = res.json<MarketResponse>();

    expect(app.repos.vendorAuctions.results(day, 0)).toHaveLength(1);
    expect(view.inventory[line.item as keyof MarketResponse['inventory']]).toBe(1);
    expect(view.caps).toBe(1_000_000 - line.price);
    // And the panel says so, on the read that closed it.
    expect(view.vendor.results).toMatchObject([
      { day, session: 0, lineId: line.id, item: line.item, outcome: 'won', price: line.price },
    ]);
  });

  it('answers a bid with the refreshed board, or with the reason it will not take one', async () => {
    const app = await makeApp();
    const ana = await signIn(app, 'ana');
    const now = new Date();
    const read = await app.inject({ method: 'GET', url: '/api/market', headers: auth(ana.token) });
    const view = read.json<MarketResponse>();

    if (!view.vendor.open) {
      // He is out at whatever hour this ran. A line id from today's barrow is still refused for the
      // right reason, which is the half of the route this branch can prove.
      const line = vendorStockFor(new Date().toISOString().slice(0, 10))[0]!;
      const res = await app.inject({
        method: 'POST',
        url: '/api/market/bid',
        headers: auth(ana.token),
        payload: { lineId: line.id, amount: line.price },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { message: string } }>().error.message).toContain(
        'not in the district',
      );
      return;
    }

    const offer = view.vendor.stock.find((entry) => entry.auction !== null);
    if (!offer?.auction) throw new Error('fixture: he is in with nothing left on any line');
    const res = await app.inject({
      method: 'POST',
      url: '/api/market/bid',
      headers: auth(ana.token),
      payload: { lineId: offer.line.id, amount: offer.auction.nextBid },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const after = res.json<{ market: MarketResponse }>().market;
    const lot = after.vendor.stock.find((entry) => entry.line.id === offer.line.id)?.auction;
    expect(lot?.yourBid).toBe(offer.auction.nextBid);
    expect(lot?.leading?.yours).toBe(true);
    expect(after.caps, 'a bid took caps before the close').toBe(view.caps);
    void now;
  });
});
