import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BARTER_RATE,
  UNIT_MODIFICATIONS,
  marketDay,
  instantAtHourInZone,
  OFFER_LIFETIME_HOURS,
  vendorSessionsFor,
  vendorStockFor,
  visitClosesAt,
  type ItemId,
  type Resources,
  type MarketResponse,
  type ScrapyardResponse,
  type Base,
  RESEARCH_ITEMS,
  researchEffects,
  storageCapacity,
  storageCapacityFor,
  OFFICER_ROLES,
  createCommander,
  makeAttributes,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { acceptOffer, buySupply, projectMarket } from './board.js';
import { placeVendorBid, settleVendorAuctions } from './auction.js';
import { chooseOverseer } from '../testing/overseer.js';
import { crewEffectsFor } from '../crew/standing.js';

/**
 * The market and the yard's refits, end to end over HTTP.
 *
 * The rules themselves are pinned in `packages/shared`; what these are for is the part that only
 * exists on the server: that goods actually move, that they move *once*, and that escrow comes
 * home. A trade is the one place in this game where a bug takes something off a player that they
 * cannot get back, so every assertion below is about a stockpile before and after.
 *
 * The Runner's hours are derived from the game date, so a test that goes over HTTP cannot decide
 * whether he is in: it gets whatever hour the suite happens to run at. Anything that needs him
 * open, or needs him shut, calls `projectMarket` with an explicit `now` instead. That is the same
 * function the route calls, one layer down, and it is the layer the hours actually live in: see
 * `anOpenMoment` and `aShutMoment`.
 */

/** A moment inside one of the Runner's two windows on `day`, and one well outside both. */
function anOpenMoment(day = marketDay(new Date())): Date {
  const session = vendorSessionsFor(day)[0];
  if (!session) throw new Error('fixture error: the Runner keeps no hours today');
  return new Date(instantAtHourInZone(day, session.startHour).getTime() + 30 * 60_000);
}

function aShutMoment(day = marketDay(new Date())): Date {
  const hours = new Set(
    vendorSessionsFor(day).flatMap((session) =>
      Array.from({ length: session.hours }, (_, step) => (session.startHour + step) % 24),
    ),
  );
  const free = Array.from({ length: 24 }, (_, hour) => hour).find((hour) => !hours.has(hour));
  if (free === undefined) throw new Error('fixture error: the Runner never leaves today');
  return new Date(instantAtHourInZone(day, free).getTime() + 30 * 60_000);
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
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

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function signIn(app: FastifyInstance, username = 'trader'): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  return token;
}

async function board(app: FastifyInstance, token: string): Promise<MarketResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/market', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<MarketResponse>();
}

/** Hand a crew whatever the test needs it to be holding. */
function stock(
  app: FastifyInstance,
  username: string,
  resources: Partial<Resources>,
  inventory: Partial<Record<ItemId, number>> = {},
): void {
  const user = app.repos.users.findByUsername(username);
  const base = app.repos.bases.findByOwnerId(user?.id ?? '');
  if (!base) throw new Error('no base');
  app.repos.bases.updateHoldings(base.id, { ...base.resources, ...resources }, inventory);
}

function baseOf(app: FastifyInstance, username: string) {
  const user = app.repos.users.findByUsername(username);
  const base = app.repos.bases.findByOwnerId(user?.id ?? '');
  if (!base) throw new Error('no base');
  return base;
}

