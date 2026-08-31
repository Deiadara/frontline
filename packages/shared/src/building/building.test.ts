import { describe, expect, it } from 'vitest';
import { infirmaryRecoveryPercent } from './standing.js';
import { recoverCasualties } from '../crew/effects.js';
import { RESOURCE_KEYS, STARTING_RESOURCES, canAfford, type Resources } from '../resources.js';
import { POPULATION_PER_LOCATION, districtPopulationCapacity } from './population.js';
import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  CENTRAL_BUILDING,
  buildingsUnlockedAt,
  describeBuildingRequirement,
  nexusLevelFor,
} from './kinds.js';
import {
  MAX_MODIFICATION_SLOTS,
  MODIFICATIONS,
  MODIFICATIONS_PER_BUILDING,
  MODIFICATION_SLOT_LEVELS,
  findModification,
  modificationSlotsAt,
  modificationsFor,
  nextModificationSlotLevel,
} from './modifications.js';
import {
  buildingLevel,
  isBuildingUnlocked,
  unmetRequirements,
  modificationCapacity,
  nextStructureLevel,
  nexusShortfall,
  structureLevelCap,
  type Building,
} from './state.js';
import { MAX_EFFECT_REDUCTION, districtEffects, localProductionPercent } from './effects.js';
import {
  BUILDING_COST_GROWTH,
  GENERATOR_TIME_DISCOUNT_PER_LEVEL,
  baseBuildSeconds,
  baseBuildingCost,
  buildDiscountFor,
  buildingBuildSeconds,
  buildingCost,
  generatorTimeDiscount,
} from './cost.js';
import {
  BUILD_BOOST_PERCENT,
  BUILD_BOOST_OIL_PER_LEVEL,
  boostedQueue,
  buildBoostActive,
  buildBoostOilCost,
  buildBoostPercent,
} from './boost.js';
import { NEXUS_LADDERS, levelCapForNexus, nexusLevelForUpgrade } from './kinds.js';
import {
  GATE_DEFENSE_PERCENT_PER_LEVEL,
  MAX_GAUNTLET_TRAINING_BONUS,
  MAX_GREENHOUSE_SUPPLIES_DISCOUNT,
  TRAINING_TIME_PER_GAUNTLET_LEVEL,
  gateDefensePercent,
  gateIntelResistancePercent,
  trainingSuppliesReduction,
  trainingTimeReduction,
} from './standing.js';
import { UNIT_CATALOG, findUnit } from '../units/catalog.js';
import { trainingCost, trainingSeconds } from '../units/training.js';
import {
  HOUSING_BASE,
  STORAGE_BASE,
  accrueProduction,
  buildingProduction,
  districtProduction,
  populationCapacity,
  storageCapacity,
  storageCapacityFor,
  type ProductionCarry,
} from './production.js';
import {
  characterXpBonus,
  districtDefense,
  payrollBonusPercent,
  factionXpBonus,
  researchTimeReduction,
} from './standing.js';
import {
  MAX_BUILD_QUEUE,
  applyQueueEntry,
  isUnlockedForQueue,
  nextQueuedLevel,
  projectedBuildings,
  queueCompletesAt,
  queueStartsAt,
  splitDueQueue,
  type BuildQueue,
} from './queue.js';

/**
 * The district (GDD §A1): thirteen structures, a build queue, a power grid and sixty-five
 * modifications.
 *
 * Where a claim can be checked against something other than the constant that produced it, it is:
 * the build-time ladder is asserted in *seconds, minutes and hours* rather than against
 * `BUILDING_TIME_GROWTH`, and the morale drift is asserted to converge rather than to equal one
 * particular exponential. A test that recomputes the source cannot fail when the source is wrong.
 */

const HOUR_MS = 3_600_000;

const build = (kind: (typeof BUILDING_KINDS)[number], level: number): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications: [],
  damage: 0,
  fortification: 0,
});

/** What `POST /overseer` mints. */
const NEW_DISTRICT: Building[] = [build('nexus', 1), build('generator', 1)];

describe('the catalogue (§A1)', () => {
  it('holds the eleven the board still names, each with a spec', () => {
    expect(BUILDING_KINDS).toHaveLength(11);
    expect(new Set(BUILDING_KINDS).size).toBe(11);
    for (const kind of BUILDING_KINDS) {
      const spec = BUILDING_CATALOG[kind];
      expect(spec.name, kind).toBeTruthy();
      expect(spec.shortName.length, kind).toBeLessThanOrEqual(12);
      expect(spec.description, kind).toBeTruthy();
      // The field that stops a dead `output` shipping again: every structure states its mechanic.
      expect(spec.role, kind).toBeTruthy();
    }
  });

  it('gates nothing behind the Nexus but itself, and unlocks the rest as it grows', () => {
    expect(nexusLevelFor(CENTRAL_BUILDING)).toBe(0);
    const gates = BUILDING_KINDS.map(nexusLevelFor);
    for (const gate of gates) {
      expect(gate).toBeGreaterThanOrEqual(0);
      expect(gate).toBeLessThan(BUILDING_MAX_LEVEL);
    }
    // Something is available from the very first Nexus level, or a new district has nothing to do.
    expect(buildingsUnlockedAt(1).length).toBeGreaterThan(0);
    // And the ladder actually spreads out rather than dumping everything at level 1. Six distinct
    // rungs across eleven structures: §B1 pulled the Gate, the Lab and the Gauntlet down the
    // ladder, so the *first* level of several now opens together and the difference between them
    // is in the per-level table above rather than in where they start.
    expect(new Set(gates).size).toBeGreaterThanOrEqual(6);
  });

  it('§A2: the Cistern is gone from the catalogue outright', () => {
    expect(BUILDING_KINDS as readonly string[]).not.toContain('cistern');
    expect(Object.keys(BUILDING_CATALOG)).not.toContain('cistern');
  });

  it('§B4: charges for the Generator mainly in oil', () => {
    const { baseCost } = BUILDING_CATALOG.generator;
    const oil = baseCost.oil ?? 0;
    for (const [key, amount] of Object.entries(baseCost)) {
      if (key === 'oil') continue;
      expect(oil, `oil vs ${key}`).toBeGreaterThan(amount ?? 0);
    }
  });

  it('prices every structure in something, and never in nothing', () => {
    for (const kind of BUILDING_KINDS) {
      const lines = Object.values(BUILDING_CATALOG[kind].baseCost);
      expect(lines.length, kind).toBeGreaterThan(0);
      for (const amount of lines) expect(amount, kind).toBeGreaterThan(0);
    }
  });
});

