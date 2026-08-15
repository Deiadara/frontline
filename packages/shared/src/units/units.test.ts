import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG, type Building } from '../building/index.js';
import { CITY_PLACES, PLACE_KINDS } from '../city/index.js';
import { RESOURCE_KEYS } from '../resources.js';
import {
  UNIT_CATALOG,
  UNIT_TIERS,
  findUnit,
  unitsInTier,
  unitsUnlockedByPlace,
  type UnitSpec,
  type UnitTier,
} from './catalog.js';
import { UNIT_MODIFIERS, UNIT_STAT_KEYS } from './stats.js';
import {
  describeRequirement,
  heldPlaceKindsOf,
  isUnitUnlocked,
  missingRequirements,
  requirementMet,
  unlockedUnits,
} from './unlocks.js';
import {
  BATCH_TIME_FACTOR,
  MAX_TRAINING_QUEUE,
  addToArmy,
  alreadyHolds,
  armyCapacity,
  armySize,
  splitDueTraining,
  supplyQueued,
  supplyUsed,
  takeFromArmy,
  trainingCost,
  trainingSeconds,
  trainingStartsAt,
  trainingCompletesAt,
  type Army,
} from './training.js';

/**
 * The units (GDD §A5).
 *
 * The load-bearing claim in here is the **unlock ladder**: that a crew with nothing can field
 * something, that a crew with everything can field everything, and that the interesting units in
 * between need more than one kind of progress at once. A roster is meant to read as a campaign.
 */

const NOTHING = { buildings: [] as Building[], heldPlaceKinds: new Set<never>() };

const building = (
  kind: Building['kind'],
  level: number,
  modifications: string[] = [],
): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications,
});

/** A crew at the top of every tree, holding one of every kind of place. */
const EVERYTHING = {
  buildings: (Object.keys(BUILDING_CATALOG) as Building['kind'][]).map((kind) =>
    building(kind, 20, [
      'gauntlet_live_fire_range',
      'lab_quantum_modeling',
      'lab_shielded_datacore',
      'nexus_encrypted_core',
    ]),
  ),
  heldPlaceKinds: new Set(PLACE_KINDS),
};

describe('the catalogue (§A5)', () => {
  it('spans five tiers and fills every one of them', () => {
    expect(UNIT_CATALOG.length).toBeGreaterThanOrEqual(24);
    for (const tier of UNIT_TIERS) {
      expect(unitsInTier(tier).length, tier).toBeGreaterThan(0);
    }
  });

  it('gives every unit a sheet inside the ranges the scale promises', () => {
    for (const unit of UNIT_CATALOG) {
      for (const key of UNIT_STAT_KEYS) {
        const value = unit.stats[key];
        expect(value, `${unit.id}.${key}`).toBeGreaterThanOrEqual(0);
        // Vitality is hit points and loot is kilograms; everything else is a 0..100 rating.
        if (key !== 'vitality' && key !== 'lootCapacity') {
          expect(value, `${unit.id}.${key}`).toBeLessThanOrEqual(100);
        }
      }
      expect(unit.stats.vitality, unit.id).toBeGreaterThan(0);
      expect(unit.blurb.length, unit.id).toBeGreaterThan(20);
      expect(unit.supply, unit.id).toBeGreaterThan(0);
      expect(unit.trainSeconds, unit.id).toBeGreaterThan(0);
      expect(Object.keys(unit.cost).length, unit.id).toBeGreaterThan(0);
      for (const key of RESOURCE_KEYS) {
        if (unit.cost[key] !== undefined) expect(unit.cost[key], unit.id).toBeGreaterThan(0);
      }
    }
  });

  it('makes power, price and time all climb with the tier', () => {
    const meanOf = (tier: UnitTier, pick: (unit: UnitSpec) => number) => {
      const units = unitsInTier(tier);
      return units.reduce((sum, unit) => sum + pick(unit), 0) / units.length;
    };
    const offense = UNIT_TIERS.map((tier) => meanOf(tier, (unit) => unit.stats.offense));
    const time = UNIT_TIERS.map((tier) => meanOf(tier, (unit) => unit.trainSeconds));
    const supply = UNIT_TIERS.map((tier) => meanOf(tier, (unit) => unit.supply));

    for (const series of [offense, time, supply]) {
      expect([...series].sort((a, b) => a - b)).toEqual(series);
    }
  });

  it('makes every legendary one of a kind, and nothing else', () => {
    for (const unit of UNIT_CATALOG) {
      expect(unit.unique, unit.id).toBe(unit.tier === 'legendary');
    }
  });

  it('names every modifier out of the shared table', () => {
    for (const unit of UNIT_CATALOG) {
      for (const id of unit.modifiers) expect(UNIT_MODIFIERS[id], `${unit.id}/${id}`).toBeDefined();
    }
    // And every modifier in the table is actually carried by somebody — a condition the engine
    // would have to implement for nobody is a condition worth deleting.
    const carried = new Set(UNIT_CATALOG.flatMap((unit) => unit.modifiers));
    for (const id of Object.keys(UNIT_MODIFIERS)) expect(carried.has(id as never), id).toBe(true);
  });
});

