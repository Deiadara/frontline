import { describe, expect, it } from 'vitest';
import type { PartialResources } from '../resources.js';
import { BUILDING_CATALOG, type Building } from '../building/index.js';
import { CITY_LOCATIONS, LOCATION_KINDS } from '../city/index.js';
import { RESOURCE_KEYS } from '../resources.js';
import {
  UNIT_CATALOG,
  UNIT_RULE_IDS,
  UNIT_RULES,
  UNIT_TIERS,
  findUnit,
  isCombatUnit,
  isSupportUnit,
  unitsInTier,
  unitRules,
  unitsUnlockedByLocation,
  type UnitSpec,
  type UnitTier,
} from './catalog.js';
import { UPGRADE_LINES, upgradedStats, upgradesInLine } from './upgrades.js';
import {
  UNIT_FIGURE_KEYS,
  UNIT_MODIFIERS,
  UNIT_RATING_KEYS,
  UNIT_STAT_KEYS,
  UnitStatsSchema,
} from './stats.js';
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
  TRAINING_CANCEL_WINDOW,
  TRAINING_MAX_BATCH,
  TrainingQueueSchema,
  addToArmy,
  alreadyHolds,
  armySize,
  maxTrainable,
  splitDueTraining,
  supplyQueued,
  supplyUsed,
  takeFromArmy,
  trainingArrivedBy,
  trainingBatchProgress,
  trainingCancelWindowMs,
  trainingCancellable,
  trainingCost,
  trainingRefund,
  trainingSeconds,
  trainingStartsAt,
  trainingCompletesAt,
  type Army,
} from './training.js';
import { BuildQueueSchema } from '../building/queue.js';
import { POPULATION_PER_LOCATION, districtPopulationCapacity } from '../building/population.js';
import { noTerritoryEffects } from '../city/locations.js';

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
  damage: 0,
  fortification: 0,
});

