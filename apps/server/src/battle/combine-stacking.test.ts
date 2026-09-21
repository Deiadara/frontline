import {
  CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL,
  COMBINE_LEADERS,
  createCommander,
  emptyDeployment,
  findLocation,
  gateDefensePercent,
  skirmishOutcome,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type BattleTarget,
  type CombineLeader,
  type ScheduledBattle,
  type SkirmishEngine,
  type SkirmishInput,
  type SkirmishOutcome,
} from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { settleBattles } from './resolve.js';

/**
 * Which **side** of a Combine fight each stacking source lands on.
 *
 * `packages/shared/src/battle/combine-stacking.test.ts` measures what happens once the engine has
 * two sides. This measures the step before it, which is where the surprise is: the regime is not
 * a crew, so `resolve.ts` has no `defenderBase` to build a defence's book from, and every
 * structure, refit, perk, research rung and faction card in the fight is therefore on the side
 * **attacking** the leader. A player raiding the Annexes brings their Gate to a fight the Gate
 * cannot be read in.
 *
 * Measured off the `SkirmishInput` the settler hands the engine, through a recording engine, so
 * every assertion is about the wiring rather than about who happened to win.
 */

let db: AppDatabase;
let repos: Repositories;

const OWNER = 'owner-stacking';
const ATTACKER = 'base-stacking';
const T0 = new Date('2026-09-20T12:00:00.000Z');
const MARK = new Date('2026-09-21T10:00:00.000Z');
const SETTLE = new Date('2026-09-21T11:00:00.000Z');
const OFFICER = 'officer-stacking';

/** The Lab rung that pays into `unitOffensePercent`: Overwhelming Force, +6%. */
const OFFENSE_TECH = 'tech_overwhelming_force';
const OFFENSE_TECH_PERCENT = 6;
/** ...and the one that only ever pays a crew that raised a Gate: Cold Joints, +12%. */
const GATE_TECH = 'tech_cold_joints';

const GATE_LEVEL = 6;
const INFIRMARY_LEVEL = 5;

const leaderOf = (unitId: string): CombineLeader => {
  const leader = COMBINE_LEADERS.find((one) => one.unitId === unitId);
  if (!leader) throw new Error(`no leader ${unitId}`);
  return leader;
};

const SYNDIC = leaderOf('syndic');
/** A plot of the Syndic's district that is not the one she stands on. */
const ANNEXES_ELSEWHERE = 'datavault-sigma-ward';

/**
 * A crew carrying one of everything this file is about: a Gate, an Infirmary, the two Lab rungs,
 * a card bolted to the Razors and somebody on the books to lead.
 */
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
    research: { ...startingResearch(), technologies: [OFFENSE_TECH, GATE_TECH] },
    buildings: [
      { id: 'nexus-1', kind: 'nexus', level: 8, modifications: [] },
      { id: 'gate-1', kind: 'gate', level: GATE_LEVEL, modifications: [] },
      { id: 'infirmary-1', kind: 'infirmary', level: INFIRMARY_LEVEL, modifications: [] },
    ],
    buildQueue: [],
    army: { razors: 60 },
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: ['composite_carapace'],
    unitLoadouts: { razors: ['composite_carapace'] },
    fleet: {},
    commanders: [createCommander(OFFICER, 'The Warden', 'field_commander')],
    createdAt: now,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'stacking', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
  repos.bases.insert(crew());
  repos.city.controls();
});

afterEach(() => {
  db.close();
});

/** Keeps every input it was handed and answers with a fixed outcome. The defence wins by default. */
function recorder(outcome: Partial<SkirmishOutcome> = {}): SkirmishEngine & {
  inputs: SkirmishInput[];
} {
  const inputs: SkirmishInput[] = [];
  return {
    inputs,
    resolve(input) {
      inputs.push(input);
      return skirmishOutcome({ winner: 'defender', log: [`${input.locationName}`], ...outcome });
    },
  };
}

function at(locationId: string): BattleTarget {
  const location = findLocation(locationId);
  if (!location) throw new Error(`no location ${locationId}`);
  return { kind: 'location', districtId: location.districtId, locationId };
}

function callFight(
  target: BattleTarget,
  options: { army?: Record<string, number>; lead?: boolean } = {},
): ScheduledBattle {
  const id = `battle-stacking-${Math.random().toString(36).slice(2, 8)}`;
  const battle: ScheduledBattle = {
    id,
    target,
    attackerBaseId: ATTACKER,
    defender:
      target.kind === 'location'
        ? (repos.city.control(target.locationId)?.holder ?? { kind: 'unoccupied' })
        : { kind: 'unoccupied' },
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
    army: options.army ?? { razors: 20 },
    ...(options.lead === false ? {} : { officerId: OFFICER }),
  });
  return battle;
}

/** The one input a single settled fight produced. */
function inputFor(target: BattleTarget, outcome: Partial<SkirmishOutcome> = {}): SkirmishInput {
  const engine = recorder(outcome);
  callFight(target);
  settleBattles(repos, engine, SETTLE);
  const [input, ...rest] = engine.inputs;
  if (!input) throw new Error('nothing settled');
  expect(rest, 'one fight, one input').toHaveLength(0);
  return input;
}

