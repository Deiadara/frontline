import {
  COMBINE_LEADERS,
  SYNDIC_ARMOR,
  SYNDIC_PENETRATION,
  emptyDeployment,
  featMeasureKey,
  findDistrict,
  findLocation,
  skirmishOutcome,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type BattleTarget,
  type CombineLeader,
  type CombinePower,
  type LocationHolder,
  type ScheduledBattle,
  type SkirmishEngine,
  type SkirmishInput,
  type SkirmishOutcome,
} from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { settleBattles } from './resolve.js';
import { defaultSkirmishEngine } from '@frontline/shared';

/**
 * The **scope and lifecycle** of a Combine legendary's power, measured through the settler.
 *
 * `battle/combine.test.ts` in the shared package measures what each power does to a sheet once the
 * engine has one. Nothing measured the question one step earlier, which is the one a player asks:
 * *does this fight carry him at all?* That answer is computed in `battle/resolve.ts` off the
 * control rows as they stand at the settle, and every one of its conditions is a rule the maintainer
 * wrote down: his district and not his plot, alive and not dead, the regime's ground and not a
 * squatter's, the defence and never the attack, now and not when the fight was called.
 *
 * So the measurement here is the `SkirmishInput` the settler hands the engine. A recording engine
 * captures it and answers with whatever the test wants the fight to have been, which keeps every
 * assertion about the wiring rather than about who happened to win.
 */

let db: AppDatabase;
let repos: Repositories;

/**
 * How many fights this test has called, which is also the seed.
 *
 * Counted rather than drawn: the seed decides the fight, and two of the tests below run the real
 * engine, so a random id made those two a coin. One of them came up tails about one run in three
 * before this was a counter.
 */
let called = 0;

const OWNER = 'owner-presence';
const ATTACKER = 'base-presence';
const T0 = new Date('2026-09-20T12:00:00.000Z');
/** The mark every fight in this file is called for: an hour before the settle clock below. */
const MARK = new Date('2026-09-21T10:00:00.000Z');
const SETTLE = new Date('2026-09-21T11:00:00.000Z');

const leaderOf = (unitId: string): CombineLeader => {
  const leader = COMBINE_LEADERS.find((one) => one.unitId === unitId);
  if (!leader) throw new Error(`no leader ${unitId}`);
  return leader;
};

const SYNDIC = leaderOf('syndic');
const EXECUTIONER = leaderOf('executioner');
const XERO = leaderOf('directive_xero');

/** A plot of the Syndic's district that is not the one she stands on. */
const ANNEXES_ELSEWHERE = 'datavault-sigma-ward';

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
    army: { razors: 40 },
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
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'presence', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
  repos.bases.insert(crew());
  called = 0;
  // Materialise every control row in the city, so what a test writes afterwards is the whole
  // truth rather than a patch over rows that do not exist yet.
  repos.city.controls();
});

afterEach(() => {
  db.close();
});

/**
 * An engine that keeps every input it was handed and answers with a fixed outcome.
 *
 * Every question in this file is about what the settler *computed*, so the fight itself is a
 * constant. Recording rather than asserting inside `resolve` keeps one engine for a test that
 * settles two fights and wants to compare them.
 *
 * **The defence wins by default**, and that is not a detail. A won attack takes the plot, so a
 * test that settled two fights on the same ground read the second one against a holder that was
 * no longer the regime: it came back `undefined` for a reason that had nothing to do with the
 * leader, and it passed with the whole alive-or-dead check deleted. Any test that wants the
 * ground to change hands says so.
 */
function recorder(outcome: Partial<SkirmishOutcome> = {}): SkirmishEngine & {
  inputs: SkirmishInput[];
} {
  const inputs: SkirmishInput[] = [];
  return {
    inputs,
    resolve(input) {
      inputs.push(input);
      return skirmishOutcome({
        winner: 'defender',
        log: [`${input.locationName} decided`],
        ...outcome,
      });
    },
  };
}