/** A crew at the top of every tree, holding one of every kind of location. */
const EVERYTHING = {
  buildings: (Object.keys(BUILDING_CATALOG) as Building['kind'][]).map((kind) =>
    building(kind, 20, [
      'gauntlet_live_fire_range',
      'lab_quantum_modeling',
      'lab_shielded_datacore',
      'nexus_encrypted_core',
    ]),
  ),
  heldPlaceKinds: new Set(LOCATION_KINDS),
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
        // Damage, hit points and loot are counts of a thing; everything else is a 0..100 rating.
        // Read off `UNIT_FIGURE_KEYS` rather than listed here, so a stat that stops being a rating
        // stops being checked as one in the same edit.
        if (!(UNIT_FIGURE_KEYS as readonly string[]).includes(key)) {
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

  /**
   * The ladder climbs, and it climbs over **rungs** rather than over tiers.
   *
   * Carriers are beside the ladder rather than on it: a Hauler is slower to train than a Razor and
   * carries three times as much, and neither fact says anything about where they stand in a battle
   * line, because they are never in one.
   *
   * Specialists and Wonders of Engineering share a rung, and asserting otherwise would be asserting
   * something untrue about the roster. A Wonder takes longer to build and eats about the same
   * supply while hitting slightly softer: Cyberhounds are supply 1, Netrunners are 3, and the two
   * tiers overlap on every axis. They are two *kinds* of middle unit, not a better and a worse one,
   * and a test that forced one above the other would be answered by editing content until an
   * arbitrary ordering came out.
   */
  it('makes power, price and time all climb with the rungs of the ladder', () => {
    const meanOfRung = (rung: readonly UnitTier[], pick: (unit: UnitSpec) => number) => {
      const units = rung.flatMap((tier) => unitsInTier(tier));
      return units.reduce((sum, unit) => sum + pick(unit), 0) / units.length;
    };
    const RUNGS: readonly (readonly UnitTier[])[] = [
      ['rabble'],
      ['specialist', 'wonder'],
      ['heavy'],
      ['legendary'],
    ];
    // Every fighting tier is on exactly one rung, so a tier added later fails here rather than
    // being silently left out of the invariant.
    expect(RUNGS.flat().sort()).toEqual(UNIT_TIERS.filter((tier) => tier !== 'carrier').sort());

    for (const pick of [
      /*
       * Power, and it has to be **both halves of the sheet**.
       *
       * This axis was `offense` alone, and offense alone is not power: it says a Warden with 172
       * damage behind 168 hit points and 40 armour is a weaker unit than a Sniper with 455 damage
       * and 85 hit points, which is not what either sheet means and not how the engine settles a
       * fight. `sidePower` in `battle/engine.ts` combines the two for exactly this reason, and it
       * is the same product Lanchester's square law puts on a body.
       *
       * It matters here because the heavy tier's identity is *armour and hit points*, not damage.
       * Asserting that heavies out-damage specialists forces the roster to make a shield-bearer
       * hit harder than a marksman to keep a test green, which is content edited to satisfy an
       * arbitrary ordering: the failure mode this test's own doc comment warns about, one rung up.
       */
      (unit: UnitSpec) => unit.stats.offense * unit.stats.vitality,
      (unit: UnitSpec) => unit.trainSeconds,
      (unit: UnitSpec) => unit.supply,
    ]) {
      const series = RUNGS.map((rung) => meanOfRung(rung, pick));
      expect([...series].sort((a, b) => a - b)).toEqual(series);
    }
  });

  /**
   * The support tier, and the one rule that makes it a different kind of thing.
   *
   * `combat: false` is what keeps a Scavenger out of a battle line: not a low offense, which the
   * engine would happily let stand in a rank and die. Every consumer asks `isCombatUnit`, so the
   * fact lives on the sheet and the enforcement lives at each door.
   */
  /**
   * Every rating stays inside the track the card draws it on, kitted as well as bare.
   *
   * The roster prints eight of these as bars out of 100, and two of the engine's readers treat
   * them the same way: `matchup.ts` clamps `range - speed` into 0..100, and `rangedShare` divides
   * range by 100 to produce a share it documents as 0..1. `upgradedStats` used to leave range
   * uncapped, so Slaved Optics put a Sniper on 109: a bar drawn past the end of its own track, and
   * a "share" of 1.09 inside the engine.
   *
   * The three exceptions are the open figures: damage, hit points and the bag are counts of a
   * thing, none of them is drawn on a track, and nothing divides them by 100.
   */
  it('holds every rating inside 0..100, with the whole workshop bolted on', () => {
    const strongest = UPGRADE_LINES.map((line) => upgradesInLine(line).at(-1)?.id ?? '');
    for (const unit of UNIT_CATALOG) {
      const kitted = upgradedStats(unit.stats, strongest);
      for (const key of UNIT_RATING_KEYS) {
        expect(kitted[key], `${unit.id}.${key}`).toBeGreaterThanOrEqual(0);
        expect(kitted[key], `${unit.id}.${key}`).toBeLessThanOrEqual(100);
      }
      // And the exceptions are real ones rather than stats nobody upgrades: a refit still moves
      // all three, it just moves them on a scale with no ceiling to stay under.
      for (const key of UNIT_FIGURE_KEYS) {
        expect(kitted[key], `${unit.id}.${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('marks the support tier as non-combat and nothing else', () => {
    for (const unit of UNIT_CATALOG) {
      expect(isCombatUnit(unit), unit.id).toBe(unit.tier !== 'carrier');
      expect(isSupportUnit(unit), unit.id).toBe(unit.tier === 'carrier');
    }
    expect(unitsInTier('carrier').length).toBeGreaterThan(0);
  });

  it('gives the support tier the trade it exists for: a big bag on slow legs', () => {
    const average = (pick: (unit: UnitSpec) => number) => {
      const fighters = UNIT_CATALOG.filter((unit) => unit.tier !== 'carrier');
      return fighters.reduce((sum, unit) => sum + pick(unit), 0) / fighters.length;
    };
    for (const porter of unitsInTier('carrier')) {
      expect(porter.stats.speed, porter.id).toBeLessThan(average((unit) => unit.stats.speed));
      expect(porter.trainedAt, porter.id).toBe('nexus');
    }
  });

  it('makes every legendary one of a kind, and nothing else', () => {
    for (const unit of UNIT_CATALOG) {
      expect(unit.unique, unit.id).toBe(unit.tier === 'legendary');
    }
  });

  /**
   * Every recruit eats while they are being trained, so every price on the roster has a supplies
   * line and a caps line.
   *
   * Both halves are asserted because the interesting failure is a *new* unit: a catalogue entry
   * added with the materials its designer was thinking about and no ration, which costs nothing to
   * write and quietly makes one unit the only one in the game that trains for free on the stores.
   */
  it('charges caps and supplies for every unit on the roster', () => {
    for (const unit of UNIT_CATALOG) {
      expect(unit.cost.caps, unit.id).toBeGreaterThan(0);
      expect(unit.cost.supplies, unit.id).toBeGreaterThan(0);
      // And it survives the batch price, which is where a rounding could drop a small line.
      expect(trainingCost(unit, 3).supplies, unit.id).toBeGreaterThan(0);
    }
  });

  it('names every modifier out of the shared table', () => {
    for (const unit of UNIT_CATALOG) {
      for (const id of unit.modifiers) expect(UNIT_MODIFIERS[id], `${unit.id}/${id}`).toBeDefined();
    }
    // And every modifier in the table is actually carried by somebody: a condition the engine
    // would have to implement for nobody is a condition worth deleting.
    const carried = new Set(UNIT_CATALOG.flatMap((unit) => unit.modifiers));
    for (const id of Object.keys(UNIT_MODIFIERS)) expect(carried.has(id as never), id).toBe(true);
  });
});

describe('unlocking them (§A5)', () => {
  it('lets a crew with nothing field something, and not much', () => {
    const starters = unlockedUnits(NOTHING);
    expect(starters.length).toBeGreaterThan(0);
    // Razors and the porters the Nexus itself signs: the two things a crew with no barracks can
    // put on the street. Nothing that fights properly.
    expect(starters.every((unit) => unit.tier === 'rabble' || unit.tier === 'carrier')).toBe(true);
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
    expect(kinds).toEqual(new Set(['building', 'modification', 'location']));
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
        { kind: 'location', locationKind: 'gene_clinic' },
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

  it('reads back which units a location would open up', () => {
    const gated = LOCATION_KINDS.filter((kind) => unitsUnlockedByLocation(kind).length > 0);
    expect(gated.length).toBeGreaterThan(0);
    for (const kind of gated) {
      for (const unit of unitsUnlockedByLocation(kind)) {
        expect(unit.requires.some((n) => n.kind === 'location' && n.locationKind === kind)).toBe(
          true,
        );
      }
    }
  });

  it('collects the location kinds a crew is standing on', () => {
    const first = CITY_LOCATIONS[0]!;
    const kinds = heldPlaceKindsOf(CITY_LOCATIONS, (locationId) => locationId === first.id);
    expect(kinds).toEqual(new Set([first.kind]));
  });
});

/** One order on the bench, with the price it was charged recorded on it. */
const order = (
  id: string,
  unitId: string,
  count: number,
  startedAt: Date,
  durationSeconds: number,
  paid: PartialResources = { caps: 100 },
) => ({
  id,
  unitId,
  count,
  delivered: 0,
  startedAt: startedAt.toISOString(),
  durationSeconds,
  paid,
});

describe('making them (§A5)', () => {
  /**
   * §A1: the army comes out of the district's population, which the Quarters raise.
   *
   * This used to assert a separate Gauntlet-driven army ceiling. There is one pool now, so what
   * has to hold is that a crew with nothing built can still field somebody, and that building
   * where people sleep is what makes room for more of them.
   */
  it('lets a crew with nothing built field a handful, and far more once it has Quarters', () => {
    const nothing = districtPopulationCapacity([], noTerritoryEffects());
    const housed = districtPopulationCapacity([building('quarters', 10)], noTerritoryEffects());
    const wellHoused = districtPopulationCapacity([building('quarters', 20)], noTerritoryEffects());
    expect(nothing).toBeGreaterThan(0);
    expect(housed).toBeGreaterThan(nothing);
    expect(wellHoused).toBeGreaterThan(housed);
  });

  /** And the ground raises it too, which is what makes taking a location worth beds. */
  it('houses more people for every location the crew holds', () => {
    const bare = districtPopulationCapacity([building('quarters', 4)], noTerritoryEffects());
    const holding = districtPopulationCapacity([building('quarters', 4)], {
      ...noTerritoryEffects(),
      populationBonus: POPULATION_PER_LOCATION * 3,
    });
    expect(holding - bare).toBe(POPULATION_PER_LOCATION * 3);
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
    const first = order('a', 'razors', 2, now, 60);
    expect(trainingStartsAt([], now)).toEqual(now);
    expect(trainingStartsAt([first], now)).toEqual(trainingCompletesAt(first));
  });

  /**
   * A batch arrives **one at a time**, at its own pace.
   *
   * Ten Razors on a 450-second order is one every 45 seconds, not ten at 450. The lump was what
   * made the batch button feel like a punishment: nothing at all happened for seven minutes and
   * then the whole thing landed at once.
   */
  it('hands a batch over in pieces rather than in a lump', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const batch = order('a', 'razors', 10, now, 450);
    const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);

    expect(trainingArrivedBy(batch, now)).toBe(0);
    expect(trainingArrivedBy(batch, at(44))).toBe(0);
    expect(trainingArrivedBy(batch, at(45))).toBe(1);
    expect(trainingArrivedBy(batch, at(225))).toBe(5);
    expect(trainingArrivedBy(batch, at(450))).toBe(10);
    // Never more than were ordered, however long the page was left open.
    expect(trainingArrivedBy(batch, at(99_999))).toBe(10);
  });

  /** The settle is a read, so it has to be idempotent: no body is ever handed over twice. */
  it('hands each body over exactly once across repeated settles', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
    let queue = [order('a', 'razors', 10, now, 450)];

    const first = splitDueTraining(queue, at(135));
    expect(first.delivered).toEqual([{ unitId: 'razors', count: 3 }]);
    queue = first.pending;

    // Read again with no time passed: nothing new has arrived.
    const again = splitDueTraining(queue, at(135));
    expect(again.delivered).toEqual([]);
    queue = again.pending;

    const later = splitDueTraining(queue, at(450));
    expect(later.delivered).toEqual([{ unitId: 'razors', count: 7 }]);
    expect(later.pending).toHaveLength(0);
  });

  it('never hands over from a batch that has not started', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const queued = [
      order('a', 'razors', 1, now, 600),
      // Behind it, so its own clock has not started: `startedAt` is in the future.
      order('b', 'razors', 1, new Date(now.getTime() + 600_000), 60),
    ];
    expect(splitDueTraining(queued, now).delivered).toEqual([]);
  });

  it('lands a finished batch and leaves the rest of the queue alone', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const past = new Date(now.getTime() - 3_600_000);
    const queue = [order('a', 'razors', 2, past, 60), order('b', 'ghosts', 1, now, 600)];
    const { delivered, pending } = splitDueTraining(queue, now);
    expect(delivered).toEqual([{ unitId: 'razors', count: 2 }]);
    expect(pending.map((entry) => entry.id)).toEqual(['b']);
    expect(supplyQueued(queue)).toBeGreaterThan(0);
  });

  /**
   * The bug that bricked a save, as a test.
   *
   * `MAX_TRAINING_QUEUE` gates the *order*. It used to be on the stored schema as well, and testing
   * mode waives `queue_full`, so a sixth order went in and every read of that crew after it threw
   * `too_big` out of `rowToBase`: `GET /me` 500ed, the client showed `UPLINK FAILED`, and the queue
   * could not even be drained because the crew could not be loaded. A cap on a read path can only
   * ever do this.
   */
  it('reads a bench longer than the cap rather than refusing to load the crew', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const long = Array.from({ length: MAX_TRAINING_QUEUE + 3 }, (_, index) =>
      order(`q-${index}`, 'razors', 1, now, 60),
    );
    expect(TrainingQueueSchema.parse(long)).toHaveLength(MAX_TRAINING_QUEUE + 3);
    expect(BuildQueueSchema.parse([])).toEqual([]);
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
        order('q', 'the_specter', 1, new Date('2026-08-14T12:00:00.000Z'), 60),
      ]),
    ).toBe(1);
  });
});

/**
 * Calling a batch off (§A5).
 *
 * Two numbers do the whole job: a window short enough that the queue is still a commitment, and a
 * refund short enough that parking resources on the bench is not free storage.
 */
describe('changing your mind (§A5)', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');
  const at = (progress: number, seconds = 600) =>
    new Date(now.getTime() + progress * seconds * 1000);

  it('shuts the moment the first body walks out, whatever the clock says', () => {
    // A ten-strong batch hands one over at a tenth of its clock, which is the same instant the
    // window would otherwise still be open on. Refunding then would pay for a unit being kept.
    const batch = order('a', 'razors', 10, now, 600, { caps: 400 });
    expect(trainingCancellable(batch, now)).toBe(true);
    expect(trainingCancellable(batch, at(0.06, 600))).toBe(true);
    expect(trainingCancellable(batch, at(0.1, 600))).toBe(false);
    expect(trainingCancellable({ ...batch, delivered: 1 }, now)).toBe(false);
  });

  it('opens for the first tenth of the batch and shuts after it', () => {
    const batch = order('a', 'razors', 4, now, 600, { caps: 160, supplies: 40 });
    expect(trainingCancellable(batch, now)).toBe(true);
    expect(trainingCancellable(batch, at(0.09))).toBe(true);
    expect(trainingCancellable(batch, at(TRAINING_CANCEL_WINDOW))).toBe(false);
    expect(trainingCancellable(batch, at(0.5))).toBe(false);
  });

  /** The window is a share of the batch's own clock, so a long build gives longer to notice. */
  it('gives a long batch a longer window than a short one', () => {
    const quick = order('a', 'razors', 1, now, 60);
    const slow = order('b', 'the_colossus', 1, now, 5400);
    expect(trainingCancelWindowMs(slow, now)).toBeGreaterThan(trainingCancelWindowMs(quick, now));
    expect(trainingCancelWindowMs(quick, at(1, 60))).toBe(0);
  });

  it('reports how far along a batch is, and how close the next one is', () => {
    const batch = order('a', 'razors', 10, now, 450);
    const at45 = new Date(now.getTime() + 45_000);
    expect(trainingBatchProgress(batch, now)).toMatchObject({ done: 0, total: 10 });
    expect(trainingBatchProgress(batch, at45)).toMatchObject({ done: 1, total: 10 });
    // Halfway to the second one.
    const half = new Date(now.getTime() + 67_500);
    expect(trainingBatchProgress(batch, half).nextProgress).toBeCloseTo(0.5, 2);
    const done = new Date(now.getTime() + 450_000);
    expect(trainingBatchProgress(batch, done)).toMatchObject({ done: 10, nextMs: 0 });
  });

  it('hands back ninety-five percent of what was actually charged, and never more', () => {
    const batch = order('a', 'razors', 4, now, 600, { caps: 160, supplies: 40 });
    expect(trainingRefund(batch)).toEqual({ caps: 152, supplies: 38 });
    for (const [key, amount] of Object.entries(trainingRefund(batch))) {
      expect(amount, key).toBeLessThan(batch.paid[key as keyof typeof batch.paid] ?? 0);
    }
  });

  /**
   * The exploit this is written against: order at full price, finish a Lab project that discounts
   * training, cancel, and be handed back more than you spent. The refund reads the recorded price,
   * so the discount cannot reach it.
   */
  it('refunds against the price paid rather than the price today', () => {
    const razors = findUnit('razors')!;
    const paidFull = trainingCost(razors, 4);
    const cheaperNow = trainingCost(razors, 4, 40);
    expect(cheaperNow.caps ?? 0).toBeLessThan(paidFull.caps ?? 0);
    const batch = order('a', 'razors', 4, now, 600, paidFull);
    expect(trainingRefund(batch).caps).toBe(Math.floor((paidFull.caps ?? 0) * 0.95));
  });

  /** A row written before the price was recorded: nothing to refund against, so nothing doing. */
  it('refuses to call off an order whose price was never recorded', () => {
    const legacy = order('a', 'razors', 1, now, 600, {});
    expect(trainingCancellable(legacy, now)).toBe(false);
    expect(trainingRefund(legacy)).toEqual({});
  });
});

describe('how many a crew could order (§A5)', () => {
  const razors = findUnit('razors')!;
  /*
   * Deep in *every* material, derived rather than listed.
   *
   * It used to be four hand-written keys, which stopped being "rich" the day units started costing
   * planks and high-quality metal: the Colossus needs 400 of the metal and the fixture held none.
   * That went unnoticed because the unique branch of `maxTrainable` never checked the price at
   * all, so the one case that would have caught it was the case the bug lived in.
   */
  const rich = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 100_000]));

  it('is bounded by the beds when the stockpile is deep', () => {
    expect(maxTrainable(razors, rich, 12)).toBe(12);
    expect(maxTrainable(razors, rich, 0)).toBe(0);
  });

  it('is bounded by the stockpile when the district has room to spare', () => {
    const cost = razors.cost.caps ?? 1;
    expect(maxTrainable(razors, { caps: cost * 3, supplies: 100_000 }, 50)).toBe(3);
  });

  /**
   * A legendary is one or none, and it still has to be paid for.
   *
   * The unique branch used to return on the beds alone and skip the affordability walk entirely,
   * so **Max** offered a Colossus to a crew holding a single cap and the route refused it with
   * `cannot_afford`. Uniques are the five most expensive things in the game, which made them the
   * units the button lied about most often.
   */
  it('never offers a unique the crew cannot pay for', () => {
    for (const unique of UNIT_CATALOG.filter((unit) => unit.unique)) {
      const broke = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 1]));
      expect(maxTrainable(unique, broke, 500), unique.id).toBe(0);

      // And it is genuinely offered when the crew can cover it: an assertion that always reads
      // zero would pass on a `maxTrainable` that had stopped working entirely.
      const purse = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 1_000_000]));
      expect(maxTrainable(unique, purse, 500), unique.id).toBe(1);
      // Beds still bind: a crew with no room gets none however deep the stockpile.
      expect(maxTrainable(unique, purse, 0), unique.id).toBe(0);
    }
  });

  it('takes the discount into account, so Max is what the route will actually accept', () => {
    const cost = razors.cost.caps ?? 1;
    const purse = { caps: cost * 4, supplies: 100_000 };
    expect(maxTrainable(razors, purse, 50, 50)).toBeGreaterThan(maxTrainable(razors, purse, 50));
  });

  it('never offers a second copy of a one-of-a-kind', () => {
    const colossus = findUnit('the_colossus')!;
    expect(maxTrainable(colossus, rich, 50)).toBe(1);
    expect(maxTrainable(colossus, rich, 1)).toBe(0);
  });

  it('stops at the batch the stepper stops at', () => {
    expect(maxTrainable(razors, rich, 10_000)).toBe(TRAINING_MAX_BATCH);
  });
});

/**
 * §A5: which stats are ratings and which are quantities.
 *
 * The two lists are hand-written and the schema is the thing that actually decides, so they can
 * drift the moment a stat is added: a figure left out of `UNIT_FIGURE_KEYS` gets a bar drawn as a
 * fraction of 100, which for a 600-vitality Colossus is a full track and a lie.
 */
describe('rating stats and open figures (§A5)', () => {
  it('sorts every stat into exactly one of the two', () => {
    const figures = new Set<string>(UNIT_FIGURE_KEYS);
    const ratings = new Set<string>(UNIT_RATING_KEYS);
    expect([...figures].filter((key) => ratings.has(key))).toEqual([]);
    expect([...figures, ...ratings].sort()).toEqual([...UNIT_STAT_KEYS].sort());
  });

  it('keeps every rating inside 0..100 across the whole catalogue, and lets the figures out', () => {
    for (const unit of UNIT_CATALOG) {
      for (const key of UNIT_RATING_KEYS) {
        const value = unit.stats[key];
        expect(typeof value, `${unit.id}.${key}`).toBe('number');
        expect(value, `${unit.id}.${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${unit.id}.${key}`).toBeLessThanOrEqual(100);
      }
    }
    // And the point of the split: at least one figure is already past what a rating may hold, so
    // a bar out of 100 would have nothing left to say about it.
    expect(Math.max(...UNIT_CATALOG.map((unit) => unit.stats.vitality))).toBeGreaterThan(100);
  });

  /**
   * Damage and hit points are counts, on whatever scale the roster needs, and the roster uses it.
   *
   * The pinned ceilings are the two the design is built around: 1000 hit points on the Colossus
   * and 700 damage on the Loose End. They are asserted as *the maximum of the catalogue* rather
   * than as one unit's sheet, so a new unit written above either has to be a decision somebody
   * made here rather than a number that drifted in.
   */
  it('scales attack and hit points as counts, not as ratings out of 100', () => {
    const topOffense = Math.max(...UNIT_CATALOG.map((unit) => unit.stats.offense));
    const topVitality = Math.max(...UNIT_CATALOG.map((unit) => unit.stats.vitality));
    expect(topOffense).toBe(700);
    expect(topVitality).toBe(1000);
    expect(findUnit('the_loose_end')?.stats.offense).toBe(topOffense);
    expect(findUnit('the_colossus')?.stats.vitality).toBe(topVitality);

    // The schema is what enforced the old 0..100 ceiling, so parsing past it is the assertion.
    const top = UNIT_CATALOG.reduce((a, b) => (a.stats.offense >= b.stats.offense ? a : b));
    expect(() => UnitStatsSchema.parse({ ...top.stats, offense: 1400 })).not.toThrow();
    expect(() => UnitStatsSchema.parse({ ...top.stats, offense: -1 })).toThrow();
  });
});

/**
 * The bench clock, against the campaign that unlocked the unit.
 *
 * Not a second ladder: the same one. `UNIT_CATALOG`'s note says a roster is a readout of a campaign,
 * and time is half of what a campaign costs. What this pins is that a unit you had to work harder
 * for also takes longer to put on the street, which is what stops a deep-gated unit from being both
 * the strongest thing you own and the quickest thing to replace.
 *
 * Measured rather than asserted: the correlation is 0.98 today, and the floor is well under it so
 * that ordinary retuning stays free.
 */
describe('the bench clock climbs with the campaign', () => {
  const LOCATION_WEIGHT = 12;
  const FITTED_WEIGHT = 8;
  const gateDepth = (unit: UnitSpec): number =>
    unit.requires.reduce(
      (total, need) =>
        total +
        (need.kind === 'building'
          ? need.level
          : need.kind === 'location'
            ? LOCATION_WEIGHT
            : FITTED_WEIGHT),
      0,
    );

  const fighters = UNIT_CATALOG.filter((unit) => isCombatUnit(unit));

  it('ranks by clock roughly the way it ranks by campaign', () => {
    const rankOf = (by: (unit: UnitSpec) => number) => {
      const sorted = [...fighters].sort((a, b) => by(a) - by(b));
      return new Map(sorted.map((unit, index) => [unit.id, index]));
    };
    const byGate = rankOf(gateDepth);
    const byClock = rankOf((unit) => unit.trainSeconds);
    const n = fighters.length;
    const d2 = fighters.reduce(
      (total, unit) => total + (byGate.get(unit.id)! - byClock.get(unit.id)!) ** 2,
      0,
    );
    expect(1 - (6 * d2) / (n * (n * n - 1))).toBeGreaterThan(0.85);
  });

  /**
   * Seconds per point of supply, which is the figure a player actually feels: a Colossus is one
   * body and twelve supply, so the honest comparison with a Razor is per point of the army cap it
   * eats rather than per body.
   */
  it('keeps the clock per point of supply inside one order of magnitude', () => {
    const perSupply = fighters.map((unit) => unit.trainSeconds / unit.supply);
    expect(Math.max(...perSupply) / Math.min(...perSupply)).toBeLessThan(20);
  });
});

/**
 * The two flags that are rules rather than numbers, and the one table that names them.
 *
 * They were readable only by the engine: no screen could show them, so a player could field an
 * Ironside without ever learning it is a shield line, or a Stitcher without learning it does
 * anything at all. `UNIT_RULES` is what the roster, the dossier and the wire all read.
 */
describe('the rule flags are visible content, not engine trivia', () => {
  it('names every flag a unit can carry, and nothing it cannot', () => {
    for (const id of UNIT_RULE_IDS) {
      expect(UNIT_RULES[id].label.length, id).toBeGreaterThan(2);
      expect(UNIT_RULES[id].description.length, id).toBeGreaterThan(40);
    }
  });

  it('reports exactly the flags a sheet sets', () => {
    for (const unit of UNIT_CATALOG) {
      const reported = unitRules(unit).map((rule) => rule.id);
      const set = UNIT_RULE_IDS.filter((id) => unit[id] === true);
      expect(reported, unit.id).toEqual(set);
    }
  });

  /**
   * Both flags have to be *on* something, or the table is describing a mechanic no player meets.
   * This is the check that would have caught `mends` shipping as a field nothing set.
   */
  it('has a unit carrying each rule', () => {
    for (const id of UNIT_RULE_IDS) {
      expect(
        UNIT_CATALOG.filter((unit) => unit[id] === true).map((unit) => unit.id),
        id,
      ).not.toEqual([]);
    }
  });

  it('leaves most of the roster carrying none, so a rule stays a distinction', () => {
    const carrying = UNIT_CATALOG.filter((unit) => unitRules(unit).length > 0);
    expect(carrying.length).toBeLessThan(UNIT_CATALOG.length / 3);
  });
});
