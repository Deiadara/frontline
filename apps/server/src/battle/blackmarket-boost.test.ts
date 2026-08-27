import {
  BLACK_MARKET_GOODS,
  declarationWindow,
  skirmishOutcome,
  type BattleTarget,
  type BattlesResponse,
  type SkirmishEngine,
  type SkirmishInput,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBattles } from './resolve.js';

/**
 * The seam between the black market and the fight.
 *
 * A battle boost is bought with infamy days before anybody declares anything, sits in a stash, and
 * is worth exactly nothing until a player **applies it to a fight**. Two halves of the game were
 * built against that contract independently: the market side stashes it, the battle side is
 * supposed to spend it, and a contract with nobody standing on both sides of it is the classic
 * location for a feature to be *shipped* and *inert*. So this test stands on both sides: it puts
 * the crate in the bag, applies it through the real route, and then reads what the engine was
 * handed.
 *
 * It used to apply itself to whichever fight happened next, on both sides, and the assertions here
 * were about a bag emptying rather than about a decision. The interesting failures are different
 * now: a crate that does nothing because nobody applied it, and a crate applied twice.
 *
 * The engine is a spy rather than a stub. What matters is not who won but **what numbers the fight
 * was given**, and the only way to see those is to capture the input.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-press',
};
/** Somewhere else in the same district, for the second fight of an evening. */
const RAMP: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-ramp',
};

/** Records what the engine was asked to resolve, and hands the fight to the attacker. */
function spy(): { engine: SkirmishEngine; seen: SkirmishInput[] } {
  const seen: SkirmishInput[] = [];
  return {
    seen,
    engine: {
      resolve: (input) => {
        seen.push(input);
        return skirmishOutcome({ winner: 'attacker', log: ['decided'] });
      },
    },
  };
}

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
  seen: SkirmishInput[];
}

async function makeStack(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const { engine, seen } = spy();
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'smuggler', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  await app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(token),
    payload: { districtId: 'rustyard' },
  });
  // One location off the looters, so the Rustyard's gate is no longer armed and a location can be called.
  const control = app.repos.city.control('rustyard-bonefield');
  if (control) {
    app.repos.city.put({ ...control, holder: { kind: 'faction', baseId }, garrison: {} });
  }

  return { app, db, token, baseId, seen };
}

/** The syringes, which are the boost with the largest offense figure on the shelf. */
// Bound to plain consts after the guard: a module-level narrowing does not follow the reference
// into a closure, and `SYRINGES!` inside the helper would be an assertion rather than a check.
const SYRINGES = BLACK_MARKET_GOODS['adrenaline_syringes'];
const BOOST = SYRINGES?.boost;
if (!SYRINGES || !BOOST) throw new Error('fixture error: the syringes are not on the shelf');
const SYRINGE_ID = SYRINGES.id;

/** Puts the boost straight in the stash. Buying it needs the shelf to be offering it today. */
function stash(stack: Stack): void {
  stack.app.repos.blackMarket.writeStash(stack.baseId, { [SYRINGE_ID]: 1 });
}

/**
 * Declares a fight, sends a squad, drags the mark into the past and settles it.
 *
 * The target is a parameter because a won location changes hands, and one crew may hold only one
 * pending call on a target: a second fight has to be somewhere else, exactly as it would be in a
 * real evening's play.
 */
async function stage(
  stack: Stack,
  target: BattleTarget = PRESS,
  apply: string | null = null,
): Promise<void> {
  const declared = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(declared.statusCode).toBe(200);

  const board = await stack.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(stack.token),
  });
  // Matched on the target rather than taken off the front, because two fights can be staged at
  // once and `coming` is not ordered by when they were declared.
  const key = JSON.stringify(target);
  const view = board
    .json<BattlesResponse>()
    .coming.find((coming) => JSON.stringify(coming.battle.target) === key);
  if (!view) throw new Error('expected a declared battle');
  const battle = view.battle;

  await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId: battle.id, changes: { razors: 4 }, perimeterChanges: {} },
  });

  if (apply !== null) {
    const applied = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/boost',
      headers: auth(stack.token),
      payload: { battleId: battle.id, boostId: apply },
    });
    expect(applied.statusCode, applied.body).toBe(200);
  }
}

/**
 * Drags every pending mark into the past.
 *
 * Separate from {@link stage} because every read of `/api/battles` settles what is due first: a
 * fight backdated inside `stage` resolves during the *next* call's board read, which is why two
 * staged-and-boosted battles could not be set up one at a time.
 */
function backdate(stack: Stack): void {
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE resolved_at IS NULL')
    .run(new Date(Date.now() - 60_000).toISOString());
}

/** Stages a fight and resolves it: the ordinary case, one battle at a time. */
async function fight(
  stack: Stack,
  target: BattleTarget = PRESS,
  apply: string | null = null,
): Promise<void> {
  await stage(stack, target, apply);
  backdate(stack);
  settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());
}