describe('the Runner, over HTTP', () => {
  it('says when he is in, whatever hour the suite runs at', async () => {
    const app = await makeApp();
    const view = await board(app, await signIn(app));

    expect(view.vendor.sessions).toHaveLength(2);
    // The hours the server reports are the ones the shared derivation produces for today.
    expect(view.vendor.sessions).toEqual(vendorSessionsFor(marketDay(new Date())));
    expect(new Date(view.vendor.opensAt).getTime()).toBeGreaterThan(Date.now());
    // And the barrow agrees with the sign on it at whatever hour this ran: goods only while he is
    // standing there. Both branches, so the run that happens to catch him out still asserts.
    if (view.vendor.open) expect(view.vendor.stock.length).toBeGreaterThan(0);
    else expect(view.vendor.stock).toEqual([]);
  });

  /**
   * Nobody sees the barrow until he is behind it.
   *
   * The stock used to be on every response all day with the buttons dead, which meant a player who
   * read the network could line their caps up for the one blueprint hours before a player who only
   * looked at the screen. What he has is a pure function of the date, so withholding it on the
   * client alone would have been a curtain rather than a rule.
   *
   * Driven through `projectMarket` with a chosen `now`: the route has no way to be told the hour,
   * and this is the function inside it that the hours belong to.
   */
  it('carries nothing at all while he is out, and the day\u2019s goods while he is in', async () => {
    const app = await makeApp();
    await signIn(app);
    const base = baseOf(app, 'trader');

    const shut = projectMarket(app.repos, base, aShutMoment());
    expect(shut.vendor.open).toBe(false);
    expect(shut.vendor.stock).toEqual([]);

    const open = projectMarket(app.repos, base, anOpenMoment());
    expect(open.vendor.open).toBe(true);
    expect(open.vendor.stock.map((offer) => offer.line.item)).toEqual(
      vendorStockFor(marketDay(new Date())).map((line) => line.item),
    );
  });

  /**
   * He takes no bids out of hours, and the line id comes from the *catalogue* rather than from the
   * response.
   *
   * It used to be read off the board, which worked while a shut barrow still listed its goods. Now
   * that it does not, that spelling would post an empty id and be refused as a malformed request:
   * a 400 dressed up as the rule under test. Naming a line the crew could not have seen is also
   * the case the guard is actually for, which is somebody who kept an id from this morning.
   */
  it('will not take a bid while he is out of the district', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const view = await board(app, token);
    if (view.vendor.open) return; // He is in right now; the closed path is the next test's job.

    const line = vendorStockFor(marketDay(new Date()))[0];
    expect(line, 'fixture error: nothing on the barrow today').toBeDefined();
    const res = await app.inject({
      method: 'POST',
      url: '/api/market/bid',
      headers: auth(token),
      payload: { lineId: line?.id ?? '', amount: line?.price ?? 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toContain(
      'not in the district',
    );
  });

  /** Every line he has something left of is a lot, and a line he is cleared out of is not. */
  it('puts a lot on every line with something left on it', async () => {
    const app = await makeApp();
    await signIn(app);
    const day = marketDay(new Date());
    const at = anOpenMoment(day);
    const cleared = vendorStockFor(day)[0];
    if (!cleared) throw new Error('fixture error: nothing on the barrow today');
    app.repos.market.recordVendorSale(day, cleared.id, cleared.stock, at.toISOString());

    const view = projectMarket(app.repos, baseOf(app, 'trader'), at);
    expect(view.vendor.session).toBe(0);
    for (const offer of view.vendor.stock) {
      if (offer.line.id === cleared.id) {
        expect(offer.line.stock).toBe(0);
        expect(offer.auction).toBeNull();
        continue;
      }
      expect(offer.auction?.lineId).toBe(offer.line.id);
      // The reserve is the city's number, so it is the line's own price and nobody's discount.
      expect(offer.auction?.reserve).toBe(offer.line.price);
      expect(offer.auction?.leading).toBeNull();
      expect(offer.auction?.nextBid).toBe(offer.line.price);
    }
  });
});

describe('the Broker, over HTTP', () => {
  it('takes one resource and gives back half of another', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    stock(app, 'trader', { oil: 1000, scrap: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/market/barter',
      headers: auth(token),
      payload: { give: 'oil', want: 'scrap', amount: 400 },
    });
    expect(res.statusCode).toBe(200);

    const after = baseOf(app, 'trader');
    expect(after.resources.oil).toBe(600);
    expect(after.resources.scrap).toBe(400 * BARTER_RATE);
  });

  it('refuses a trade for the same thing, and one that is too small', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    stock(app, 'trader', { oil: 1000 });

    const same = await app.inject({
      method: 'POST',
      url: '/api/market/barter',
      headers: auth(token),
      payload: { give: 'oil', want: 'oil', amount: 400 },
    });
    expect(same.statusCode).toBe(409);

    const small = await app.inject({
      method: 'POST',
      url: '/api/market/barter',
      headers: auth(token),
      payload: { give: 'oil', want: 'scrap', amount: 1 },
    });
    expect(small.statusCode).toBe(409);
  });

  it('does not touch caps, either way round ( maintainer 2026-09-09)', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    stock(app, 'trader', { caps: 5000, oil: 1000, scrap: 0 });

    for (const payload of [
      { give: 'caps', want: 'scrap', amount: 400 },
      { give: 'oil', want: 'caps', amount: 400 },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/market/barter',
        headers: auth(token),
        payload,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { message: string } }>().error.message).toContain('caps');
    }
    // And nothing moved.
    const after = baseOf(app, 'trader');
    expect(after.resources.caps).toBe(5000);
    expect(after.resources.oil).toBe(1000);
  });

  it('will not let a crew trade what it does not have', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    stock(app, 'trader', { oil: 10 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/market/barter',
      headers: auth(token),
      payload: { give: 'oil', want: 'scrap', amount: 5000 },
    });
    expect(res.statusCode).toBe(409);
    expect(baseOf(app, 'trader').resources.oil).toBe(10);
  });
});