describe('level caps and unlocks (§A1)', () => {
  it('holds each structure where its own ladder says, and stops the Nexus at the ceiling', () => {
    // §B1: the Greenhouse's ladder wants Nexus 6 for level 9, so a Nexus 5 district stops at 8.
    const district = [build('nexus', 5), build('greenhouse', 8)];
    expect(structureLevelCap('nexus', district)).toBe(BUILDING_MAX_LEVEL);
    expect(structureLevelCap('greenhouse', district)).toBe(8);
    expect(nextStructureLevel('greenhouse', district)).toBeNull();
    expect(nextStructureLevel('nexus', district)).toBe(6);
    // ...and the Gate's ladder is shallower, so the same Nexus carries it four levels further.
    expect(structureLevelCap('gate', district)).toBe(12);
  });

  it('caps everything at zero when no Nexus is standing', () => {
    expect(structureLevelCap('greenhouse', [])).toBe(0);
    expect(nextStructureLevel('greenhouse', [])).toBeNull();
  });

  it('stops the Nexus itself at the ceiling', () => {
    expect(nextStructureLevel('nexus', [build('nexus', BUILDING_MAX_LEVEL)])).toBeNull();
  });

  it('locks a structure until the Nexus reaches its gate, then unlocks it', () => {
    const gate = nexusLevelFor('garage');
    // Everything *except* the Nexus clause satisfied, so this isolates the Nexus rung.
    const rest = (nexus: number) => [
      build('nexus', nexus),
      build('scrapyard', 20),
      build('generator', 20),
    ];
    expect(isBuildingUnlocked('garage', rest(gate - 1), 99)).toBe(false);
    expect(isBuildingUnlocked('garage', rest(gate), 99)).toBe(true);
  });

  /**
   * §A1/§I3: the Grepolis shape: a structure waits on the *district* and on the *crew*.
   *
   * Both halves asserted from a district that satisfies everything else, so each case names one
   * unmet clause and nothing else. Without the isolation a test like this passes for the wrong
   * reason forever the moment any other rung moves.
   */
  it('holds a structure back on another structure, and on the crew’s own level', () => {
    const maxed = BUILDING_KINDS.filter((kind) => kind !== 'garage').map((kind) => build(kind, 20));

    // Everything standing, crew too green: the level clause alone is unmet.
    const green = unmetRequirements('garage', maxed, 1);
    expect(green).toHaveLength(1);
    expect(green[0]).toEqual({ kind: 'player_level', level: 14 });

    // Veteran crew, no Scrapyard: the building clause alone is unmet.
    const noYard = maxed.filter((building) => building.kind !== 'scrapyard');
    const missing = unmetRequirements('garage', noYard, 99);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toEqual({ kind: 'building', building: 'scrapyard', level: 6 });

    // And both at once, which is the case the ladder is built out of.
    expect(unmetRequirements('garage', noYard, 1)).toHaveLength(2);
  });

  it('says every clause in words a player can act on', () => {
    for (const kind of BUILDING_KINDS) {
      for (const clause of BUILDING_CATALOG[kind].requires) {
        const line = describeBuildingRequirement(clause);
        expect(line, kind).toMatch(/\d/);
        expect(line.length, kind).toBeGreaterThan(8);
      }
    }
  });

  /** A ladder where nothing waits on the crew is a ladder with one axis. */
  it('gates some structures on the crew and some only on the district', () => {
    const onCrew = BUILDING_KINDS.filter((kind) =>
      BUILDING_CATALOG[kind].requires.some((clause) => clause.kind === 'player_level'),
    );
    const onOthers = BUILDING_KINDS.filter((kind) =>
      BUILDING_CATALOG[kind].requires.some(
        (clause) => clause.kind === 'building' && clause.building !== CENTRAL_BUILDING,
      ),
    );
    expect(onCrew.length).toBeGreaterThanOrEqual(3);
    expect(onOthers.length).toBeGreaterThanOrEqual(5);
    // And several carry both, which is what "sometimes both" has to mean to be true.
    expect(onCrew.filter((kind) => onOthers.includes(kind)).length).toBeGreaterThanOrEqual(3);
  });
});

describe('what a level costs and how long it takes (§A1, §D3)', () => {
  it('never gets cheaper in any material as it climbs', () => {
    for (const kind of BUILDING_KINDS) {
      for (let level = 2; level <= BUILDING_MAX_LEVEL; level += 1) {
        const lower = baseBuildingCost(kind, level - 1);
        const higher = baseBuildingCost(kind, level);
        for (const key of RESOURCE_KEYS) {
          expect(higher[key] ?? 0, `${kind} ${key} at ${level}`).toBeGreaterThanOrEqual(
            lower[key] ?? 0,
          );
        }
      }
    }
  });

  it('makes the top of the tree a campaign rather than a wall', () => {
    // ~100x from level 1 to level 20: expensive enough to pace, cheap enough to reach.
    const ratio = BUILDING_COST_GROWTH ** (BUILDING_MAX_LEVEL - 1);
    expect(ratio).toBeGreaterThan(50);
    expect(ratio).toBeLessThan(200);
  });

  /**
   * The board asked for seconds at the start, minutes in the middle and hours at the end. Asserted
   * in those units rather than against the growth constant. This is the one claim in the module
   * that a reader can check against the request itself.
   */
  it('runs seconds → minutes → hours across the twenty levels', () => {
    for (const kind of BUILDING_KINDS) {
      expect(baseBuildSeconds(kind, 1), `${kind} L1`).toBeLessThan(90);
      expect(baseBuildSeconds(kind, 1), `${kind} L1`).toBeGreaterThanOrEqual(10);
    }
    const mid = BUILDING_KINDS.map((kind) => baseBuildSeconds(kind, 10));
    for (const seconds of mid) {
      expect(seconds).toBeGreaterThan(3 * 60);
      expect(seconds).toBeLessThan(60 * 60);
    }
    const top = BUILDING_KINDS.map((kind) => baseBuildSeconds(kind, BUILDING_MAX_LEVEL));
    for (const seconds of top) {
      expect(seconds).toBeGreaterThan(2 * 3600);
      expect(seconds).toBeLessThan(24 * 3600);
    }
  });

  it('§B4: discounts every *other* structure as the Generator grows, and never itself', () => {
    const high = [build('nexus', BUILDING_MAX_LEVEL), build('generator', BUILDING_MAX_LEVEL)];
    expect(generatorTimeDiscount('generator', high)).toBe(0);
    expect(generatorTimeDiscount('greenhouse', high)).toBeGreaterThan(0);

    // Materials are untouched: §B4 moved the *clock* and deleted the cost discount outright.
    expect(buildingCost('greenhouse', 1, high).oil).toBe(baseBuildingCost('greenhouse', 1).oil);
    expect(buildingBuildSeconds('greenhouse', 1, high)).toBeLessThan(
      baseBuildSeconds('greenhouse', 1),
    );
  });

  it('never lets a discount make a material free or a build instant', () => {
    const stacked = [
      { ...build('nexus', BUILDING_MAX_LEVEL) },
      { ...build('lab', 20), modifications: ['lab_process_cell'] },
      { ...build('garage', 20), modifications: ['garage_machine_shop'] },
      { ...build('quarters', 20), modifications: ['quarters_prefab_stacks'] },
    ];
    const cost = buildingCost('greenhouse', 1, stacked);
    for (const key of Object.keys(baseBuildingCost('greenhouse', 1))) {
      expect(cost[key as keyof Resources], key).toBeGreaterThanOrEqual(1);
    }
    expect(buildingBuildSeconds('greenhouse', 1, stacked)).toBeGreaterThanOrEqual(1);
    expect(buildDiscountFor('greenhouse', stacked).timePercent).toBeLessThanOrEqual(
      MAX_EFFECT_REDUCTION,
    );
  });

  it('leaves a new district able to afford its first few plots', () => {
    const affordable = BUILDING_KINDS.filter(
      (kind) =>
        isBuildingUnlocked(kind, NEW_DISTRICT, 1) &&
        canAfford(STARTING_RESOURCES, buildingCost(kind, 1, NEW_DISTRICT)),
    );
    // Not a formality: this is the whole opening. A starting stockpile that covers nothing is a
    // dead first session, and one that covers everything is no decision at all.
    expect(affordable.length).toBeGreaterThanOrEqual(2);
  });
});

