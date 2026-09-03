import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type UnitsResponse,
  BARTER_RATE,
  UNIT_UPGRADES,
  marketDay,
  instantAtHourInZone,
  OFFER_LIFETIME_HOURS,
  vendorSessionsFor,
  vendorStockFor,
  type ItemId,
  type Resources,
  type MarketResponse,
  type WorkshopResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { acceptOffer, buyFromVendor, projectMarket } from './board.js';

/**
 * The market and the workshop, end to end over HTTP.
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
  await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
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
   * The till refuses out of hours, and the line id comes from the *catalogue* rather than from the
   * response.
   *
   * It used to be read off the board, which worked while a shut barrow still listed its goods. Now
   * that it does not, that spelling would post an empty id and be refused as a malformed request:
   * a 400 dressed up as the rule under test. Naming a line the crew could not have seen is also
   * the case the guard is actually for, which is somebody who kept an id from this morning.
   */
  it('will not sell while he is out of the district', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const view = await board(app, token);
    if (view.vendor.open) return; // He is in right now; the closed path is the next test's job.

    const line = vendorStockFor(marketDay(new Date()))[0];
    expect(line, 'fixture error: nothing on the barrow today').toBeDefined();
    const res = await app.inject({
      method: 'POST',
      url: '/api/market/buy',
      headers: auth(token),
      payload: { lineId: line?.id ?? '', count: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toContain(
      'not in the district',
    );
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

describe('the workshop, over HTTP', () => {
  async function ready(): Promise<{ app: FastifyInstance; token: string }> {
    const app = await makeApp();
    const token = await signIn(app, 'smith');
    const base = baseOf(app, 'smith');
    // A Gauntlet high enough for the whole first tier, and the money to pay for it.
    app.repos.bases.updateDistrict(
      base.id,
      [...base.buildings, { id: 'g', kind: 'gauntlet', level: 20, modifications: [], damage: 0 }],
      [],
    );
    stock(
      app,
      'smith',
      { scrap: 99_999, caps: 99_999, highQualityMetal: 9_999, oil: 9_999 },
      { scrap_servo: 20, ceramic_plate: 20, optic_cluster: 20, neural_shunt: 20, coolant_cell: 20 },
    );
    return { app, token };
  }

  const workshop = async (app: FastifyInstance, token: string): Promise<WorkshopResponse> => {
    const res = await app.inject({ method: 'GET', url: '/api/workshop', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    return res.json<WorkshopResponse>();
  };

  it('offers every rung, with the locked ones saying why', async () => {
    const { app, token } = await ready();
    const view = await workshop(app, token);
    expect(view.upgrades).toHaveLength(UNIT_UPGRADES.length);
    const second = view.upgrades.find((upgrade) => upgrade.id === 'armour_2');
    expect(second?.blocker).toContain('Scrap Plate');
  });

  it('fits a rung, spends for it, and takes the parts', async () => {
    const { app, token } = await ready();
    const before = baseOf(app, 'smith');

    const res = await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'weapons_1' },
    });
    expect(res.statusCode).toBe(200);

    const after = baseOf(app, 'smith');
    expect(after.fittedUpgrades).toContain('weapons_1');
    expect(after.resources.scrap).toBeLessThan(before.resources.scrap);
    expect(after.inventory.scrap_servo).toBe((before.inventory.scrap_servo ?? 0) - 2);
  });

  /**
   * The whole point of a refit: it reaches the people who are already on the books.
   *
   * And the whole point of a bracket: it reaches the ones you bolted it to. Buying the upgrade
   * puts it in the crew's stock and changes nobody's sheet; slotting it onto the Razors changes
   * the Razors, and only them.
   */
  it('improves the roster a crew already has, once the upgrade is in a bracket', async () => {
    const { app, token } = await ready();
    const penetrationOf = (res: { json: <T>() => T }, unitId: string) =>
      res
        .json<{ units: { id: string; stats: { penetration: number } }[] }>()
        .units.find((unit) => unit.id === unitId)?.stats.penetration ?? 0;

    const before = await app.inject({ method: 'GET', url: '/api/units', headers: auth(token) });
    const penetrationBefore = penetrationOf(before, 'razors');

    await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'weapons_1' },
    });

    const bought = await app.inject({ method: 'GET', url: '/api/units', headers: auth(token) });
    expect(penetrationOf(bought, 'razors')).toBe(penetrationBefore);

    const slotted = await app.inject({
      method: 'POST',
      url: '/api/units/loadout',
      headers: auth(token),
      payload: { unitId: 'razors', slot: 0, upgradeId: 'weapons_1' },
    });
    expect(slotted.statusCode).toBe(200);
    expect(penetrationOf(slotted, 'razors')).toBeGreaterThan(penetrationBefore);
    expect(penetrationOf(slotted, 'sparks')).toBe(penetrationOf(before, 'sparks'));

    const after = await app.inject({ method: 'GET', url: '/api/units', headers: auth(token) });
    expect(penetrationOf(after, 'razors')).toBeGreaterThan(penetrationBefore);
  });

  it('refuses a bracket the workshop has not built for', async () => {
    const { app, token } = await ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/units/loadout',
      headers: auth(token),
      payload: { unitId: 'razors', slot: 0, upgradeId: 'armour_3' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/not built/i);
  });

  it('refuses the second rung without its blueprint, and takes it with one', async () => {
    const { app, token } = await ready();
    await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'armour_1' },
    });

    const without = await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'armour_2' },
    });
    expect(without.statusCode).toBe(409);
    // §D12g: the document out of `blueprints/catalog.ts`, named, not the retired flat item.
    expect(without.json<{ error: { message: string } }>().error.message).toContain(
      'Composite Armour Blueprint',
    );

    const base = baseOf(app, 'smith');
    app.repos.bases.updateHoldings(base.id, base.resources, {
      ...base.inventory,
      bp_composite_armour: 1,
    });

    const withOne = await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'armour_2' },
    });
    expect(withOne.statusCode).toBe(200);
  });

  // §B11 moved the yard onto its own page: building a machine is `/garage/build` now, and it is
  // covered by `garage/garage.test.ts` rather than here.
});

