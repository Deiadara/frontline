import {
  MAX_LOCATION_LEVEL,
  MAX_NOTORIETY,
  BLACK_MARKET_GOODS,
  BLACK_MARKET_SLOTS,
  blackMarketBoard,
  blackMarketClosesAt,
  blackMarketDay,
  discountedInfamy,
  findBlackMarketGood,
  nextLotBid,
  type BlackMarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { placeBlackMarketBid, settleBlackMarketLots } from './shelf.js';
import { standingEffectsFor } from '../crew/standing.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';

/**
 * The back room, end to end.
 *
 * The rules live in `@frontline/shared` and are tested there. What is tested here is everything the
 * *server* has to get right on top of them: that a bid is written where the whole city can see it,
 * that the close hands the crate to the crew that actually won it, that infamy leaves the ledger
 * only at the close, and that the daily allowance survives a restart because it is counted off
 * receipts rather than flagged.
 *
 * The close is driven directly with an instant past midnight rather than through a route. There is
 * no scheduler and the lots settle on the Athens calendar, so a test that waited for the suite's
 * own clock to reach midnight would only pass once a day.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  // The bench is on here on purpose, and only as a *fixture*: a crew cannot earn a reputation
  // inside a unit test, so `giveInfamy` below uses the admin knob to hand one over. Nothing the
  // back room does is priced in resources or measured in seconds, so admin mode changes none of
  // what is being asserted.
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'true',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const handle = { app, db };
  instances.push(handle);
  return handle;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function crew(app: FastifyInstance, username: string): Promise<{ token: string }> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(registered.statusCode).toBe(201);
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode).toBe(201);
  return { token };
}

/**
 * A crew cannot earn a reputation inside a unit test, so the bench hands them one.
 *
 * Both halves of it. The wallet is what the fence charges; the **rank** is what he will deal to
 * them at all, and since the good stock went behind `minNotoriety` a crew holding a fortune and no
 * name is refused at the door. `MAX_NOTORIETY` rather than a number, so a retune of any one good's
 * rank does not quietly turn these tests into a test of the gate instead of the thing they name.
 */
async function giveInfamy(app: FastifyInstance, token: string, infamy: number): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/knobs',
    headers: auth(token),
    payload: { infamy, notoriety: MAX_NOTORIETY },
  });
  expect(res.statusCode).toBe(200);
  // The back room sits inside the Market, whose door is a level.
  openDoors(app, token, 'market');
}

/**
 * The ordinary rules, from here on. Admin mode holds nothing on a bid (held bids, 2026-10-06), so a
 * case about what a bid costs turns it off once the bench has handed the infamy over.
 */
function ordinaryRules(app: FastifyInstance): void {
  Object.assign(app.config, { admin: false });
}

async function shelf(app: FastifyInstance, token: string): Promise<BlackMarketResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/black-market', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<BlackMarketResponse>();
}

describe('GET /api/black-market', () => {
  it('shows five slots, priced in infamy, with the crew’s own balance', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');

    const board = await shelf(app, token);
    expect(board.offers).toHaveLength(BLACK_MARKET_SLOTS);
    expect(board.infamy).toBe(0);
    expect(board.takenToday).toBe(0);
    expect(board.takesPerDay).toBe(1);
    for (const offer of board.offers) {
      expect(findBlackMarketGood(offer.slot.goodId)).toBeDefined();
      // Nothing is affordable on nothing, which is the whole shape of the sink.
      expect(offer.affordable).toBe(false);
    }
  });

  it('is the same shelf for two different crews in the same city', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'operator_one');
    const two = await crew(app, 'operator_two');

    const first = await shelf(app, one.token);
    const second = await shelf(app, two.token);
    expect(second.offers.map((offer) => offer.slot.goodId)).toEqual(
      first.offers.map((offer) => offer.slot.goodId),
    );
  });

  it('counts down to the next Athens midnight', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    const board = await shelf(app, token);

    const refresh = new Date(board.refreshesAt);
    expect(refresh.getTime()).toBeGreaterThan(Date.parse(board.serverNow));
    // The instant the shelf turns over is the first moment of the next day, by the same derivation
    // the shelf itself uses, so a client counting to it lands exactly on the new stock.
    expect(blackMarketDay(refresh)).not.toBe(board.day);
    expect(blackMarketDay(new Date(refresh.getTime() - 60_000))).toBe(board.day);
  });
});

