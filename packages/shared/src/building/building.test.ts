import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS, STARTING_RESOURCES, canAfford, type Resources } from '../resources.js';
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
  structureLevelCap,
  type Building,
} from './state.js';
import { MAX_EFFECT_REDUCTION, districtEffects, localProductionPercent } from './effects.js';
import {
  BUILDING_COST_GROWTH,
  baseBuildSeconds,
  baseBuildingCost,
  buildDiscountFor,
  buildingBuildSeconds,
  buildingCost,
  nexusDiscountFor,
} from './cost.js';
import {
  OIL_BURN_PER_GENERATOR_LEVEL,
  POWER_SUPPLY_PER_GENERATOR_LEVEL,
  buildingPowerDraw,
  powerGrid,
  wouldBrownOut,
} from './power.js';
import {
  HOUSING_BASE,
  STORAGE_BASE,
  accrueProduction,
  buildingProduction,
  districtProduction,
  populationCapacity,
  storageCapacity,
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

/** A district with everything standing at `level`: the fat case most ceilings are read at. */
const fullDistrict = (level: number): Building[] =>
  BUILDING_KINDS.map((kind) => build(kind, level));

/** What `POST /overseer` mints. */
const NEW_DISTRICT: Building[] = [build('nexus', 1), build('generator', 1)];

describe('the catalogue (§A1)', () => {
  it('holds the twelve the board still names, each with a spec', () => {
    expect(BUILDING_KINDS).toHaveLength(12);
    expect(new Set(BUILDING_KINDS).size).toBe(12);
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
    // And the ladder actually spreads out rather than dumping everything at level 1.
    expect(new Set(gates).size).toBeGreaterThanOrEqual(8);
  });

  it('only the Generator supplies power; everything else draws', () => {
    expect(BUILDING_CATALOG.generator.basePowerDraw).toBe(0);
    for (const kind of BUILDING_KINDS.filter((k) => k !== 'generator')) {
      expect(BUILDING_CATALOG[kind].basePowerDraw, kind).toBeGreaterThan(0);
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
  it('lets nothing outgrow the Nexus, and stops the Nexus at the ceiling', () => {
    const district = [build('nexus', 3), build('greenhouse', 3)];
    expect(structureLevelCap('nexus', district)).toBe(BUILDING_MAX_LEVEL);
    expect(structureLevelCap('greenhouse', district)).toBe(3);
    expect(nextStructureLevel('greenhouse', district)).toBeNull();
    expect(nextStructureLevel('nexus', district)).toBe(4);
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

  it('discounts every *other* structure as the Nexus grows, and never itself', () => {
    const high = [build('nexus', BUILDING_MAX_LEVEL)];
    expect(nexusDiscountFor('nexus', high)).toEqual({ costPercent: 0, timePercent: 0 });

    const discount = nexusDiscountFor('greenhouse', high);
    expect(discount.costPercent).toBeGreaterThan(0);
    expect(discount.timePercent).toBeGreaterThan(discount.costPercent);

    expect(buildingCost('greenhouse', 1, high).oil).toBeLessThan(
      baseBuildingCost('greenhouse', 1).oil ?? 0,
    );
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

describe('the power grid (§A1: the Generator)', () => {
  it('supplies linearly and draws sub-linearly, so the Generator stays a level or two ahead', () => {
    expect(powerGrid([build('generator', 1)]).supply).toBe(POWER_SUPPLY_PER_GENERATOR_LEVEL);
    expect(powerGrid([build('generator', 10)]).supply).toBe(POWER_SUPPLY_PER_GENERATOR_LEVEL * 10);

    // A level-20 structure draws well under twenty times its level-1 draw.
    const one = buildingPowerDraw('lab', 1);
    const twenty = buildingPowerDraw('lab', BUILDING_MAX_LEVEL);
    expect(twenty / one).toBeGreaterThan(5);
    expect(twenty / one).toBeLessThan(15);
  });

  it('leaves a brand-new district comfortably lit', () => {
    const grid = powerGrid(NEW_DISTRICT);
    expect(grid.brownout).toBe(false);
    expect(grid.headroom).toBeGreaterThan(0);
  });

  it('browns out when the district outgrows the Generator, without stopping', () => {
    const starved = [
      ...fullDistrict(BUILDING_MAX_LEVEL).filter((b) => b.kind !== 'generator'),
      build('generator', 1),
    ];
    const grid = powerGrid(starved);
    expect(grid.brownout).toBe(true);
    expect(grid.ratio).toBeGreaterThan(0);
    expect(grid.ratio).toBeLessThan(1);
  });

  it('burns fuel for the load it is carrying, not for its nameplate', () => {
    const idle = powerGrid(NEW_DISTRICT);
    const loaded = powerGrid([
      ...fullDistrict(6).filter((b) => b.kind !== 'generator'),
      build('generator', 6),
    ]);

    expect(idle.oilPerHour).toBeGreaterThan(0);
    // A barely-loaded level-1 Generator must not burn its full rate. That is what would starve a
    // new crew before they could build anything that makes oil.
    expect(idle.oilPerHour).toBeLessThan(OIL_BURN_PER_GENERATOR_LEVEL);
    expect(loaded.oilPerHour).toBeGreaterThan(idle.oilPerHour);
  });

  it('reports a level that would brown the district out before it is ordered', () => {
    const tight = [build('nexus', 1), build('generator', 1), build('lab', 1)];
    expect(wouldBrownOut('greenhouse', 1, NEW_DISTRICT)).toBe(false);
    expect(wouldBrownOut('nexus', BUILDING_MAX_LEVEL, tight)).toBe(true);
  });
});

describe('what the district makes (§A1)', () => {
  it('produces nothing from a district that has nothing to produce with', () => {
    for (const kind of BUILDING_KINDS) {
      expect(buildingProduction(kind, []), kind).toEqual({});
    }
  });

  it('grows more food with a Cistern than without one', () => {
    const dry = buildingProduction('greenhouse', [build('greenhouse', 5)]);
    const wet = buildingProduction('greenhouse', [build('greenhouse', 5), build('cistern', 10)]);
    expect(wet.food ?? 0).toBeGreaterThan(dry.food ?? 0);
  });

  it('applies a structure’s own production modifications to itself and to nothing else', () => {
    const boosted: Building[] = [
      { ...build('greenhouse', 5), modifications: ['greenhouse_insect_farm'] },
      build('scrapyard', 5),
    ];
    const plain = [build('greenhouse', 5), build('scrapyard', 5)];

    expect(buildingProduction('greenhouse', boosted).food ?? 0).toBeGreaterThan(
      buildingProduction('greenhouse', plain).food ?? 0,
    );
    expect(buildingProduction('scrapyard', boosted)).toEqual(
      buildingProduction('scrapyard', plain),
    );
    expect(localProductionPercent(boosted[0])).toBeGreaterThan(0);
    expect(localProductionPercent(boosted[1])).toBe(0);
  });

  it('nets the Generator’s fuel burn off the oil the district brings in', () => {
    const burningOnly = districtProduction(NEW_DISTRICT);
    expect(burningOnly.perHour.oil ?? 0).toBeLessThan(0);

    // The Scrapyard is the first oil source, and it unlocks at Nexus 2, so the loop closes as
    // soon as a player can reach it, which is what stops a new crew running dry.
    const withSource = districtProduction([...NEW_DISTRICT, build('scrapyard', 1)]);
    expect(withSource.perHour.oil ?? 0).toBeGreaterThan(0);
  });

  it('scales everything down in a brownout, and says what it would have made', () => {
    const starved = [build('nexus', 20), build('greenhouse', 20), build('generator', 1)];
    const { perHour, fullPowerPerHour, grid } = districtProduction(starved);
    expect(grid.brownout).toBe(true);
    expect(perHour.food ?? 0).toBeLessThan(fullPowerPerHour.food ?? 0);
    expect(perHour.food ?? 0).toBeGreaterThan(0);
  });

  it('accrues over elapsed hours and banks whole units, carrying the rest', () => {
    const district = [build('nexus', 1), build('generator', 1), build('greenhouse', 1)];
    const stock: Resources = { ...STARTING_RESOURCES, food: 0 };
    const oneHour = accrueProduction(stock, district, 1);
    const halfHour = accrueProduction(stock, district, 0.5);

    expect(oneHour.resources.food).toBeGreaterThan(0);
    expect(Number.isInteger(oneHour.resources.food)).toBe(true);
    expect(Number.isInteger(halfHour.resources.food)).toBe(true);

    // Two half-hours must equal one hour, or a player is paid for how often they refresh. What
    // makes that true with an integral stockpile is the carry, so the comparison is of the *sum*.
    const twice = accrueProduction(halfHour.resources, district, 0.5, undefined, halfHour.carry);
    const held = (accrual: ReturnType<typeof accrueProduction>): number =>
      accrual.resources.food + (accrual.carry.food ?? 0);
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

  it('does not take a whole barrel off the readout for a fraction of a barrel burned', () => {
    // A district with nothing but a Nexus and a Generator makes no oil and burns some, so a settle
    // covering half a minute produces about -0.012 oil. Accumulating the running total and flooring
    // it debits a whole unit the instant anybody opens the page: arithmetically conserved, because
    // the carry holds 0.98 of a barrel, and visibly wrong. The live flow caught exactly this.
    const district = [build('nexus', 1), build('generator', 1)];
    const stock: Resources = { ...STARTING_RESOURCES };
    const halfAMinute = 30 / 3600;

    const { perHour } = districtProduction(district);
    expect(
      perHour.oil ?? 0,
      'this test is meaningless unless the district is burning oil',
    ).toBeLessThan(0);

    const accrual = accrueProduction(stock, district, halfAMinute);
    expect(accrual.resources.oil).toBe(stock.oil);
    expect(accrual.carry.oil ?? 0).toBeLessThan(0);

    // And the barrel does leave, once a whole one has actually been burned.
    const hours = 1 / Math.abs(perHour.oil ?? 1);
    const later = accrueProduction(stock, district, hours * 1.01);
    expect(later.resources.oil).toBe(stock.oil - 1);
  });

  it('stops production at the Apothecary’s ceiling without clawing anything back', () => {
    const district = [build('nexus', 1), build('generator', 1), build('greenhouse', 20)];
    const ceiling = storageCapacity(district);

    const full: Resources = { ...STARTING_RESOURCES, food: ceiling };
    expect(accrueProduction(full, district, 100).resources.food).toBe(ceiling);

    // Raid loot can put a stock over the ceiling. Production adds nothing, but takes nothing.
    const overflowing: Resources = { ...STARTING_RESOURCES, food: ceiling * 2 };
    expect(accrueProduction(overflowing, district, 100).resources.food).toBe(ceiling * 2);
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

  it('houses the founding crew with no Quarters, and more with them', () => {
    expect(populationCapacity([])).toBe(HOUSING_BASE);
    expect(populationCapacity([build('quarters', 5)])).toBeGreaterThan(HOUSING_BASE);
    // Clean water raises the ceiling on the same beds.
    expect(populationCapacity([build('quarters', 5), build('cistern', 10)])).toBeGreaterThan(
      populationCapacity([build('quarters', 5)]),
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

  it('pays faction XP only for the modifications that grant it', () => {
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
      { ...build('cistern', 20), modifications: ['cistern_clean_line_to_the_quarters'] },
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
    // The Greenhouse is capped by the Nexus, and the queue's projection is what it is measured on.
    expect(nextQueuedLevel('greenhouse', NEW_DISTRICT, [])).toBe(1);
    expect(
      nextQueuedLevel('greenhouse', NEW_DISTRICT, [entry('greenhouse', 1, NOW, 60)]),
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