/** Puts a fight on the board directly: the declaration rules are another file's subject. */
function callFight(
  target: BattleTarget,
  options: { defender?: LocationHolder; declaredAt?: Date; army?: Record<string, number> } = {},
): ScheduledBattle {
  called += 1;
  const id = `battle-${called}-${target.districtId}`;
  const defender =
    options.defender ??
    (target.kind === 'location'
      ? (repos.city.control(target.locationId)?.holder ?? { kind: 'unoccupied' })
      : { kind: 'unoccupied' });
  const battle: ScheduledBattle = {
    id,
    target,
    attackerBaseId: ATTACKER,
    defender,
    scheduledFor: MARK.toISOString(),
    declaredAt: (options.declaredAt ?? T0).toISOString(),
    resolvedAt: null,
    seed: `seed-${id}`,
    holdAfterCapture: false,
    wokeSleepers: false,
  };
  repos.sieges.insert(battle);
  repos.sieges.putDeployment({
    ...emptyDeployment(id, ATTACKER, 'attacker', T0.toISOString()),
    army: options.army ?? { razors: 20 },
  });
  return battle;
}

/** A location target, with the district read off the catalogue so the two ids cannot disagree. */
function at(locationId: string): BattleTarget {
  const location = findLocation(locationId);
  if (!location) throw new Error(`no location ${locationId}`);
  return { kind: 'location', districtId: location.districtId, locationId };
}

/** Rewrites one plot's holder and garrison, leaving everything else on the row alone. */
function standOn(locationId: string, holder: LocationHolder, garrison: Record<string, number>) {
  const control = repos.city.control(locationId);
  if (!control) throw new Error(`no control row for ${locationId}`);
  repos.city.put({ ...control, holder, garrison });
}

/** The garrison a plot starts with, which is the one a fixture wants to edit rather than invent. */
const garrisonAt = (locationId: string): Record<string, number> => ({
  ...(repos.city.control(locationId)?.garrison ?? {}),
});

/** Takes the leader out of his own plot's garrison and leaves the rest of it standing. */
function killLeader(leader: CombineLeader): void {
  const rest = garrisonAt(leader.locationId);
  delete rest[leader.unitId];
  if (Object.keys(rest).length === 0) throw new Error('the plot held nobody but him');
  standOn(leader.locationId, { kind: 'government' }, rest);
}

/** Settles everything due and hands back the presence each fight was given, in settle order. */
function presencesFrom(engine: ReturnType<typeof recorder>): (CombinePower | undefined)[] {
  settleBattles(repos, engine, SETTLE);
  return engine.inputs.map((input) => input.defenderPresence);
}

/**
 * The one presence a single settled fight carried.
 *
 * The holder is asserted before the fight goes on the board, because "the regime holds it" is the
 * other condition the settler reads: without this check every `toBeUndefined` below would also
 * pass on ground that had quietly changed hands.
 */
function presenceOn(target: BattleTarget, outcome: Partial<SkirmishOutcome> = {}) {
  if (target.kind === 'location') {
    expect(repos.city.control(target.locationId)?.holder.kind, target.locationId).toBe(
      'government',
    );
  }
  const engine = recorder(outcome);
  callFight(target);
  const [presence, ...rest] = presencesFrom(engine);
  expect(rest, 'one fight, one input').toHaveLength(0);
  return presence;
}

describe('a leader shadows his district, not his plot', () => {
  it('carries his power to a fight on another plot of the same district', () => {
    // She is standing on the uplink and the fight is on the ward, four plots away.
    expect(repos.city.control(SYNDIC.locationId)!.garrison['syndic']).toBe(1);
    expect(presenceOn(at(ANNEXES_ELSEWHERE))).toEqual({
      kind: 'syndic',
      penetration: SYNDIC_PENETRATION,
      armor: SYNDIC_ARMOR,
    });
  });

  /**
   * ...and stops at the district line, in both directions.
   *
   * The Blacksite is the Annexes' neighbour on the difficulty ladder and both are Combine ground,
   * so a reach computed off "the regime holds it" rather than off the district would pass every
   * assertion above and fail here. The Blacksite's own leader is the control: a fight there
   * carries the Executioner and nothing of hers.
   */
  it('reaches no fight in another district, even the Combine ground next to it', () => {
    const engine = recorder();
    callFight(at(ANNEXES_ELSEWHERE));
    callFight(at('blacksite-7-outer'));
    callFight(at('combine-spire-broadcast'));
    expect(presencesFrom(engine).map((one) => one?.kind)).toEqual([
      'syndic',
      'executioner',
      'directive_xero',
    ]);
  });

  it('carries nothing at all on Combine ground no legendary commands', () => {
    // The Docks and the Steelbelt are the regime's and have no leader over them.
    expect(COMBINE_LEADERS.some((one) => one.districtId === 'neon-docks')).toBe(false);
    expect(presenceOn(at('neon-docks-galley'))).toBeUndefined();
  });
});