describe('the board', () => {
  async function twoCrews(): Promise<{
    app: FastifyInstance;
    seller: string;
    buyer: string;
  }> {
    const app = await makeApp();
    const seller = await signIn(app, 'seller');
    const buyer = await signIn(app, 'buyer');
    stock(app, 'seller', { scrap: 5000, caps: 1000 }, { rotor_hub: 1 });
    stock(app, 'buyer', { scrap: 0, caps: 9000 });
    return { app, seller, buyer };
  }

  const post = (app: FastifyInstance, token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/market/offer', headers: auth(token), payload });

  it('escrows what a listing gives, the moment it is posted', async () => {
    const { app, seller } = await twoCrews();
    const before = baseOf(app, 'seller').resources.scrap;

    const res = await post(app, seller, {
      give: { resources: { scrap: 2000 }, items: {} },
      want: { resources: { caps: 3000 }, items: {} },
    });
    expect(res.statusCode).toBe(200);
    // Gone already: a board of listings nobody can honour is worse than no board.
    expect(baseOf(app, 'seller').resources.scrap).toBe(before - 2000);
  });

  it('gives the escrow back when the listing is withdrawn', async () => {
    const { app, seller } = await twoCrews();
    const before = baseOf(app, 'seller').resources.scrap;
    await post(app, seller, {
      give: { resources: { scrap: 2000 }, items: {} },
      want: { resources: { caps: 3000 }, items: {} },
    });
    const mine = (await board(app, seller)).mine[0];

    const res = await app.inject({
      method: 'POST',
      url: '/api/market/withdraw',
      headers: auth(seller),
      payload: { offerId: mine?.id ?? '' },
    });
    expect(res.statusCode).toBe(200);
    expect(baseOf(app, 'seller').resources.scrap).toBe(before);
  });

  /**
   * A counter is a bid on one listing, so it goes when the listing goes.
   *
   * Accepting released the counters from the start; withdrawing did not, so a buyer's escrow sat
   * locked for two days against a listing nobody could take any more.
   */
  it('releases the counters when the listing they answer is withdrawn', async () => {
    const { app, seller, buyer } = await twoCrews();
    await post(app, seller, {
      give: { resources: { scrap: 100 }, items: {} },
      want: { resources: { caps: 5000 }, items: {} },
    });
    const listing = (await board(app, buyer)).offers[0];
    const buyerCaps = baseOf(app, 'buyer').resources.caps;
    await post(app, buyer, {
      give: { resources: { caps: 2000 }, items: {} },
      want: { resources: { scrap: 100 }, items: {} },
      counterTo: listing?.id,
    });
    expect(baseOf(app, 'buyer').resources.caps).toBe(buyerCaps - 2000);

    const res = await app.inject({
      method: 'POST',
      url: '/api/market/withdraw',
      headers: auth(seller),
      payload: { offerId: listing?.id ?? '' },
    });
    expect(res.statusCode).toBe(200);
    // The counter's escrow is back with the buyer, and the counter is off the board.
    expect(baseOf(app, 'buyer').resources.caps).toBe(buyerCaps);
    expect((await board(app, seller)).offers.find((offer) => offer.counterTo === listing?.id)).toBe(
      undefined,
    );
  });

  it('moves both sides exactly once when somebody takes it', async () => {
    const { app, seller, buyer } = await twoCrews();
    await post(app, seller, {
      give: { resources: {}, items: { rotor_hub: 1 } },
      want: { resources: { caps: 3000 }, items: {} },
    });
    const listing = (await board(app, buyer)).offers[0];
    expect(listing).toBeDefined();

    const sellerCaps = baseOf(app, 'seller').resources.caps;
    const buyerCaps = baseOf(app, 'buyer').resources.caps;

    const res = await app.inject({
      method: 'POST',
      url: '/api/market/accept',
      headers: auth(buyer),
      payload: { offerId: listing?.id ?? '' },
    });
    expect(res.statusCode).toBe(200);

    expect(baseOf(app, 'buyer').resources.caps).toBe(buyerCaps - 3000);
    expect(baseOf(app, 'buyer').inventory.rotor_hub).toBe(1);
    expect(baseOf(app, 'seller').resources.caps).toBe(sellerCaps + 3000);
    expect(baseOf(app, 'seller').inventory.rotor_hub).toBeUndefined();

    // And it cannot be taken twice.
    const again = await app.inject({
      method: 'POST',
      url: '/api/market/accept',
      headers: auth(buyer),
      payload: { offerId: listing?.id ?? '' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuses a buyer who cannot pay, and takes nothing off them', async () => {
    const { app, seller, buyer } = await twoCrews();
    await post(app, seller, {
      give: { resources: { scrap: 100 }, items: {} },
      want: { resources: { caps: 999_999 }, items: {} },
    });
    const listing = (await board(app, buyer)).offers[0];
    const before = baseOf(app, 'buyer').resources.caps;

    const res = await app.inject({
      method: 'POST',
      url: '/api/market/accept',
      headers: auth(buyer),
      payload: { offerId: listing?.id ?? '' },
    });
    expect(res.statusCode).toBe(409);
    expect(baseOf(app, 'buyer').resources.caps).toBe(before);
  });

  it('will not let a crew trade with itself', async () => {
    const { app, seller } = await twoCrews();
    await post(app, seller, {
      give: { resources: { scrap: 100 }, items: {} },
      want: { resources: { caps: 100 }, items: {} },
    });
    const mine = (await board(app, seller)).mine[0];
    const res = await app.inject({
      method: 'POST',
      url: '/api/market/accept',
      headers: auth(seller),
      payload: { offerId: mine?.id ?? '' },
    });
    expect(res.statusCode).toBe(409);
  });

  describe('counters', () => {
    it('shows a counter to the crew it is aimed at, and to nobody else', async () => {
      const { app, seller, buyer } = await twoCrews();
      const third = await signIn(app, 'onlooker');
      await post(app, seller, {
        give: { resources: { scrap: 100 }, items: {} },
        want: { resources: { caps: 5000 }, items: {} },
      });
      const listing = (await board(app, buyer)).offers[0];

      const counter = await post(app, buyer, {
        give: { resources: { caps: 2000 }, items: {} },
        want: { resources: { scrap: 100 }, items: {} },
        counterTo: listing?.id,
      });
      expect(counter.statusCode).toBe(200);

      // The seller sees it; a passer-by does not.
      expect((await board(app, seller)).offers.map((offer) => offer.counterTo)).toContain(
        listing?.id,
      );
      expect((await board(app, third)).offers.some((offer) => offer.counterTo !== null)).toBe(
        false,
      );
    });

    it('settles the counter and releases the counters on whatever it replaced', async () => {
      const { app, seller, buyer } = await twoCrews();
      await post(app, seller, {
        give: { resources: { scrap: 100 }, items: {} },
        want: { resources: { caps: 5000 }, items: {} },
      });
      const listing = (await board(app, buyer)).offers[0];
      await post(app, buyer, {
        give: { resources: { caps: 2000 }, items: {} },
        want: { resources: { scrap: 100 }, items: {} },
        counterTo: listing?.id,
      });

      const counter = (await board(app, seller)).offers.find(
        (offer) => offer.counterTo === listing?.id,
      );
      const sellerScrap = baseOf(app, 'seller').resources.scrap;

      const res = await app.inject({
        method: 'POST',
        url: '/api/market/accept',
        headers: auth(seller),
        payload: { offerId: counter?.id ?? '' },
      });
      expect(res.statusCode).toBe(200);
      // The seller paid the counter's price in scrap and took the caps.
      expect(baseOf(app, 'seller').resources.scrap).toBe(sellerScrap - 100);
      expect(baseOf(app, 'seller').resources.caps).toBeGreaterThan(1000);
    });
  });
});

/**
 * A crew that clears the officer and level gates every card now asks for.
 *
 * Every modification names a chair, a mark, a structure level and a crew level
 * (`building/requirements.ts`), and an empty chair is a refusal. These tests are about the yard's
 * own rules, the documents and the parts, so the crew gates are satisfied once here rather than
 * fought with in every case. `scrapyard.test.ts` is where the gates themselves are exercised.
 */
function seatEveryChair(app: FastifyInstance, baseId: string): void {
  app.repos.bases.updateCommanders(
    baseId,
    OFFICER_ROLES.map((role, index) =>
      createCommander(`off-${index}`, `Officer ${index}`, role, makeAttributes(90)),
    ),
  );
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateProgression(baseId, 30, base.progression);
}

describe("unit modification cards, over the yard's route", () => {
  /*
   * The Workshop's own route sold the refits until the maintainer's 2026-09-10 call folded it into
   * the Scrapyard; the refits themselves went on 2026-09-15 for the thirty cards. Same parts, same
   * brackets: the door moved and the catalogue changed, the rules did not.
   */
  async function ready(): Promise<{ app: FastifyInstance; token: string }> {
    const app = await makeApp();
    const token = await signIn(app, 'smith');
    const base = baseOf(app, 'smith');
    // A yard high enough for every rarity, and the money to pay for it.
    app.repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings.filter(
          (building) => building.kind !== 'scrapyard' && building.kind !== 'gauntlet',
        ),
        { id: 'y', kind: 'scrapyard', level: 20, modifications: [], damage: 0 },
        // A unit card's level gate reads the Gauntlet, and the roster it may be bolted to is the
        // one the Gauntlet has opened: without one, every sheet answers "you cannot field them".
        { id: 'g', kind: 'gauntlet', level: 20, modifications: [], damage: 0 },
      ],
      [],
    );
    stock(
      app,
      'smith',
      { scrap: 99_999, caps: 99_999, highQualityMetal: 9_999, oil: 9_999 },
      {
        scrap_servo: 20,
        ceramic_plate: 20,
        optic_cluster: 20,
        neural_shunt: 20,
        coolant_cell: 20,
        weld_rod: 20,
        hydraulic_ram: 20,
        signal_relay: 20,
        pressure_valve: 20,
        // One gated card's drawings, so the parts and the brackets can be exercised on a card that
        // has parts to spend. Rag Wraps is the control: gated, and its document is not held.
        bp_mod_filed_sights: 1,
      },
    );
    seatEveryChair(app, base.id);
    return { app, token };
  }

  const yard = async (app: FastifyInstance, token: string): Promise<ScrapyardResponse> => {
    const res = await app.inject({ method: 'GET', url: '/api/scrapyard', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    return res.json<ScrapyardResponse>();
  };

  const buildCard = (app: FastifyInstance, token: string, id: string, unitId = 'razors') =>
    app.inject({
      method: 'POST',
      url: '/api/scrapyard/build',
      headers: auth(token),
      // One press cuts the card and bolts it onto the named sheet (maintainer rule, 2026-09-16).
      payload: { kind: 'upgrade', id, target: unitId },
    });

  const statOf = async (app: FastifyInstance, token: string, unitId: string, stat: string) => {
    const res = await app.inject({ method: 'GET', url: '/api/units', headers: auth(token) });
    const units = res.json<{ units: { id: string; stats: Record<string, number> }[] }>().units;
    return units.find((unit) => unit.id === unitId)?.stats[stat] ?? 0;
  };

  it('offers every card, with the locked ones saying why on every sheet they fit', async () => {
    const { app, token } = await ready();
    const view = await yard(app, token);
    const cards = view.entries.filter((entry) => entry.kind === 'upgrade');
    expect(cards).toHaveLength(UNIT_MODIFICATIONS.length);
    const gated = cards.find((card) => card.id === 'rag_wraps');
    expect(gated?.rarity).toBe('basic');
    // The answer lives per sheet now, because the gates are per sheet: the same card is refused on
    // a unit the crew cannot field and open on one it can.
    expect(gated?.targets.length).toBeGreaterThan(0);
    // On a sheet the crew can field, the document is what is in the way. On one it cannot field
    // yet, that is said first: a card cut for a unit that cannot take the field is spent on
    // nothing, and it is the refusal a document would not fix.
    const fieldable = gated?.targets.find((target) => target.id === 'razors');
    expect(fieldable?.blocker, 'razors').toContain('Rag Wraps Blueprint');
    expect(
      gated?.targets.every((target) => target.blocker !== null),
      'a gated card was open somewhere',
    ).toBe(true);
  });

  /**
   * One press: the yard cuts it, charges for it, takes the parts, and bolts it on.
   *
   * There is no stock in between any more, so what proves it landed is the bracket on the sheet
   * and the sheet itself: a card that was merely bought used to change nobody's numbers.
   */
  it('cuts a card, spends for it, takes the parts and bolts it onto the sheet', async () => {
    const { app, token } = await ready();
    const before = baseOf(app, 'smith');
    const penetrationBefore = await statOf(app, token, 'razors', 'penetration');

    const res = await buildCard(app, token, 'filed_sights');
    expect(res.statusCode, res.body).toBe(200);

    const after = baseOf(app, 'smith');
    expect(after.unitLoadouts['razors']).toContain('filed_sights');
    expect(after.resources.scrap).toBeLessThan(before.resources.scrap);
    expect(after.inventory.weld_rod).toBe((before.inventory.weld_rod ?? 0) - 2);
    // ...and the roster the crew already has is better for it, on the same request.
    expect(await statOf(app, token, 'razors', 'penetration')).toBeGreaterThan(penetrationBefore);
  });

  it('refuses a gated card without its blueprint, and takes it with one', async () => {
    const { app, token } = await ready();
    const refused = await buildCard(app, token, 'rag_wraps');
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('Rag Wraps Blueprint');

    const base = baseOf(app, 'smith');
    app.repos.bases.updateHoldings(base.id, base.resources, {
      ...base.inventory,
      bp_mod_rag_wraps: 1,
    });
    const taken = await buildCard(app, token, 'rag_wraps');
    expect(taken.statusCode, taken.body).toBe(200);
  });

  it('refuses a sheet the card does not fit, and one the crew cannot field', async () => {
    const { app, token } = await ready();
    // A carrier's harness on a fighting sheet: never, whatever the crew has.
    const wrongUnit = await buildCard(app, token, 'counterweight_harness', 'razors');
    expect(wrongUnit.statusCode).toBe(409);
    expect(wrongUnit.body).toContain('does not fit this sheet');

    // A sheet the roster is not open to: the gates that decide it are the training gates, so a
    // card cut for it would be a card spent on a unit that cannot take the field.
    const cannotField = await buildCard(app, token, 'taped_grips', 'the_specter');
    expect(cannotField.statusCode).toBe(409);
  });

  /**
   * §D5c as it stands: one of a thing is one per *sheet*, not one per crew.
   *
   * The old rule was one copy in the whole yard, so bolting a plate to the Razors put it out of
   * reach of the Breakers for ever. The maintainer's rule of 2026-09-16 is the opposite and it is
   * the reason the bench is per unit: you may kit two sheets with the same card, and you pay the
   * yard twice for the privilege.
   */
  it('takes the same card for a second sheet, and charges for it again', async () => {
    const { app, token } = await ready();
    const first = await buildCard(app, token, 'taped_grips', 'razors');
    expect(first.statusCode, first.body).toBe(200);
    const afterFirst = baseOf(app, 'smith');

    const again = await buildCard(app, token, 'taped_grips', 'razors');
    expect(again.statusCode, 'the same sheet twice').toBe(409);
    expect(again.body).toContain('Already bolted on here');

    const second = await buildCard(app, token, 'taped_grips', 'ghosts');
    expect(second.statusCode, second.body).toBe(200);
    const afterSecond = baseOf(app, 'smith');
    expect(afterSecond.unitLoadouts['ghosts']).toContain('taped_grips');
    expect(afterSecond.resources.scrap, 'the second one was free').toBeLessThan(
      afterFirst.resources.scrap,
    );
  });

  /** And the only way one comes off, which destroys it. */
  it('dismantles a bolted card and leaves nothing behind', async () => {
    const { app, token } = await ready();
    expect((await buildCard(app, token, 'taped_grips', 'razors')).statusCode).toBe(200);

    const burnt = await app.inject({
      method: 'POST',
      url: '/api/units/burn',
      headers: auth(token),
      payload: { upgradeId: 'taped_grips' },
    });
    expect(burnt.statusCode, burnt.body).toBe(200);
    const after = baseOf(app, 'smith');
    expect(after.unitLoadouts['razors'] ?? []).not.toContain('taped_grips');
    expect(after.fittedUpgrades, 'nothing goes back to a stock: there is none').toEqual([]);
  });

  it('serves two crews the same stock on the same day', async () => {
    const app = await makeApp();
    await signIn(app, 'one');
    await signIn(app, 'two');
    // At an hour he is actually there, or both crews would correctly be served nothing and the
    // assertion would pass on two empty lists.
    const at = anOpenMoment();
    const first = projectMarket(app.repos, baseOf(app, 'one'), at);
    const second = projectMarket(app.repos, baseOf(app, 'two'), at);
    expect(first.vendor.stock.map((offer) => offer.line.item)).toEqual(
      second.vendor.stock.map((offer) => offer.line.item),
    );
    expect(first.vendor.stock.map((offer) => offer.line.item)).toEqual(
      vendorStockFor(marketDay(new Date())).map((line) => line.item),
    );
  });
});

/**
 * §D5c: one of a thing is one per **sheet**, and taking one off destroys it.
 *
 * The old rule was one copy in the whole yard, with a separate screen to move it: build a plate,
 * bolt it to the Razors, and the Breakers could never have one. The maintainer reversed that on
 * 2026-09-16, and the reversal is the whole reason the bench is per unit. What is left of the old
 * rule is the part that gives the choice weight: a card comes off in pieces, so the second sheet
 * costs the yard's bill again rather than a click.
 */
describe('one of a thing is one of a thing (§D5c)', () => {
  /** A crew with a yard, a Gauntlet, the chairs filled, money, and the parts. */
  async function armed(): Promise<{ app: FastifyInstance; token: string }> {
    const app = await makeApp();
    const token = await signIn(app, 'plater');
    const base = baseOf(app, 'plater');
    app.repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings.filter(
          (building) =>
            building.kind !== 'scrapyard' &&
            building.kind !== 'gauntlet' &&
            building.kind !== 'generator',
        ),
        { id: 'y', kind: 'scrapyard', level: 20, modifications: [], damage: 0 },
        { id: 'g', kind: 'gauntlet', level: 20, modifications: [], damage: 0 },
        // The Sparks want a Generator, and this test is about two sheets rather than about which
        // structures open which roster.
        { id: 'gen', kind: 'generator', level: 6, modifications: [], damage: 0 },
      ],
      [],
    );
    stock(
      app,
      'plater',
      { scrap: 99_999, caps: 99_999, highQualityMetal: 9_999, oil: 9_999 },
      {
        scrap_servo: 20,
        ceramic_plate: 20,
        optic_cluster: 20,
        neural_shunt: 20,
        coolant_cell: 20,
        weld_rod: 20,
        hydraulic_ram: 20,
        signal_relay: 20,
        pressure_valve: 20,
      },
    );
    seatEveryChair(app, base.id);
    return { app, token };
  }

  const bolt = (app: FastifyInstance, token: string, unitId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/scrapyard/build',
      headers: auth(token),
      payload: { kind: 'upgrade', id: 'taped_grips', target: unitId },
    });

  it('puts the same card on a second sheet, for a second bill', async () => {
    const { app, token } = await armed();
    const first = await bolt(app, token, 'razors');
    expect(first.statusCode, first.body).toBe(200);
    const afterFirst = baseOf(app, 'plater').resources.scrap;

    const second = await bolt(app, token, 'sparks');
    expect(second.statusCode, second.body).toBe(200);
    const after = baseOf(app, 'plater');
    expect(after.unitLoadouts['razors']).toContain('taped_grips');
    expect(after.unitLoadouts['sparks']).toContain('taped_grips');
    expect(after.resources.scrap, 'the second sheet was free').toBeLessThan(afterFirst);
  });

  it('refuses the same card twice on one sheet', async () => {
    const { app, token } = await armed();
    expect((await bolt(app, token, 'razors')).statusCode).toBe(200);
    const again = await bolt(app, token, 'razors');
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain('Already bolted on here');
  });

  it('fills the brackets from the left and refuses a fourth card', async () => {
    const { app, token } = await armed();
    const cards = ['taped_grips', 'scrap_vest', 'filed_sights', 'rag_wraps'];
    const base = baseOf(app, 'plater');
    // Every document, so what is being read is the brackets rather than the drawings.
    // Scrap Vest is one of the three open cards, so it wants no document.
    app.repos.bases.updateHoldings(base.id, base.resources, {
      ...base.inventory,
      bp_mod_filed_sights: 1,
      bp_mod_rag_wraps: 1,
    });

    const taken: number[] = [];
    for (const id of cards) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/scrapyard/build',
        headers: auth(token),
        payload: { kind: 'upgrade', id, target: 'razors' },
      });
      taken.push(res.statusCode);
    }
    // Three brackets, so the fourth is refused for the brackets rather than for anything else.
    expect(taken.slice(0, 3)).toEqual([200, 200, 200]);
    expect(taken[3]).toBe(409);
    expect(baseOf(app, 'plater').unitLoadouts['razors']).toHaveLength(3);
  });

  it('burns one off the sheet and leaves nothing to re-bolt', async () => {
    const { app, token } = await armed();
    expect((await bolt(app, token, 'razors')).statusCode).toBe(200);

    const burnt = await app.inject({
      method: 'POST',
      url: '/api/units/burn',
      headers: auth(token),
      payload: { upgradeId: 'taped_grips' },
    });
    expect(burnt.statusCode, burnt.body).toBe(200);
    const after = baseOf(app, 'plater');
    expect(after.unitLoadouts['razors'] ?? []).not.toContain('taped_grips');
    expect(after.fittedUpgrades).toEqual([]);
  });

  it('refuses a burn of something that is not bolted to anything', async () => {
    const { app, token } = await armed();
    const res = await app.inject({
      method: 'POST',
      url: '/api/units/burn',
      headers: auth(token),
      payload: { upgradeId: 'taped_grips' },
    });
    expect(res.statusCode).toBe(409);
  });
});