describe('§B1: the Nexus permission table', () => {
  it('asks a Nexus level of every upgrade, per building and per level', () => {
    for (const kind of BUILDING_KINDS) {
      if (kind === CENTRAL_BUILDING) continue;
      const rungs = Array.from({ length: BUILDING_MAX_LEVEL }, (_, index) =>
        nexusLevelForUpgrade(kind, index + 1),
      );
      // Never steps down: a level being legal while the one below it is not is unplayable.
      for (let i = 1; i < rungs.length; i += 1) {
        expect(rungs[i], `${kind} level ${i + 1}`).toBeGreaterThanOrEqual(rungs[i - 1] as number);
      }
      // And it actually climbs: a flat ladder is the rule the table replaced.
      expect(rungs.at(-1), kind).toBeGreaterThan(rungs[0] as number);
    }
  });

  it('is asymmetric: the Gate and the Lab do not want the same Nexus at the same level', () => {
    expect(nexusLevelForUpgrade('gate', 5)).toBe(2);
    expect(nexusLevelForUpgrade('lab', 5)).toBe(4);
    // The board's own example, and the general claim behind it: some pair of structures disagrees
    // at every level worth reaching.
    const disagreements = Array.from({ length: BUILDING_MAX_LEVEL }, (_, index) => {
      const level = index + 1;
      const wanted = BUILDING_KINDS.filter((kind) => kind !== CENTRAL_BUILDING).map((kind) =>
        nexusLevelForUpgrade(kind, level),
      );
      return new Set(wanted).size;
    });
    expect(Math.min(...disagreements)).toBeGreaterThan(1);
  });

  it('caps a structure where its own ladder says, not where the Nexus stands', () => {
    const nexusAt = (level: number): Building[] => [build(CENTRAL_BUILDING, level)];
    // The old rule was `cap === nexus level` for everything. It no longer holds for anything.
    expect(structureLevelCap('gate', nexusAt(2))).toBeGreaterThan(2);
    expect(structureLevelCap('lab', nexusAt(2))).toBe(0);
    expect(levelCapForNexus('gate', BUILDING_MAX_LEVEL)).toBe(BUILDING_MAX_LEVEL);
    // The Nexus answers to nobody.
    expect(NEXUS_LADDERS[CENTRAL_BUILDING]).toHaveLength(0);
    expect(structureLevelCap(CENTRAL_BUILDING, nexusAt(1))).toBe(BUILDING_MAX_LEVEL);
  });

  it('says which Nexus level a refused upgrade wants, before anything is spent', () => {
    const district = [build(CENTRAL_BUILDING, 2), build('lab', 4)];
    const short = nexusShortfall('lab', district);
    expect(short).not.toBeNull();
    expect(short?.needed).toBe(nexusLevelForUpgrade('lab', 5));
    expect(short?.at).toBe(2);
    // ...and says nothing when the Nexus is not what is in the way.
    expect(nexusShortfall('gate', [build(CENTRAL_BUILDING, 20), build('gate', 1)])).toBeNull();
  });
});

describe('§B4: the Generator pays for the clock', () => {
  it('takes time off every other structure and nothing off its own', () => {
    const strong = [build(CENTRAL_BUILDING, 10), build('generator', 10)];
    expect(generatorTimeDiscount('lab', strong)).toBe(10 * GENERATOR_TIME_DISCOUNT_PER_LEVEL);
    expect(generatorTimeDiscount('generator', strong)).toBe(0);
    expect(buildingBuildSeconds('lab', 3, strong)).toBeLessThan(baseBuildSeconds('lab', 3));
  });

  it('takes nothing off materials any more: the Nexus discount is gone, not moved', () => {
    const bare = [build(CENTRAL_BUILDING, 1)];
    const grand = [
      build(CENTRAL_BUILDING, BUILDING_MAX_LEVEL),
      build('generator', BUILDING_MAX_LEVEL),
    ];
    expect(buildDiscountFor('lab', grand).costPercent).toBe(0);
    expect(buildingCost('lab', 4, grand)).toEqual(buildingCost('lab', 4, bare));
    // ...and the Nexus no longer buys a second of anybody's clock on its own.
    const nexusOnly = [build(CENTRAL_BUILDING, BUILDING_MAX_LEVEL)];
    expect(buildDiscountFor('lab', nexusOnly).timePercent).toBe(0);
  });

  it('prices the burn off the Generator that sells it, and refuses to stack', () => {
    expect(buildBoostOilCost([build('generator', 4)])).toBe(4 * BUILD_BOOST_OIL_PER_LEVEL);
    expect(buildBoostOilCost([])).toBe(0);

    const now = new Date('2026-01-01T00:00:00.000Z');
    const running = new Date(now.getTime() + 3_600_000).toISOString();
    expect(buildBoostActive(running, now)).toBe(true);
    expect(buildBoostActive(new Date(now.getTime() - 1).toISOString(), now)).toBe(false);
    expect(buildBoostActive(null, now)).toBe(false);
    expect(buildBoostPercent(running, now)).toBe(BUILD_BOOST_PERCENT);
    expect(buildBoostPercent(null, now)).toBe(0);
  });

  it('reaches work already in the queue, keeping the head order’s own progress', () => {
    const now = new Date('2026-01-01T01:00:00.000Z');
    const queue = [
      {
        id: 'a',
        kind: 'lab' as const,
        level: 3,
        startedAt: new Date(now.getTime() - 1000 * 1000).toISOString(),
        durationSeconds: 2000,
      },
      {
        id: 'b',
        kind: 'gate' as const,
        level: 2,
        startedAt: new Date(now.getTime() + 1000 * 1000).toISOString(),
        durationSeconds: 800,
      },
    ];
    const boosted = boostedQueue(queue, now, BUILD_BOOST_PERCENT);
    // The head has 1000s served and 1000s left; a quarter comes off the part not yet worked.
    expect(boosted[0]?.durationSeconds).toBe(1750);
    expect(boosted[0]?.startedAt).toBe(queue[0]?.startedAt);
    // Everything behind it has not started, so its whole clock shrinks and it re-links.
    expect(boosted[1]?.durationSeconds).toBe(600);
    expect(Date.parse(boosted[1]?.startedAt ?? '')).toBe(
      Date.parse(boosted[0]?.startedAt ?? '') + 1750 * 1000,
    );
    // And a queue with no burn on it is handed straight back.
    expect(boostedQueue(queue, now, 0)).toBe(queue);
  });
});