describe('he is alive only while he is standing on his own plot', () => {
  it('takes his power off every other plot in the district the moment he falls', () => {
    const before = presenceOn(at(ANNEXES_ELSEWHERE));
    expect(before?.kind).toBe('syndic');
    killLeader(SYNDIC);
    expect(presenceOn(at(ANNEXES_ELSEWHERE))).toBeUndefined();
  });

  it('takes it off when a crew holds his plot, whoever is standing on it', () => {
    // The whole garrison is still there, his sheet among it, and the flag over the plot is ours.
    standOn(SYNDIC.locationId, { kind: 'crew', baseId: ATTACKER }, garrisonAt(SYNDIC.locationId));
    expect(repos.city.control(SYNDIC.locationId)!.garrison['syndic']).toBe(1);
    expect(presenceOn(at(ANNEXES_ELSEWHERE))).toBeUndefined();
  });

  it('takes it off for a garrison that has everything except him', () => {
    const rest = garrisonAt(SYNDIC.locationId);
    delete rest['syndic'];
    standOn(SYNDIC.locationId, { kind: 'government' }, { ...rest, suppressor: 40 });
    expect(presenceOn(at(ANNEXES_ELSEWHERE))).toBeUndefined();
  });

  /**
   * Each of the three, killed on his own plot and checked on somebody else's.
   *
   * One leader proves the wiring; three prove the table, and the table is where a fourth leader
   * added tomorrow would be missed.
   */
  it('holds for all three of them, each over his own district', () => {
    const elsewhere: Record<string, string> = {
      syndic: ANNEXES_ELSEWHERE,
      executioner: 'blacksite-7-outer',
      directive_xero: 'combine-spire-broadcast',
    };
    for (const leader of COMBINE_LEADERS) {
      const plot = elsewhere[leader.unitId];
      if (!plot) throw new Error(`no second plot named for ${leader.unitId}`);
      expect(presenceOn(at(plot))?.kind, leader.unitId).toBe(leader.power.kind);
      killLeader(leader);
      expect(presenceOn(at(plot)), `${leader.unitId} dead`).toBeUndefined();
    }
  });

  /** His own plot is one of the plots he shadows, right up until it is taken off him. */
  it('carries his power on the plot he is standing on too', () => {
    expect(presenceOn(at(SYNDIC.locationId))?.kind).toBe('syndic');
  });
});

describe('only the regime carries him', () => {
  /**
   * The same district, the same living leader, a different flag over the plot.
   *
   * `presenceOn` refuses ground that is not the regime's, so these two build the fight
   * themselves. The control in both is her garrison row: she is untouched on the uplink, so the
   * only thing that changed between the powered reading above and the bare one here is who holds
   * the ground being fought over.
   */
  const notTheRegimes = (holder: LocationHolder) => {
    standOn(ANNEXES_ELSEWHERE, holder, { razors: 12 });
    expect(repos.city.control(SYNDIC.locationId)!.garrison['syndic']).toBe(1);
    const engine = recorder();
    callFight(at(ANNEXES_ELSEWHERE));
    const [presence] = presencesFrom(engine);
    expect(engine.inputs).toHaveLength(1);
    return presence;
  };

  it('carries nothing for the looters holding a plot in his district', () => {
    expect(notTheRegimes({ kind: 'looters' })).toBeUndefined();
  });

  it('carries nothing for another crew holding a plot in his district', () => {
    expect(notTheRegimes({ kind: 'crew', baseId: 'some-other-crew' })).toBeUndefined();
  });
});

/**
 * The attacker's sheets, at the seam the settler owns.
 *
 * `SkirmishInput` has one presence field and it is the defence's, so the strongest thing a test
 * here can say is that the settler never puts a power anywhere else on the input it builds. The
 * engine half of the rule, that a power on the attacking side is not applied even when a caller
 * hands one over, is measured in `packages/shared/src/battle/combine.test.ts`.
 */
