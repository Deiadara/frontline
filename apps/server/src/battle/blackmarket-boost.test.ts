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
 * is worth exactly nothing until a battle resolves. Two halves of the game were built against that
 * contract independently: the market side stashes it, the battle side is supposed to spend it,
 * and a contract with nobody standing on both sides of it is the classic location for a feature to be
 * *shipped* and *inert*. So this test stands on both sides: it buys the thing through the real
 * route and then reads what the engine was handed.
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
async function fight(stack: Stack, target: BattleTarget = PRESS): Promise<void> {
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
  const view = board.json<BattlesResponse>().coming[0];
  if (!view) throw new Error('expected a declared battle');
  const battle = view.battle;

  await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId: battle.id, changes: { razors: 4 }, perimeterChanges: {} },
  });

  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), battle.id);

  settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());
}

describe('contraband reaches the fight', () => {
  it('hands the engine nothing extra when the stash is empty', async () => {
    const stack = await makeStack();
    await fight(stack);

    const input = stack.seen[0];
    expect(input, 'the engine must have been asked to resolve something').toBeDefined();
    // The baseline is whatever the crew's own attributes and ground are worth. What this pins is
    // that it is *not* carrying a boost nobody bought.
    expect(input?.attackerTerritory?.unitOffensePercent).toBeLessThan(BOOST.offensePercent);
  });

  it('adds the boost to what the attacker brings', async () => {
    const plain = await makeStack();
    await fight(plain);
    const before = plain.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0;

    const boosted = await makeStack();
    stash(boosted);
    await fight(boosted);
    const after = boosted.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0;

    // Exactly the crate's figure on top of the same baseline: additive, like every other source.
    expect(after - before).toBe(BOOST.offensePercent);
    expect(
      (boosted.seen[0]?.attackerTerritory?.unitMoraleFlat ?? 0) -
        (plain.seen[0]?.attackerTerritory?.unitMoraleFlat ?? 0),
    ).toBe(BOOST.moralePercent);
  });

  it('spends it, so the next fight does not get it again', async () => {
    const stack = await makeStack();
    stash(stack);
    await fight(stack);
    expect(stack.app.repos.blackMarket.stashFor(stack.baseId)).toEqual({});

    // And the second fight is back to the baseline. A boost bought for *a* battle that survived
    // into the next one would make contraband permanent rather than expensive.
    await fight(stack, RAMP);
    const [first, second] = stack.seen;
    expect(second?.attackerTerritory?.unitOffensePercent).toBe(
      (first?.attackerTerritory?.unitOffensePercent ?? 0) - BOOST.offensePercent,
    );
  });

  /**
   * The board's rule: the same boost counts **once**, however many are in the bag.
   *
   * Two of a thing stacking is the shape that ends one way: the correct play becomes hoarding a
   * fortnight of infamy into six syringes and deleting somebody with a number no defence was
   * balanced against. The second crate is not wasted, though: it is the next fight's.
   */
  it('counts a duplicate once, and keeps it for the next fight', async () => {
    const plain = await makeStack();
    await fight(plain);
    const before = plain.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0;

    const hoarder = await makeStack();
    hoarder.app.repos.blackMarket.writeStash(hoarder.baseId, { [SYRINGE_ID]: 2 });
    await fight(hoarder);

    // One syringe's worth, not two.
    expect((hoarder.seen[0]?.attackerTerritory?.unitOffensePercent ?? 0) - before).toBe(
      BOOST.offensePercent,
    );
    // ...and the other one is still in the bag rather than billed for and thrown away.
    expect(hoarder.app.repos.blackMarket.stashFor(hoarder.baseId)).toEqual({ [SYRINGE_ID]: 1 });

    // Which the next fight then gets, at the same one-crate figure.
    await fight(hoarder, RAMP);
    expect((hoarder.seen[1]?.attackerTerritory?.unitOffensePercent ?? 0) - before).toBe(
      BOOST.offensePercent,
    );
    expect(hoarder.app.repos.blackMarket.stashFor(hoarder.baseId)).toEqual({});
  });

  it('spends it on a loss as well', async () => {
    const stack = await makeStack();
    stash(stack);
    // The engine hands this one to the defender; the crate is still opened.
    stack.app.skirmishEngine.resolve = (input) => {
      stack.seen.push(input);
      return skirmishOutcome({ winner: 'defender', log: ['decided'] });
    };
    await fight(stack);
    expect(stack.app.repos.blackMarket.stashFor(stack.baseId)).toEqual({});
  });
});
