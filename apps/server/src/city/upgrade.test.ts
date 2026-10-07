import {
  makeAttributes,
  createCommander,
  cancelRefund,
  DECLARE_INFAMY_COST,
  MAX_LOCATION_LEVEL,
  bonusesAt,
  declarationWindow,
  findLocation,
  skirmishOutcome,
  upgradeCost,
  type BattleTarget,
  type BattlesResponse,
  type DistrictDetailResponse,
  type LocationView,
  type SkirmishEngine,
  NOTORIETY_TO_FIELD,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBattles } from '../battle/resolve.js';
import { settleMoves } from '../moves/moves.js';
import { UPGRADE_SECONDS_SCALE, cancelUpgrade, startUpgrade, upgradeSeconds } from './upgrade.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * §A4: a location is a post you take, work up, and lose.
 *
 * The whole board-game loop in one file, and the last assertions are the ones the design turns on:
 * **a capture keeps the level, and kills the upgrade that was under way.** You take the ground as
 * it stands, so a well-developed location is a prize rather than a wall that has to be rebuilt
 * from nothing, and the level somebody poured in is the level you get.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** The Bonefield: handed to the crew in `makeStack`, so it is the one they can work on. */
const MINE = 'steelbelt-bonefield';
/** Kessler Press: still the looters', so it is the one somebody can take off them. */
const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'steelbelt',
  locationId: 'steelbelt-press',
};

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

const engine: SkirmishEngine = {
  resolve: () => skirmishOutcome({ winner: 'attacker', log: ['x'] }),
};

async function makeStack(admin = false): Promise<Stack> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: admin ? 'true' : 'false',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'landlord', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  // §D7: calling a fight costs infamy and nobody starts with any. Fixture money, enough for every
  // call this file makes.
  const purse = app.repos.bases.findById(baseId)!.economy;
  app.repos.bases.updateEconomy(baseId, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });

  const control = app.repos.city.control(MINE);
  if (control) app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });

  // Enough to cover the whole ladder on anything on this ground, so no test here is about money.
  // The nine steps come to about 110x a kind's base price (`UPGRADE_COST_SCALE`), and the
  // Bonefield is one of the dearest in the catalogue.
  app.repos.bases.updateResources(baseId, {
    caps: 400_000,
    supplies: 400_000,
    oil: 400_000,
    scrap: 400_000,
    highQualityMetal: 40_000,
    planks: 400_000,
  });

  return { app, db, token, baseId };
}

const read = async (stack: Stack, locationId = MINE): Promise<LocationView> => {
  const res = await stack.app.inject({
    method: 'GET',
    url: '/api/city/steelbelt',
    headers: auth(stack.token),
  });
  expect(res.statusCode, res.body).toBe(200);
  // `GET /city/:id` answers with the district detail itself, not wrapped.
  const view = res
    .json<DistrictDetailResponse>()
    .locations.find((candidate) => candidate.location.id === locationId);
  if (!view) throw new Error(`no view for ${locationId}`);
  return view;
};

const upgrade = (stack: Stack, locationId = MINE) =>
  stack.app.inject({
    method: 'POST',
    url: '/api/city/upgrade',
    headers: auth(stack.token),
    payload: { locationId },
  });

/** Drags a location's upgrade clock into the past, the way the battle tests drag a mark. */
function finishWork(stack: Stack, locationId = MINE): void {
  const control = stack.app.repos.city.control(locationId);
  if (!control?.upgradingUntil) throw new Error('nothing is being worked on');
  stack.app.repos.city.put({
    ...control,
    upgradingUntil: new Date(Date.now() - 1000).toISOString(),
  });
}