/** Say a number on a lot, through the route a screen presses. */
async function bid(
  app: FastifyInstance,
  token: string,
  slotIndex: number,
  goodId: string,
  amount: number,
) {
  return app.inject({
    method: 'POST',
    url: '/api/black-market/bid',
    headers: auth(token),
    payload: { slotIndex, goodId, amount },
  });
}

/** The lot standing in one slot, as this crew sees it. */
function lotIn(board: BlackMarketResponse, slotIndex: number) {
  const lot = board.offers.find((offer) => offer.slot.index === slotIndex)?.lot;
  if (!lot) throw new Error(`fixture: slot ${slotIndex} has no lot on it`);
  return lot;
}

/** Midnight at the end of the day a shelf belongs to: the instant the fence settles. */
function closeOf(board: BlackMarketResponse): Date {
  return blackMarketClosesAt(board.day);
}

/**
 * Noon on a day whose shelf opens at least one lot behind a rank, found rather than assumed.
 *
 * The shelf is drawn off the date, and on 2026-10-07 Ashfall's five asked for no name at all, which
 * turned a case about the rank gate into a fixture error once a month or so. Walked forward from a
 * fixed day so the case reads the same shelf on every run.
 */
function dayAskingForAName(): Date {
  for (let offset = 0; offset < 60; offset += 1) {
    const at = new Date(Date.UTC(2026, 9, 7, 9) + offset * 86_400_000);
    const ranked = blackMarketBoard(blackMarketDay(at, 'Europe/Athens'), [0, 0, 0, 0, 0]).some(
      (slot) => (findBlackMarketGood(slot.goodId)?.minNotoriety ?? 0) > 0,
    );
    if (ranked) return at;
  }
  throw new Error('fixture: no shelf in two months opens a ranked lot');
}

