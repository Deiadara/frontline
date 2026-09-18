import {
  DECLARE_INFAMY_COST,
  declarationWindow,
  featMeasureKey,
  skirmishOutcome,
  unitSlotsUsed,
  type Army,
  type BattlesResponse,
  type BattleTarget,
  type FeatMeasure,
  type ItemId,
  type SkirmishEngine,
  TRAP_CATALOG,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBattles } from '../battle/resolve.js';
import { settleMovements } from '../battle/movement.js';
import { elsewhere } from '../testing/districts.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The counters that ask what a fight *looked like* (maintainer request, 2026-09-18).
 *
 * `feats/battle.test.ts` in the shared package holds the rule: which of the four a set of numbers
 * earns, and where each boundary sits. None of that proves the numbers reaching it are the right
 * ones, and that is the half this feature is exposed on. A hook reading the analysis instead of the
 * assembled lines, or reading `attackerKills` as the attacker's own dead, produces a counter that
 * moves, so every test in the tree stays green while the board pays out for the wrong fights.
 *
 * So these run real fights through the real settler and read `crew_tallies` afterwards. Every
 * scenario asserts the counters that are *not* supposed to move as well as the ones that are:
 * three of the four fire on almost any big win, and a hook wired to the wrong measure would be
 * invisible otherwise.
 *
 * A break-in is the fixture for all of them because it is the one target kind where both crews are
 * named players, the defending force is a roster a test can set outright rather than a garrison,
 * and the resident counts as the defender for the trap route (`battle/ground.ts`, `sideOf`).
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** The cheapest trap, off the catalogue rather than typed, the way `battle/trap.test.ts` takes it. */
const TRAP = TRAP_CATALOG[0]!;

/** The four the shared rule can pay, so every scenario can assert the ones that stayed still. */
const SHAPES: readonly FeatMeasure[] = [
  'battles_won_outnumbered',
  'battles_won_overwhelmed',
  'battles_won_flawless',
  'battles_won_lopsided',
];

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

/** The attacker takes the ground, killing everything on it and losing `winnerLosses`. */
const attackerTakesIt = (winnerLosses: Army = {}, perimeterCaught: Army = {}): SkirmishEngine => ({
  resolve: (input) =>
    skirmishOutcome({
      winner: 'attacker',
      log: ['through the wall'],
      killed: input.defending,
      winnerLosses,
      perimeterCaught,
    }),
});

/** ...and the mirror of it, so the defending half of every hook is driven by a real fight too. */
const defenderHolds = (winnerLosses: Army = {}): SkirmishEngine => ({
  resolve: (input) =>
    skirmishOutcome({
      winner: 'defender',
      log: ['turned back at the door'],
      killed: input.attacking,
      winnerLosses,
    }),
});

async function register(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(registered.statusCode, registered.body.slice(0, 200)).toBe(201);
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  // §D7: calling a fight costs infamy and nobody starts with any.
  const purse = app.repos.bases.findById(base.id)!.economy;
  app.repos.bases.updateEconomy(base.id, { ...purse, infamy: DECLARE_INFAMY_COST * 4 });
  return { token, baseId: base.id, districtId: base.districtId };
}

async function makeWorld(engine: SkirmishEngine): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const raider = await register(app, 'raider');
  const planted = await register(app, 'victim');
  const home = elsewhere(raider.districtId);
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(home, planted.baseId);
  const victim: Crew = { ...planted, districtId: home };

  app.repos.city.markScouted(raider.baseId, victim.districtId, new Date().toISOString());
  // Nothing behind a standing gate can be reached. Breaking it is its own fight with its own tests.
  app.repos.sieges.breakGate(victim.districtId, new Date(Date.now() + 3_600_000).toISOString());
  return { app, db, raider, victim };
}

/**
 * Declares the break-in and puts a column on the road, without settling it.
 *
 * Split from the settle so a trap can be named in between, which is the only window the route
 * allows: `/battles/trap` refuses once the mark has passed.
 */
async function declareRaid(world: World, sending: Army): Promise<string> {
  const target: BattleTarget = { kind: 'district', districtId: world.victim.districtId };
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

  world.app.repos.bases.updateArmy(world.raider.baseId, sending, []);
  const sent = await world.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(world.raider.token),
    payload: { battleId: view.battle.id, changes: sending, perimeterChanges: {} },
  });
  expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
  return view.battle.id;
}

/**
 * Winds the mark and the column back so the settler picks the fight up, then runs it.
 *
 * The movement row has to move with the mark. Winding only the mark resolves a fight nobody turned
 * up to, which settles correctly and measures nothing: `battle/breakin.test.ts` has the same note.
 */
function settle(world: World, battleId: string): void {
  const mark = new Date(Date.now() - 60_000);
  world.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(mark.toISOString(), battleId);
  world.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(mark.getTime() - 60_000).toISOString(), mark.toISOString(), battleId);
  settleMovements(world.app.repos, new Date());
  expect(settleBattles(world.app.repos, world.app.skirmishEngine, new Date())).toHaveLength(1);
}

/** Declares, deploys and settles one break-in, with the victim's roster standing in the way. */
async function raid(world: World, sending: Army, holding: Army): Promise<void> {
  world.app.repos.bases.updateArmy(world.victim.baseId, holding, []);
  settle(world, await declareRaid(world, sending));
}

const talliesOf = (world: World, baseId: string): Record<string, number> =>
  world.app.repos.feats.tallies(baseId);