describe('never the attacker', () => {
  it('names the presence on the defence and nowhere else on the input', () => {
    const engine = recorder();
    callFight(at(ANNEXES_ELSEWHERE));
    callFight(at('blacksite-7-outer'));
    callFight(at('combine-spire-broadcast'));
    settleBattles(repos, engine, SETTLE);
    expect(engine.inputs).toHaveLength(3);
    for (const input of engine.inputs) {
      expect(input.defenderPresence).toBeDefined();
      const keys = Object.keys(input).filter((key) => key.toLowerCase().includes('presence'));
      expect(keys).toEqual(['defenderPresence']);
    }
  });
});

describe('the control rows are read at the settle', () => {
  it('carries nothing for a fight called while he lived and settled after he died', () => {
    const engine = recorder();
    // Called a day before the mark, while she was standing.
    callFight(at(ANNEXES_ELSEWHERE), { declaredAt: new Date(MARK.getTime() - 86_400_000) });
    killLeader(SYNDIC);
    expect(presencesFrom(engine)).toEqual([undefined]);
  });

  it('carries his power for a fight called while he was dead and settled after he stood again', () => {
    const engine = recorder();
    killLeader(SYNDIC);
    callFight(at(ANNEXES_ELSEWHERE), { declaredAt: new Date(MARK.getTime() - 86_400_000) });
    // The regime puts her back on the uplink before the mark comes round.
    standOn(
      SYNDIC.locationId,
      { kind: 'government' },
      { ...garrisonAt(SYNDIC.locationId), syndic: 1 },
    );
    expect(presencesFrom(engine).map((one) => one?.kind)).toEqual(['syndic']);
  });
});

describe('the feats say what the fight actually carried', () => {
  const shadowed = () =>
    repos.feats.tallies(ATTACKER)[featMeasureKey('combine_fights_won_shadowed')] ?? 0;

  it('counts a win under his shadow, and does not count one without it', () => {
    const engine = recorder({ winner: 'attacker' });
    callFight(at(ANNEXES_ELSEWHERE));
    settleBattles(repos, engine, SETTLE);
    expect(engine.inputs[0]?.defenderPresence?.kind).toBe('syndic');
    expect(shadowed()).toBe(1);

    killLeader(SYNDIC);
    const second = recorder({ winner: 'attacker' });
    callFight(at('datavault-sigma-coldrow'));
    settleBattles(repos, second, SETTLE);
    expect(second.inputs[0]?.defenderPresence).toBeUndefined();
    // Still one: the second win was not under anybody.
    expect(shadowed()).toBe(1);
  });

  it('does not count a win on looter ground in his district', () => {
    standOn(ANNEXES_ELSEWHERE, { kind: 'looters' }, { razors: 12 });
    const engine = recorder({ winner: 'attacker' });
    callFight(at(ANNEXES_ELSEWHERE));
    settleBattles(repos, engine, SETTLE);
    expect(shadowed()).toBe(0);
  });

  it('records the leader as slain when he is among the Combine dead', () => {
    const engine = recorder({ winner: 'attacker', killed: { syndic: 1, greycoat: 4 } });
    callFight(at(SYNDIC.locationId));
    settleBattles(repos, engine, SETTLE);
    const held = repos.feats.tallies(ATTACKER);
    expect(held[featMeasureKey('combine_leaders_slain', 'syndic')]).toBe(1);
    expect(held[featMeasureKey('combine_kills_of', 'syndic')]).toBe(1);
  });

  /**
   * The ledger and the world have to say the same thing about him.
   *
   * `combine_leaders_slain` is written off the engine's `killed` map and `combinePresenceOver` is
   * read off the control row, so the two can disagree: a settle that credits the kill and leaves
   * him standing on the plot would give a crew the feat and the next fight in the district his
   * power anyway.
   */
  it('leaves nobody standing that the ledger has counted as slain', () => {
    const engine = recorder({ winner: 'attacker', killed: { syndic: 1 } });
    callFight(at(SYNDIC.locationId));
    settleBattles(repos, engine, SETTLE);
    expect(repos.feats.tallies(ATTACKER)[featMeasureKey('combine_leaders_slain', 'syndic')]).toBe(
      1,
    );

    const after = recorder();
    callFight(at(ANNEXES_ELSEWHERE));
    settleBattles(repos, after, SETTLE);
    expect(after.inputs[0]?.defenderPresence).toBeUndefined();
  });
});