describe('what the district makes (§A1)', () => {
  it('produces nothing from a district that has nothing to produce with', () => {
    for (const kind of BUILDING_KINDS) {
      expect(buildingProduction(kind, []), kind).toEqual({});
    }
  });

  it('§B5: grows more supplies the higher the Greenhouse goes', () => {
    const small = buildingProduction('greenhouse', [build('greenhouse', 5)]);
    const large = buildingProduction('greenhouse', [build('greenhouse', 10)]);
    expect(large.supplies ?? 0).toBeGreaterThan(small.supplies ?? 0);
    // §A2: a maxed Greenhouse must not be poorer than it was when the Cistern fed it. The old
    // pairing was 12/level x (1 + 3% x 20), which is the figure this has to clear.
    const maxed = buildingProduction('greenhouse', [build('greenhouse', BUILDING_MAX_LEVEL)]);
    expect(maxed.supplies ?? 0).toBeGreaterThanOrEqual(12 * BUILDING_MAX_LEVEL * 1.6);
  });

  it('applies a structure’s own production modifications to itself and to nothing else', () => {
    const boosted: Building[] = [
      { ...build('greenhouse', 5), modifications: ['greenhouse_insect_farm'] },
      build('scrapyard', 5),
    ];
    const plain = [build('greenhouse', 5), build('scrapyard', 5)];

    expect(buildingProduction('greenhouse', boosted).supplies ?? 0).toBeGreaterThan(
      buildingProduction('greenhouse', plain).supplies ?? 0,
    );
    expect(buildingProduction('scrapyard', boosted)).toEqual(
      buildingProduction('scrapyard', plain),
    );
    expect(localProductionPercent(boosted[0])).toBeGreaterThan(0);
    expect(localProductionPercent(boosted[1])).toBe(0);
  });

  it('§A1: nothing burns oil to keep the lights on any more', () => {
    // A district with a Generator and no salvage line used to be running an oil deficit from its
    // first second. It produces nothing at all now, which is what "the grid is gone" has to mean.
    expect(districtProduction(NEW_DISTRICT).perHour.oil ?? 0).toBe(0);

    const withSource = districtProduction([...NEW_DISTRICT, build('scrapyard', 1)]);
    expect(withSource.perHour.oil ?? 0).toBeGreaterThan(0);
  });

  it('accrues over elapsed hours and banks whole units, carrying the rest', () => {
    const district = [build('nexus', 1), build('generator', 1), build('greenhouse', 1)];
    const stock: Resources = { ...STARTING_RESOURCES, supplies: 0 };
    const oneHour = accrueProduction(stock, district, 1);
    const halfHour = accrueProduction(stock, district, 0.5);

    expect(oneHour.resources.supplies).toBeGreaterThan(0);
    expect(Number.isInteger(oneHour.resources.supplies)).toBe(true);
    expect(Number.isInteger(halfHour.resources.supplies)).toBe(true);

    // Two half-hours must equal one hour, or a player is paid for how often they refresh. What
    // makes that true with an integral stockpile is the carry, so the comparison is of the *sum*.
    const twice = accrueProduction(halfHour.resources, district, 0.5, undefined, halfHour.carry);
    const held = (accrual: ReturnType<typeof accrueProduction>): number =>
      accrual.resources.supplies + (accrual.carry.supplies ?? 0);
    expect(held(twice)).toBeCloseTo(held(oneHour), 6);
  });

  it('pays out a rate below one an hour instead of rounding it to nothing', () => {
    // The Scrapyard makes a quarter of a high-quality metal per level-hour. Settled a minute at a
    // time, an accrual that rounded each step would pay zero for ever, which is exactly the bug a
    // whole-number stockpile invites. Eight hours drip-fed must bank what eight hours pays.
    const district = [build('nexus', 1), build('generator', 2), build('scrapyard', 1)];
    const stock: Resources = { ...STARTING_RESOURCES, highQualityMetal: 0 };
    const HOURS = 8;

    const oneShot = accrueProduction(stock, district, HOURS);

    let held = stock;
    let carry: ProductionCarry = {};
    for (let minute = 0; minute < 60 * HOURS; minute++) {
      const accrual = accrueProduction(held, district, 1 / 60, undefined, carry);
      held = accrual.resources;
      carry = accrual.carry;
      expect(Number.isInteger(held.highQualityMetal)).toBe(true);
    }

    // Banked, not merely owed: a carry that never turned into a unit would be the same bug wearing
    // a different hat.
    expect(held.highQualityMetal).toBeGreaterThanOrEqual(1);
    expect(held.highQualityMetal + (carry.highQualityMetal ?? 0)).toBeCloseTo(
      oneShot.resources.highQualityMetal + (oneShot.carry.highQualityMetal ?? 0),
      6,
    );
  });

  it('does not bank a whole unit for a fraction of one made', () => {
    // A level-1 Scrapyard makes a little over one high-quality metal an hour, so a settle covering
    // half a minute makes about a hundredth of one. Rounding that up is a printing press and
    // rounding it to zero means a client that polls fast earns nothing at all.
    const district = [build('nexus', 1), build('scrapyard', 1)];
    const stock: Resources = { ...STARTING_RESOURCES };
    const halfAMinute = 30 / 3600;

    const { perHour } = districtProduction(district);
    /*
     * The premise is that **the window** makes a fraction, not that the hourly rate is one.
     *
     * This used to assert `perHour < 1`, which was a proxy for the same thing and stopped being
     * true the moment the Scrapyard absorbed the Garage's output (§B11): the rate went to 1.25 and
     * the test failed while the behaviour it guards was untouched. Asserting the amount actually
     * made in the window says what the test is about and survives a retune of the rate.
     */
    const madeInWindow = (perHour.highQualityMetal ?? 0) * halfAMinute;
    expect(
      madeInWindow,
      'this test is meaningless unless the window makes a fraction of something',
    ).toBeGreaterThan(0);
    expect(madeInWindow).toBeLessThan(1);

    const accrual = accrueProduction(stock, district, halfAMinute);
    expect(accrual.resources.highQualityMetal).toBe(stock.highQualityMetal);
    expect(accrual.carry.highQualityMetal ?? 0).toBeGreaterThan(0);

    // And the unit does arrive, once a whole one has actually been made.
    const hours = 1 / (perHour.highQualityMetal ?? 1);
    const later = accrueProduction(stock, district, hours * 1.01);
    expect(later.resources.highQualityMetal).toBe(stock.highQualityMetal + 1);
  });

  /**
   * The other half of the same arithmetic, which nothing in the game currently drives.
   *
   * The Generator's fuel burn used to be the only negative rate, and it is gone with the grid
   * (§A1). `accrueProduction` still trunc-rounds towards zero on purpose, because a debt carried
   * into a settle must not move the stockpile until a whole unit is owed, and a rule with no
   * caller is a rule that silently rots. Driven through the carry, which is the input that can
   * still be negative on a save written before the grid came out.
   */
  it('leaves a stockpile alone while a carried debt is under a whole unit', () => {
    const district = [build('nexus', 1)];
    const stock: Resources = { ...STARTING_RESOURCES };
    const owing = accrueProduction(stock, district, 1, undefined, { oil: -0.4 });
    expect(owing.resources.oil).toBe(stock.oil);
    expect(owing.carry.oil).toBe(-0.4);

    const settled = accrueProduction(stock, district, 1, undefined, { oil: -1.4 });
    expect(settled.resources.oil).toBe(stock.oil - 1);
    expect(settled.carry.oil).toBeCloseTo(-0.4, 10);
  });

  it('stops production at the Apothecary’s ceiling without clawing anything back', () => {
    const district = [build('nexus', 1), build('generator', 1), build('greenhouse', 20)];
    const ceiling = storageCapacity(district);

    const full: Resources = { ...STARTING_RESOURCES, supplies: ceiling };
    expect(accrueProduction(full, district, 100).resources.supplies).toBe(ceiling);

    // Raid loot can put a stock over the ceiling. Production adds nothing, but takes nothing.
    const overflowing: Resources = { ...STARTING_RESOURCES, supplies: ceiling * 2 };
    expect(accrueProduction(overflowing, district, 100).resources.supplies).toBe(ceiling * 2);
  });

  it('never hands a settle a fractional stockpile, however the window is cut', () => {
    const district = [
      build('nexus', 2),
      build('generator', 2),
      build('greenhouse', 3),
      build('scrapyard', 2),
    ];
    let held: Resources = { ...STARTING_RESOURCES };
    let carry: ProductionCarry = {};
    // Deliberately awkward windows: a whole hour is the easy case and the one that never broke.
    for (const hours of [0.37, 1.9, 0.004, 11.11, 0.5, 2.718]) {
      const accrual = accrueProduction(held, district, hours, undefined, carry);
      held = accrual.resources;
      carry = accrual.carry;
      for (const amount of Object.values(held)) {
        expect(Number.isInteger(amount)).toBe(true);
      }
      // And the carry never becomes a second stockpile: it is a part-unit, under one either way.
      for (const owed of Object.values(carry)) {
        // `?? 0` because the carry is sparse: a key that is absent owes nothing, which is the
        // same statement this makes about a key that is present and small.
        expect(Math.abs(owed ?? 0)).toBeLessThan(1);
      }
    }
  });

  it('raises the ceiling with the Apothecary and with its modifications', () => {
    expect(storageCapacity([])).toBe(STORAGE_BASE);
    expect(storageCapacity([build('apothecary', 10)])).toBeGreaterThan(STORAGE_BASE);
    const modded: Building[] = [
      { ...build('apothecary', 10), modifications: ['apothecary_deep_racking'] },
    ];
    expect(storageCapacity(modded)).toBeGreaterThan(storageCapacity([build('apothecary', 10)]));
  });

  /**
   * Three shelves, in a fixed ratio, at every level of the building that sets them.
   *
   * The ratio is the promise: raising the Apothecary must widen all three together rather than
   * changing which one is the binding constraint, or a player who upgraded to fix a scrap problem
   * would find their metal store had quietly become the new one.
   */
  it('holds bulk, then what it burns, then the scarce metal, in that order at every level', () => {
    for (const level of [0, 1, 7, 14, BUILDING_MAX_LEVEL]) {
      const district = level === 0 ? [] : [build('apothecary', level)];
      const bulk = storageCapacityFor(district, 'scrap');
      const burned = storageCapacityFor(district, 'oil');
      const scarce = storageCapacityFor(district, 'highQualityMetal');

      expect(bulk, `level ${level}`).toBe(storageCapacity(district));
      expect(storageCapacityFor(district, 'planks')).toBe(bulk);
      expect(storageCapacityFor(district, 'supplies')).toBe(burned);

      expect(burned / bulk).toBeCloseTo(2 / 3, 2);
      expect(scarce / bulk).toBeCloseTo(1 / 3, 2);
    }
  });

  /**
   * Caps are money, and money does not fill up.
   *
   * `Infinity` rather than a large number on purpose: a ceiling of 10^9 is still a ceiling, and the
   * player who finds it is the one who has been playing longest.
   */
  it('gives caps no ceiling at all, at any level', () => {
    for (const level of [0, 1, BUILDING_MAX_LEVEL]) {
      const district = level === 0 ? [] : [build('apothecary', level)];
      expect(storageCapacityFor(district, 'caps')).toBe(Number.POSITIVE_INFINITY);
    }
  });

  /** And production never clamps them, which is the half that would actually lose a player caps. */
  it('never clamps a caps stockpile back to a ceiling', () => {
    const district = [build('apothecary', 1), build('nexus', 1)];
    const over = { ...STARTING_RESOURCES, caps: 10_000_000 };
    const { resources } = accrueProduction(over, district, 24);
    expect(resources.caps).toBe(over.caps);
  });

  it('houses the founding crew with no Quarters, and more with them', () => {
    expect(populationCapacity([])).toBe(HOUSING_BASE);
    expect(populationCapacity([build('quarters', 5)])).toBeGreaterThan(HOUSING_BASE);
    expect(populationCapacity([build('quarters', 10)])).toBeGreaterThan(
      populationCapacity([build('quarters', 5)]),
    );
  });

  /**
   * §A2/§B2: the Cistern's housing lands on the Quarters, and the ceiling does not drop.
   *
   * Anchored on the arithmetic the Cistern used to do rather than on today's constant: the pair
   * was `HOUSING_BASE + 5 x L(L+1)/2` beds times `1 + 3% x 20`, so a finished district had 1696.
   * A test written against `HOUSING_PER_QUARTERS_LEVEL` would agree with whatever the constant is
   * set to and could not catch the ceiling being quietly halved.
   */
  it('§B2: the Quarters absorbs what the Cistern used to house', () => {
    // Literals, not today's constants: the anchor is what the pair *used to* give, which is
    // `(16 + 5 x L(L+1)/2) x (1 + 3% x 20)`. Reading either figure off the module under test
    // would make this agree with whatever it is set to.
    const before = Math.floor((16 + 5 * ((20 * 21) / 2)) * 1.6);
    expect(populationCapacity([build('quarters', BUILDING_MAX_LEVEL)])).toBeGreaterThanOrEqual(
      before,
    );
  });
});

