import {
  BARTER_RATE,
  ITEM_CATALOG,
  UNIT_UPGRADES,
  marketDay,
  vendorSessionsFor,
  vendorStockFor,
  type ItemId,
  type Resources,
  type MarketResponse,
  type WorkshopResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The market and the workshop, end to end over HTTP.
 *
 * The rules themselves are pinned in `packages/shared`; what these are for is the part that only
 * exists on the server: that goods actually move, that they move *once*, and that escrow comes
 * home. A trade is the one place in this game where a bug takes something off a player that they
 * cannot get back, so every assertion below is about a stockpile before and after.
 *
 * The Runner's hours are derived from the UTC date, so no test can simply decide he is in: the
 * closed-shop assertion checks the board first and returns early if he happens to be open, because
 * a test that pretended to control the clock would be testing a mock of the thing under test.
 */

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
  it('says when he is in and what he is carrying', async () => {
    const app = await makeApp();
    const view = await board(app, await signIn(app));

    expect(view.vendor.sessions).toHaveLength(2);
    expect(view.vendor.stock.length).toBeGreaterThan(0);
    // The hours the server reports are the ones the shared derivation produces for today.
    expect(view.vendor.sessions).toEqual(vendorSessionsFor(marketDay(new Date())));
    expect(new Date(view.vendor.opensAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('will not sell while he is out of the district', async () => {
    const app = await makeApp();
    const token = await signIn(app);
    const view = await board(app, token);
    if (view.vendor.open) return; // He is in right now; the closed path is the next test's job.

    const line = view.vendor.stock[0];
    const res = await app.inject({
      method: 'POST',
      url: '/api/market/buy',
      headers: auth(token),
      payload: { lineId: line?.line.id ?? '', count: 1 },
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
      [
        ...base.buildings,
        { id: 'g', kind: 'gauntlet', level: 20, modifications: [], damage: 0, fortification: 0 },
      ],
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
    expect(without.json<{ error: { message: string } }>().error.message).toContain(
      ITEM_CATALOG.blueprint_composite_armour.name,
    );

    const base = baseOf(app, 'smith');
    app.repos.bases.updateHoldings(base.id, base.resources, {
      ...base.inventory,
      blueprint_composite_armour: 1,
    });

    const withOne = await app.inject({
      method: 'POST',
      url: '/api/workshop/fit',
      headers: auth(token),
      payload: { upgradeId: 'armour_2' },
    });
    expect(withOne.statusCode).toBe(200);
  });

  it('builds a machine and shortens the road with it', async () => {
    const { app, token } = await ready();
    const base = baseOf(app, 'smith');
    app.repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings,
        { id: 'gar', kind: 'garage', level: 6, modifications: [], damage: 0, fortification: 0 },
      ],
      [],
    );
    app.repos.bases.updateHoldings(base.id, base.resources, {
      ...base.inventory,
      gyro_assembly: 4,
    });

    const before = await workshop(app, token);
    expect(before.fleetTravelSpeedPercent).toBe(0);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workshop/vehicle',
      headers: auth(token),
      payload: { vehicleId: 'motorcycle' },
    });
    expect(res.statusCode).toBe(200);

    const after = await workshop(app, token);
    expect(after.fleetTravelSpeedPercent).toBeGreaterThan(0);
    expect(baseOf(app, 'smith').fleet.motorcycle).toBe(1);
  });
});

describe('the barrow is the same for the whole city', () => {
  it('serves two crews the same stock on the same day', async () => {
    const app = await makeApp();
    const one = await signIn(app, 'one');
    const two = await signIn(app, 'two');
    const first = await board(app, one);
    const second = await board(app, two);
    expect(first.vendor.stock.map((offer) => offer.line.item)).toEqual(
      second.vendor.stock.map((offer) => offer.line.item),
    );
    expect(first.vendor.stock.map((offer) => offer.line.item)).toEqual(
      vendorStockFor(marketDay(new Date())).map((line) => line.item),
    );
  });
});