describe('unlocking them (§A5)', () => {
  it('lets a crew with nothing field something, and not much', () => {
    const starters = unlockedUnits(NOTHING);
    expect(starters.length).toBeGreaterThan(0);
    expect(starters.every((unit) => unit.tier === 'rabble')).toBe(true);
    expect(starters.length).toBeLessThan(UNIT_CATALOG.length / 3);
  });

  it('lets a crew at the top of every tree field everything', () => {
    expect(unlockedUnits(EVERYTHING)).toHaveLength(UNIT_CATALOG.length);
  });

  it('needs more than one kind of progress for the units worth having', () => {
    // The design claim: the interesting half of the roster is gated on *two or more* clauses, so
    // a roster reads as a campaign rather than as a Gauntlet level.
    const multi = UNIT_CATALOG.filter((unit) => unit.requires.length >= 2);
    expect(multi.length).toBeGreaterThan(UNIT_CATALOG.length / 2);

    // And every legendary needs three.
    for (const unit of unitsInTier('legendary')) {
      expect(unit.requires.length, unit.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('gates something on each of the three kinds of clause', () => {
    const kinds = new Set(UNIT_CATALOG.flatMap((unit) => unit.requires.map((need) => need.kind)));
    expect(kinds).toEqual(new Set(['building', 'modification', 'place']));
  });

  it('reads a building clause off the level, a modification off what is fitted', () => {
    expect(requirementMet({ kind: 'building', building: 'gauntlet', level: 4 }, NOTHING)).toBe(
      false,
    );
    expect(
      requirementMet(
        { kind: 'building', building: 'gauntlet', level: 4 },
        { ...NOTHING, buildings: [building('gauntlet', 4)] },
      ),
    ).toBe(true);
    expect(
      requirementMet(
        { kind: 'modification', modificationId: 'gauntlet_live_fire_range' },
        { ...NOTHING, buildings: [building('gauntlet', 7, ['gauntlet_live_fire_range'])] },
      ),
    ).toBe(true);
    expect(
      requirementMet(
        { kind: 'place', placeKind: 'gene_clinic' },
        { ...NOTHING, heldPlaceKinds: new Set(['gene_clinic'] as const) },
      ),
    ).toBe(true);
  });

  it('reports every clause still outstanding, not the first one', () => {
    const colossus = findUnit('the_colossus');
    expect(colossus).toBeDefined();
    const missing = missingRequirements(colossus!, NOTHING);
    expect(missing).toHaveLength(colossus!.requires.length);
    for (const clause of missing) expect(describeRequirement(clause).length).toBeGreaterThan(4);

    // Meeting one does not silence the others.
    const partway = missingRequirements(colossus!, {
      buildings: [building('garage', 20)],
      heldPlaceKinds: new Set(),
    });
    expect(partway.length).toBe(colossus!.requires.length - 1);
    expect(isUnitUnlocked(colossus!, partway.length === 0 ? EVERYTHING : NOTHING)).toBe(false);
  });

  it('reads back which units a place would open up', () => {
    const gated = PLACE_KINDS.filter((kind) => unitsUnlockedByPlace(kind).length > 0);
    expect(gated.length).toBeGreaterThan(0);
    for (const kind of gated) {
      for (const unit of unitsUnlockedByPlace(kind)) {
        expect(unit.requires.some((n) => n.kind === 'place' && n.placeKind === kind)).toBe(true);
      }
    }
  });

  it('collects the place kinds a crew is standing on', () => {
    const first = CITY_PLACES[0]!;
    const kinds = heldPlaceKindsOf(CITY_PLACES, (placeId) => placeId === first.id);
    expect(kinds).toEqual(new Set([first.kind]));
  });
});

describe('making them (§A5)', () => {
  it('lets a crew with no Gauntlet field a handful, and far more with one', () => {
    expect(armyCapacity([])).toBeGreaterThan(0);
    expect(armyCapacity([building('gauntlet', 10)])).toBeGreaterThan(armyCapacity([]));
    expect(armyCapacity([building('gauntlet', 20)])).toBeGreaterThan(
      armyCapacity([building('gauntlet', 10)]),
    );
  });

  it('counts a Colossus as rather more than one soldier', () => {
    const colossus = findUnit('the_colossus')!;
    const razors = findUnit('razors')!;
    expect(supplyUsed({ the_colossus: 1 })).toBe(colossus.supply);
    expect(supplyUsed({ razors: 5 })).toBe(razors.supply * 5);
    expect(colossus.supply).toBeGreaterThan(razors.supply * 5);
    expect(armySize({ razors: 5, ghosts: 2 })).toBe(7);
    expect(supplyUsed({ nonexistent: 99 })).toBe(0);
  });

  it('discounts a batch in time but never to nothing, and floors the price at one', () => {
    const razors = findUnit('razors')!;
    const one = trainingSeconds(razors, 1);
    const ten = trainingSeconds(razors, 10);

    expect(one).toBe(razors.trainSeconds);
    expect(ten).toBeGreaterThan(one);
    // Cheaper per head than one at a time, but a batch of ten is not the price of one.
    expect(ten).toBeLessThan(one * 10);
    expect(ten).toBeCloseTo(one * (1 + 9 * BATCH_TIME_FACTOR), 0);

    const free = trainingCost(razors, 1, 500);
    for (const key of RESOURCE_KEYS) {
      if (razors.cost[key] !== undefined) expect(free[key], key).toBeGreaterThanOrEqual(1);
    }
    expect(trainingSeconds(razors, 1, 500)).toBeGreaterThanOrEqual(1);
  });

  it('scales the price with the batch and takes the discount off it', () => {
    const breakers = findUnit('breakers')!;
    const plain = trainingCost(breakers, 4);
    const cheap = trainingCost(breakers, 4, 25);
    expect(plain.caps).toBe((breakers.cost.caps ?? 0) * 4);
    expect(cheap.caps ?? 0).toBeLessThan(plain.caps ?? 0);
  });

  it('holds five orders, worked one after another', () => {
    expect(MAX_TRAINING_QUEUE).toBe(5);
    const now = new Date('2026-08-14T12:00:00.000Z');
    const first = {
      id: 'a',
      unitId: 'razors',
      count: 2,
      startedAt: now.toISOString(),
      durationSeconds: 60,
    };
    expect(trainingStartsAt([], now)).toEqual(now);
    expect(trainingStartsAt([first], now)).toEqual(trainingCompletesAt(first));
  });

  it('lands a finished batch and leaves the rest of the queue alone', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const past = new Date(now.getTime() - 3_600_000).toISOString();
    const queue = [
      { id: 'a', unitId: 'razors', count: 2, startedAt: past, durationSeconds: 60 },
      { id: 'b', unitId: 'ghosts', count: 1, startedAt: now.toISOString(), durationSeconds: 600 },
    ];
    const { due, pending } = splitDueTraining(queue, now);
    expect(due.map((order) => order.id)).toEqual(['a']);
    expect(pending.map((order) => order.id)).toEqual(['b']);
    expect(supplyQueued(queue)).toBeGreaterThan(0);
  });

  it('never treats a later batch as done while an earlier one is still on the bench', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const queue = [
      { id: 'a', unitId: 'razors', count: 1, startedAt: now.toISOString(), durationSeconds: 600 },
      {
        id: 'b',
        unitId: 'razors',
        count: 1,
        startedAt: new Date(now.getTime() - 3_600_000).toISOString(),
        durationSeconds: 60,
      },
    ];
    expect(splitDueTraining(queue, now).due).toHaveLength(0);
  });

  it('adds and removes from an army without leaving zeroes behind', () => {
    let army: Army = {};
    army = addToArmy(army, 'razors', 3);
    army = addToArmy(army, 'razors', 2);
    expect(army).toEqual({ razors: 5 });

    army = takeFromArmy(army, 'razors', 5);
    expect(army).toEqual({});
    expect(takeFromArmy(army, 'razors', 5)).toEqual({});
  });

  it('counts a unique unit already queued as already held', () => {
    const specter = findUnit('the_specter')!;
    expect(alreadyHolds(specter, {}, [])).toBe(0);
    expect(alreadyHolds(specter, { the_specter: 1 }, [])).toBe(1);
    expect(
      alreadyHolds(specter, {}, [
        {
          id: 'q',
          unitId: 'the_specter',
          count: 1,
          startedAt: '2026-08-14T12:00:00.000Z',
          durationSeconds: 60,
        },
      ]),
    ).toBe(1);
  });
});