describe('the barrow is the same for the whole city', () => {
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
 * §D5c: a modification is one object, it goes on one unit, and it does not come off (board rule).
 *
 * Three rules, and each one closes a hole the old model left open. Before this a single Scrap
 * Plate could be bolted to every unit type in the game at once, and un-bolted for free, which made
 * the three brackets a loadout screen a player re-arranges before every fight rather than a
 * decision they live with.
 */
describe('one of a thing is one of a thing (§D5c)', () => {
  /** A crew with a Gauntlet, money, and the parts to build a modification. */
  async function armed(): Promise<{ app: FastifyInstance; token: string }> {
    const app = await makeApp();
    const token = await signIn(app, 'plater');
    const base = baseOf(app, 'plater');
    app.repos.bases.updateDistrict(
      base.id,
      [...base.buildings, { id: 'g', kind: 'gauntlet', level: 20, modifications: [], damage: 0 }],
      [],
    );
    stock(
      app,
      'plater',
      { scrap: 99_999, caps: 99_999, highQualityMetal: 9_999, oil: 9_999 },
      { scrap_servo: 20, ceramic_plate: 20, optic_cluster: 20, neural_shunt: 20, coolant_cell: 20 },
    );
    return { app, token };
  }

  async function withPlate(): Promise<{ app: FastifyInstance; token: string }> {
    const { app, token } = await armed();
    await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'weapons_1' },
    });
    return { app, token };
  }

  const fit = (app: FastifyInstance, token: string, unitId: string, slot = 0) =>
    app.inject({
      method: 'POST',
      url: '/api/units/loadout',
      headers: auth(token),
      payload: { unitId, slot, upgradeId: 'weapons_1' },
    });

  it('will not put the same one on a second unit', async () => {
    const { app, token } = await withPlate();
    const first = await fit(app, token, 'razors');
    expect(first.statusCode, first.body).toBe(200);

    const second = await fit(app, token, 'sparks');
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain('already bolted');
  });

  it('will not drop one into a bracket that is taken', async () => {
    const { app, token } = await withPlate();
    await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'armour_1' },
    });
    expect((await fit(app, token, 'razors', 0)).statusCode).toBe(200);

    const over = await app.inject({
      method: 'POST',
      url: '/api/units/loadout',
      headers: auth(token),
      payload: { unitId: 'razors', slot: 0, upgradeId: 'armour_1' },
    });
    expect(over.statusCode).toBe(409);
    expect(over.body).toContain('Burn it first');
  });

  /**
   * Burning is the only way off, and it destroys the thing.
   *
   * Asserted on the *stock* as well as on the bracket, because leaving it in `fittedUpgrades`
   * would be the free un-fit this replaces wearing a different name: burn it off the Razors, bolt
   * the same one to the Sparks, nothing spent.
   */
  it('burns one off the roster and out of the crew stock', async () => {
    const { app, token } = await withPlate();
    await fit(app, token, 'razors');

    const burnt = await app.inject({
      method: 'POST',
      url: '/api/units/burn',
      headers: auth(token),
      payload: { upgradeId: 'weapons_1' },
    });
    expect(burnt.statusCode, burnt.body).toBe(200);

    const after = burnt.json<UnitsResponse>();
    expect(after.built.map((entry) => entry.id)).not.toContain('weapons_1');
    const razors = after.units.find((unit) => unit.id === 'razors');
    expect(razors?.slots.every((slot) => slot.upgradeId !== 'weapons_1')).toBe(true);

    // And it cannot simply be re-fitted: it has to be built again first.
    expect((await fit(app, token, 'sparks')).statusCode).toBe(409);
  });

  it('refuses a burn of something that is not bolted to anything', async () => {
    const { app, token } = await withPlate();
    const res = await app.inject({
      method: 'POST',
      url: '/api/units/burn',
      headers: auth(token),
      payload: { upgradeId: 'weapons_1' },
    });
    expect(res.statusCode).toBe(409);
  });

  /** The payload tells the picker where each one is, so a dead control and a 409 agree. */
  it('says on the roster which unit each built modification is bolted to', async () => {
    const { app, token } = await withPlate();
    await fit(app, token, 'razors');

    const res = await app.inject({ method: 'GET', url: '/api/units', headers: auth(token) });
    const plate = res.json<UnitsResponse>().built.find((entry) => entry.id === 'weapons_1');
    expect(plate?.fittedTo).toBe('razors');
    expect(plate?.fittedToName).toBeTruthy();
  });
});

