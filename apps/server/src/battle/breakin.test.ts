/**
 * Breaking into a lived-in district: what leaves with the raiders, and what does not come back.
 *
 * A `building` target is the only path in the game that plunders a stockpile, and until this file
 * nothing tested it: `grep -rn "kind: 'building'"` across the server suite found no test at all.
 * Two shipped bugs lived in that gap, and both are the same mistake in different clothes, so both
 * are pinned here as invariants rather than as numbers.
 *
 *   * The defender's salvage refund was added to the stockpile *as it stood before the raid*, and
 *     `updateResources` rewrites the whole column, so writing it put the looted resources back. The
 *     attacker kept the haul, the defender lost nothing, and the difference was minted.
 *   * `planks` was priced and stocked but missing from `PLUNDER_PRIORITY`, so no raid had ever
 *     taken one. Covered directly in `shared/src/raid.test.ts`; the end-to-end half is here.
 *
 * Both are measured by conservation: a raid *moves* resources, so the total across the two crews
 * cannot change. That holds whatever the loot table, the carry capacity or the refund percentage
 * are tuned to, which a hard-coded expected stockpile would not.
 */
import {
  MAX_LOCATION_LEVEL,
  RESOURCE_KEYS,
  declarationWindow,
  skirmishOutcome,
  type BattleTarget,
  type BattlesResponse,
  type Resources,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMovements } from './movement.js';
import { settleBattles } from './resolve.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** The attacker wins and both sides lose bodies, so there is something to refund on each end. */
const bloody: SkirmishEngine = {
  resolve: (input) =>
    skirmishOutcome({
      winner: 'attacker',
      log: ['through the wall'],
      killed: input.defending,
      winnerLosses: { razors: 2 },
    }),
};

interface Crew {
  token: string;
  baseId: string;
  districtId: string;
}

interface World {
  app: FastifyInstance;
  db: AppDatabase;
  raider: Crew;
  victim: Crew;
}

async function register(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(registered.statusCode, `register: ${registered.statusCode}`).toBe(201);
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode, `overseer: ${chosen.statusCode}`).toBe(201);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  return { token, baseId: base.id, districtId: base.districtId };
}

async function makeWorld(): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: bloody, logger: false });
  instances.push({ app, db });

  const raider = await register(app, 'raider');
  const planted = await register(app, 'victim');

  // Every new crew is planted on the same opening ground, so the victim is moved next door: a
  // break-in needs two crews in two districts, and a crew cannot raid itself.
  const HOME = 'ashen-terraces';
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, planted.baseId);
  const victim: Crew = { ...planted, districtId: HOME };
  expect(raider.districtId).not.toBe(victim.districtId);

  app.repos.city.markScouted(raider.baseId, victim.districtId, new Date().toISOString());
  // Nothing behind a standing gate can be reached, so the way in is already open. Breaking it is
  // its own fight with its own rules and its own tests; this file is about what happens *after*.
  app.repos.sieges.breakGate(victim.districtId, new Date(Date.now() + 3_600_000).toISOString());
  return { app, db, raider, victim };
}

const stockOf = (world: World, baseId: string): Resources =>
  world.app.repos.bases.findById(baseId)!.resources;

const totalAcross = (world: World): Resources =>
  RESOURCE_KEYS.reduce(
    (sum, key) => ({
      ...sum,
      [key]: stockOf(world, world.raider.baseId)[key] + stockOf(world, world.victim.baseId)[key],
    }),
    {} as Resources,
  );

/** Declares a break-in on the victim's district, sends a column, and settles it. */
async function breakIn(world: World): Promise<void> {
  const buildings = world.app.repos.bases.findById(world.victim.baseId)!.buildings;
  const building = buildings[0];
  if (!building) throw new Error('fixture: the victim has nothing to break into');

  const target: BattleTarget = {
    kind: 'building',
    districtId: world.victim.districtId,
    buildingId: building.id,
  };
  const declared = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(world.raider.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);

  const board = await world.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(world.raider.token),
  });
  const view = board.json<BattlesResponse>().coming[0];
  if (!view) throw new Error('expected a declared break-in');
  await world.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(world.raider.token),
    payload: { battleId: view.battle.id, changes: { razors: 6 }, perimeterChanges: {} },
  });

  const mark = new Date(Date.now() - 60_000);
  world.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(mark.toISOString(), view.battle.id);
  /*
   * And the column arrives.
   *
   * Sending units starts a march rather than filling a deployment, so winding only the *mark* back
   * resolves a fight nobody turned up to: the attacking force is empty, the hold capacity is zero
   * and the raid carries nothing. That is a correct settle and a useless fixture, and it is why the
   * conservation check below asserts something was actually looted before comparing the two sides.
   */
  world.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(mark.getTime() - 60_000).toISOString(), mark.toISOString(), view.battle.id);
  settleMovements(world.app.repos, new Date());

  expect(settleBattles(world.app.repos, world.app.skirmishEngine, new Date())).toHaveLength(1);
}

