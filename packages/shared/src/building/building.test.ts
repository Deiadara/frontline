import { describe, expect, it } from 'vitest';
import { clampMeter } from '../economy/meters.js';
import { RESOURCE_KEYS, STARTING_RESOURCES, canAfford, type Resources } from '../resources.js';
import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  CENTRAL_BUILDING,
  buildingsUnlockedAt,
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
} from './production.js';
import {
  BASE_MORALE_TARGET,
  MORALE_HALF_LIFE_HOURS,
  characterXpBonus,
  districtDefense,
  driftMorale,
  hardshipReduction,
  moraleTarget,
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
 * The district (GDD §A1) — thirteen structures, a build queue, a power grid and sixty-five
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
});

/** A district with everything standing at `level` — the fat case most ceilings are read at. */
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
    expect(BUILDING_CATALOG[CENTRAL_BUILDING].requiresNexusLevel).toBe(0);
    const gates = BUILDING_KINDS.map((kind) => BUILDING_CATALOG[kind].requiresNexusLevel);
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
    const gate = BUILDING_CATALOG.garage.requiresNexusLevel;
    expect(isBuildingUnlocked('garage', [build('nexus', gate - 1)])).toBe(false);
    expect(isBuildingUnlocked('garage', [build('nexus', gate)])).toBe(true);
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
    // ~100x from level 1 to level 20 — expensive enough to pace, cheap enough to reach.
    const ratio = BUILDING_COST_GROWTH ** (BUILDING_MAX_LEVEL - 1);
    expect(ratio).toBeGreaterThan(50);
    expect(ratio).toBeLessThan(200);
  });

  /**
   * The board asked for seconds at the start, minutes in the middle and hours at the end. Asserted
   * in those units rather than against the growth constant — this is the one claim in the module
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
        isBuildingUnlocked(kind, NEW_DISTRICT) &&
        canAfford(STARTING_RESOURCES, buildingCost(kind, 1, NEW_DISTRICT)),
    );
    // Not a formality: this is the whole opening. A starting stockpile that covers nothing is a
    // dead first session, and one that covers everything is no decision at all.
    expect(affordable.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the power grid (§A1 — the Generator)', () => {
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
    // A barely-loaded level-1 Generator must not burn its full rate — that is what would starve a
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

    // The Scrapyard is the first oil source, and it unlocks at Nexus 2 — so the loop closes as
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

  it('accrues over elapsed hours and keeps the fractions', () => {
    const district = [build('nexus', 1), build('generator', 1), build('greenhouse', 1)];
    const stock: Resources = { ...STARTING_RESOURCES, food: 0 };
    const oneHour = accrueProduction(stock, district, 1);
    const halfHour = accrueProduction(stock, district, 0.5);

    expect(oneHour.food).toBeGreaterThan(0);
    expect(halfHour.food).toBeCloseTo(oneHour.food / 2, 6);
    // Two half-hours must equal one hour, or a player is paid for how often they refresh.
    expect(accrueProduction(halfHour, district, 0.5).food).toBeCloseTo(oneHour.food, 6);
  });

  it('stops production at the Apothecary’s ceiling without clawing anything back', () => {
    const district = [build('nexus', 1), build('generator', 1), build('greenhouse', 20)];
    const ceiling = storageCapacity(district);

    const full: Resources = { ...STARTING_RESOURCES, food: ceiling };
    expect(accrueProduction(full, district, 100).food).toBe(ceiling);

    // Raid loot can put a stock over the ceiling. Production adds nothing, but takes nothing.
    const overflowing: Resources = { ...STARTING_RESOURCES, food: ceiling * 2 };
    expect(accrueProduction(overflowing, district, 100).food).toBe(ceiling * 2);
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
  it('settles morale higher with Quarters and lower in a brownout', () => {
    const bare = moraleTarget(NEW_DISTRICT);
    expect(bare).toBeGreaterThan(BASE_MORALE_TARGET);

    const social = moraleTarget([...NEW_DISTRICT, build('quarters', 10)]);
    expect(social).toBeGreaterThan(bare);

    const dark = moraleTarget([build('nexus', 20), build('lab', 20)]);
    expect(dark).toBeLessThan(bare);
  });

  it('drifts towards the target without ever overshooting it, from either side', () => {
    for (const [from, to] of [
      [20, 80],
      [80, 20],
      [50, 50],
    ] as const) {
      let morale = clampMeter(from);
      // 400 hours is ~33 half-lives: the gap left is smaller than the meter can express.
      for (let step = 0; step < 400; step += 1) morale = driftMorale(morale, clampMeter(to), 1);
      expect(morale).toBeCloseTo(to, 6);
    }
    // And the half-life is what it says: half the gap in `MORALE_HALF_LIFE_HOURS`.
    expect(driftMorale(clampMeter(0), clampMeter(100), MORALE_HALF_LIFE_HOURS)).toBeCloseTo(50, 6);
  });

  it('is frequency-independent — the same elapsed time gives the same answer', () => {
    const oneGo = driftMorale(clampMeter(20), clampMeter(80), 6);
    let stepped = clampMeter(20);
    for (let i = 0; i < 12; i += 1) stepped = driftMorale(stepped, clampMeter(80), 0.5);
    expect(stepped).toBeCloseTo(oneGo, 6);
  });

  it('makes the district harder to take with a Gate', () => {
    expect(districtDefense([])).toBe(0);
    expect(districtDefense([build('gate', 5)])).toBeGreaterThan(0);
    const fortified: Building[] = [
      { ...build('gate', 5), modifications: ['gate_interlocking_bulwarks'] },
    ];
    expect(districtDefense(fortified)).toBeGreaterThan(districtDefense([build('gate', 5)]));
  });

  it('gives the Lab, the Gauntlet and the Infirmary each their own live effect', () => {
    expect(researchTimeReduction([])).toBe(0);
    expect(researchTimeReduction([build('lab', 10)])).toBeGreaterThan(0);
    expect(characterXpBonus([])).toBe(0);
    expect(characterXpBonus([build('gauntlet', 10)])).toBeGreaterThan(0);
    expect(hardshipReduction([])).toBe(0);
    expect(hardshipReduction([build('infirmary', 10)])).toBeGreaterThan(0);
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
      { ...build('quarters', 20), modifications: ['quarters_sound_baffling'] },
      { ...build('cistern', 20), modifications: ['cistern_clean_line_to_the_quarters'] },
      { ...build('greenhouse', 20), modifications: ['greenhouse_insect_farm'] },
    ];
    const effects = districtEffects(district);
    expect(effects.morale_flat).toBeGreaterThan(0);
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
    const gate = BUILDING_CATALOG.gate.requiresNexusLevel;
    expect(isUnlockedForQueue('gate', NEW_DISTRICT, [])).toBe(false);
    const queue: BuildQueue = [entry('nexus', gate, NOW, 60)];
    expect(isUnlockedForQueue('gate', NEW_DISTRICT, queue)).toBe(true);
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
      // Deliberately already "finished" by its own clock — the queue is sequential, so it is not.
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