describe('what the district is worth to the crew (§A1)', () => {
  it('carries more of a payroll book with Quarters standing', () => {
    expect(payrollBonusPercent(NEW_DISTRICT.filter((b) => b.kind !== 'quarters'))).toBe(0);
    const bare = payrollBonusPercent([build('quarters', 1)]);
    expect(bare).toBeGreaterThan(0);
    expect(payrollBonusPercent([build('quarters', 10)])).toBeGreaterThan(bare);
  });

  it('pays allegiance XP only for the modifications that grant it', () => {
    expect(factionXpBonus([build('quarters', 20)])).toBe(0);
    const kitted: Building[] = [
      { ...build('quarters', 20), modifications: ['quarters_debriefing_room'] },
    ];
    expect(factionXpBonus(kitted)).toBeGreaterThan(0);
  });

  it('makes the district harder to take with a Gate', () => {
    expect(districtDefense([])).toBe(0);
    expect(districtDefense([build('gate', 5)])).toBeGreaterThan(0);
    const fortified: Building[] = [
      { ...build('gate', 5), modifications: ['gate_interlocking_bulwarks'] },
    ];
    expect(districtDefense(fortified)).toBeGreaterThan(districtDefense([build('gate', 5)]));
  });

  it('gives the Lab and the Gauntlet each their own live effect', () => {
    expect(researchTimeReduction([])).toBe(0);
    expect(researchTimeReduction([build('lab', 10)])).toBeGreaterThan(0);
    expect(characterXpBonus([])).toBe(0);
    expect(characterXpBonus([build('gauntlet', 10)])).toBeGreaterThan(0);
  });

  it('caps every reduction, however many modifications are stacked on it', () => {
    const stacked: Building[] = [
      {
        ...build('lab', 20),
        modifications: ['lab_quantum_modeling', 'lab_redundant_testing_chambers'],
      },
      { ...build('gauntlet', 20), modifications: ['gauntlet_salvaged_simulators'] },
    ];
    expect(researchTimeReduction(stacked)).toBeLessThanOrEqual(MAX_EFFECT_REDUCTION);
    const effects = districtEffects(stacked);
    expect(effects.research_time_reduction).toBeLessThanOrEqual(MAX_EFFECT_REDUCTION);
  });
});

