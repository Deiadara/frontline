import {
  CITY_DISTRICTS,
  callPriceOf,
  declarationWindow,
  DECLARE_INFAMY_COST,
  DECLARE_UNAFFORDABLE_MESSAGE,
  type BattleTarget,
  type BattleMutationResponse,
  type BattlesResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * §D7: a call on a player costs a name, and a crew without one does not get to make it.
 *
 * The maintainer's rule (2026-09-15): the price is charged only when the ground is held by a crew a
 * player runs. The Combine, the looters, empty ground and the seeded AI rival are all free to
 * call. The one fact that tells a player's crew from the rival's is `Base.isBot`, so the free cases
 * below are built by flipping exactly that.
 *
 * Two halves and they fail differently. A price that is quoted but never taken is a free call with
 * a warning on it; a refusal that has already charged is worse, because the crew is out the infamy
 * and has nothing coming. Both are asserted against the stored economy rather than against the
 * response, so a route that answered with the right number and wrote the wrong one is caught.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  return { token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

/** Whose ground the caller is calling on. */
type Held = 'player' | 'bot' | 'looters';

/**
 * A contested district the caller has scouted, with one location held as `held` says.
 *
 * The same second account backs both the player and the bot case: the bot is that account's base
 * with `is_bot` flipped, so the two differ in one column and nothing else.
 */
async function cityWithACaller(infamy: number, held: Held = 'player') {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  expect(config.admin, 'admin mode waives the price this file is about').toBe(false);

  const caller = await register(app, 'caller');
  const rival = await register(app, 'rival');
  if (held === 'bot') db.prepare('UPDATE bases SET is_bot = 1 WHERE id = ?').run(rival.baseId);

  const district = CITY_DISTRICTS.find(
    (entry) => entry.kind === 'contested' && entry.locations.length > 0,
  );
  const location = district?.locations[0];
  if (!district || !location) throw new Error('fixture: no contested ground to call on');
  app.repos.city.markScouted(caller.baseId, district.id, new Date().toISOString());
  app.repos.city.put({
    locationId: location.id,
    holder: held === 'looters' ? { kind: 'looters' } : { kind: 'crew', baseId: rival.baseId },
    level: 1,
    upgradingUntil: null,
    fortification: 0,
    fortifyingUntil: null,
    garrison: { razors: 4 },
  });

  const base = app.repos.bases.findById(caller.baseId);
  if (!base) throw new Error('fixture: no base');
  app.repos.bases.updateEconomy(caller.baseId, { ...base.economy, infamy });

  const target: BattleTarget = {
    kind: 'location',
    districtId: district.id,
    locationId: location.id,
  };
  const declare = () =>
    app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(caller.token),
      payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });
  const board = async () => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(caller.token),
    });
    expect(read.statusCode).toBe(200);
    return read.json<BattlesResponse>();
  };
  const stored = () => app.repos.bases.findById(caller.baseId)?.economy.infamy ?? -1;

  return { app, declare, board, stored, baseId: caller.baseId, target };
}

describe('what calling a fight on a player costs', () => {
  it('takes the price out of the caller when the call lands', async () => {
    const purse = DECLARE_INFAMY_COST + 47;
    const { app, declare, stored, baseId } = await cityWithACaller(purse);

    const called = await declare();
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    expect(stored()).toBe(47);
    // The wallet the screen is handed back, not the one that went in: a response that still quoted
    // the old number would leave the HUD a refresh behind its own crew.
    expect(called.json<BattleMutationResponse>().base.economy.infamy).toBe(47);
    expect(app.repos.sieges.pendingCountFor(baseId)).toBe(1);
  });

  it('refuses a crew one point short and takes nothing', async () => {
    const { app, declare, stored, baseId } = await cityWithACaller(DECLARE_INFAMY_COST - 1);

    const refused = await declare();
    expect(refused.statusCode, refused.body.slice(0, 200)).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe(
      DECLARE_UNAFFORDABLE_MESSAGE,
    );
    expect(stored()).toBe(DECLARE_INFAMY_COST - 1);
    expect(app.repos.sieges.pendingCountFor(baseId)).toBe(0);
  });

  it('lets a crew holding exactly the price through, and leaves them at nothing', async () => {
    const { declare, stored } = await cityWithACaller(DECLARE_INFAMY_COST);

    const called = await declare();
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    expect(stored()).toBe(0);
  });

  it('quotes the price on the board, against the ground it is for', async () => {
    const { board, target } = await cityWithACaller(0);
    const prices = (await board()).callPrices;
    expect(callPriceOf(target, prices)).toBe(DECLARE_INFAMY_COST);
  });
});