describe('POST /api/black-market/bid', () => {
  it('writes the number where the whole city can read it, and holds the infamy', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'operator_one');
    const two = await crew(app, 'operator_two');
    await giveInfamy(app, one.token, 5_000);
    ordinaryRules(app);

    const before = await shelf(app, one.token);
    const lot = lotIn(before, 0);
    const res = await bid(app, one.token, 0, before.offers[0]!.slot.goodId, lot.nextBid);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);

    // Read back through a fresh request rather than out of the write's own answer: the response is
    // projected from the base the handler just built and would report a bid that was never stored.
    const mine = await shelf(app, one.token);
    expect(lotIn(mine, 0).leading?.amount).toBe(lot.nextBid);
    expect(lotIn(mine, 0).leading?.yours).toBe(true);
    expect(lotIn(mine, 0).yourBid).toBe(lot.nextBid);
    // Held when placed (maintainer, 2026-10-06): the infamy leaves with the bid, and the write's
    // own answer already shows the lower wallet.
    expect(mine.infamy).toBe(before.infamy - lot.nextBid);
    expect(res.json<{ blackMarket: BlackMarketResponse }>().blackMarket.infamy).toBe(mine.infamy);
    expect(mine.takenToday).toBe(0);

    // And the other crew sees the same table, under a name rather than as "yours".
    const theirs = await shelf(app, two.token);
    expect(lotIn(theirs, 0).leading?.amount).toBe(lot.nextBid);
    expect(lotIn(theirs, 0).leading?.yours).toBe(false);
    expect(lotIn(theirs, 0).bidders).toBe(1);
  });

  /**
   * §H7a behind the shelf: two crates at once (maintainer, 2026-09-17).
   *
   * The fence already limited **wins** to one a night, which is what makes a crate scarce. Bidding
   * was free, so a crew could put a name down on all five and let the close pick. Two, like the Bar
   * and like the barrow, and for the same reason: an auction is a decision about which thing you
   * want, and a limit is what makes it one.
   *
   * The third assertion is the one a count would get wrong: raising on a crate the crew is already
   * on is not opening a third.
   */
  it('holds a crew to two crates at once, and still lets them raise on one of the two', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'operator_limit');
    await giveInfamy(app, one.token, 500_000);

    const before = await shelf(app, one.token);
    const say = async (slot: number) =>
      bid(app, one.token, slot, before.offers[slot]!.slot.goodId, lotIn(before, slot).nextBid);

    expect((await say(0)).statusCode).toBe(200);
    expect((await say(1)).statusCode).toBe(200);

    const third = await say(2);
    expect(third.statusCode).toBe(409);
    expect(third.body).toContain('every crate you can hold');

    /*
     * And answering somebody who topped them is not opening a third crate.
     *
     * Through a second crew, because a crew leading a lot is refused for that by a different rule
     * (`outbid_yourself`) and would prove nothing about this one. Being outbid is exactly when a
     * crew at the limit needs to bid again, and a limit written as a count would refuse them.
     */
    const two = await crew(app, 'operator_rival');
    await giveInfamy(app, two.token, 500_000);
    const rivalShelf = await shelf(app, two.token);
    const topped = await bid(
      app,
      two.token,
      0,
      before.offers[0]!.slot.goodId,
      lotIn(rivalShelf, 0).nextBid,
    );
    expect(topped.statusCode, topped.body.slice(0, 200)).toBe(200);

    const mine = await shelf(app, one.token);
    const raise = await bid(
      app,
      one.token,
      0,
      before.offers[0]!.slot.goodId,
      lotIn(mine, 0).nextBid,
    );
    expect(raise.statusCode, raise.body.slice(0, 200)).toBe(200);
  });

  it('refuses a number under where the lot opens, and one that does not clear the leader', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'operator_one');
    const two = await crew(app, 'operator_two');
    await giveInfamy(app, one.token, 500_000);
    await giveInfamy(app, two.token, 500_000);

    const board = await shelf(app, one.token);
    const goodId = board.offers[0]!.slot.goodId;
    const opening = lotIn(board, 0).reserve;

    const low = await bid(app, one.token, 0, goodId, opening - 1);
    expect(low.statusCode).toBe(409);
    expect(low.json<{ error: { code: string } }>().error.code).toBe('BLACK_MARKET_REFUSED');

    expect((await bid(app, one.token, 0, goodId, opening)).statusCode).toBe(200);
    const minimum = nextLotBid(opening, opening);
    expect((await bid(app, two.token, 0, goodId, minimum - 1)).statusCode).toBe(409);
    expect((await bid(app, two.token, 0, goodId, minimum)).statusCode).toBe(200);
  });

  it('refuses a crew bidding against its own leading number', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 500_000);
    const board = await shelf(app, token);
    const goodId = board.offers[0]!.slot.goodId;

    expect((await bid(app, token, 0, goodId, lotIn(board, 0).reserve)).statusCode).toBe(200);
    const again = await shelf(app, token);
    expect((await bid(app, token, 0, goodId, lotIn(again, 0).nextBid)).statusCode).toBe(409);
  });

  it('refuses a slot whose contents moved between the read and the click', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 500_000);
    const board = await shelf(app, token);

    // Naming slot 0 while asking for what is standing in slot 1.
    const res = await bid(app, token, 0, board.offers[1]!.slot.goodId, lotIn(board, 0).nextBid);
    expect(res.statusCode).toBe(409);
    expect(lotIn(await shelf(app, token), 0).leading).toBeNull();
  });

  /**
   * The Statue's cut comes off what the winner pays, and the table refuses on that charge. So the
   * field's edge is past the ledger for a crew standing under it, and the shelf has to say where.
   */
  it('quotes a bid ceiling past the ledger for a crew the Statue favours', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 700);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const baseId = me.json<{ base: { id: string } }>().base.id;
    const statue = 'last-platform-stationmaster';
    const control = app.repos.city.control(statue);
    if (!control) throw new Error(`fixture: no control row for ${statue}`);
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId },
      level: MAX_LOCATION_LEVEL,
      garrison: {},
    });

    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('fixture: the crew lost its district');
    const percent = standingEffectsFor(app.repos, base).blackMarketDiscountPercent;
    expect(percent, 'holding the Statue bought no discount').toBeGreaterThan(0);

    const ceiling = (await shelf(app, token)).bidCeiling ?? 0;
    expect(ceiling).toBeGreaterThan(700);
    expect(discountedInfamy(ceiling, percent)).toBeLessThanOrEqual(700);
    expect(discountedInfamy(ceiling + 1, percent)).toBeGreaterThan(700);
  });

  it('refuses a bid the crew could not cover tonight', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 1);
    // The bench was on only to hand the infamy over. Admin mode waives this very refusal now
    // (maintainer, 2026-10-02), so the bid itself is made under the ordinary rules.
    Object.assign(app.config, { admin: false });
    const board = await shelf(app, token);

    const res = await bid(app, token, 0, board.offers[0]!.slot.goodId, lotIn(board, 0).nextBid);
    expect(res.statusCode).toBe(409);
    const after = await shelf(app, token);
    expect(after.infamy).toBe(1);
    expect(lotIn(after, 0).bidders).toBe(0);
  });
});