describe('modifications (§A1)', () => {
  it('offers five per structure, sixty-five in all, with unique ids', () => {
    expect(MODIFICATIONS).toHaveLength(BUILDING_KINDS.length * MODIFICATIONS_PER_BUILDING);
    expect(new Set(MODIFICATIONS.map((mod) => mod.id)).size).toBe(MODIFICATIONS.length);
    for (const kind of BUILDING_KINDS) {
      expect(modificationsFor(kind), kind).toHaveLength(MODIFICATIONS_PER_BUILDING);
    }
  });

  it('gives every one a positive magnitude and a description of its own', () => {
    const descriptions = new Set<string>();
    for (const mod of MODIFICATIONS) {
      expect(mod.magnitude, mod.id).toBeGreaterThan(0);
      expect(mod.description.length, mod.id).toBeGreaterThan(20);
      descriptions.add(mod.description);
    }
    expect(descriptions.size).toBe(MODIFICATIONS.length);
  });

  it('only puts a production bonus on a structure that produces something', () => {
    const producers = new Set(['greenhouse', 'scrapyard', 'garage']);
    for (const mod of MODIFICATIONS.filter((m) => m.effect === 'production_percent')) {
      expect(producers.has(mod.building), `${mod.id} boosts a structure that makes nothing`).toBe(
        true,
      );
    }
  });

  it('opens slots at 5, 10 and 20, and never more than three', () => {
    expect(MODIFICATION_SLOT_LEVELS).toEqual([5, 10, 20]);
    expect(modificationSlotsAt(4)).toBe(0);
    expect(modificationSlotsAt(5)).toBe(1);
    expect(modificationSlotsAt(10)).toBe(2);
    expect(modificationSlotsAt(BUILDING_MAX_LEVEL)).toBe(MAX_MODIFICATION_SLOTS);
    expect(nextModificationSlotLevel(1)).toBe(5);
    expect(nextModificationSlotLevel(BUILDING_MAX_LEVEL)).toBeNull();
  });

  it('reports free slots against what is already fitted', () => {
    const lab: Building = { ...build('lab', 10), modifications: ['lab_quantum_modeling'] };
    expect(modificationCapacity(lab)).toEqual({ slots: 2, used: 1, free: 1 });
    expect(modificationCapacity(undefined)).toEqual({ slots: 0, used: 0, free: 0 });
  });

  it('ignores an id the catalogue no longer knows rather than throwing on a read path', () => {
    const ghost: Building[] = [{ ...build('lab', 20), modifications: ['lab_retired_thing'] }];
    expect(findModification('lab_retired_thing')).toBeUndefined();
    expect(() => districtEffects(ghost)).not.toThrow();
    expect(districtEffects(ghost).research_time_reduction).toBe(0);
  });

  it('sums district-wide effects and keeps the local one out of them', () => {
    const district: Building[] = [
      { ...build('quarters', 20), modifications: ['quarters_debriefing_room'] },
      { ...build('greenhouse', 20), modifications: ['greenhouse_insect_farm'] },
    ];
    const effects = districtEffects(district);
    expect(effects.faction_xp_percent).toBeGreaterThan(0);
    // `production_percent` is local, so it must not appear in the district totals.
    expect(effects.production_percent).toBe(0);
  });
});