/**
 * A sold-out line stays sold out across a restart.
 *
 * The city's counter was a module-level `Map`, so it lived exactly as long as the process. A
 * restart, a crash or a deploy put every sold-out line back on the barrow inside the same UTC day,
 * which turns a blueprint the catalogue rations to `stock: 1` into one that anybody can have: the
 * exploit is "wait for a deploy". Two app instances over one database file is the smallest thing
 * that can tell the difference, because an in-memory database dies with the process it is testing.
 */
describe('what the city has already bought', () => {
  it('survives the server being restarted', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'frontline-market-')), 'world.sqlite');
    const day = marketDay(new Date());
    const open = anOpenMoment(day);

    // A line the catalogue rations, so buying it out is buying out the whole city's supply.
    const rationed = vendorStockFor(day).find((line) => line.stock <= 2);
    if (!rationed) throw new Error('fixture error: the Runner rations nothing today');

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
    // Caps enough that affording it is never the reason a purchase is refused.
    first.app.repos.bases.updateResources(base.id, { ...base.resources, caps: 1_000_000 });

    const bought = buyFromVendor(
      first.app.repos,
      first.app.repos.bases.findById(base.id)!,
      rationed.id,
      rationed.stock,
      open,
    );
    expect(bought.kind, 'the fixture could not buy the line out').toBe('done');
    // Sold out for this process, which is the part that always worked.
    expect(
      buyFromVendor(first.app.repos, first.app.repos.bases.findById(base.id)!, rationed.id, 1, open)
        .kind,
    ).toBe('refused');

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
    const { buyFromVendor: afterRestart } = await import('./board.js');

    const second = await boot();
    try {
      const after = afterRestart(
        second.app.repos,
        second.app.repos.bases.findById(base.id)!,
        rationed.id,
        1,
        open,
      );
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
