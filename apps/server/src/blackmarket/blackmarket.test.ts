import {
  BLACK_MARKET_GOODS,
  BLACK_MARKET_SLOTS,
  blackMarketBoard,
  blackMarketDay,
  findBlackMarketGood,
  type BlackMarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The back room, end to end.
 *
 * The rules live in `@frontline/shared` and are tested there. What is tested here is everything the
 * *server* has to get right on top of them: that infamy actually leaves the ledger, that what was
 * bought actually arrives, that the slot turns over for the whole city rather than for the buyer,
 * and that the daily limit survives a restart because it is counted rather than flagged.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
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
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode).toBe(201);
  return { token };
}

/** A crew cannot earn a reputation inside a unit test, so the bench hands them one. */
async function giveInfamy(app: FastifyInstance, token: string, infamy: number): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/knobs',
    headers: auth(token),
    payload: { infamy },
  });
  expect(res.statusCode).toBe(200);
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

describe('POST /api/black-market/take', () => {
  it('spends the infamy and hands over the goods', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 5_000);

    const before = await shelf(app, token);
    const target = before.offers[0]!;
    const spec = BLACK_MARKET_GOODS[target.slot.goodId]!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      payload: { slotIndex: 0, goodId: target.slot.goodId },
    });
    expect(res.statusCode).toBe(200);
    const answered = res.json<{ blackMarket: BlackMarketResponse }>().blackMarket;
    expect(answered.infamy).toBe(before.infamy - spec.infamy);

    // Read back through a *fresh* request, not out of the write's own answer. The response is
    // projected from the in-memory base the handler just built, so it reports the charge whether or
    // not the charge was ever written: dropping the `updateEconomy` call left this test green.
    const after = await shelf(app, token);
    expect(after.infamy).toBe(before.infamy - spec.infamy);
    expect(after.takenToday).toBe(1);

    if (spec.boost) {
      expect(after.stash[spec.id]).toBe(1);
    } else {
      // A delivery lands in the satchel the rest of the game already reads.
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
      const inventory = me.json<{ base: { inventory: Record<string, number> } }>().base.inventory;
      for (const [item, count] of Object.entries(spec.grants ?? {})) {
        expect(inventory[item]).toBe(count);
      }
    }
  });

  it('replaces the slot immediately, for everybody', async () => {
    const { app } = await makeApp();
    const buyer = await crew(app, 'operator_one');
    const bystander = await crew(app, 'operator_two');
    await giveInfamy(app, buyer.token, 5_000);

    const before = await shelf(app, bystander.token);
    const taken = before.offers[0]!.slot.goodId;
    await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(buyer.token),
      payload: { slotIndex: 0, goodId: taken },
    });

    const after = await shelf(app, bystander.token);
    // Still five deep: the slot refilled rather than emptying.
    expect(after.offers).toHaveLength(BLACK_MARKET_SLOTS);
    expect(after.offers[0]!.slot.goodId).not.toBe(taken);
    expect(after.offers[0]!.slot.generation).toBe(1);
    // And the other four are exactly where the bystander left them.
    expect(after.offers.slice(1).map((offer) => offer.slot.goodId)).toEqual(
      before.offers.slice(1).map((offer) => offer.slot.goodId),
    );
  });

  it('allows one a day and no more', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 100_000);

    const board = await shelf(app, token);
    const first = await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      payload: { slotIndex: 0, goodId: board.offers[0]!.slot.goodId },
    });
    expect(first.statusCode).toBe(200);

    const next = await shelf(app, token);
    const second = await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      payload: { slotIndex: 1, goodId: next.offers[1]!.slot.goodId },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('BLACK_MARKET_REFUSED');
    // The refusal must not have charged anything or moved the shelf.
    expect((await shelf(app, token)).infamy).toBe(next.infamy);
  });

  it('refuses a slot whose contents moved between the read and the click', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 5_000);
    const board = await shelf(app, token);

    const res = await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      // Naming slot 0 while asking for what is standing in slot 1.
      payload: { slotIndex: 0, goodId: board.offers[1]!.slot.goodId },
    });
    expect(res.statusCode).toBe(409);
    expect((await shelf(app, token)).infamy).toBe(board.infamy);
  });

  it('refuses a crew that cannot pay, and takes nothing', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'operator');
    const board = await shelf(app, token);
    await giveInfamy(app, token, 1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      payload: { slotIndex: 0, goodId: board.offers[0]!.slot.goodId },
    });
    expect(res.statusCode).toBe(409);
    const after = await shelf(app, token);
    expect(after.infamy).toBe(1);
    expect(after.takenToday).toBe(0);
    expect(after.offers[0]!.slot.generation).toBe(0);
  });

  it('writes a receipt that survives the request', async () => {
    const { app, db } = await makeApp();
    const { token } = await crew(app, 'operator');
    await giveInfamy(app, token, 5_000);
    const board = await shelf(app, token);
    await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      payload: { slotIndex: 0, goodId: board.offers[0]!.slot.goodId },
    });

    // The limit is counted off these rows rather than off a flag, so the receipt is load-bearing.
    const rows = db.prepare('SELECT * FROM black_market_takings').all() as {
      good_id: string;
      infamy_spent: number;
      day: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.good_id).toBe(board.offers[0]!.slot.goodId);
    expect(rows[0]?.infamy_spent).toBe(BLACK_MARKET_GOODS[board.offers[0]!.slot.goodId]!.infamy);
    expect(rows[0]?.day).toBe(board.day);

    const events = db
      .prepare("SELECT kind FROM game_events WHERE kind = 'blackmarket.taken'")
      .all();
    expect(events).toHaveLength(1);
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
 * The daily limit is the game's day, not the player's.
 *
 * `zone.ts` states the rule outright: a player may move the *display* to their timezone, and "the
 * day boundary the rules use does not move with them". The black market did the opposite: it keyed
 * both the once-a-day limit and the shelf seed to `currentUser.timezone`, which is a value the
 * player sets with a single `PATCH /settings/profile`. Take, change timezone, take again. At the
 * right hour there are three distinct day strings reachable, so the once-a-day good is a
 * three-a-day good, and the shelf reseeds each time so you can shop for the one you want.
 */
describe('the black market day is the house clock', () => {
  it('does not hand out a second take when the player changes timezone', async () => {
    const { app } = await makeApp();
    const { token } = await crew(app, 'zonehopper');
    await giveInfamy(app, token, 50_000);

    const before = await shelf(app, token);
    const first = await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      payload: { slotIndex: 0, goodId: before.offers[0]!.slot.goodId },
    });
    expect(first.statusCode, first.body.slice(0, 200)).toBe(200);

    // The whole exploit, in one request.
    const moved = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { timezone: 'Pacific/Kiritimati' },
    });
    expect(moved.statusCode, moved.body.slice(0, 200)).toBe(200);

    const after = await shelf(app, token);
    const second = await app.inject({
      method: 'POST',
      url: '/api/black-market/take',
      headers: auth(token),
      payload: { slotIndex: 0, goodId: after.offers[0]!.slot.goodId },
    });
    expect(second.statusCode, 'a timezone change bought a second take').not.toBe(200);
  });
});