describe('the build queue (§A1)', () => {
  const NOW = new Date('2026-08-14T12:00:00.000Z');

  const entry = (
    kind: (typeof BUILDING_KINDS)[number],
    level: number,
    startedAt: Date,
    seconds: number,
  ) => ({
    id: `q-${kind}-${level}`,
    kind,
    level,
    startedAt: startedAt.toISOString(),
    durationSeconds: seconds,
  });

  it('holds six orders', () => {
    expect(MAX_BUILD_QUEUE).toBe(6);
  });

  it('starts an order now when the queue is empty, and behind the last one when it is not', () => {
    expect(queueStartsAt([], NOW)).toEqual(NOW);

    const running = [entry('quarters', 1, NOW, 60)];
    expect(queueStartsAt(running, NOW)).toEqual(queueCompletesAt(running[0]!));
    // A queue whose last entry is already finished starts the next one immediately.
    const done = [entry('quarters', 1, new Date(NOW.getTime() - HOUR_MS), 60)];
    expect(queueStartsAt(done, NOW)).toEqual(NOW);
  });

  it('projects what the district will be once the queue drains', () => {
    const queue: BuildQueue = [entry('nexus', 2, NOW, 60), entry('greenhouse', 1, NOW, 60)];
    const projected = projectedBuildings(NEW_DISTRICT, queue);
    expect(buildingLevel(projected, 'nexus')).toBe(2);
    expect(buildingLevel(projected, 'greenhouse')).toBe(1);
    // The standing district is untouched.
    expect(buildingLevel(NEW_DISTRICT, 'greenhouse')).toBe(0);
  });

  it('lets a player queue the Nexus and the thing it unlocks in the same breath', () => {
    const gate = nexusLevelFor('gate');
    // The Gate also waits on the Scrapyard, so the district here has one standing: the clause
    // under test is the Nexus one, and leaving the other unmet would prove nothing about it.
    const yard = [...NEW_DISTRICT, build('scrapyard', 3)];
    expect(isUnlockedForQueue('gate', yard, [], 99)).toBe(false);
    const queue: BuildQueue = [entry('nexus', gate, NOW, 60)];
    expect(isUnlockedForQueue('gate', yard, queue, 99)).toBe(true);
  });

  it('stacks repeat orders for the same plot', () => {
    expect(nextQueuedLevel('nexus', NEW_DISTRICT, [])).toBe(2);
    const queue: BuildQueue = [entry('nexus', 2, NOW, 60)];
    expect(nextQueuedLevel('nexus', NEW_DISTRICT, queue)).toBe(3);
  });

  it('refuses to queue past the ceiling, standing or projected', () => {
    const maxed = [build('nexus', BUILDING_MAX_LEVEL)];
    expect(nextQueuedLevel('nexus', maxed, [])).toBeNull();
    // §B1: the Greenhouse's ladder wants Nexus 3 for level 5, and `NEW_DISTRICT` has a Nexus 1,
    // so four levels are available and the fifth is not: the projection is what it is measured on.
    expect(nextQueuedLevel('greenhouse', NEW_DISTRICT, [])).toBe(1);
    expect(
      nextQueuedLevel('greenhouse', NEW_DISTRICT, [entry('greenhouse', 4, NOW, 60)]),
    ).toBeNull();
  });

  it('splits the queue at the first order that is not finished, in order', () => {
    const past = new Date(NOW.getTime() - HOUR_MS);
    const queue: BuildQueue = [
      entry('quarters', 1, past, 60),
      entry('greenhouse', 1, past, 120),
      entry('nexus', 2, NOW, 600),
    ];
    const { due, pending } = splitDueQueue(queue, NOW);
    expect(due.map((e) => e.kind)).toEqual(['quarters', 'greenhouse']);
    expect(pending.map((e) => e.kind)).toEqual(['nexus']);
  });

  it('never treats a later order as done while an earlier one is still running', () => {
    const queue: BuildQueue = [
      entry('nexus', 2, NOW, 3600),
      // Deliberately already "finished" by its own clock: the queue is sequential, so it is not.
      entry('quarters', 1, new Date(NOW.getTime() - HOUR_MS), 60),
    ];
    expect(splitDueQueue(queue, NOW).due).toHaveLength(0);
  });

  it('applies a finished order as a new plot or as a level on an old one', () => {
    const laid = applyQueueEntry(NEW_DISTRICT, entry('greenhouse', 1, NOW, 60));
    expect(buildingLevel(laid, 'greenhouse')).toBe(1);
    expect(laid).toHaveLength(NEW_DISTRICT.length + 1);

    const raised = applyQueueEntry(laid, entry('greenhouse', 2, NOW, 60));
    expect(buildingLevel(raised, 'greenhouse')).toBe(2);
    expect(raised).toHaveLength(laid.length);
  });

  it('keeps a structure’s modifications when a later level lands on it', () => {
    const fitted: Building[] = [{ ...build('lab', 10), modifications: ['lab_quantum_modeling'] }];
    const raised = applyQueueEntry(fitted, entry('lab', 11, NOW, 60));
    expect(raised[0]?.modifications).toEqual(['lab_quantum_modeling']);
  });
});

/**
 * §A1: what a finished district can house.
 *
 * The board's number is **about two thousand** for a district that is fully built and holding
 * ground, and it was 345. Pinned here rather than left to the constants, because the figure is the
 * board's and the constants are two multiplications away from it: `HOUSING_PER_QUARTERS_LEVEL` is
 * triangular and the ground adds a flat rate per location. A change to either that quietly halves
 * the ceiling should fail here by name.
 */