describe('working a location up (§A4)', () => {
  it('starts every location at level 1 and offers the first upgrade', async () => {
    const stack = await makeStack();
    const view = await read(stack);
    expect(view.level).toBe(1);
    expect(view.upgrade?.toLevel).toBe(2);
    expect(view.upgrade?.note.length ?? 0).toBeGreaterThan(20);
    expect(view.upgrade?.cost).toEqual(upgradeCost(view.location.kind, 1));
  });

  it('charges for it, puts a clock on it, and banks it on the next read', async () => {
    const stack = await makeStack();
    const before = stack.app.repos.bases.findById(stack.baseId)?.resources.caps ?? 0;
    const cost = upgradeCost(findLocation(MINE)!.kind, 1)?.caps ?? 0;

    const res = await upgrade(stack);
    expect(res.statusCode, res.body).toBe(200);
    expect(stack.app.repos.bases.findById(stack.baseId)?.resources.caps).toBe(before - cost);

    // Still level 1 while the work is under way: the clock is the whole point.
    const during = await read(stack);
    expect(during.level).toBe(1);
    expect(during.upgradingUntil).not.toBeNull();

    const tally = (key: string) => stack.app.repos.feats.tallies(stack.baseId)[key] ?? 0;
    expect(tally('location_levels_raised'), 'counted before the work landed').toBe(0);

    finishWork(stack);
    const after = await read(stack);
    expect(after.level).toBe(2);
    expect(after.upgradingUntil).toBeNull();
    // P8-C: the workings ladder counts the level when it lands, for whoever holds the ground.
    expect(tally('location_levels_raised')).toBe(1);
  });

  it('pays more at the new level, and says so on the card', async () => {
    const stack = await makeStack();
    const before = await read(stack);
    await upgrade(stack);
    finishWork(stack);
    const after = await read(stack);

    expect(after.bonuses).not.toEqual(before.bonuses);
    // Not just *different*: the same bonuses, described at the new level, one line each.
    expect(after.bonuses).toHaveLength(bonusesAt(after.location.kind, 2).length);
    for (const line of after.bonuses) expect(line.length).toBeGreaterThan(2);
  });

  it('takes nine upgrades to the ceiling and then stops offering', async () => {
    const stack = await makeStack();
    for (let level = 1; level < MAX_LOCATION_LEVEL; level += 1) {
      expect((await upgrade(stack)).statusCode).toBe(200);
      finishWork(stack);
      expect((await read(stack)).level).toBe(level + 1);
    }
    const topped = await read(stack);
    expect(topped.level).toBe(MAX_LOCATION_LEVEL);
    expect(topped.upgrade).toBeNull();
    expect((await upgrade(stack)).statusCode).toBe(409);
  });

  it('refuses a second job while one is under way', async () => {
    const stack = await makeStack();
    expect((await upgrade(stack)).statusCode).toBe(200);
    const second = await upgrade(stack);
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { message: string } }>().error.message).toMatch(/under way/i);
  });

  it('refuses ground somebody else is holding', async () => {
    const stack = await makeStack();
    const res = await upgrade(stack, 'steelbelt-press');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/do not hold/i);
  });

  it('refuses a crew that cannot cover it, and charges them nothing', async () => {
    const stack = await makeStack();
    stack.app.repos.bases.updateResources(stack.baseId, {
      caps: 0,
      supplies: 0,
      oil: 0,
      scrap: 0,
      highQualityMetal: 0,
      planks: 0,
    });
    const res = await upgrade(stack);
    expect(res.statusCode).toBe(409);
    expect(stack.app.repos.city.control(MINE)?.upgradingUntil).toBeNull();
  });

  /*
   * Bug pass, 2026-09-29: the testing build waived every bill but this one, and the cancel handed
   * back ninety percent of a price that had never been taken.
   */
  it('in admin mode, takes nothing for the work and hands nothing back', async () => {
    const stack = await makeStack(true);
    const broke = { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 };
    stack.app.repos.bases.updateResources(stack.baseId, broke);
    const res = await upgrade(stack);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(stack.app.repos.city.control(MINE)?.upgradingUntil).not.toBeNull();
    expect(stack.app.repos.bases.findById(stack.baseId)!.resources).toEqual(broke);

    const cancelled = await stack.app.inject({
      method: 'POST',
      url: '/api/city/cancel-upgrade',
      headers: auth(stack.token),
      payload: { locationId: MINE, acceptWaste: true },
    });
    expect(cancelled.statusCode, cancelled.body.slice(0, 200)).toBe(200);
    expect(stack.app.repos.bases.findById(stack.baseId)!.resources).toEqual(broke);
  });

  it('takes longer at each step, and longer on harder ground', () => {
    const kind = findLocation(MINE)!.kind;
    for (let level = 1; level < UPGRADE_SECONDS_SCALE.length; level += 1) {
      expect(upgradeSeconds(kind, level + 1)).toBeGreaterThan(upgradeSeconds(kind, level));
    }
    // One step per upgrade on the five-level ladder, each the old nine-step clock's every second
    // entry (maintainer, 2026-10-06): the climb to 5 takes what the climb to 10 took.
    expect(UPGRADE_SECONDS_SCALE).toHaveLength(MAX_LOCATION_LEVEL - 1);
    expect(UPGRADE_SECONDS_SCALE).toEqual([3, 5.9, 9.2, 11.5]);
    // The Bonefield is a war machine graveyard (defence 6); the Ramp is a skate ground (1).
    expect(upgradeSeconds('war_machine_graveyard', 1)).toBeGreaterThan(
      upgradeSeconds('skate_ground', 1),
    );
  });
});

