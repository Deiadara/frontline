import {
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
import { UPGRADE_SECONDS_SCALE, upgradeSeconds } from './upgrade.js';

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
const MINE = 'rustyard-bonefield';
/** Kessler Press: still the looters', so it is the one somebody can take off them. */
const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-press',
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

async function makeStack(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
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
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  // Scouting is a journey now (`scouting/scouting.ts`), so the button no longer opens
  // ground: it sends somebody who walks back hours later. A fixture wants the *state*,
  // not the trip, so the intel is written directly.
  app.repos.city.markScouted(baseId, 'rustyard', new Date().toISOString());
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
    url: '/api/city/rustyard',
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

    finishWork(stack);
    const after = await read(stack);
    expect(after.level).toBe(2);
    expect(after.upgradingUntil).toBeNull();
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
    const res = await upgrade(stack, 'rustyard-press');
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

  it('takes longer at each step, and longer on harder ground', () => {
    const kind = findLocation(MINE)!.kind;
    for (let level = 1; level < UPGRADE_SECONDS_SCALE.length; level += 1) {
      expect(upgradeSeconds(kind, level + 1)).toBeGreaterThan(upgradeSeconds(kind, level));
    }
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
    const held = stack.app.repos.city.control('rustyard-press');
    if (!held) throw new Error('no control row for the press');
    stack.app.repos.city.put({ ...held, level: MAX_LOCATION_LEVEL, garrison: { razors: 1 } });
    expect((await read(stack, 'rustyard-press')).level).toBe(MAX_LOCATION_LEVEL);

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

    const taken = stack.app.repos.city.control('rustyard-press');
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
    const held = stack.app.repos.city.control('rustyard-press');
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

    const taken = stack.app.repos.city.control('rustyard-press');
    expect(taken?.level).toBe(3);
    expect(taken?.upgradingUntil).toBeNull();
  });
});

/**
 * §D7 across two doors: `POST /battles/deploy` and `POST /city/garrison`.
 *
 * "A legend does not work for anybody the Combine has not opened a file on" is enforced by
 * `unitsBeyondNotoriety`, and `battle/deploy.ts` is the only caller in the codebase. Stationing a
 * unit on held ground is the other way to put one where it fights: `assemble` merges a location's
 * garrison into the defending force, so a Specter parked on a rooftop by a crew nobody has heard
 * of takes the field exactly as if it had been deployed, and the rank it will not work without is
 * never asked for.
 */
describe('who will stand on your ground (§D7)', () => {
  it('will not garrison a unit the crew is not notorious enough to field', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    // A legend on the roster, and a name nobody has heard of.
    stack.app.repos.bases.updateArmy(base.id, { the_specter: 1 }, base.trainingQueue);
    stack.app.repos.bases.updateEconomy(base.id, { ...base.economy, notoriety: 0 });
    expect(NOTORIETY_TO_FIELD.legendary).toBeGreaterThan(0);

    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/city/garrison',
      headers: auth(stack.token),
      payload: { locationId: MINE, changes: { the_specter: 1 } },
    });
    expect(res.statusCode).toBe(409);
    // And they are still on the roster rather than on the roof.
    expect(stack.app.repos.city.control(MINE)!.garrison.the_specter ?? 0).toBe(0);
    expect(stack.app.repos.bases.findById(stack.baseId)!.army.the_specter).toBe(1);
  });

  it('lets the same crew garrison anything its rank does cover', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateArmy(base.id, { razors: 2 }, base.trainingQueue);
    stack.app.repos.bases.updateEconomy(base.id, { ...base.economy, notoriety: 0 });

    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/city/garrison',
      headers: auth(stack.token),
      payload: { locationId: MINE, changes: { razors: 2 } },
    });
    expect(res.statusCode).toBe(200);
    expect(stack.app.repos.city.control(MINE)!.garrison.razors).toBe(2);
  });
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
      stack.app.repos.bases.updateArmy(base.id, { razors: 10 }, base.trainingQueue);
      const before = stack.app.repos.bases.findById(stack.baseId)!.army;

      const res = await stack.app.inject({
        method: 'POST',
        url: '/api/city/garrison',
        headers: auth(stack.token),
        payload: { locationId: MINE, changes: { [key]: -1 } },
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