/**
 * A sold-out line stays sold out across a restart.
 *
 * The city's counter was a module-level `Map`, so it lived exactly as long as the process. A
 * restart, a crash or a deploy put every sold-out line back on the barrow inside the same game day,
 * which turns a blueprint the catalogue rations to `stock: 1` into one that anybody can have: the
 * exploit is "wait for a deploy". Two app instances over one database file is the smallest thing
 * that can tell the difference, because an in-memory database dies with the process it is testing.
 *
 * The line goes now by being won rather than bought, which is the same counter one door further
 * along: the close books the sale, and his second visit of the day finds nothing left to bid on.
 */
describe('what the city has already bought', () => {
  it('survives the server being restarted', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'frontline-market-')), 'world.sqlite');

    /*
     * A fixed day with a one-of-a-kind line on it, rather than today's.
     *
     * The barrow is a pure function of the game day, and not every day has a line the catalogue
     * rations to one. Scanning for a day that does is what makes the fixture the same on every
     * morning the suite runs; nothing else in this case cares what the date is.
     */
    let day = '2026-09-15';
    let rationed = vendorStockFor(day).find((line) => line.stock === 1);
    for (let step = 0; step < 90 && !rationed; step += 1) {
      day = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
      rationed = vendorStockFor(day).find((line) => line.stock === 1);
    }
    if (!rationed) throw new Error('fixture error: the Runner rations nothing for three months');
    const line = rationed;

    const during = (session: number): Date => {
      const slot = vendorSessionsFor(day)[session];
      if (!slot) throw new Error(`fixture error: no session ${session} on ${day}`);
      return new Date(instantAtHourInZone(day, slot.startHour).getTime() + 30 * 60_000);
    };

    const boot = async () => {
      const config = loadConfig({ DATABASE_PATH: file, JWT_SECRET: 'test-secret' });
      const db = openDatabase(config.databasePath);
      runMigrations(db);
      const app = await buildApp({ config, db, logger: false });
      return { app, db };
    };

    const first = await boot();
    const token = await signIn(first.app, 'restarts');
    const me = await first.app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const base = first.app.repos.bases.findById(me.json<{ base: { id: string } }>().base.id)!;
    const userId = base.ownerId;
    // Caps enough that affording it is never the reason a bid or a close is refused.
    first.app.repos.bases.updateResources(base.id, { ...base.resources, caps: 1_000_000 });

    const placed = placeVendorBid(first.app.repos, {
      base: first.app.repos.bases.findById(base.id)!,
      userId,
      lineId: line.id,
      amount: line.price,
      now: during(0),
    });
    expect(placed.kind, 'the fixture could not bid on the line').toBe('placed');
    settleVendorAuctions(first.app.repos, new Date(visitClosesAt(day, 0).getTime() + 60_000));
    expect(first.app.repos.market.vendorSold(day, line.id)).toBe(1);

    // Sold out for this process, which is the part that always worked.
    expect(
      placeVendorBid(first.app.repos, {
        base: first.app.repos.bases.findById(base.id)!,
        userId,
        lineId: line.id,
        amount: line.price,
        now: during(1),
      }),
    ).toMatchObject({ kind: 'refused', reason: 'sold_out' });

    await first.app.close();
    first.db.close();

    /*
     * Same day, same database, new *process*.
     *
     * `vi.resetModules()` is what makes that claim honest. Two `buildApp` calls in one test process
     * share module-level state, so a counter kept in a `Map` would survive a plain second boot and
     * the test would pass against the very bug it exists to catch: it did, until this line. A fresh
     * module registry is the closest thing in-process to the restart that actually loses it.
     */
    vi.resetModules();
    const { placeVendorBid: afterRestart } = await import('./auction.js');

    const second = await boot();
    try {
      const after = afterRestart(second.app.repos, {
        base: second.app.repos.bases.findById(base.id)!,
        userId,
        lineId: line.id,
        amount: line.price,
        now: during(1),
      });
      expect(after, 'a restart put the sold-out line back on the barrow').toMatchObject({
        kind: 'refused',
        reason: 'sold_out',
      });
    } finally {
      await second.app.close();
      second.db.close();
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

/**
 * A listing past its 48 hours does not trade, even if nobody has swept it.
 *
 * Expiry was applied only in `sweepExpiredOffers`, which runs on `GET /market`. On a board nobody
 * has loaded, that means nothing expires: a stale page could settle a listing days out of date, and
 * the seller's escrow went with it. The sweep is a tidy-up; the rule belongs where the goods move.
 */
describe('an offer that has stood too long', () => {
  it('cannot be accepted, even when nothing has swept it', async () => {
    const app = await makeApp();
    const sellerToken = await signIn(app, 'seller');
    const buyerToken = await signIn(app, 'buyer');

    const listed = await app.inject({
      method: 'POST',
      url: '/api/market/offer',
      headers: auth(sellerToken),
      payload: {
        give: { resources: { scrap: 10 }, items: {} },
        want: { resources: { caps: 10 }, items: {} },
      },
    });
    expect(listed.statusCode, listed.body.slice(0, 200)).toBe(200);
    const offerId = app.repos.market.listByStatus('open')[0]!.id;

    // Still fresh: it trades. Without this the assertion below passes against an offer that was
    // never acceptable for some entirely different reason.
    const buyer = () => {
      const id = app.repos.bases.listSummaries().find((b) => b.name.includes('buyer'))?.id;
      return app.repos.bases.findById(id!)!;
    };
    expect(acceptOffer(app.repos, buyer(), offerId, new Date()).kind).toBe('done');

    // A second listing, and this time the clock has run out on it.
    const again = await app.inject({
      method: 'POST',
      url: '/api/market/offer',
      headers: auth(sellerToken),
      payload: {
        give: { resources: { scrap: 10 }, items: {} },
        want: { resources: { caps: 10 }, items: {} },
      },
    });
    expect(again.statusCode).toBe(200);
    const stale = app.repos.market.listByStatus('open')[0]!;
    const wellPast = new Date(Date.parse(stale.createdAt) + (OFFER_LIFETIME_HOURS + 1) * 3_600_000);

    expect(acceptOffer(app.repos, buyer(), stale.id, wellPast)).toMatchObject({
      kind: 'refused',
    });
    void buyerToken;
  });
});

/**
 * §F2: the crew's Logistics, on the shelf the supply run measures against.
 *
 * The bonus reached the production clamp and nothing else, so a crew that had researched room for
 * another 55% of a warehouse was quoted the bare structures' ceiling everywhere it mattered: the
 * board said the store was full, `supplyAffordable` returned zero, and the run refused to sell a
 * single unit of something the district plainly had room for. Driven through `projectMarket` with
 * a hand-built base rather than over HTTP, because the rungs have to be on the books before the
 * board is drawn and there is no route that grants research outright.
 */
describe('the supply run and the crew that widened the store', () => {
  it('measures the shelf against the room the crew opened, not the bare structures’', async () => {
    const app = await makeApp();
    await signIn(app);
    const base = baseOf(app, 'trader');

    const rungs = RESEARCH_ITEMS.filter((item) => item.payout.bonus.kind === 'storage_capacity');
    expect(rungs.length, 'no research rung raises the store').toBeGreaterThan(0);
    // The independent half, read off the research catalogue rather than off the server's own fold:
    // these rungs really do widen a store, so `bare` below is genuinely the wrong answer.
    expect(researchEffects(rungs.map((rung) => rung.id)).storageCapacityPercent).toBeGreaterThan(0);

    const buildings = [
      { id: 'b-apothecary', kind: 'apothecary' as const, level: 12, modifications: [], damage: 0 },
    ];
    const bare = storageCapacityFor(buildings, 'scrap');

    const at = anOpenMoment();
    const kitted: Base = {
      ...base,
      buildings,
      research: { ...base.research, technologies: rungs.map((rung) => rung.id) },
      // Full to the brim of what the structures alone hold, with caps enough that money is never
      // what the refusal is about.
      resources: { ...base.resources, caps: 1_000_000, scrap: bare },
    };

    const line = projectMarket(app.repos, kitted, at).supply.lines.find(
      (entry) => entry.key === 'scrap',
    );
    // Wider than the bare structures, which is the claim, and exactly as wide as the crew's own
    // fold says, which is the arithmetic.
    expect(line?.capacity, 'the shelf must be wider than the structures alone').toBeGreaterThan(
      bare,
    );
    const bonus = crewEffectsFor(app.repos, kitted, at).storageCapacityPercent;
    expect(line?.capacity).toBe(
      storageCapacityFor(buildings, 'scrap', storageCapacity(buildings, bonus)),
    );
    expect(line?.most, 'the run must sell into the room the crew opened').toBeGreaterThan(0);

    // And the till agrees with the board: a run the panel offers is a run the server takes.
    expect(buySupply(app.repos, kitted, 'scrap', 1, at).kind).toBe('done');
  });
});