/**
 * Mixed ground: the price follows the crew behind each target, never the district around it.
 *
 * Three accounts. The caller, a rival a person plays, and the same kind of account with `is_bot`
 * flipped, so the two rivals differ in one column. They are put on the same contested district so
 * that a bot's location sits inside a player's holdings and the other way round: a rule that read
 * the district's holder, or its majority, would price both plots the same way and this catches it
 * in whichever direction it leaned. The home case goes through `residentOf`, which is the branch a
 * gate or a raid takes, by moving each rival onto a plot of their own.
 */
async function cityWithMixedGround() {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const caller = await register(app, 'caller');
  const player = await register(app, 'player');
  const bot = await register(app, 'bot');
  db.prepare('UPDATE bases SET is_bot = 1 WHERE id = ?').run(bot.baseId);

  const district = CITY_DISTRICTS.find(
    (entry) => entry.kind === 'contested' && entry.locations.length >= 3,
  );
  if (!district) throw new Error('fixture: no contested ground with three plots');
  const [first, second, third] = district.locations;
  if (!first || !second || !third) throw new Error('fixture: three plots expected');
  app.repos.city.markScouted(caller.baseId, district.id, new Date().toISOString());
  const hold = (locationId: string, baseId: string) =>
    app.repos.city.put({
      locationId,
      holder: { kind: 'crew', baseId },
      level: 1,
      upgradingUntil: null,
      fortifyingUntil: null,
      fortification: 0,
      garrison: { razors: 4 },
    });
  const board = async () => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(caller.token),
    });
    expect(read.statusCode).toBe(200);
    return read.json<BattlesResponse>().callPrices;
  };
  const at = (locationId: string): BattleTarget => ({
    kind: 'location',
    districtId: district.id,
    locationId,
  });
  /** Puts a rival on a residential plot of their own, and lets the caller see it. */
  const houses = (baseId: string, districtId: string) => {
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(districtId, baseId);
    app.repos.city.markScouted(caller.baseId, districtId, new Date().toISOString());
  };
  /** The route's bill for the same target the board quoted, from a caller with no name at all. */
  const declare = (target: BattleTarget) =>
    app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(caller.token),
      payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });

  return {
    app,
    player,
    bot,
    district,
    plots: [first.id, second.id, third.id],
    hold,
    board,
    at,
    houses,
    declare,
  };
}