describe('the regime brings nothing but its leader', () => {
  /**
   * The whole of the claim, in one input.
   *
   * `resolveOne` builds `defenderTerritory`, `defenderUpgrades`, `defenderCohesionPercent` and
   * `defenderOfficer` only from a `defenderBase`, and `battle.defender.kind === 'government'` has
   * none. So the leader's power is the only thing on the Combine's side of the sheet, and every
   * other stacking source in the fight is the attacker's.
   *
   * Each absence is paired with the attacker's own value for the same field, so this cannot pass
   * on a settler that stopped filling either side in.
   */
  it('hands the engine a presence on the defence and every other book on the attack', () => {
    const input = inputFor(at(ANNEXES_ELSEWHERE));

    expect(input.defenderPresence?.kind).toBe('syndic');
    expect(input.defenderTerritory).toBeUndefined();
    expect(input.defenderUpgrades).toBeUndefined();
    expect(input.defenderCohesionPercent).toBeUndefined();
    expect(input.defenderOfficer).toBeUndefined();

    // ...and the controls, on the side that does have a crew behind it.
    expect(input.attackerTerritory).toBeDefined();
    expect(input.attackerUpgrades).toEqual({ razors: ['composite_carapace'] });
    expect(input.attackerOfficer?.officerId).toBe(OFFICER);
    // One presence field on the whole input, and it is the defence's.
    expect(Object.keys(input).filter((key) => key.endsWith('Presence'))).toEqual([
      'defenderPresence',
    ]);
  });

  /**
   * §5: the research fold and the faction table reach the attack, and only the attack.
   *
   * `standingEffectsFor` is the one door into a fight for a crew's Lab, its cards, its notoriety,
   * its ground and its people, and `resolveOne` calls it for the attacker and for a
   * `defenderBase` that does not exist here. Overwhelming Force is the probe: +6% of offense, on
   * the only fold in the input.
   */
  it("folds the attacker's research into the attack, and has no defence fold to put it in", () => {
    const input = inputFor(at(ANNEXES_ELSEWHERE));
    expect(input.attackerTerritory?.unitOffensePercent).toBeGreaterThanOrEqual(
      OFFENSE_TECH_PERCENT,
    );
    expect(input.defenderTerritory).toBeUndefined();

    // The control: take the rung away and the same channel falls by exactly what it was worth.
    const crewNow = repos.bases.findById(ATTACKER)!;
    repos.bases.updateResearch(ATTACKER, { ...crewNow.research, technologies: [GATE_TECH] });
    const without = inputFor(at('datavault-sigma-coldrow'));
    expect(
      (input.attackerTerritory?.unitOffensePercent ?? 0) -
        (without.attackerTerritory?.unitOffensePercent ?? 0),
    ).toBeCloseTo(OFFENSE_TECH_PERCENT, 6);
  });

  /**
   * §3: the Gate is real, it is folded, and it is folded onto the wrong side of this fight.
   *
   * A level-6 Gate plus Cold Joints is worth `gateDefensePercent` points of `defensePercent`, and
   * `standingEffectsFor` puts them on the attacker's book because that is the crew whose book it
   * is. `battle/effects.ts` reads `defensePercent` only for `side.defending`, so a crew raiding
   * the Annexes carries its whole wall into a fight nothing can read it in. The engine half of
   * that is pinned in the shared file; this is the half that says the number really is there and
   * really is on the attack.
   */
  it('carries the raider’s Gate on the attacking book, where nothing reads it', () => {
    const input = inputFor(at(ANNEXES_ELSEWHERE));
    const wall = gateDefensePercent(repos.bases.findById(ATTACKER)!.buildings);
    expect(wall).toBeGreaterThan(0);
    expect(input.attackerTerritory?.defensePercent).toBeGreaterThanOrEqual(wall);
    expect(input.defenderTerritory).toBeUndefined();
  });
});

/** Every Razor the crew owns, at home and on the road: the denominator both arms below read. */
const ROSTER = 60;
const MARCHED = 20;

/**
 * Sends the force out properly and settles the fight.
 *
 * The roster is debited at the door the way `/battles/deploy` debits it, so what the settle then
 * writes back is the survivors and nothing else. Without the debit the roster grows over a won
 * fight and "how many did we lose" is unanswerable.
 */
function marchAndSettle(engine: ReturnType<typeof recorder>) {
  callFight(at(ANNEXES_ELSEWHERE), { army: { razors: MARCHED } });
  repos.bases.updateArmy(ATTACKER, { razors: ROSTER - MARCHED }, []);
  return settleBattles(repos, engine, SETTLE);
}

/** The whole roster once the survivors are back on the books. */
const homeAgain = (): number => repos.bases.findById(ATTACKER)?.army['razors'] ?? 0;

