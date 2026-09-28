/**
 * The regime's army is spent by the fights it turns up to.
 *
 * `assemble` folds every `control.garrison` in a district into the defence of a gate or a raid,
 * and until this file existed nothing wrote the survivors back: `repos.city.put` and `setGarrison`
 * ran for a `location` target and for nothing else. So a Combine or looter district's standing
 * army was an immortal defence that was nonetheless counted as killed. Measured on the boot world
 * with 400 Razors against the `neon-docks` gate: the defence committed 46 and lost 29, the
 * attacker banked 37 infamy and the win, and the seven `civic_levy` rows behind the gate (44
 * bodies) were byte-identical before and after. `tallyCombineFight`, `tallyBattleResolved` and
 * `tallyBattleShape` all paid out on those 29, every 24 hours, for ever.
 *
 * The leader was already held back from these fights (`withoutTheLeader`) for exactly this reason,
 * with the note that the regiment beside him was left in. This is the regiment.
 *
 * What the survivors go back to is measured per row rather than in total, because the apportionment
 * is the part that can be wrong quietly: a split that hands every survivor to the first row leaves
 * the same number of bodies in the district and a different map.
 */
import {
  combineLeaderAt,
  emptyDeployment,
  defaultSkirmishEngine,
  skirmishOutcome,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Army,
  type Base,
  type BattleTarget,
  type ScheduledBattle,
  type SkirmishEngine,
  type SkirmishOutcome,
} from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { controlsIn } from './ground.js';
import { assemble, settleBattles } from './resolve.js';

let db: AppDatabase;
let repos: Repositories;

const OWNER = 'owner-erosion';
const ATTACKER = 'base-erosion';
const T0 = new Date('2026-09-20T12:00:00.000Z');
const MARK = new Date('2026-09-21T10:00:00.000Z');
const SETTLE = new Date('2026-09-21T11:00:00.000Z');

/** The cheapest Combine ground in the city, and the district the defect was measured on. */
const DOCKS = 'neon-docks';
/** The Syndic's district, for the one plot in it that must never be in a gate fight. */
const ANNEXES = 'annexes';
const UPLINK = 'annexes-uplink';

function crew(): Base {
  const now = T0.toISOString();
  return {
    id: ATTACKER,
    ownerId: OWNER,
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 8,
    isBot: false,
    resources: {
      caps: 500,
      supplies: 500,
      oil: 500,
      scrap: 500,
      planks: 500,
      highQualityMetal: 50,
    },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus-1', kind: 'nexus', level: 5, modifications: [] }],
    buildQueue: [],
    army: { razors: 400 },
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'erosion', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
  repos.bases.insert(crew());
  // Materialise every control row, so a reading taken before the fight is the whole truth rather
  // than a patch over rows that do not exist yet.
  repos.city.controls();
});

afterEach(() => {
  db.close();
});

/** Every body standing on the district's control rows, by unit id. */
function garrisonedIn(districtId: string): Army {
  const total: Army = {};
  for (const { control } of controlsIn(repos, districtId)) {
    for (const [unitId, count] of Object.entries(control.garrison)) {
      total[unitId] = (total[unitId] ?? 0) + count;
    }
  }
  return total;
}

function bodies(army: Army): number {
  return Object.values(army).reduce((sum, count) => sum + count, 0);
}

/** One row's garrison, for the per-plot questions. */
function garrisonAt(locationId: string): Army {
  return repos.city.control(locationId)?.garrison ?? {};
}

/** A gate fight against the regime, on the board and paid for by nobody: the rules are elsewhere. */
function callGateFight(districtId: string, options: { muster?: Army } = {}): ScheduledBattle {
  const target: BattleTarget = { kind: 'gate', districtId };
  const id = `erosion-${districtId}`;
  const battle: ScheduledBattle = {
    id,
    target,
    attackerBaseId: ATTACKER,
    defender: { kind: 'government' },
    scheduledFor: MARK.toISOString(),
    declaredAt: T0.toISOString(),
    resolvedAt: null,
    seed: `seed-${id}`,
    holdAfterCapture: false,
    wokeSleepers: false,
  };
  repos.sieges.insert(battle);
  repos.sieges.putDeployment({
    ...emptyDeployment(id, ATTACKER, 'attacker', T0.toISOString()),
    army: { razors: 400 },
  });
  if (options.muster) {
    // The row `declare` writes for an NPC defender: a muster belongs to nobody's plot, so it is
    // the one part of the defence that must not be written back to one.
    repos.sieges.putDeployment({
      ...emptyDeployment(id, null, 'defender', T0.toISOString()),
      army: options.muster,
    });
  }
  return battle;
}

/** An engine that answers with one fixed outcome, so the arithmetic is the test's and not a draw's. */
function fixed(outcome: Partial<SkirmishOutcome>): SkirmishEngine {
  return {
    resolve: (input) =>
      skirmishOutcome({ winner: 'defender', log: [`${input.locationName} decided`], ...outcome }),
  };
}