describe('what calling a fight costs on mixed ground', () => {
  it("charges a player's plot inside a bot's holdings, and not the bot's plots around it", async () => {
    const { player, bot, district, plots, hold, board, at } = await cityWithMixedGround();
    const [theirs, ...botPlots] = plots;
    hold(theirs!, player.baseId);
    for (const plot of botPlots) hold(plot, bot.baseId);

    const prices = await board();
    expect(callPriceOf(at(theirs!), prices)).toBe(DECLARE_INFAMY_COST);
    for (const plot of botPlots) expect(callPriceOf(at(plot), prices), plot).toBe(0);
    // Two of three plots are the bot's, so the district has no single holder and nothing to bill.
    expect(callPriceOf({ kind: 'gate', districtId: district.id }, prices)).toBe(0);
  });

  it("frees a bot's plot inside a player's holdings, and charges the player's plots around it", async () => {
    const { player, bot, plots, hold, board, at, declare } = await cityWithMixedGround();
    const [bots, ...playerPlots] = plots;
    hold(bots!, bot.baseId);
    for (const plot of playerPlots) hold(plot, player.baseId);

    const prices = await board();
    expect(callPriceOf(at(bots!), prices)).toBe(0);
    for (const plot of playerPlots) {
      expect(callPriceOf(at(plot), prices), plot).toBe(DECLARE_INFAMY_COST);
    }

    // The bill agrees with the quote, off the same ground: the caller has nothing to their name,
    // so the bot's plot goes through and the player's plot next door is refused for the price.
    const onTheBot = await declare(at(bots!));
    expect(onTheBot.statusCode, onTheBot.body.slice(0, 200)).toBe(200);
    const onThePlayer = await declare(at(playerPlots[0]!));
    expect(onThePlayer.statusCode, onThePlayer.body.slice(0, 200)).toBe(409);
    expect(onThePlayer.json<{ error: { message: string } }>().error.message).toBe(
      DECLARE_UNAFFORDABLE_MESSAGE,
    );
  });

  /**
   * Every plot, not three: a district has one holder only when every plot in it is theirs
   * (`districtHolder`), and a gate on contested ground is a call on that one party.
   */
  it("prices a gate and a raid off the district's whole holder the same way", async () => {
    const { player, bot, district, hold, board } = await cityWithMixedGround();
    const every = district.locations.map((location) => location.id);
    expect(every.length).toBeGreaterThan(3);
    for (const plot of every) hold(plot, player.baseId);
    const gate = { kind: 'gate', districtId: district.id } as const;
    const raid = { kind: 'district', districtId: district.id } as const;
    const theirs = await board();
    expect(callPriceOf(gate, theirs)).toBe(DECLARE_INFAMY_COST);
    expect(callPriceOf(raid, theirs)).toBe(DECLARE_INFAMY_COST);

    for (const plot of every) hold(plot, bot.baseId);
    const bots = await board();
    expect(callPriceOf(gate, bots)).toBe(0);
    expect(callPriceOf(raid, bots)).toBe(0);
  });

  /**
   * A home has no plots to hold, so its holder reads `unoccupied` and the party called out is
   * whoever *lives* there (`residentOf`). The bot's home and the player's home are the same shape
   * on the control table; only the roster tells them apart.
   */
  it("charges a call on a player's home and not on a bot's", async () => {
    const { player, bot, board, houses } = await cityWithMixedGround();
    const homes = CITY_DISTRICTS.filter(
      (entry) => entry.kind === 'residential' && entry.id !== 'kettle-row',
    );
    const [playerHome, botHome] = homes;
    if (!playerHome || !botHome) throw new Error('fixture: two spare plots expected');
    houses(player.baseId, playerHome.id);
    houses(bot.baseId, botHome.id);

    const prices = await board();
    expect(callPriceOf({ kind: 'gate', districtId: playerHome.id }, prices)).toBe(
      DECLARE_INFAMY_COST,
    );
    expect(callPriceOf({ kind: 'district', districtId: playerHome.id }, prices)).toBe(
      DECLARE_INFAMY_COST,
    );
    expect(callPriceOf({ kind: 'gate', districtId: botHome.id }, prices)).toBe(0);
    expect(callPriceOf({ kind: 'district', districtId: botHome.id }, prices)).toBe(0);
  });
});

/**
 * The other half of the rule, and the control for the first: the same ground, the same caller with
 * nothing to their name, and the call goes through for nothing because nobody a person plays is
 * behind it. A crew at zero infamy is the sharpest fixture, since a price of any size refuses it.
 */
describe('what calling a fight on anybody else costs', () => {
  it.each<Held>(['bot', 'looters'])('is free against %s ground, at zero infamy', async (held) => {
    const { app, declare, board, stored, baseId, target } = await cityWithACaller(0, held);
    expect(callPriceOf(target, (await board()).callPrices)).toBe(0);

    const called = await declare();
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    expect(stored()).toBe(0);
    expect(app.repos.sieges.pendingCountFor(baseId)).toBe(1);
  });
});