describe("the Infirmary, on the far side of the Executioner's line", () => {
  /**
   * What he finished is not a casualty the medics get to walk home.
   *
   * `execute` takes its bodies out through `alive`, so on a won attack they arrive in
   * `winnerLosses` like every other dead body, and until 2026-09-21 `applyOutcome` handed that
   * whole list to `recoverCasualties`: an Infirmary at 5 is 20 points, so two of ten came back and
   * the report said all ten had been finished where they stood. Measured over 400 winning attacks
   * on the Blacksite, 129 of 447 winner losses were his, so this was most of what his power was
   * worth on the one side of the ledger it could still be felt on.
   *
   * `applyOutcome` now takes `executedForce` off the list before the medics see it and adds it
   * back after, which is why the fixture carries the force and not only the count: the count alone
   * cannot say which bodies, and a settler reading only the count is the settler this replaced.
   */
  it('leaves the units he finished where he finished them, even on a won attack', () => {
    const engine = recorder({
      winner: 'attacker',
      executed: 10,
      executedForce: { razors: 10 },
      winnerLosses: { razors: 10 },
      killed: { greycoat: 4 },
    });
    const [resolved] = marchAndSettle(engine);
    expect(resolved?.analysis.executed).toBe(10);

    // The ward is real and would otherwise be taking a fifth off this list.
    const recovery = INFIRMARY_LEVEL * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL;
    expect(recovery).toBe(20);
    expect(ROSTER - homeAgain()).toBe(10);
  });

  /**
   * The positive control: the same ward, the same fight, dead he did not finish.
   *
   * Without this the test above passes on a settler whose Infirmary recovers nobody at all, which
   * is a different bug with the same number in it. Ten fell, the Executioner finished none of
   * them, and two come off the ward.
   */
  it('still hands back the dead he had nothing to do with', () => {
    marchAndSettle(
      recorder({
        winner: 'attacker',
        executed: 0,
        executedForce: {},
        winnerLosses: { razors: 10 },
        killed: { greycoat: 4 },
      }),
    );
    const recovery = INFIRMARY_LEVEL * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL;
    expect(ROSTER - homeAgain()).toBe(10 - Math.floor((10 * recovery) / 100));
  });

  /**
   * Half his and half not, so the rule is a split rather than a switch.
   *
   * Four of the ten were finished; the ward works on the other six and brings back one. A settler
   * that exempted the whole list the moment he was anywhere near it would hand back nobody, and a
   * settler that ignored him would hand back two.
   */
  it('recovers from the rest of the list and not from his share of it', () => {
    marchAndSettle(
      recorder({
        winner: 'attacker',
        executed: 4,
        executedForce: { razors: 4 },
        winnerLosses: { razors: 10 },
        killed: { greycoat: 4 },
      }),
    );
    const recovery = INFIRMARY_LEVEL * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL;
    expect(ROSTER - homeAgain()).toBe(10 - Math.floor((6 * recovery) / 100));
  });

  /**
   * The other control, which is the same fight with the ward torn down.
   *
   * Without it the crew's own medicine is all there is, and on a starting crew that is nothing, so
   * all ten stay dead whoever finished them.
   */
  it('keeps all of them when there is no ward to bring them into', () => {
    const crewNow = repos.bases.findById(ATTACKER)!;
    repos.bases.updateBuildings(
      ATTACKER,
      crewNow.buildings.filter((one) => one.kind !== 'infirmary'),
    );
    marchAndSettle(
      recorder({
        winner: 'attacker',
        executed: 10,
        executedForce: { razors: 10 },
        winnerLosses: { razors: 10 },
        killed: { greycoat: 4 },
      }),
    );
    expect(ROSTER - homeAgain()).toBe(10);
  });
});

describe('the trap and the leader never meet', () => {
  /**
   * A trap is spent off a **defender's** deployment row that names a `baseId`, and the regime
   * files none, so no fight the Combine is in springs one. What a trap does reach is the force the
   * engine is then handed (`trap.attacking`), which is why it would have gone off before
   * `applyPresence`, before §D3 and before the Executioner's first reading, had there been one.
   *
   * Pinned as the absence, because the absence is the whole rule: the defending side of a Combine
   * fight has no deployment row for a trap to be named on.
   */
  it('files no defender deployment for the regime, so no trap can be set on its ground', () => {
    const battle = callFight(at(ANNEXES_ELSEWHERE));
    expect(repos.sieges.side(battle.id, 'defender')).toEqual([]);
    // The control: the attacker's row is there, which is what a trap row would look like.
    expect(repos.sieges.side(battle.id, 'attacker')).toHaveLength(1);
    expect(repos.sieges.side(battle.id, 'attacker')[0]?.baseId).toBe(ATTACKER);
  });

  it('still hands the engine the force the settler assembled, trap or no trap', () => {
    const input = inputFor(at(ANNEXES_ELSEWHERE), { winner: 'defender' });
    expect(input.attacking).toEqual({ razors: 20 });
    expect(SYNDIC.districtId).toBe('datavault-sigma');
  });
});