describe('a leader fights on his own plot and nowhere else', () => {
  const gateAt = (districtId: string): BattleTarget => ({ kind: 'gate', districtId });

  it('keeps him out of the line of a gate fight over his district', () => {
    const engine = recorder();
    callFight(gateAt(SYNDIC.districtId), { defender: { kind: 'government' } });
    settleBattles(repos, engine, SETTLE);
    const defending = engine.inputs[0]?.defending ?? {};
    // The control: the rest of his plot's regiment did march, so the force is the district's and
    // the only sheet missing from it is his.
    expect(defending['greycoat'] ?? 0, 'nobody at all marched').toBeGreaterThan(0);
    expect(defending['syndic'] ?? 0).toBe(0);
  });

  it('carries his power to the gate fight even though he is not standing in it', () => {
    const engine = recorder();
    callFight(gateAt(SYNDIC.districtId), { defender: { kind: 'government' } });
    settleBattles(repos, engine, SETTLE);
    expect(engine.inputs[0]?.defenderPresence?.kind).toBe('syndic');
  });

  it('holds for all three of them', () => {
    const engine = recorder();
    for (const leader of COMBINE_LEADERS) {
      callFight(gateAt(leader.districtId), { defender: { kind: 'government' } });
    }
    settleBattles(repos, engine, SETTLE);
    expect(engine.inputs).toHaveLength(COMBINE_LEADERS.length);
    engine.inputs.forEach((input, index) => {
      const leader = COMBINE_LEADERS[index]!;
      expect(input.defending[leader.unitId] ?? 0, leader.unitId).toBe(0);
      expect(input.defenderPresence?.kind, leader.unitId).toBe(leader.power.kind);
    });
  });

  /**
   * ...and on his own plot he fights like anybody else, which is what makes the rule above a rule
   * about the gate rather than a rule that deleted him.
   */
  it('stands him in the line of a fight on the plot he holds', () => {
    const engine = recorder();
    callFight(at(SYNDIC.locationId));
    settleBattles(repos, engine, SETTLE);
    expect(engine.inputs[0]?.defending['syndic']).toBe(1);
  });
});

describe('the ledger and the ground agree about whether he died', () => {
  /**
   * An engine that wipes whatever was standing there, which is the only honest stub for this.
   *
   * A fixed `killed` map lets the ledger name a unit that never marched, so it would credit the
   * kill on a gate fight whether or not the leader was in the line and the assertion would be
   * about the fixture. Killing exactly what it was handed ties the ledger to the force the
   * settler assembled, which is the thing under test.
   */
  function wipesTheDefence(): SkirmishEngine & { inputs: SkirmishInput[] } {
    const inputs: SkirmishInput[] = [];
    return {
      inputs,
      resolve(input) {
        inputs.push(input);
        return skirmishOutcome({
          winner: 'attacker',
          log: [`${input.locationName} overrun`],
          killed: input.defending,
        });
      },
    };
  }

  const slain = () =>
    repos.feats.tallies(ATTACKER)[featMeasureKey('combine_leaders_slain', 'syndic')] ?? 0;
  const standing = () => repos.city.control(SYNDIC.locationId)?.garrison['syndic'] ?? 0;

  it('credits the kill and clears the plot when the fight was on his plot', () => {
    const engine = wipesTheDefence();
    callFight(at(SYNDIC.locationId));
    settleBattles(repos, engine, SETTLE);
    expect(engine.inputs[0]?.defending['syndic']).toBe(1);
    expect(slain()).toBe(1);
    expect(standing()).toBe(0);
  });

  /**
   * ...and credits nothing at all for a gate fight, because he was never in it.
   *
   * The pair is the point: `slain > 0 && standing > 0` is the state that must not exist, and the
   * test above is what stops this one passing on a game where he cannot be killed anywhere.
   */
  it('credits nothing and leaves him standing when the fight was over the gate', () => {
    const engine = wipesTheDefence();
    callFight(
      { kind: 'gate', districtId: SYNDIC.districtId },
      { defender: { kind: 'government' } },
    );
    settleBattles(repos, engine, SETTLE);
    expect(slain()).toBe(0);
    expect(standing()).toBe(1);

    // ...so the district still fights under her, which is what her plot still holding her means.
    const after = recorder();
    callFight(at(ANNEXES_ELSEWHERE));
    settleBattles(repos, after, SETTLE);
    expect(after.inputs[0]?.defenderPresence?.kind).toBe('syndic');
  });

  /** ...and a defence that held its ground but lost him takes him off the plot with the rest. */
  it('takes him off his plot when he falls defending it', () => {
    const engine = recorder({ winner: 'defender', winnerLosses: { syndic: 1 } });
    callFight(at(SYNDIC.locationId));
    settleBattles(repos, engine, SETTLE);
    expect(standing()).toBe(0);

    const after = recorder();
    callFight(at(ANNEXES_ELSEWHERE));
    settleBattles(repos, after, SETTLE);
    expect(after.inputs[0]?.defenderPresence).toBeUndefined();
  });
});