describe('§B5, §B6, §B7: what the Greenhouse, the Gauntlet and the Gate are worth', () => {
  it('§B5: takes supplies off a training bill and leaves every other line alone', () => {
    expect(trainingSuppliesReduction([])).toBe(0);
    const small = trainingSuppliesReduction([build('greenhouse', 5)]);
    const large = trainingSuppliesReduction([build('greenhouse', 12)]);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    // Capped, so a maxed Greenhouse is not most of a unit's rations.
    expect(trainingSuppliesReduction([build('greenhouse', BUILDING_MAX_LEVEL)])).toBe(
      MAX_GREENHOUSE_SUPPLIES_DISCOUNT,
    );

    // And the discount reaches the supplies line and nothing else.
    const razors = findUnit('razors');
    expect(razors).toBeDefined();
    if (!razors) return;
    const plain = trainingCost(razors, 4);
    const fed = trainingCost(razors, 4, 0, MAX_GREENHOUSE_SUPPLIES_DISCOUNT);
    expect(fed.supplies ?? 0).toBeLessThan(plain.supplies ?? 0);
    for (const key of RESOURCE_KEYS) {
      if (key === 'supplies') continue;
      expect(fed[key], key).toBe(plain[key]);
    }
  });

  it('§B6: takes training time off every unit, including the ones it cannot train', () => {
    expect(trainingTimeReduction([])).toBe(0);
    const mid = trainingTimeReduction([build('gauntlet', 8)]);
    expect(mid).toBe(8 * TRAINING_TIME_PER_GAUNTLET_LEVEL);
    expect(trainingTimeReduction([build('gauntlet', BUILDING_MAX_LEVEL)])).toBe(
      MAX_GAUNTLET_TRAINING_BONUS,
    );

    // "Every unit" is the load-bearing half: the Cyber Dogs are made in the Infirmary and the
    // Colossus in the Garage, and both come off the same clock.
    const elsewhere = UNIT_CATALOG.filter((unit) => unit.trainedAt !== 'gauntlet');
    expect(elsewhere.length).toBeGreaterThan(0);
    for (const unit of elsewhere) {
      expect(trainingSeconds(unit, 1, mid), unit.id).toBeLessThan(trainingSeconds(unit, 1, 0));
    }
  });

  it('§B7: raises defence and cover with the Gate, and both fall when it is wrecked', () => {
    expect(gateDefensePercent([])).toBe(0);
    expect(gateIntelResistancePercent([])).toBe(0);

    const low = [build('gate', 4)];
    const high = [build('gate', 12)];
    expect(gateDefensePercent(high)).toBeGreaterThan(gateDefensePercent(low));
    expect(gateIntelResistancePercent(high)).toBeGreaterThan(gateIntelResistancePercent(low));
    expect(gateDefensePercent(high)).toBe(12 * GATE_DEFENSE_PERCENT_PER_LEVEL);

    // A breached Gate is worth less on both counts until it is put right (§A4).
    const wrecked: Building[] = [{ ...build('gate', 12), damage: 100 }];
    expect(gateDefensePercent(wrecked)).toBeLessThan(gateDefensePercent(high));
    expect(gateIntelResistancePercent(wrecked)).toBeLessThan(gateIntelResistancePercent(high));
  });
});

describe('§A1: the population ceiling', () => {
  const finished: Building[] = BUILDING_KINDS.map((kind) => build(kind, BUILDING_MAX_LEVEL));

  it('houses about two thousand once the district is built and holding ground', () => {
    // Fifteen locations, which is a crew with a real grip on the map rather than a maximal one.
    const held = 15 * POPULATION_PER_LOCATION;
    const capacity = districtPopulationCapacity(finished, { populationBonus: held });
    expect(capacity).toBeGreaterThan(1_800);
    expect(capacity).toBeLessThan(2_200);
  });

  /** ...and the start of the game is still the start of the game. */
  it('leaves a founding district housing a couple of dozen', () => {
    const founding: Building[] = [build('nexus', 1), build('quarters', 1)];
    const capacity = districtPopulationCapacity(founding, { populationBonus: 0 });
    expect(capacity).toBeGreaterThanOrEqual(HOUSING_BASE);
    expect(capacity).toBeLessThan(40);
  });
});

/**
 * §B10: what the Infirmary is actually worth, in the board's own numbers.
 *
 * Anchored on literals rather than on `CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL`, and that is the
 * whole point of the test. The existing coverage computes what it expects *from* the constant, so
 * it proves the Infirmary reaches the settle (which is worth proving, and a mutation that stopped
 * it recovering anybody was caught by it) but it agrees with any rate at all: the constant was
 * moved from 1.5 to 4 during integration and the entire suite stayed green.
 *
 * The board asked for 4% per level, capped at 40. Both halves are written out here by hand.
 */
describe('the Infirmary, at the boardrate', () => {
  const gate = (level: number): Building[] => [
    { id: 'i', kind: 'infirmary', level, modifications: [], damage: 0, fortification: 0 },
  ];

  it('hands back four percent of the dead per level', () => {
    expect(infirmaryRecoveryPercent(gate(1))).toBe(4);
    expect(infirmaryRecoveryPercent(gate(5))).toBe(20);
    expect(infirmaryRecoveryPercent(gate(10))).toBe(40);
  });

  it('gives nothing without one standing', () => {
    expect(infirmaryRecoveryPercent([])).toBe(0);
  });

  /** The ceiling is on the recovery itself, so two sources cannot add past it. */
  it('never returns more than four in ten, however deep it goes', () => {
    const deep = recoverCasualties({ razors: 100 }, infirmaryRecoveryPercent(gate(20)));
    expect(100 - (deep.razors ?? 0)).toBeLessThanOrEqual(40);
  });
});

/**
 * §B11: the Garage gives nothing on its own.
 *
 * The board's rule, in their words. It was still producing 4 oil and 1 high-quality metal per
 * level, which at level 20 was 80% of the metal in the game, so "does not give anything" was true
 * of the description and false of the building.
 *
 * Pinned as a literal zero rather than derived, and pinned beside the thing that made removing it
 * safe: the output moved to the Scrapyard rather than out of the game, because the Garage is the
 * one building that *charges* high-quality metal and deleting the supply would have made its own
 * machines unbuildable.
 */
describe('what the Garage makes (§B11)', () => {
  const at = (kind: Building['kind'], level: number): Building[] => [
    { id: 'x', kind, level, modifications: [], damage: 0, fortification: 0 },
  ];

  it('produces nothing at any level', () => {
    for (const level of [1, 5, 10, 20]) {
      expect(districtProduction(at('garage', level)).perHour).toEqual({});
    }
  });

  it('leaves the metal economy where it was, on the Scrapyard', () => {
    const yard = districtProduction(at('scrapyard', 20)).perHour;
    // The two buildings used to make 25 an hour between them at level 20. They still do.
    expect(yard.highQualityMetal).toBe(25);
    expect(yard.oil).toBe(120);
  });
});