describe('the close', () => {
  it('hands the crate to the highest bidder, at what they bid', async () => {
    const { app, db } = await makeApp();
    const one = await crew(app, 'operator_one');
    const two = await crew(app, 'operator_two');
    await giveInfamy(app, one.token, 500_000);
    await giveInfamy(app, two.token, 500_000);
    ordinaryRules(app);

    const board = await shelf(app, one.token);
    const goodId = board.offers[0]!.slot.goodId;
    const spec = BLACK_MARKET_GOODS[goodId]!;
    const opening = lotIn(board, 0).reserve;
    expect((await bid(app, two.token, 0, goodId, opening)).statusCode).toBe(200);
    const winning = nextLotBid(opening, opening);
    expect((await bid(app, one.token, 0, goodId, winning)).statusCode).toBe(200);

    // Both bids are holding their infamy until the close.
    expect((await shelf(app, one.token)).infamy).toBe(500_000 - winning);
    expect((await shelf(app, two.token)).infamy).toBe(500_000 - opening);
    settleBlackMarketLots(app.repos, closeOf(board), 'Europe/Athens');

    const winner = await shelf(app, one.token);
    // Paid once, at the bid: the close takes nothing more.
    expect(winner.infamy).toBe(500_000 - winning);
    expect(winner.takenToday).toBe(1);
    // The crew that was outbid gets its hold back.
    expect((await shelf(app, two.token)).infamy).toBe(500_000);

    if (spec.boost) {
      expect(winner.stash[spec.id]).toBe(1);
    } else {
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(one.token) });
      const inventory = me.json<{ base: { inventory: Record<string, number> } }>().base.inventory;
      for (const [item, count] of Object.entries(spec.grants ?? {})) {
        expect(inventory[item]).toBe(count);
      }
    }

    // The receipt the allowance is counted off, at the figure that actually left the wallet.
    const rows = db.prepare('SELECT * FROM black_market_takings').all() as {
      good_id: string;
      infamy_spent: number;
      day: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.good_id).toBe(goodId);
    expect(rows[0]?.infamy_spent).toBe(winning);
    expect(rows[0]?.day).toBe(board.day);
    expect(
      db.prepare("SELECT kind FROM game_events WHERE kind = 'blackmarket.taken'").all(),
    ).toHaveLength(1);
  });

  /*
   * Bug pass, 2026-10-02: the winner's bell quoted the bid, not what the Statue's discount left it
   * paying, and the others' bells named the winner by login name.
   */
  it('tells the winner what they paid, and the rest who took it by the name they go by', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'vex_login');
    const two = await crew(app, 'operator_two');
    await giveInfamy(app, one.token, 500_000);
    await giveInfamy(app, two.token, 500_000);
    ordinaryRules(app);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(one.token) });
    const { base: mine, user } = me.json<{ base: { id: string }; user: { id: string } }>();
    app.repos.users.updateProfile(user.id, { displayName: 'Vex' });
    const statue = 'last-platform-stationmaster';
    const control = app.repos.city.control(statue)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: mine.id },
      level: MAX_LOCATION_LEVEL,
      garrison: {},
    });
    const percent = standingEffectsFor(
      app.repos,
      app.repos.bases.findById(mine.id)!,
    ).blackMarketDiscountPercent;
    expect(percent, 'fixture: the Statue buys no discount').toBeGreaterThan(0);

    const board = await shelf(app, one.token);
    const goodId = board.offers[0]!.slot.goodId;
    const opening = lotIn(board, 0).reserve;
    expect((await bid(app, two.token, 0, goodId, opening)).statusCode).toBe(200);
    const winning = nextLotBid(opening, opening);
    expect((await bid(app, one.token, 0, goodId, winning)).statusCode).toBe(200);
    settleBlackMarketLots(app.repos, closeOf(board), 'Europe/Athens');

    const won = app.repos.social
      .notifications(user.id, 50)
      .find((one) => one.kind === 'market_won');
    expect(won?.title).toContain(
      `for ${discountedInfamy(winning, percent).toLocaleString('en')} infamy`,
    );
    const twoId = (
      await app.inject({ method: 'GET', url: '/api/me', headers: auth(two.token) })
    ).json<{
      user: { id: string };
    }>().user.id;
    const lost = app.repos.social
      .notifications(twoId, 50)
      .find((one) => one.kind === 'market_outbid');
    expect(lost?.title).toContain('Vex');
    expect(lost?.title).not.toContain('vex_login');
  });

  it('settles a lot once, however many times it is asked to', async () => {
    const { app, db } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 500_000);
    const board = await shelf(app, token);
    await bid(app, token, 0, board.offers[0]!.slot.goodId, lotIn(board, 0).nextBid);

    settleBlackMarketLots(app.repos, closeOf(board), 'Europe/Athens');
    const once = await shelf(app, token);
    settleBlackMarketLots(app.repos, closeOf(board), 'Europe/Athens');
    settleBlackMarketLots(app.repos, closeOf(board), 'Europe/Athens');

    expect((await shelf(app, token)).infamy).toBe(once.infamy);
    expect(db.prepare('SELECT * FROM black_market_takings').all()).toHaveLength(1);
  });

  it('gives a crew one crate a day and passes the rest down the ranking', async () => {
    const { app } = await makeApp();
    const greedy = await crew(app, 'operator_one');
    const patient = await crew(app, 'operator_two');
    await giveInfamy(app, greedy.token, 500_000);
    await giveInfamy(app, patient.token, 500_000);

    const board = await shelf(app, greedy.token);
    const first = board.offers[0]!.slot.goodId;
    const second = board.offers[1]!.slot.goodId;
    const opening = lotIn(board, 1).reserve;

    // The patient crew opens the second lot; the greedy one leads both.
    expect((await bid(app, patient.token, 1, second, opening)).statusCode).toBe(200);
    expect((await bid(app, greedy.token, 1, second, nextLotBid(opening, opening))).statusCode).toBe(
      200,
    );
    expect((await bid(app, greedy.token, 0, first, lotIn(board, 0).reserve)).statusCode).toBe(200);

    settleBlackMarketLots(app.repos, closeOf(board), 'Europe/Athens');

    // One crate each: the allowance stops the leader taking a second, and the lot falls to the
    // crew behind them rather than going unsold.
    expect((await shelf(app, greedy.token)).takenToday).toBe(1);
    expect((await shelf(app, patient.token)).takenToday).toBe(1);
  });

  /**
   * The infamy was taken at the bid, so a leader who spends the rest of their wallet afterwards
   * still takes the crate. What can still pass a leader over is the fence's own door: here their
   * name has slipped below the crate's rank. They get their hold back with everybody else who did
   * not take it.
   */
  it('passes a leader whose name has slipped to the crew behind them, and hands the hold back', async () => {
    // Only the clock, so the routes' `new Date()` reads the pinned shelf and nothing else waits.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(dayAskingForAName());
    const { app } = await makeApp();
    const slipped = await crew(app, 'operator_one');
    const solvent = await crew(app, 'operator_two');
    await giveInfamy(app, slipped.token, 500_000);
    await giveInfamy(app, solvent.token, 500_000);
    ordinaryRules(app);

    const board = await shelf(app, slipped.token);
    const slot = board.offers.findIndex((offer) => offer.minNotoriety > 0);
    if (slot === -1) throw new Error('fixture: nothing on the shelf asks for a name');
    const goodId = board.offers[slot]!.slot.goodId;
    const opening = lotIn(board, slot).reserve;
    const leading = nextLotBid(opening, opening);
    expect((await bid(app, solvent.token, slot, goodId, opening)).statusCode).toBe(200);
    expect((await bid(app, slipped.token, slot, goodId, leading)).statusCode).toBe(200);

    const slippedId = app.repos.users.findByUsername('operator_one')!.id;
    const base = app.repos.bases.findByOwnerId(slippedId)!;
    app.repos.bases.updateEconomy(base.id, { ...base.economy, notoriety: 0 });
    settleBlackMarketLots(app.repos, closeOf(board), 'Europe/Athens');

    const passed = await shelf(app, slipped.token);
    expect(passed.takenToday).toBe(0);
    expect(passed.infamy, 'the passed leader never got its hold back').toBe(500_000);
    const winner = await shelf(app, solvent.token);
    expect(winner.takenToday).toBe(1);
    expect(winner.infamy).toBe(500_000 - opening);
    // The leader is told it could not take the crate, not that operator_two outbid it (bug pass,
    // 2026-09-29): its own bid was the higher one.
    const told = app.repos.social
      .notifications(slippedId, 20)
      .find((entry) => entry.kind === 'market_outbid');
    // Formatted as the notice formats it: a lot over a thousand reads "1,904" (found 2026-10-06,
    // on a day the shelf opened one that high).
    expect(told?.title).toMatch(
      new RegExp(
        `^You could not take .+ at the close, so operator_two did at ${opening.toLocaleString('en')} infamy$`,
      ),
    );
  });

  it('lets a crew raise on its own wallet plus the hold its last bid is keeping', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'operator_one');
    const two = await crew(app, 'operator_two');
    await giveInfamy(app, one.token, 500_000);
    await giveInfamy(app, two.token, 500_000);
    ordinaryRules(app);
    const board = await shelf(app, one.token);
    const goodId = board.offers[0]!.slot.goodId;
    const opening = lotIn(board, 0).reserve;
    const second = nextLotBid(opening, opening);
    const raised = nextLotBid(opening, second);
    // Exactly the raise: it only clears if the first bid's hold comes back first. Set on the row
    // rather than through the bench, which moves the rank and with it the city's reserve.
    const oneId = app.repos.users.findByUsername('operator_one')!.id;
    const base = app.repos.bases.findByOwnerId(oneId)!;
    app.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: raised });

    const first = await bid(app, one.token, 0, goodId, opening);
    expect(first.statusCode, first.body).toBe(200);
    const over = await bid(app, two.token, 0, goodId, second);
    expect(over.statusCode, over.body).toBe(200);
    const outbid = await shelf(app, one.token);
    expect(outbid.infamy).toBe(raised - opening);
    expect(outbid.offers[0]!.affordable, 'the card greyed a raise the wallet covers').toBe(true);

    expect((await bid(app, one.token, 0, goodId, raised)).statusCode).toBe(200);
    expect((await shelf(app, one.token)).infamy).toBe(0);
  });

  it('holds nothing on a bid placed in admin mode', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'operator_one');
    await giveInfamy(app, one.token, 5_000);
    const board = await shelf(app, one.token);

    expect(
      (await bid(app, one.token, 0, board.offers[0]!.slot.goodId, lotIn(board, 0).nextBid))
        .statusCode,
    ).toBe(200);
    expect((await shelf(app, one.token)).infamy).toBe(5_000);
  });

  it('turns the slot over for the whole city once it has gone', async () => {
    const { app } = await makeApp();
    const buyer = await crew(app, 'operator_one');
    const bystander = await crew(app, 'operator_two');
    await giveInfamy(app, buyer.token, 500_000);

    const before = await shelf(app, bystander.token);
    const sold = before.offers[0]!.slot.goodId;
    await bid(app, buyer.token, 0, sold, lotIn(before, 0).nextBid);
    settleBlackMarketLots(app.repos, closeOf(before), 'Europe/Athens');

    const after = await shelf(app, bystander.token);
    // Still five deep: the slot refilled rather than emptying.
    expect(after.offers).toHaveLength(BLACK_MARKET_SLOTS);
    expect(after.offers[0]!.slot.generation).toBe(1);
    expect(after.offers[0]!.slot.goodId).not.toBe(sold);
    // And the other four are exactly where the bystander left them.
    expect(after.offers.slice(1).map((offer) => offer.slot.goodId)).toEqual(
      before.offers.slice(1).map((offer) => offer.slot.goodId),
    );
  });

  it('derives what it shows from the stored turnover, and nothing else', async () => {
    const { app, db } = await makeApp();
    const { token } = await crew(app, 'operator');
    const board = await shelf(app, token);

    // Everything the shelf shows can be rebuilt from the day and five integers. That is the
    // property that lets two servers a month apart agree about what was on sale.
    const generations = (
      db
        .prepare('SELECT slot_index, generation FROM black_market_slots WHERE day = ?')
        .all(board.day) as { slot_index: number; generation: number }[]
    ).reduce<number[]>((into, row) => {
      into[row.slot_index] = row.generation;
      return into;
    }, []);
    expect(blackMarketBoard(board.day, generations)).toEqual(
      board.offers.map((offer) => offer.slot),
    );
  });
});