describe('contraband reaches the fight', () => {
  it('hands the engine nothing extra when the bag is empty', async () => {
    const stack = await makeStack();
    await fight(stack);

    const input = stack.seen[0];
    expect(input, 'the engine must have been asked to resolve something').toBeDefined();
    // The baseline is whatever the crew's own attributes and ground are worth. What this pins is
    // that it is *not* carrying a boost nobody bought.
    expect(input?.attackerTerritory?.unitOffensePercent).toBeLessThan(BOOST.offensePercent);
  });

  /**
   * A crate in the bag and nothing done with it changes nothing.
   *
   * This is the whole point of the move, and it is the assertion that would have failed under the
   * old rule: the bag used to empty itself into whatever fight came next whether or not the player
   * wanted it spent there.
   */
  it('leaves a crate alone when nobody applied it', async () => {
    const plain = await makeStack();
    await fight(plain);
    const before = plain.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0;

    const carrying = await makeStack();
    stash(carrying);
    await fight(carrying);

    expect(carrying.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0).toBe(before);
    expect(carrying.app.repos.blackMarket.stashFor(carrying.baseId)).toEqual({ [SYRINGE_ID]: 1 });
  });

  it('adds the boost to what the attacker brings, once applied', async () => {
    const plain = await makeStack();
    await fight(plain);
    const before = plain.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0;

    const boosted = await makeStack();
    stash(boosted);
    await fight(boosted, PRESS, SYRINGE_ID);
    const after = boosted.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0;

    // Exactly the crate's figure on top of the same baseline: additive, like every other source.
    expect(after - before).toBe(BOOST.offensePercent);
    expect(
      (boosted.seen[0]?.attackerTerritory?.unitMoraleFlat ?? 0) -
        (plain.seen[0]?.attackerTerritory?.unitMoraleFlat ?? 0),
    ).toBe(BOOST.moralePercent);
  });

  /**
   * It was paid for at the shelf. Applying it must not bill the crew's name a second time.
   *
   * Read either side of the *apply*, not either side of the fight: winning pays infamy, so a
   * measurement that spanned the resolve would be reading the prize rather than the price.
   */
  it('costs no infamy to take one in', async () => {
    const stack = await makeStack();
    stash(stack);
    const before = stack.app.repos.bases.findById(stack.baseId)?.economy.infamy;
    await stage(stack, PRESS, SYRINGE_ID);
    expect(stack.app.repos.bases.findById(stack.baseId)?.economy.infamy).toBe(before);
  });

  it('spends it, so the next fight does not get it again', async () => {
    const stack = await makeStack();
    stash(stack);
    await fight(stack, PRESS, SYRINGE_ID);
    expect(stack.app.repos.blackMarket.stashFor(stack.baseId)).toEqual({});

    // And the second fight is back to the baseline, even though it names the same crate: a boost
    // bought for *a* battle that survived into the next one would make contraband permanent
    // rather than expensive.
    await fight(stack, RAMP);
    const [first, second] = stack.seen;
    expect(second?.attackerTerritory?.unitOffensePercent).toBe(
      (first?.attackerTerritory?.unitOffensePercent ?? 0) - BOOST.offensePercent,
    );
  });

  /**
   * One crate, two fights, and only the first one gets it.
   *
   * Nothing leaves the bag when a crate is applied: the deployment names it and the resolve spends
   * it, which is what lets a player change their mind for free right up to the mark. The cost of
   * that is that the same crate can legally be named on two battles, and the second one has to
   * find the bag empty rather than opening a syringe that no longer exists.
   */
  it('opens one syringe when the same one is named on two fights', async () => {
    const plain = await makeStack();
    await fight(plain);
    const before = plain.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0;

    const stack = await makeStack();
    stash(stack);
    // Both staged before either resolves, which is the only way to reach this: apply the crate to
    // a second fight *after* the first has settled and the route refuses it outright, because the
    // bag really is empty by then. Two battles called for the same mark is not an exotic state.
    await stage(stack, PRESS, SYRINGE_ID);
    await stage(stack, RAMP, SYRINGE_ID);
    backdate(stack);
    settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    const opened = stack.seen.map(
      (input) => (input.attackerTerritory?.unitOffensePercent ?? 0) - before,
    );
    expect(opened).toHaveLength(2);
    expect(opened.filter((delta) => delta === BOOST.offensePercent)).toHaveLength(1);
    expect(opened.filter((delta) => delta === 0)).toHaveLength(1);
    expect(stack.app.repos.blackMarket.stashFor(stack.baseId)).toEqual({});
  });

  /** And once it really is gone, the screen will not even let you name it. */
  it('refuses a crate the crew has already spent', async () => {
    const stack = await makeStack();
    stash(stack);
    await fight(stack, PRESS, SYRINGE_ID);
    await expect(fight(stack, RAMP, SYRINGE_ID)).rejects.toThrow();
  });

  /** A crate the crew is not carrying cannot be applied at all. */
  it('refuses a crate that is not in the bag', async () => {
    const stack = await makeStack();
    await expect(fight(stack, PRESS, SYRINGE_ID)).rejects.toThrow();
  });

  it('spends it on a loss as well', async () => {
    const stack = await makeStack();
    stash(stack);
    // The engine hands this one to the defender; the crate is still opened.
    stack.app.skirmishEngine.resolve = (input) => {
      stack.seen.push(input);
      return skirmishOutcome({ winner: 'defender', log: ['decided'] });
    };
    await fight(stack, PRESS, SYRINGE_ID);
    expect(stack.app.repos.blackMarket.stashFor(stack.baseId)).toEqual({});
  });

  /** And the crate is on the fight's own screen, which is the only place it can now be spent. */
  it('lists what the crew is carrying under the fight’s boosts', async () => {
    const stack = await makeStack();
    stash(stack);
    await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const options = board.json<BattlesResponse>().coming[0]?.boosts ?? [];
    const crate = options.find((option) => option.id === SYRINGE_ID);
    expect(crate, 'the syringes should be on the fight’s boost list').toBeDefined();
    expect(crate?.held).toBe(true);
    // Already paid for, and it lands on everyone you sent.
    expect(crate?.cost).toBe(0);
    expect(crate?.reach).toBe(100);
  });
});