/**
 * What the report tells the crew, through the real engine and the real settler.
 *
 * Two lines on the report are the only place a power's *effect* is ever named to the loser:
 * `BattleReportModal` prints "N units changed sides and are his now" off `analysis.turned` and
 * "The Executioner finished N" off `analysis.executed`, and both are zero on a fight nobody
 * commanded. So they agree with whether the power applied exactly when the settler's reading of
 * the control rows reaches the engine, which is what these measure end to end.
 *
 * The powers above are measured against a recording stub, deliberately: a stub cannot prove the
 * toll is real. These two fights run `defaultSkirmishEngine` on the shipped garrisons, and each
 * one carries its own control, the same fight with the leader taken off his plot.
 */
describe('the report carries the toll the power actually took', () => {
  it('reports no turncoats and no executions on a fight nobody commanded', () => {
    expect(COMBINE_LEADERS.some((one) => one.districtId === 'neon-docks')).toBe(false);
    const engine = recorder({ winner: 'attacker' });
    callFight(at('neon-docks-galley'));
    const [resolved] = settleBattles(repos, engine, SETTLE);
    expect(resolved?.analysis.turned).toEqual({});
    expect(resolved?.analysis.executed).toBe(0);
  });

  /**
   * The Executioner, swept across the Blacksite rather than pinned on one fight.
   *
   * One fight is a coin: his line is a tenth of a life, and on these garrisons it comes up on
   * four of the district's seven plots and not on the other three. Measured 2026-09-21, a mixed
   * sixty walked onto each plot in turn: 0, 3, 3, 1, 4, 4, 0 under him and seven zeros with him
   * off the armory. The seeds are the fixture's counter, so this is the same seven fights every
   * run, and the assertion is on the total rather than on the shape.
   */
  it("counts the Executioner's finishings only while he stands on the armory", () => {
    const mixed = { razors: 30, scrapers: 20, ghosts: 10, sluggers: 10 };
    const plots = (findDistrict(EXECUTIONER.districtId)?.locations ?? [])
      .map((one) => one.id)
      .filter((id) => id !== EXECUTIONER.locationId);
    const sweep = () => {
      for (const plot of plots) callFight(at(plot), { army: mixed });
      return settleBattles(repos, defaultSkirmishEngine, SETTLE).reduce(
        (total, one) => total + one.analysis.executed,
        0,
      );
    };
    const under = sweep();
    killLeader(EXECUTIONER);
    expect(under, 'he never fired, so there is nothing to measure').toBeGreaterThan(0);
    expect(sweep()).toBe(0);
  });

  /**
   * Directive Xero, on the spire.
   *
   * Twelve Razors into the CCS, measured 2026-09-21: nine change sides and nobody is intimidated
   * while he stands, nine are intimidated and nobody crosses once he does not. The same nine men
   * either way, which is the pair of figures the report has to keep straight, and the fight is
   * lost both times, so the assertion is about the toll rather than about the result.
   */
  it('reports turncoats instead of the intimidated only while Directive Xero stands', () => {
    callFight(at('combine-spire-broadcast'), { army: { razors: 12 } });
    const [under] = settleBattles(repos, defaultSkirmishEngine, SETTLE);
    const crossed = Object.values(under?.analysis.turned ?? {}).reduce((n, c) => n + c, 0);
    expect(crossed).toBeGreaterThan(0);
    expect(under?.analysis.attacker.intimidated).toBe(0);

    killLeader(XERO);
    callFight(at('combine-spire-broadcast'), { army: { razors: 12 } });
    const settled = settleBattles(repos, defaultSkirmishEngine, SETTLE);
    const after = settled.at(-1)?.analysis;
    expect(after?.turned).toEqual({});
    expect(after?.attacker.intimidated).toBe(crossed);
  });
});