/**
 * The daily allowance is the game's day, not the player's.
 *
 * `zone.ts` states the rule outright: a player may move the *display* to their timezone, and "the
 * day boundary the rules use does not move with them". The black market did the opposite: it keyed
 * both the once-a-day limit and the shelf seed to `currentUser.timezone`, which is a value the
 * player sets with a single `PATCH /settings/profile`. Take, change timezone, take again. At the
 * right hour there are three distinct day strings reachable, so the once-a-day good is a
 * three-a-day good, and the shelf reseeds each time so you can shop for the one you want.
 *
 * The shelf takes bids rather than takes now, and the hole is the same one: the allowance is
 * counted on a day string, and the day string has to be the house's.
 */
describe('the black market day is the house clock', () => {
  it('does not hand out a second crate when the player changes timezone', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'zonehopper');
    await giveInfamy(app, token, 500_000);

    const before = await shelf(app, token);
    const first = await bid(app, token, 0, before.offers[0]!.slot.goodId, lotIn(before, 0).nextBid);
    expect(first.statusCode, first.body.slice(0, 200)).toBe(200);
    const second = await bid(
      app,
      token,
      1,
      before.offers[1]!.slot.goodId,
      lotIn(before, 1).nextBid,
    );
    expect(second.statusCode, second.body.slice(0, 200)).toBe(200);

    // The whole exploit, in one request.
    const moved = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { timezone: 'Pacific/Kiritimati' },
    });
    expect(moved.statusCode, moved.body.slice(0, 200)).toBe(200);

    settleBlackMarketLots(app.repos, closeOf(before), 'Europe/Athens');
    const after = await shelf(app, token);
    expect(after.day, 'the shelf reseeded on the player’s own calendar').toBe(before.day);
    expect(after.takenToday, 'a timezone change bought a second crate').toBe(1);
  });
});