describe('a district fight is paid for out of the garrisons that fought it', () => {
  it('takes exactly what the ledger says died off the control rows', () => {
    const before = garrisonedIn(DOCKS);
    callGateFight(DOCKS);

    const [resolved] = settleBattles(repos, defaultSkirmishEngine, SETTLE);
    expect(resolved).toBeDefined();

    const lost = resolved!.analysis.defender.lost;
    // A fight the defence walked out of measures nothing, and the whole point of the boot world's
    // Docks is that 400 Razors do not walk away from it.
    expect(lost).toBeGreaterThan(0);
    expect(bodies(before) - bodies(garrisonedIn(DOCKS))).toBe(lost);
  });

  it('writes the survivors back unit for unit', () => {
    const before = garrisonedIn(DOCKS);
    const unit = Object.keys(before)[0]!;
    callGateFight(DOCKS);

    // The defence holds and pays four bodies for it. With no muster on the row, every one of the
    // four has to come off a plot.
    settleBattles(repos, fixed({ winner: 'defender', winnerLosses: { [unit]: 4 } }), SETTLE);

    const after = garrisonedIn(DOCKS);
    expect(after).toEqual({ ...before, [unit]: before[unit]! - 4 });
  });

  it('spreads the losses across the plots that sent them rather than emptying the first', () => {
    const before = controlsIn(repos, DOCKS).map(({ locationId, control }) => ({
      locationId,
      size: bodies(control.garrison),
    }));
    callGateFight(DOCKS);

    // Half the defence falls, which no single plot can pay for on its own.
    const half: Army = {};
    for (const [unitId, count] of Object.entries(garrisonedIn(DOCKS))) {
      half[unitId] = Math.floor(count / 2);
    }
    settleBattles(repos, fixed({ winner: 'defender', winnerLosses: half }), SETTLE);

    for (const plot of before) {
      const after = bodies(garrisonAt(plot.locationId));
      expect(after, `${plot.locationId} kept nothing`).toBeGreaterThan(0);
      expect(after, `${plot.locationId} paid nothing`).toBeLessThan(plot.size);
    }
  });

  it('leaves the legendary standing, because he was never in the line', () => {
    const leader = combineLeaderAt(UPLINK);
    expect(leader, 'fixture error: nobody stands on the uplink').toBeDefined();
    expect(garrisonAt(UPLINK)[leader!.unitId]).toBe(1);

    callGateFight(ANNEXES);
    // Nobody walks away: `fled` is empty and the attacker takes the door, so every body that was
    // in the line is gone. The leader was not in it.
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(garrisonAt(UPLINK)).toEqual({ [leader!.unitId]: 1 });
    for (const { locationId, control } of controlsIn(repos, ANNEXES)) {
      if (locationId === UPLINK) continue;
      expect(bodies(control.garrison), `${locationId} kept somebody`).toBe(0);
    }
  });

  it('never writes the muster onto a plot, because it came from none', () => {
    const before = garrisonedIn(DOCKS);
    const unit = Object.keys(before)[0]!;
    // Ten more bodies in the line than the plots hold, and every one of them a body the district
    // turned out rather than one standing on a roof.
    callGateFight(DOCKS, { muster: { [unit]: 10 } });

    // The defence holds without a scratch, so every survivor is written back somewhere.
    settleBattles(repos, fixed({ winner: 'defender' }), SETTLE);

    expect(garrisonedIn(DOCKS)).toEqual(before);
  });

  it('is settled once, so a second read cannot spend the garrison twice', () => {
    const before = garrisonedIn(DOCKS);
    const unit = Object.keys(before)[0]!;
    callGateFight(DOCKS);

    const engine = fixed({ winner: 'defender', winnerLosses: { [unit]: 4 } });
    settleBattles(repos, engine, SETTLE);
    const after = garrisonedIn(DOCKS);
    settleBattles(repos, engine, new Date(SETTLE.getTime() + 60_000));

    expect(garrisonedIn(DOCKS)).toEqual(after);
  });
});

describe('the district behind a broken gate', () => {
  it('erodes on a raid too, not only at the door', () => {
    const before = garrisonedIn(DOCKS);
    const unit = Object.keys(before)[0]!;
    const id = 'erosion-raid';
    // A raid is only legal inside a breach, and is called off at the mark without one.
    repos.sieges.breakGate(DOCKS, new Date(MARK.getTime() + 24 * 3_600_000).toISOString());
    repos.sieges.insert({
      id,
      target: { kind: 'district', districtId: DOCKS },
      attackerBaseId: ATTACKER,
      defender: { kind: 'government' },
      scheduledFor: MARK.toISOString(),
      declaredAt: T0.toISOString(),
      resolvedAt: null,
      seed: `seed-${id}`,
      holdAfterCapture: false,
      wokeSleepers: false,
    });
    repos.sieges.putDeployment({
      ...emptyDeployment(id, ATTACKER, 'attacker', T0.toISOString()),
      army: { razors: 400 },
    });

    settleBattles(repos, fixed({ winner: 'defender', winnerLosses: { [unit]: 3 } }), SETTLE);

    expect(garrisonedIn(DOCKS)).toEqual({ ...before, [unit]: before[unit]! - 3 });
  });
});

