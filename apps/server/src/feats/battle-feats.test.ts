import {
  DECLARE_INFAMY_COST,
  JAMMING_AT,
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
  'battles_won_jamming',
  'battles_won_planted',
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

/** The attacker takes it, with their jammers reported as having been this deep in the enemy. */
const attackerJams = (jam: number): SkirmishEngine => ({
  resolve: (input) =>
    skirmishOutcome({
      winner: 'attacker',
      log: ['nothing they brought worked'],
      killed: input.defending,
      jam: { attacker: jam, defender: 0 },
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

  /**
   * ...and only the slots that will be *in* the line, which is the other half of the same note.
   *
   * A crew defends its home with its whole roster (`assemble`), porters included, and nobody
   * chooses that. `unitSlotsUsed` counted them, so the size of a warehouse was the size of a
   * defence: beating four Razors standing in front of sixty porters paid out as a win against
   * eight-to-one odds. The engine has skipped them when it counts its own sides since the day the
   * rule was written; this is the feats board asking the same question the fight did.
   *
   * The two holdings below are **the same 84 unit slots**, and that is the point of the pair: the
   * old reading could not tell them apart, so a control that only asserted the refusal would pass
   * on a hook that had simply stopped paying the counter at all.
   */
  it('does not count porters as a defence, and still counts real numbers', async () => {
    const PADDED: Army = { razors: 4, scavengers: 40, haulers: 20 };
    const REAL: Army = { razors: 84 };
    expect(unitSlotsUsed(PADDED), 'the pair is only a pair while the raw totals match').toBe(
      unitSlotsUsed(REAL),
    );

    const behindPorters = await makeWorld(attackerTakesIt());
    await raid(behindPorters, { razors: 10 }, PADDED);
    expect(counted(behindPorters, behindPorters.raider.baseId, 'battles_won_outnumbered')).toBe(0);
    expect(counted(behindPorters, behindPorters.raider.baseId, 'battles_won_overwhelmed')).toBe(0);

    /*
     * And a district with *nobody* in it who can fight is a walkover rather than a flawless win.
     *
     * `battles_won_flawless` asks for a real enemy and the raw slot count called sixty porters
     * one, so walking into an undefended warehouse paid out the same as holding a line against
     * one. The three force-driven counters are named rather than asserting the whole set:
     * `battles_won_lopsided` reads kill counts, and this file's stub kills whatever it is handed,
     * porters included, which the engine's own line would never have put in front of anybody.
     */
    const empty = await makeWorld(attackerTakesIt());
    await raid(empty, { razors: 10 }, { scavengers: 40, haulers: 20 });
    for (const measure of [
      'battles_won_outnumbered',
      'battles_won_overwhelmed',
      'battles_won_flawless',
    ] as const) {
      expect(counted(empty, empty.raider.baseId, measure), measure).toBe(0);
    }

    const behindFighters = await makeWorld(attackerTakesIt());
    await raid(behindFighters, { razors: 10 }, REAL);
    expect(counted(behindFighters, behindFighters.raider.baseId, 'battles_won_outnumbered')).toBe(
      1,
    );
    expect(counted(behindFighters, behindFighters.raider.baseId, 'battles_won_overwhelmed')).toBe(
      1,
    );
  });

  /**
   * The half that is easy to miss: the padding was on the defender's *own* force too.
   *
   * Ten Razors holding out against forty is four to one, and the crew that did it could never be
   * paid for it, because the thirty Scavengers and twenty five Haulers asleep in the same district
   * made their own line read as ninety slots. The one side that was genuinely outnumbered was the
   * one the counter refused.
   */
  it('pays a defender who really was outnumbered, past the porters in their own district', async () => {
    const world = await makeWorld(defenderHolds());
    const holding: Army = { razors: 10, scavengers: 30, haulers: 25 };
    await raid(world, { razors: 40 }, holding);

    // The raw reading made the defence the *bigger* side, which is why it paid nothing.
    expect(unitSlotsUsed(holding)).toBeGreaterThan(unitSlotsUsed({ razors: 40 }));
    expect(counted(world, world.victim.baseId, 'battles_won_outnumbered')).toBe(1);
    expect(counted(world, world.victim.baseId, 'battles_won_overwhelmed')).toBe(1);
  });
});

/**
 * §E: the jam counter, at the seam where it is written (maintainer, 2026-09-18).
 *
 * `feats/battle.test.ts` holds the threshold. What it cannot hold is that the number reaching
 * the rule is the one the engine produced: `outcome.jam` is a new field on the skirmish outcome
 * and the settle site has to read the right half of it for each crew. A hook that passed zero,
 * or that crossed the two sides over, leaves every test in the tree green while the board never
 * pays a Netrunner crew for the fight they won.
 */
describe('the counter for a fight the jammers decided', () => {
  it('pays a win where the jam was deep enough, and nothing where it was not', async () => {
    const deep = await makeWorld(attackerJams(JAMMING_AT));
    await raid(deep, { razors: 20 }, { razors: 10 });
    expect(counted(deep, deep.raider.baseId, 'battles_won_jamming')).toBe(1);

    const shallow = await makeWorld(attackerJams(JAMMING_AT - 1));
    await raid(shallow, { razors: 20 }, { razors: 10 });
    expect(counted(shallow, shallow.raider.baseId, 'battles_won_jamming')).toBe(0);
  });

  /**
   * The crossover, and it has to be set up carefully to mean anything.
   *
   * `outcome.jam` has a key per side and the settler reads one for each crew, so handing the
   * attacker's figure to the defender is a one-word mistake nothing else sees. The obvious test
   * is vacuous: a defender who *loses* earns nothing whatever the jam says, because
   * `battleFeatsEarned` returns early on `won: false`, and the first version of this passed with
   * the two sides crossed over. So the defender has to win, while the jam belongs to the
   * attacker: the only thing that can pay the defender here is reading the wrong key.
   */
  it('does not pay the crew the jam was laid on, even when they win', async () => {
    const world = await makeWorld({
      resolve: (input) =>
        skirmishOutcome({
          winner: 'defender',
          log: ['they held, and it was not the hacking that did it'],
          killed: input.attacking,
          jam: { attacker: JAMMING_AT * 2, defender: 0 },
        }),
    });
    await raid(world, { razors: 20 }, { razors: 10 });

    expect(counted(world, world.victim.baseId, 'battles_won_jamming')).toBe(0);
    // The premise: the defender really did win, so the early return is not what is passing this.
    expect(counted(world, world.victim.baseId, 'battles_won')).toBe(1);
  });

  /** And a fight nobody jammed pays nobody, which the default stub is already the case for. */
  it('pays nothing when nobody brought one', async () => {
    const world = await makeWorld(attackerTakesIt());
    await raid(world, { razors: 20 }, { razors: 10 });
    expect(counted(world, world.raider.baseId, 'battles_won_jamming')).toBe(0);
  });
});

/**
 * §A4: the counter for a fight that was set up before it was called.
 *
 * `city/sleepers.test.ts` holds the declaration end, where `wokeSleepers` is written. This is
 * the other end, where the settler reads it: a hook that passed a flat `false`, or read the
 * field for the wrong crew, leaves every test in the tree green while the board never pays a
 * crew for the one thing a cell is for.
 *
 * The flag is set on the row directly rather than by planting, because planting needs a location
 * target and this file's world is a break-in. What is measured is the settler reading it.
 */
describe('the counter for a fight the Sleepers were already standing in', () => {
  const raidWith = async (woke: boolean): Promise<World> => {
    const world = await makeWorld(attackerTakesIt());
    world.app.repos.bases.updateArmy(world.victim.baseId, { razors: 10 }, []);
    const battleId = await declareRaid(world, { razors: 20 });
    world.db
      .prepare('UPDATE scheduled_battles SET woke_sleepers = ? WHERE id = ?')
      .run(woke ? 1 : 0, battleId);
    settle(world, battleId);
    return world;
  };

  it('pays the crew whose cell was waiting, and nobody otherwise', async () => {
    const planted = await raidWith(true);
    expect(counted(planted, planted.raider.baseId, 'battles_won_planted')).toBe(1);

    const marched = await raidWith(false);
    expect(counted(marched, marched.raider.baseId, 'battles_won_planted')).toBe(0);
  });

  /** A defender never plants: a cell goes on ground its crew does **not** hold. */
  it('never pays the crew that was attacked', async () => {
    const world = await makeWorld(defenderHolds());
    world.app.repos.bases.updateArmy(world.victim.baseId, { razors: 40 }, []);
    const battleId = await declareRaid(world, { razors: 5 });
    world.db.prepare('UPDATE scheduled_battles SET woke_sleepers = 1 WHERE id = ?').run(battleId);
    settle(world, battleId);

    expect(counted(world, world.victim.baseId, 'battles_won_planted')).toBe(0);
    // The premise: they really did win, so the early return is not what is passing this.
    expect(counted(world, world.victim.baseId, 'battles_won')).toBe(1);
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