describe('what a capture does to the work', () => {
  /**
   * The rule the whole level system stands on, and it is the opposite of what it used to be.
   *
   * The looters are holding Kessler Press at the ceiling; the crew takes it; it is theirs **at the
   * ceiling**. Asserted from a fully-worked location rather than a fresh one, because the failure
   * mode is "the capture wrote a 1 over it" and a location already at 1 cannot tell the difference.
   */
  it('leaves a captured location at the level it had been worked to', async () => {
    const stack = await makeStack();

    // Somebody else's fully-developed location.
    const held = stack.app.repos.city.control('steelbelt-press');
    if (!held) throw new Error('no control row for the press');
    stack.app.repos.city.put({ ...held, level: MAX_LOCATION_LEVEL, garrison: { razors: 1 } });
    expect((await read(stack, 'steelbelt-press')).level).toBe(MAX_LOCATION_LEVEL);

    const declared = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body).toBe(200);

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('expected a declared battle');
    await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: { battleId: view.battle.id, changes: { razors: 4 }, perimeterChanges: {} },
    });
    stack.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), view.battle.id);
    settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    const taken = stack.app.repos.city.control('steelbelt-press');
    expect(taken?.holder).toEqual({ kind: 'crew', baseId: stack.baseId });
    expect(taken?.level, 'a capture keeps the work').toBe(MAX_LOCATION_LEVEL);
    expect(taken?.upgradingUntil).toBeNull();
  });

  /**
   * And a capture still kills work *in progress*, rather than handing it over half done.
   *
   * The contrast with the test above is the rule: banked levels change hands, an upgrade charged
   * for and not yet finished does not. The press is at 3 with a fourth under way, and what the
   * attacker gets is a 3.
   */
  it('cancels an upgrade that was under way when the ground changed hands', async () => {
    const stack = await makeStack();
    const held = stack.app.repos.city.control('steelbelt-press');
    if (!held) throw new Error('no control row for the press');
    stack.app.repos.city.put({
      ...held,
      level: 3,
      upgradingUntil: new Date(Date.now() + 3_600_000).toISOString(),
      garrison: { razors: 1 },
    });

    const declared = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body).toBe(200);
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('expected a declared battle');
    await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: { battleId: view.battle.id, changes: { razors: 4 }, perimeterChanges: {} },
    });
    stack.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), view.battle.id);
    settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    const taken = stack.app.repos.city.control('steelbelt-press');
    expect(taken?.level).toBe(3);
    expect(taken?.upgradingUntil).toBeNull();
  });
});

/**
 * §D7 sits on the muster now (maintainer, 2026-10-07), not on `POST /actions/move`.
 *
 * It used to stand on this door and the deployment's, which let a crew muster a legend it was
 * then refused the right to put anywhere. A unit on the roster goes where the crew goes, so a
 * name nobody has heard of stations a Specter like it stations a Razor. Pinned on the legend,
 * which is the sheet the old door refused, so the gate cannot quietly come back here.
 */