/**
 * A crew's own garrison, standing inside a district the regime still holds most of.
 *
 * `assemble` takes the "nobody's crew is defending this" branch whenever the call names a gate or
 * a raid and no crew answers for the ground, and it then folds in **every** control row in the
 * district. That includes rows a crew holds, which is the one thing the module doc under it says
 * it must not do: "a crew's garrisons are the crew's, standing on plots they chose to leave them
 * on, and a gate fight three streets away is not a thing they walked to."
 *
 * The state is reachable in the ordinary way. Break a Combine gate, call it a second time while
 * the breach is open, and take a plot inside before the second call lands: the district still
 * reads `government` on the battle row, `residentOf` answers nobody on contested ground, and the
 * new holder's units are conscripted into the regime's line and eroded by `spendGarrisons` on the
 * way out. The holder is told nothing and is paid nothing.
 */
describe('a crew holding ground inside a district the regime is defending', () => {
  const NEIGHBOUR = 'base-neighbour';
  const PLOT = 'neon-docks-chandler';

  function handPlotToNeighbour(garrison: Army): void {
    const control = repos.city.control(PLOT)!;
    repos.city.put({ ...control, holder: { kind: 'crew', baseId: NEIGHBOUR }, garrison });
  }

  it('is not conscripted into the line', () => {
    handPlotToNeighbour({ razors: 6 });
    const battle = callGateFight(DOCKS);

    const assembled = assemble(repos, battle, undefined);

    expect(assembled.defending.razors ?? 0).toBe(0);
    expect(assembled.garrisons.map((row) => row.locationId)).not.toContain(PLOT);
  });

  it('keeps its garrison when the regime loses the door', () => {
    handPlotToNeighbour({ razors: 6 });
    callGateFight(DOCKS);

    // Nobody the regime had walks away, so every plot that was in the line is emptied.
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(garrisonAt(PLOT)).toEqual({ razors: 6 });
  });
});

/**
 * The muster, on a raid against one plot rather than against the door.
 *
 * `declare` turns the district out on top of whatever is standing on the ground
 * (`battle/npc.ts`), and the muster stands on no plot: `spendGarrisons` says so in as many words
 * and drops its share, "because both would be a regime that grows by fighting". The location path
 * is older than that rule and does the opposite, writing the whole surviving line back onto the
 * plot, so a raid the Combine turns back leaves more bodies on the ground than it started with.
 */
describe('the muster a raid on one plot brings out', () => {
  const PLOT = 'neon-docks-tideline';

  function callLocationFight(muster: Army): void {
    const id = 'erosion-plot';
    repos.sieges.insert({
      id,
      target: { kind: 'location', districtId: DOCKS, locationId: PLOT },
      attackerBaseId: ATTACKER,
      defender: { kind: 'government' },
      scheduledFor: MARK.toISOString(),
      declaredAt: T0.toISOString(),
      resolvedAt: null,
      seed: `seed-${id}`,
      holdAfterCapture: false,
      wokeSleepers: false,
    });
    repos.sieges.putDeployment({
      ...emptyDeployment(id, ATTACKER, 'attacker', T0.toISOString()),
      army: { razors: 10 },
    });
    repos.sieges.putDeployment({
      ...emptyDeployment(id, null, 'defender', T0.toISOString()),
      army: muster,
    });
  }

  it('does not stay on the plot when the raid is turned back', () => {
    const before = garrisonAt(PLOT);
    const unit = Object.keys(before)[0]!;
    callLocationFight({ [unit]: 12 });

    // The regime holds the plot without losing anybody, so every survivor is written somewhere.
    settleBattles(repos, fixed({ winner: 'defender' }), SETTLE);

    expect(garrisonAt(PLOT)).toEqual(before);
  });

  it('is spent by the fight like the garrison beside it', () => {
    const before = garrisonAt(PLOT);
    const unit = Object.keys(before)[0]!;
    const standing = before[unit]!;
    callLocationFight({ [unit]: standing });

    // Half the line falls. The plot and the muster each sent half of it, so the plot pays half of
    // the dead rather than all of them.
    settleBattles(repos, fixed({ winner: 'defender', winnerLosses: { [unit]: standing } }), SETTLE);

    expect(garrisonAt(PLOT)[unit] ?? 0).toBe(Math.round(standing / 2));
  });
});