const counted = (world: World, baseId: string, measure: FeatMeasure): number =>
  talliesOf(world, baseId)[featMeasureKey(measure)] ?? 0;

/** Which of the four a crew was paid, in catalogue order, so a test can assert the whole answer. */
const shapesFor = (world: World, baseId: string): FeatMeasure[] =>
  SHAPES.filter((measure) => counted(world, baseId, measure) > 0);

describe('the four counters that ask what a fight looked like', () => {
  it('pays the attacker for a win against a line four times its own, and nothing to the loser', async () => {
    const world = await makeWorld(attackerTakesIt());
    // Six against sixty. A tenth of the unit slots, and every one of them walks back off.
    await raid(world, { razors: 6 }, { razors: 60 });

    expect(shapesFor(world, world.raider.baseId)).toEqual([
      'battles_won_outnumbered',
      'battles_won_overwhelmed',
      'battles_won_flawless',
      'battles_won_lopsided',
    ]);
    expect(shapesFor(world, world.victim.baseId)).toEqual([]);
  });

  /**
   * The separating case, and the reason the test above is not enough on its own.
   *
   * Two and a half to one, five of the raiders dead and twenty five of the defence: past the first
   * threshold and short of all three others. A hook that paid every counter on every win, or that
   * read the casualty figures the wrong way round, passes the all-four test and fails this one.
   */
  it('pays only the first rung for a win that clears only the first threshold', async () => {
    const world = await makeWorld(attackerTakesIt({ razors: 5 }));
    await raid(world, { razors: 10 }, { razors: 25 });

    expect(shapesFor(world, world.raider.baseId)).toEqual(['battles_won_outnumbered']);
  });

  it('pays the defending crew when the defending crew is the one holding out', async () => {
    const world = await makeWorld(defenderHolds());
    // Forty walk in on ten, and the ten are still standing afterwards.
    await raid(world, { razors: 40 }, { razors: 10 });

    expect(shapesFor(world, world.victim.baseId)).toEqual([
      'battles_won_outnumbered',
      'battles_won_overwhelmed',
      'battles_won_flawless',
      'battles_won_lopsided',
    ]);
    expect(shapesFor(world, world.raider.baseId)).toEqual([]);
  });

  /**
   * The force is unit slots and not heads, which is the whole of `feats/battle.ts`'s second note.
   *
   * Razors on both sides, so heads and unit slots are the same ratio and the assertion above cannot
   * tell them apart. This pins the reading itself: what the hook handed the rule has to be what
   * `unitSlotsUsed` says about the two lines that stood there.
   */
  it('measures the two lines in unit slots', async () => {
    const world = await makeWorld(attackerTakesIt());
    const sending: Army = { razors: 6 };
    const holding: Army = { razors: 60 };
    await raid(world, sending, holding);

    expect(unitSlotsUsed(holding)).toBeGreaterThanOrEqual(unitSlotsUsed(sending) * 4);
    expect(counted(world, world.raider.baseId, 'battles_won_overwhelmed')).toBe(1);
  });
});

describe('a break-in, counted for both sides of it', () => {
  it('counts the raid for whoever forced the door', async () => {
    const world = await makeWorld(attackerTakesIt());
    await raid(world, { razors: 20 }, { razors: 4 });

    expect(counted(world, world.raider.baseId, 'districts_raided')).toBe(1);
    expect(counted(world, world.raider.baseId, 'raids_repelled')).toBe(0);
    expect(counted(world, world.victim.baseId, 'raids_repelled')).toBe(0);
  });

  it('counts it for whoever did not let them in', async () => {
    const world = await makeWorld(defenderHolds());
    await raid(world, { razors: 20 }, { razors: 30 });

    expect(counted(world, world.victim.baseId, 'raids_repelled')).toBe(1);
    expect(counted(world, world.victim.baseId, 'districts_raided')).toBe(0);
    expect(counted(world, world.raider.baseId, 'districts_raided')).toBe(0);
  });
});

describe('the trap and the ring', () => {
  it('counts what a trap took, for the crew that buried it', async () => {
    const world = await makeWorld(attackerTakesIt());
    const base = world.app.repos.bases.findById(world.victim.baseId)!;
    world.app.repos.bases.updateHoldings(base.id, base.resources, { [TRAP.id as ItemId]: 1 });
    world.app.repos.bases.updateArmy(world.victim.baseId, { razors: 4 }, []);

    const battleId = await declareRaid(world, { razors: 40 });
    const laid = await world.app.inject({
      method: 'POST',
      url: '/api/battles/trap',
      headers: auth(world.victim.token),
      payload: { battleId, trapId: TRAP.id },
    });
    expect(laid.statusCode, laid.body.slice(0, 300)).toBe(200);
    settle(world, battleId);

    expect(counted(world, world.victim.baseId, 'trap_kills')).toBeGreaterThan(0);
    // The column that walked into it is not the crew that laid it, however many it lost.
    expect(counted(world, world.raider.baseId, 'trap_kills')).toBe(0);
  });

  it('counts the runners a ring stopped, for the side that won', async () => {
    const world = await makeWorld(attackerTakesIt({}, { razors: 3 }));
    await raid(world, { razors: 20 }, { razors: 8 });

    expect(counted(world, world.raider.baseId, 'runners_caught')).toBe(3);
    expect(counted(world, world.victim.baseId, 'runners_caught')).toBe(0);
  });
});