describe('who will stand on your ground (§D7)', () => {
  it('garrisons a legend for a crew nobody has heard of', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateArmy(base.id, { the_specter: 1 }, base.musterQueue);
    stack.app.repos.bases.updateEconomy(base.id, { ...base.economy, notoriety: 0 });
    expect(NOTORIETY_TO_FIELD.legendary).toBeGreaterThan(0);

    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/actions/move',
      headers: auth(stack.token),
      payload: onto({ the_specter: 1 }),
    });
    expect(res.statusCode, res.body).toBe(200);
    stack.db
      .prepare('UPDATE unit_moves SET returns_at = ?')
      .run(new Date(Date.now() - 1_000).toISOString());
    settleMoves(stack.app.repos, new Date());
    expect(stack.app.repos.city.control(MINE)!.garrison.the_specter).toBe(1);
  });

  it('garrisons anything else the same way', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateArmy(base.id, { razors: 2 }, base.musterQueue);
    stack.app.repos.bases.updateEconomy(base.id, { ...base.economy, notoriety: 0 });

    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/actions/move',
      headers: auth(stack.token),
      payload: onto({ razors: 2 }),
    });
    expect(res.statusCode).toBe(200);
    // On the road, and standing there once they arrive.
    stack.db
      .prepare('UPDATE unit_moves SET returns_at = ?')
      .run(new Date(Date.now() - 1_000).toISOString());
    settleMoves(stack.app.repos, new Date());
    expect(stack.app.repos.city.control(MINE)!.garrison.razors).toBe(2);
  });
});

/** A walk from home onto the crew's own plot: how units are stood on ground since 2026-09-28. */
const onto = (army: Record<string, number>) => ({
  from: { kind: 'district' },
  to: { kind: 'location', locationId: MINE },
  army,
  vehicles: {},
});

/**
 * A garrison order names units, and only units.
 *
 * The twin of the deployment bug, at the door the fix for that one did not reach.
 * `battle/deploy.ts` carries a comment describing exactly this being closed there; this route was
 * missed, and it is the same shape: both guards above read only the *positive* deltas, so a
 * withdrawal naming `constructor` or `toString` never meets them. `garrison['constructor']` on a
 * plain object is a function rather than `undefined`, `Math.min(-delta, fn)` is `NaN`, and the
 * `back === 0` guard does not catch `NaN`, so the roster took a `NaN` count and the garrison
 * column took a stringified function.
 *
 * That is a lesson about fixes rather than about prototypes: a bug with two call sites needs a
 * test at each, or the untested one keeps the bug and the passing suite says otherwise.
 */
describe('a garrison order names units, and only units', () => {
  for (const key of ['constructor', 'toString', '__proto__']) {
    it(`refuses a withdrawal of "${key}"`, async () => {
      const stack = await makeStack();
      const base = stack.app.repos.bases.findById(stack.baseId)!;
      stack.app.repos.bases.updateArmy(base.id, { razors: 10 }, base.musterQueue);
      const before = stack.app.repos.bases.findById(stack.baseId)!.army;

      // The move door now, from the plot home: the withdrawal this case was written about.
      const res = await stack.app.inject({
        method: 'POST',
        url: '/api/actions/move',
        headers: auth(stack.token),
        payload: {
          from: { kind: 'location', locationId: MINE },
          to: { kind: 'district' },
          army: { [key]: 1 },
          vehicles: {},
        },
      });
      expect(res.statusCode, `${key} was accepted as a unit`).toBe(400);

      // And nothing was written: no NaN, no new key, nothing lost off the roster.
      const after = stack.app.repos.bases.findById(stack.baseId)!.army;
      expect(after).toEqual(before);
      for (const [unit, count] of Object.entries(after)) {
        expect(Number.isFinite(count), `${unit} is not a finite count`).toBe(true);
      }
      for (const [unit, count] of Object.entries(stack.app.repos.city.control(MINE)!.garrison)) {
        expect(Number.isFinite(count), `garrison ${unit} is not a finite count`).toBe(true);
      }
    });
  }
});

/**
 * Any ground you hold, anywhere in the city (maintainer, 2026-09-22).
 *
 * The maintainer asked for every captured location to be workable and for the level to be on show.
 * Both were already true, and neither was written down anywhere a change could trip over: nothing
 * in this file said that the ground it works up is in a district the crew does not live in, and
 * nothing said that a level is legible on ground held by somebody else.
 *
 * The rule the server actually enforces is holder-based and has no geography in it at all
 * (`startUpgrade` asks whether the control row names your crew). These two pin that, so a
 * district-scoped guard added later fails here rather than quietly halving the map.
 */