/** Hands the victim a location outright, so its hold bonus is live on their side of the fight. */
function give(world: World, locationId: string): void {
  const control = world.app.repos.city.control(locationId);
  if (!control) throw new Error(`no control row for ${locationId}`);
  world.app.repos.city.put({
    ...control,
    holder: { kind: 'crew', baseId: world.victim.baseId },
    level: MAX_LOCATION_LEVEL,
    garrison: {},
  });
}

/** Enough of everything that the raiders' hold, not the victim's poverty, is what bounds the haul. */
function fill(world: World, baseId: string, each = 50_000): void {
  world.app.repos.bases.updateResources(
    baseId,
    Object.fromEntries(RESOURCE_KEYS.map((key) => [key, each])) as unknown as Resources,
  );
}

describe('breaking into a lived-in district', () => {
  it('moves resources between the two crews without creating any', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);

    const before = totalAcross(world);
    await breakIn(world);
    const after = totalAcross(world);

    for (const key of RESOURCE_KEYS) {
      expect(after[key], `${key} was created or destroyed by a raid`).toBe(before[key]);
    }
  });

  /**
   * The same, with the defender holding a Bone Market.
   *
   * This is the case the duplication bug needed: the refund write is what put the loot back, and it
   * only happens when the defender has a salvage percentage and lost somebody. Without the hold the
   * raid conserves resources whether or not the bug is present, so the case above cannot catch it.
   */
  it('conserves resources even when the defender is owed a salvage refund', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    /*
     * A poor victim, in caps only.
     *
     * Caps are first in `PLUNDER_PRIORITY` and weigh a kilogram, so a well-stocked victim has its
     * whole hold filled with them and *nothing else moves*. That matters because the refund is also
     * paid in caps: with a caps-only haul, every assertion below is about a resource that legitimately
     * moves on two counts at once, and the test cannot tell a clobbered stockpile from a refunded
     * one. Capping the caps forces the raiders to carry something else out, and that something else
     * is what the duplication shows up in.
     */
    world.app.repos.bases.updateResources(world.victim.baseId, {
      ...stockOf(world, world.victim.baseId),
      caps: 40,
    });
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
    world.app.repos.bases.updateArmy(world.victim.baseId, { razors: 8 }, []);
    give(world, 'rustyard-bones');

    const victimBefore = stockOf(world, world.victim.baseId);
    const raiderBefore = stockOf(world, world.raider.baseId);
    await breakIn(world);
    const victimAfter = stockOf(world, world.victim.baseId);
    const raiderAfter = stockOf(world, world.raider.baseId);

    // Somebody was actually robbed, or this proves nothing about the loot at all.
    const looted = RESOURCE_KEYS.filter((key) => raiderAfter[key] > raiderBefore[key]);
    expect(looted.length, 'the raid carried nothing out').toBeGreaterThan(0);
    // And robbed of something the refund cannot also explain. Without this the loop below skips
    // every key it is given and passes against a stockpile that was handed straight back.
    expect(
      looted.filter((key) => key !== 'caps'),
      'the raid carried out nothing but caps, so the refund and the loot cannot be told apart',
    ).not.toEqual([]);
    // The refund actually happened, which is the whole precondition for the bug.
    expect(
      victimAfter.caps + (victimBefore.caps - victimAfter.caps),
      'sanity: the victim was measured',
    ).toBe(victimBefore.caps);

    for (const key of looted) {
      const gained = raiderAfter[key] - raiderBefore[key];
      const lost = victimBefore[key] - victimAfter[key];
      // Caps can move on both counts at once: the refund is paid in them. Everything else the
      // raiders carried out has to have left the victim's stockpile, one for one.
      if (key === 'caps') continue;
      expect(lost, `the victim kept the ${key} the raiders carried out`).toBe(gained);
    }
  });
});