/**
 * The fence's blueprint lots sell whole documents that cannot be traded and unlock once, so a crew
 * that already holds one is refused at the table and walked past at the close (bug pass,
 * 2026-09-28). Driven through `placeBlackMarketBid` on a day whose shelf carries a blueprint lot:
 * the route bids on today's shelf, and today's may not have one.
 */
describe('a blueprint the crew already holds', () => {
  const zone = 'Europe/Athens';
  const blueprintDay = (() => {
    for (let offset = 0; offset < 400; offset += 1) {
      const noon = new Date(Date.UTC(2026, 9, 1, 10) + offset * 86_400_000);
      const day = blackMarketDay(noon, zone);
      const slot = blackMarketBoard(day, []).find(
        (entry) => findBlackMarketGood(entry.goodId)?.kind === 'blueprint',
      );
      if (slot) return { noon, day, slot };
    }
    throw new Error('fixture: no blueprint lot in 400 days of shelves');
  })();
  const { noon, day, slot } = blueprintDay;
  const spec = findBlackMarketGood(slot.goodId)!;
  const documentId = Object.keys(spec.grants ?? {})[0]!;

  const baseOf = (app: FastifyInstance, username: string) => {
    const user = app.repos.users.findByUsername(username)!;
    return { user, base: app.repos.bases.findByOwnerId(user.id)! };
  };
  const holdDocument = (app: FastifyInstance, username: string) => {
    const { base } = baseOf(app, username);
    app.repos.bases.updateHoldings(base.id, base.resources, {
      ...base.inventory,
      [documentId]: 1,
    });
  };
  const place = (app: FastifyInstance, username: string, amount: number) => {
    const { user, base } = baseOf(app, username);
    return placeBlackMarketBid(app.repos, {
      base,
      userId: user.id,
      slotIndex: slot.index,
      goodId: slot.goodId,
      amount,
      now: noon,
      zone,
    });
  };

  it('refuses the bid, and says why', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'plans_holder');
    await giveInfamy(app, one.token, 500_000);
    holdDocument(app, 'plans_holder');

    expect(place(app, 'plans_holder', 100_000)).toEqual({
      kind: 'refused',
      reason: 'already_known',
    });
  });

  it('passes the lot to the next crew when the leader came by the plans after bidding', async () => {
    const { app } = await makeApp();
    const one = await crew(app, 'plans_leader');
    const two = await crew(app, 'plans_second');
    await giveInfamy(app, one.token, 500_000);
    await giveInfamy(app, two.token, 500_000);

    expect(place(app, 'plans_second', 50_000)).toEqual({ kind: 'placed' });
    expect(place(app, 'plans_leader', 60_000)).toEqual({ kind: 'placed' });
    holdDocument(app, 'plans_leader');

    settleBlackMarketLots(app.repos, blackMarketClosesAt(day), zone);

    expect(baseOf(app, 'plans_leader').base.economy.infamy).toBe(500_000);
    const second = baseOf(app, 'plans_second').base;
    expect(second.inventory[documentId as keyof typeof second.inventory]).toBe(1);
    expect(second.economy.infamy).toBeLessThan(500_000);
  });
});