describe('working up ground anywhere in the city', () => {
  /** Every location in the game sits in a contested district; a crew lives in a residential one. */
  it('works up a location in a district the crew does not live in', async () => {
    const stack = await makeStack();
    const home = stack.app.repos.bases.findById(stack.baseId)?.districtId;
    expect(home, 'the fixture crew should not live on the ground it is working').not.toBe(
      'steelbelt',
    );

    // A second contested district, so the pass is not an accident of the one this file uses.
    const FAR = 'chrome-row-anvil';
    const far = stack.app.repos.city.control(FAR);
    if (!far) throw new Error(`fixture: no control row for ${FAR}`);
    expect(far.holder.kind, 'fixture: the far location should start in other hands').not.toBe(
      'crew',
    );
    stack.app.repos.city.put({ ...far, holder: { kind: 'crew', baseId: stack.baseId } });

    const started = await upgrade(stack, FAR);
    expect(started.statusCode, started.body.slice(0, 200)).toBe(200);
    finishWork(stack, FAR);
    await stack.app.inject({
      method: 'GET',
      url: '/api/city/chrome-row',
      headers: auth(stack.token),
    });
    expect(stack.app.repos.city.control(FAR)?.level).toBe(2);
  });

  it('shows the level of a location the crew does not hold', async () => {
    const stack = await makeStack();
    const press = stack.app.repos.city.control(PRESS.locationId);
    if (!press) throw new Error('fixture: no Kessler Press');
    // Somebody else's ground, worked up by them. The number is the map's, not a secret.
    stack.app.repos.city.put({ ...press, level: 4 });

    const view = await read(stack, PRESS.locationId);
    expect(view.holder.kind, 'fixture: the Press should not be ours').not.toBe('crew');
    expect(view.level).toBe(4);
    // And there is no offer on it, because it is not ours to work on.
    const refused = await upgrade(stack, PRESS.locationId);
    expect(refused.statusCode).toBe(409);
  });
});

/**
 * Calling an upgrade off hands back ninety percent of what it was charged, not of today's price
 * (bug pass, 2026-10-04). The Engineer's cut is read live: seat a perfect one to start the work,
 * bench them, cancel, and the refund was priced without the cut, about 1.8 times what was spent.
 */
describe('a cancelled upgrade refunds what it was charged', () => {
  const engineerAt = (stack: Stack, role: 'engineer' | null) =>
    stack.app.repos.bases.updateCommanders(stack.baseId, [
      createCommander('wright', 'Wright', role, makeAttributes(100)),
    ]);

  it('pays back the cut price after the Engineer who cut it has left the chair', async () => {
    const stack = await makeStack();
    engineerAt(stack, 'engineer');
    const location = findLocation(MINE)!;
    const now = new Date();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const started = startUpgrade(stack.app.repos, {
      base,
      location,
      control: stack.app.repos.city.control(MINE)!,
      now,
    });
    if (started.kind !== 'started') throw new Error(`refused: ${started.reason}`);
    const listed = upgradeCost(location.kind, 1)!;
    const paid = stack.app.repos.city.control(MINE)!.upgradePaid!;
    // The premise: the Engineer's cut was taken.
    expect(paid.caps ?? 0).toBeLessThan(listed.caps ?? 0);

    engineerAt(stack, null);
    const cancelled = cancelUpgrade(stack.app.repos, {
      base: stack.app.repos.bases.findById(stack.baseId)!,
      location,
      control: stack.app.repos.city.control(MINE)!,
      now: new Date(now.getTime() + 1000),
      // The fixture is rich past its stores; what is under test is the refund, not the room.
      acceptWaste: true,
    });
    if (cancelled.kind !== 'cancelled') throw new Error(`refused: ${cancelled.reason}`);
    expect(cancelled.refund).toEqual(cancelRefund(paid));
    // Never more than was spent, line by line.
    for (const [key, amount] of Object.entries(cancelled.refund)) {
      expect(amount, key).toBeLessThanOrEqual(paid[key as keyof typeof paid] ?? 0);
    }
    expect(stack.app.repos.city.control(MINE)!.upgradePaid ?? null).toBeNull();
  });
});
