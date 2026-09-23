import {
  territoryEffectsFor,
  BUILDING_MAX_LEVEL,
  BASE_BUILD_QUEUE,
  BUILD_QUEUE_RESEARCH_ID,
  MAX_BUILD_QUEUE,
  STARTING_RESOURCES,
  buildingBuildSeconds,
  buildingCost,
  buildingLevel,
  nexusLevelFor,
  createCommander,
  findUnit,
  MAX_TRAINING_QUEUE,
  trainingCost,
  districtProduction,
  findBuilding,
  RESOURCE_KEYS,
  BUILD_BOOST_MS,
  BUILD_BOOST_OIL_PER_LEVEL,
  BUILD_BOOST_PERCENT,
  buildBoostActive,
  addonsOf,
  queueCompletesAt,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Base,
  type Building,
  type BuildQueue,
  type Resources,
  startingTraining,
  CITY_LOCATIONS,
  UNIT_SLOTS_PER_LOCATION,
  xpForClock,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { settleBase } from './settle.js';
import { queueBuild, buildClocksFor } from './build.js';
import { buyBuildBoost } from './boost.js';
import { clearSlot } from './modifications.js';
import { districtUnitSlots } from './unit-slots.js';
import { setGarrison } from '../city/actions.js';
import { projectUnits } from '../units/roster.js';
import { cancelTraining, queueTraining, settleTraining } from '../units/training.js';
import { PRODUCTION_MIN_STEP_MS, settleDistrict } from './settle.js';

/**
 * The district's server half (GDD §A1): ordering a level, and everything that lands lazily on the
 * next read.
 *
 * Run against a real sqlite stack rather than a repository double, because half of what is being
 * asserted is that the queue and the structures move in the same write: a double would happily
 * let them come apart.
 */

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

const NOW = new Date('2026-08-14T12:00:00.000Z');
const HOUR_MS = 3_600_000;

function openStack(): Repositories {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return createRepositories(db);
}

const build = (kind: Building['kind'], level: number, modifications: string[] = []): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications,
});

interface SeedOptions {
  buildings?: Building[];
  buildQueue?: BuildQueue;
  resources?: Resources;
  settledAt?: string | null;
  officers?: Base['commanders'];
  level?: number;
  trainingQueue?: Base['trainingQueue'];
  addons?: Base['addons'];
}

function seedBase(repos: Repositories, options: SeedOptions = {}): Base {
  repos.users.insert({
    id: 'user-1',
    username: 'Builder',
    passwordHash: 'x',
    createdAt: NOW.toISOString(),
  });

  const economy = startingEconomy(NOW.toISOString());
  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Ninth Street Crew',
    districtId: 'neon-docks',
    level: options.level ?? 1,
    isBot: false,
    resources: options.resources ?? STARTING_RESOURCES,
    economy: { ...economy, productionSettledAt: options.settledAt ?? NOW.toISOString() },
    progression: startingProgression(),
    research: startingResearch(),
    buildings: options.buildings ?? [build('nexus', 1), build('generator', 1)],
    buildQueue: options.buildQueue ?? [],
    army: {},
    trainingQueue: options.trainingQueue ?? [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    addons: options.addons,
    commanders: options.officers ?? [],
    createdAt: NOW.toISOString(),
  };
  repos.bases.insert(base);
  return base;
}

const entry = (kind: Building['kind'], level: number, startedAt: Date, seconds: number) => ({
  id: `q-${kind}-${level}`,
  kind,
  level,
  startedAt: startedAt.toISOString(),
  durationSeconds: seconds,
  paid: {},
  parts: {},
});

describe('ordering a level (§A1, §D3)', () => {
  it('charges at order time and puts the level in the queue, not on the ground', () => {
    const repos = openStack();
    const base = seedBase(repos);
    const cost = buildingCost('quarters', 1, base.buildings);

    const result = queueBuild(repos, { base, structure: 'quarters', id: 'q1', now: NOW });
    expect(result.kind).toBe('queued');
    if (result.kind !== 'queued') return;

    expect(result.base.resources.oil).toBe(base.resources.oil - (cost.oil ?? 0));
    expect(result.base.buildQueue).toHaveLength(1);
    expect(buildingLevel(result.base.buildings, 'quarters')).toBe(0);

    // And it is on disk, not only in the returned object.
    const stored = repos.bases.findById(base.id);
    expect(stored?.buildQueue).toHaveLength(1);
    expect(stored?.resources.oil).toBe(result.base.resources.oil);
  });

  it('works orders one after another rather than all at once', () => {
    const repos = openStack();
    let base = seedBase(repos);

    // Two plots a Nexus 1 seed base can actually lay. The Greenhouse was the second of these until
    // 2026-09-18, when it moved behind Nexus 3: a refused order makes this a test of the unlock
    // table rather than of the queue, which is what it is for.
    for (const [index, kind] of (['quarters', 'gate'] as const).entries()) {
      const result = queueBuild(repos, { base, structure: kind, id: `q${index}`, now: NOW });
      expect(result.kind).toBe('queued');
      if (result.kind !== 'queued') return;
      base = result.base;
    }

    const [first, second] = base.buildQueue;
    expect(first && second).toBeTruthy();
    if (!first || !second) return;
    // The second starts when the first finishes, not when it was ordered.
    expect(second.startedAt).toBe(queueCompletesAt(first).toISOString());
  });

  it('refuses a structure the Nexus has not authorised, and says which', () => {
    const repos = openStack();
    const base = seedBase(repos);
    const result = queueBuild(repos, { base, structure: 'garage', id: 'q1', now: NOW });
    expect(result).toEqual({ kind: 'refused', reason: 'locked' });
  });

  it('refuses a level the Nexus is holding down, distinctly from the content ceiling', () => {
    const repos = openStack();
    // §B1: the Generator's ladder wants Nexus 3 for level 4, so a Nexus 1 district stops at 3.
    // Given the materials, so the refusal that comes back is the Nexus's and not the stockpile's.
    const capped = seedBase(repos, {
      buildings: [build('nexus', 1), build('generator', 3)],
      resources: {
        caps: 99999,
        supplies: 99999,
        oil: 99999,
        scrap: 99999,
        highQualityMetal: 99999,
        planks: 99999,
      },
    });
    expect(queueBuild(repos, { base: capped, structure: 'generator', id: 'q1', now: NOW })).toEqual(
      {
        kind: 'refused',
        reason: 'nexus_cap',
      },
    );

    const maxed = { ...capped, buildings: [build('nexus', BUILDING_MAX_LEVEL)] };
    expect(queueBuild(repos, { base: maxed, structure: 'nexus', id: 'q2', now: NOW })).toEqual({
      kind: 'refused',
      reason: 'at_max_level',
    });
  });

  /**
   * The queue is four wide, and six once `Batch Runs` is researched (maintainer, 2026-09-22).
   *
   * This used to be called "refuses a seventh order" and seeded six entries on a crew with no
   * research at all. It still passed, because four is that crew's real cap and the refusal simply
   * fired three orders earlier than the name claimed, against a queue depth the game can no
   * longer produce. Both halves are walked now, and the fixture for each is a state that exists.
   */
  it('refuses a fifth order, and a seventh once the rung is in', () => {
    const repos = openStack();
    const full = seedBase(repos, {
      buildings: [build('nexus', BUILDING_MAX_LEVEL)],
      buildQueue: Array.from({ length: BASE_BUILD_QUEUE }, (_, i) =>
        entry('quarters', i + 1, NOW, 60),
      ),
    });
    expect(queueBuild(repos, { base: full, structure: 'greenhouse', id: 'q5', now: NOW })).toEqual({
      kind: 'refused',
      reason: 'queue_full',
    });

    // The same crew with the rung: the four it is holding are now inside its cap, so the order
    // that was refused a line ago goes through.
    const researched = {
      ...full,
      research: {
        ...full.research,
        technologies: [...full.research.technologies, BUILD_QUEUE_RESEARCH_ID],
      },
    };
    expect(
      queueBuild(repos, { base: researched, structure: 'greenhouse', id: 'q5b', now: NOW }),
    ).not.toEqual({ kind: 'refused', reason: 'queue_full' });

    // ...and it is still a cap, six entries up.
    const six = {
      ...researched,
      buildQueue: Array.from({ length: MAX_BUILD_QUEUE }, (_, i) =>
        entry('quarters', i + 1, NOW, 60),
      ),
    };
    expect(queueBuild(repos, { base: six, structure: 'greenhouse', id: 'q7', now: NOW })).toEqual({
      kind: 'refused',
      reason: 'queue_full',
    });
  });

  it('refuses what the stockpile cannot cover, and takes nothing', () => {
    const repos = openStack();
    const broke = seedBase(repos, {
      resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    });
    expect(queueBuild(repos, { base: broke, structure: 'quarters', id: 'q1', now: NOW })).toEqual({
      kind: 'refused',
      reason: 'cannot_afford',
    });
    expect(repos.bases.findById(broke.id)?.buildQueue).toEqual([]);
  });

  it('lets a player queue the Nexus and the structure it unlocks in one sitting', () => {
    const repos = openStack();
    const rich = seedBase(repos, {
      resources: {
        caps: 99999,
        supplies: 99999,
        oil: 99999,
        scrap: 99999,
        highQualityMetal: 99999,
        planks: 99999,
      },
      // Everything the Gate wants except the Nexus rung, already up.
      buildings: [build('nexus', 1), build('generator', 1), build('scrapyard', 3)],
    });

    let base = rich;
    /*
     * The claim under test is narrow and worth keeping narrow: **a prerequisite still in the queue
     * counts as met**, so a player can order the Nexus rung and the thing it opens without waiting.
     *
     * So only the Nexus is climbed here. The Gate's *other* clause, a Scrapyard, is standing
     * before the run starts, because six queue slots (`MAX_BUILD_QUEUE`) cannot hold three Nexus
     * levels, three Scrapyard levels and the Gate, and a test that failed on the queue cap would be
     * failing for a reason that has nothing to do with what it is asserting.
     */
    for (let i = buildingLevel(base.buildings, 'nexus'); i < nexusLevelFor('gate'); i += 1) {
      const result = queueBuild(repos, { base, structure: 'nexus', id: `n${i}`, now: NOW });
      expect(result.kind, `nexus order ${i}`).toBe('queued');
      if (result.kind !== 'queued') return;
      base = result.base;
    }
    expect(queueBuild(repos, { base, structure: 'gate', id: 'g1', now: NOW }).kind).toBe('queued');
  });
});

describe('settling the district (§A1)', () => {
  it('owes nothing on a read moments after the last one, and writes nothing', () => {
    const repos = openStack();
    const base = seedBase(repos);
    const settled = settleDistrict(repos, base, new Date(NOW.getTime() + 1));
    expect(settled.base).toBe(base);
    expect(settled.completed).toEqual([]);
  });

  it('does not lose the sub-second window it skipped', () => {
    const repos = openStack();
    const district = [build('nexus', 1), build('generator', 1), build('greenhouse', 5)];
    const base = seedBase(repos, { buildings: district });

    // A read below the step leaves the clock alone…
    const skipped = settleDistrict(
      repos,
      base,
      new Date(NOW.getTime() + PRODUCTION_MIN_STEP_MS / 2),
    );
    expect(skipped.base.economy.productionSettledAt).toBe(base.economy.productionSettledAt);

    // …so the next read that clears it accrues the whole hour, not the remainder.
    const later = settleDistrict(repos, skipped.base, new Date(NOW.getTime() + HOUR_MS));
    const expected = districtProduction(district).perHour.supplies ?? 0;
    expect(later.base.resources.supplies - base.resources.supplies).toBeCloseTo(expected, 6);
  });

  it('stands a finished order up, drops it from the queue and pays its XP', () => {
    const repos = openStack();
    const started = new Date(NOW.getTime() - HOUR_MS);
    const base = seedBase(repos, {
      buildQueue: [entry('quarters', 1, started, 60)],
      settledAt: started.toISOString(),
    });

    const settled = settleDistrict(repos, base, NOW);
    expect(buildingLevel(settled.base.buildings, 'quarters')).toBe(1);
    expect(settled.base.buildQueue).toEqual([]);
    expect(settled.completed).toHaveLength(1);
    expect(settled.awards).toHaveLength(1);
    expect(settled.base.progression.xpIntoLevel).toBeGreaterThan(0);

    // Persisted, and not paid twice.
    const stored = repos.bases.findById(base.id);
    expect(buildingLevel(stored?.buildings ?? [], 'quarters')).toBe(1);
    expect(settleDistrict(repos, settled.base, NOW).completed).toEqual([]);
  });

  /**
   * The XP is priced off the order's own clock, and this is the test that says so at the call site.
   *
   * `xpForClock` being correct proves nothing about whether the settler passes it: the flat table
   * entry was the bug, and it lived here rather than in the curve. Two orders of the same structure
   * at wildly different clocks, one settle, and the long one has to pay more.
   */
  it('pays a long build more XP than a short one', () => {
    const started = new Date(NOW.getTime() - 12 * HOUR_MS);
    // A stack each: `seedBase` writes the same username, so one crew per database.
    const settleOne = (durationSeconds: number) => {
      const repos = openStack();
      return settleDistrict(
        repos,
        seedBase(repos, {
          buildQueue: [entry('quarters', 1, started, durationSeconds)],
          settledAt: started.toISOString(),
        }),
        NOW,
      );
    };
    const quick = settleOne(60);
    const slow = settleOne(9 * 3600);

    expect(quick.awards[0]!.xpGained).toBe(xpForClock('buildingConstructed', 60));
    expect(slow.awards[0]!.xpGained).toBe(xpForClock('buildingConstructed', 9 * 3600));
    expect(slow.awards[0]!.xpGained).toBeGreaterThan(quick.awards[0]!.xpGained * 4);
  });

  /**
   * The bench, and the same rule at its own call site.
   *
   * Per unit at a flat rate is what would make Razors an XP faucet: forty-five seconds apiece,
   * twenty XP apiece, forever. The unit's own clock is what prices it, so a Colossus is worth
   * bringing off the bench and a Razor is worth what a Razor takes.
   */
  it('pays more XP for a unit that took longer to train', () => {
    const started = new Date(NOW.getTime() - 4 * HOUR_MS);
    const settleOne = (unitId: string) => {
      const repos = openStack();
      const unit = findUnit(unitId)!;
      const base = seedBase(repos, {
        trainingQueue: [
          {
            id: `order-${unitId}`,
            unitId,
            count: 1,
            delivered: 0,
            startedAt: started.toISOString(),
            durationSeconds: unit.trainSeconds,
            paid: {},
          },
        ],
      });
      return settleTraining(repos, base, NOW);
    };

    const cheap = settleOne('razors');
    const dear = settleOne('the_colossus');
    expect(cheap.awards).toHaveLength(1);
    expect(dear.awards).toHaveLength(1);
    expect(cheap.awards[0]!.xpGained).toBe(
      xpForClock('unitTrained', findUnit('razors')!.trainSeconds),
    );
    expect(dear.awards[0]!.xpGained).toBeGreaterThan(cheap.awards[0]!.xpGained * 4);
  });

  it('lands several orders in the order they were queued', () => {
    const repos = openStack();
    const started = new Date(NOW.getTime() - HOUR_MS);
    const base = seedBase(repos, {
      buildQueue: [entry('quarters', 1, started, 60), entry('greenhouse', 1, started, 120)],
      settledAt: started.toISOString(),
    });

    const settled = settleDistrict(repos, base, NOW);
    expect(settled.completed.map((e) => e.kind)).toEqual(['quarters', 'greenhouse']);
    expect(settled.awards).toHaveLength(2);
  });

  it('leaves an order that has not finished alone', () => {
    const repos = openStack();
    const base = seedBase(repos, { buildQueue: [entry('quarters', 1, NOW, 600)] });
    const settled = settleDistrict(repos, base, new Date(NOW.getTime() + 60_000));
    expect(settled.completed).toEqual([]);
    expect(settled.base.buildQueue).toHaveLength(1);
    expect(buildingLevel(settled.base.buildings, 'quarters')).toBe(0);
  });

  /**
   * The piecewise walk is the whole reason `settleDistrict` is not one multiplication.
   *
   * A Greenhouse that finished an hour ago must pay for one hour, not for the three days the
   * district went unread, and the only way to tell the two apart is to compare against a district
   * where the same structure had been standing the whole time.
   */
  it('does not back-date a structure that finished partway through the window', () => {
    const repos = openStack();
    const start = new Date(NOW.getTime() - 3 * HOUR_MS);
    const landedAt = new Date(NOW.getTime() - HOUR_MS);

    const late = seedBase(repos, {
      buildQueue: [entry('greenhouse', 1, new Date(landedAt.getTime() - 60_000), 60)],
      settledAt: start.toISOString(),
    });
    const lateSettled = settleDistrict(repos, late, NOW);

    const alwaysThere = districtProduction([
      build('nexus', 1),
      build('generator', 1),
      build('greenhouse', 1),
    ]).perHour.supplies;

    // The carry has to come into it: §A2 folded the Cistern into the Greenhouse's rate, which is
    // 19.2 an hour, so one hour banks 19 whole units and holds 0.2 back. Comparing the banked
    // figure alone would be comparing a truncation to a rate.
    const grown =
      lateSettled.base.resources.supplies -
      late.resources.supplies +
      (lateSettled.base.economy.productionCarry.supplies ?? 0);
    // One hour's worth, not three.
    expect(grown).toBeCloseTo(alwaysThere ?? 0, 4);
    expect(grown).toBeLessThan((alwaysThere ?? 0) * 2);
  });

  /**
   * §A1: the grid is gone, so a district left alone does not come back poorer.
   *
   * The Generator used to burn oil to hold the grid up, which meant a new crew who put the game
   * down for three days came back with less fuel than they left. Nothing in the game consumes a
   * resource on a clock any more, and this is the assertion that says so by name.
   *
   * Oil used to be pinned flat here for the same reason. The Generator is the fuel line as of
   * 2026-09-15, so the fixture's one structure pays out over three days and the half that still
   * has to hold is the direction: three days away is never a loss, on any resource.
   */
  it('§A1: takes nothing off the stockpile over a long absence', () => {
    const repos = openStack();
    const start = new Date(NOW.getTime() - 72 * HOUR_MS);
    const base = seedBase(repos, { settledAt: start.toISOString() });

    const settled = settleDistrict(repos, base, NOW);
    expect(settled.base.resources.oil, 'the Generator runs while nobody is home').toBeGreaterThan(
      base.resources.oil,
    );
    for (const key of RESOURCE_KEYS) {
      expect(settled.base.resources[key], key).toBeGreaterThanOrEqual(base.resources[key]);
    }
  });

  it('starts the clock rather than back-paying a base that predates production', () => {
    const repos = openStack();
    const base = seedBase(repos, { settledAt: null });
    const settled = settleDistrict(repos, base, NOW);
    expect(settled.base.resources).toEqual(base.resources);
    expect(settled.base.economy.productionSettledAt).toBe(NOW.toISOString());
  });
});

describe('unit slots (§A1: one pool)', () => {
  /**
   * §A1, as the maintainer rewrote it on 2026-09-15: **the officers and the yard draw on the pool
   * too**, one bed each, alongside the army's slots.
   *
   * Officers were charged, then were not on the argument that nineteen of them against a ceiling in
   * the hundreds was a rounding error, and are charged again. The rule is the simple one now: if
   * the crew feeds it or parks it, the district is housing it.
   */
  it('charges the army, the officers and the yard against the ceiling', () => {
    const repos = openStack();
    const officers = [createCommander('o1', 'One', 'master_of_whispers')];
    const base = seedBase(repos, {
      officers,
      buildings: [build('nexus', 1), build('generator', 1), build('quarters', 2)],
    });

    const withOfficer = districtUnitSlots(repos, base);
    expect(withOfficer.officers).toBe(1);
    expect(withOfficer.total, 'one officer, one bed').toBe(1);

    // §A5: Razors are one unit slot apiece, so five of them is five units rather than one roster entry.
    const withArmy: Base = { ...base, army: { razors: 5 } };
    const fielded = districtUnitSlots(repos, withArmy);
    expect(fielded.army).toBe(5);
    expect(fielded.total).toBe(6);
    expect(fielded.spare).toBe(withOfficer.spare - 5);

    // §C: and a machine is one bed whatever it seats. The Heli Porter carries twelve.
    const withYard: Base = { ...withArmy, fleet: { motorcycle: 2, heli_porter: 1 } };
    const parked = districtUnitSlots(repos, withYard);
    expect(parked.fleet).toBe(3);
    expect(parked.total).toBe(9);
    expect(parked.spare).toBe(fielded.spare - 3);
  });

  /**
   * §A5 through the real route: the pool is a ceiling on the army, and officers eat into it.
   *
   * This is the consequence the merge exists for. Before it, the Gauntlet ran a separate army cap
   * and a crew could fill both pools without either noticing; the only way to see that the merge
   * actually happened is to hire somebody and watch the roster get smaller.
   */
  it('refuses an order the district has no beds for, and hiring makes it refuse sooner', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [build('nexus', 1), build('generator', 1), build('gauntlet', 4)],
      resources: {
        caps: 900_000,
        supplies: 900_000,
        oil: 900_000,
        scrap: 900_000,
        highQualityMetal: 0,
        planks: 900_000,
      },
    });
    const razors = findUnit('razors')!;
    const room = districtUnitSlots(repos, base).spare;

    expect(queueTraining(repos, { base, unit: razors, count: room + 1, now: NOW })).toEqual({
      kind: 'refused',
      reason: 'no_unit_slots',
    });

    const filled = queueTraining(repos, { base, unit: razors, count: room, now: NOW });
    expect(filled.kind).toBe('queued');

    // ...and signing somebody takes a bed off the army, which is the maintainer's rule (§A1).
    const withOfficer = {
      ...base,
      commanders: [createCommander('o1', 'One', 'master_of_whispers')],
    };
    expect(districtUnitSlots(repos, withOfficer).spare).toBe(room - 1);
  });

  /**
   * The roster's chip and **Max** subtract to the same figure the training door compares against.
   *
   * `unitSlotsCap - unitSlotsUsed` is exactly what Max offers, and the route refuses anything past
   * `districtUnitSlots`'s `spare`. Sending the roster a draw that leaves the officers and the yard
   * out is Max proposing a batch the door then turns away, which is the defect this pins: it needs
   * a crew that actually has an officer and a machine, or the two numbers agree by accident.
   */
  it('sends the roster a draw that subtracts to the same beds the training door counts', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      officers: [
        createCommander('o1', 'One', 'master_of_whispers'),
        createCommander('o2', 'Two', null),
      ],
      buildings: [build('nexus', 1), build('generator', 1), build('quarters', 4)],
    });
    const crew: Base = { ...base, army: { razors: 3 }, fleet: { motorcycle: 2 } };

    const slots = districtUnitSlots(repos, crew);
    const page = projectUnits(repos, crew, NOW);
    expect(slots.officers).toBe(2);
    expect(slots.fleet).toBe(2);
    expect(page.unitSlotsCap - page.unitSlotsUsed).toBe(slots.spare);
  });

  /**
   * One fixture through both counters, across the two doors this module owns for a unit leaving
   * or entering the district: posting a garrison and calling a batch off. The refusal's `spare`
   * and the roster's `unitSlotsCap - unitSlotsUsed` have to move together at every step, and a garrison
   * has to move neither: a unit on a rooftop is still fed from home.
   */
  it('keeps the door and the roster on one figure through a garrison and a cancelled batch', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [
        build('nexus', 1),
        build('generator', 1),
        build('quarters', 4),
        build('gauntlet', 4),
      ],
      resources: {
        caps: 900_000,
        supplies: 900_000,
        oil: 900_000,
        scrap: 900_000,
        highQualityMetal: 0,
        planks: 900_000,
      },
    });
    const crew: Base = { ...base, army: { razors: 6 } };
    repos.bases.updateArmy(crew.id, crew.army, crew.trainingQueue);
    const agree = (at: Base, label: string): number => {
      const slots = districtUnitSlots(repos, at);
      const page = projectUnits(repos, at, NOW);
      expect(page.unitSlotsUsed, label).toBe(slots.total);
      expect(page.unitSlotsCap - page.unitSlotsUsed, label).toBe(slots.spare);
      return slots.total;
    };
    const home = agree(crew, 'six at home');

    // Two Razors onto held ground: the roster shrinks, the district does not.
    const location = CITY_LOCATIONS[0]!;
    repos.city.put({
      ...repos.city.control(location.id)!,
      holder: { kind: 'crew', baseId: crew.id },
      garrison: {},
    });
    const posted = setGarrison(repos, { base: crew, location, changes: { razors: 2 } });
    if (posted.kind !== 'ok') throw new Error(`fixture: garrison refused ${posted.reason}`);
    expect(posted.base.army).toEqual({ razors: 4 });
    expect(agree(posted.base, 'two posted'), 'a garrison is still fed from home').toBe(home);

    // A batch of two claims two beds at the order, and hands them back when it is called off.
    const razors = findUnit('razors')!;
    const queued = queueTraining(repos, { base: posted.base, unit: razors, count: 2, now: NOW });
    if (queued.kind !== 'queued') throw new Error(`fixture: order refused ${queued.reason}`);
    expect(agree(queued.base, 'two on the bench')).toBe(home + 2);
    const cancelled = cancelTraining(repos, queued.base, queued.order.id, NOW);
    if (cancelled.kind !== 'cancelled') throw new Error('fixture: cancel refused');
    expect(agree(cancelled.base, 'batch called off')).toBe(home);

    // And bringing the two home changes nothing either: they were counted the whole time.
    const recalled = setGarrison(repos, {
      base: cancelled.base,
      location,
      changes: { razors: -2 },
    });
    if (recalled.kind !== 'ok') throw new Error('fixture: recall refused');
    expect(recalled.base.army).toEqual({ razors: 6 });
    expect(agree(recalled.base, 'two home again')).toBe(home);
  });

  it('houses more people for every location the crew holds', () => {
    const repos = openStack();
    const base = seedBase(repos, { buildings: [build('nexus', 1), build('quarters', 2)] });
    const bare = districtUnitSlots(repos, base).capacity;

    const location = CITY_LOCATIONS[0]!;
    const held = repos.city.control(location.id)!;
    repos.city.put({ ...held, holder: { kind: 'crew', baseId: base.id } });

    expect(districtUnitSlots(repos, base).capacity).toBe(bare + UNIT_SLOTS_PER_LOCATION);
  });
});

describe('modification brackets (§E)', () => {
  /**
   * §E: a bracket is emptied from the structure, and what comes out is destroyed.
   *
   * Filling one is the Scrapyard's own press as of 2026-09-16 (`district/scrapyard.ts` cuts the
   * card for a named structure and bolts it in), so the half that lives here is the other one.
   * There is no shelf for it to go back to: the card is gone and putting the same one in again
   * means paying the yard again, which is the whole weight behind choosing a bracket.
   */
  it('empties a bracket, destroys what was in it, and refuses to empty it twice', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [
        build('nexus', 20),
        { id: 'lab-1', kind: 'lab', level: 20, modifications: ['lab_quantum_modeling'] },
      ],
    });

    const cleared = clearSlot(repos, base, 'lab', 0);
    expect(cleared.kind).toBe('cleared');
    const emptied = cleared.kind === 'cleared' ? cleared.base : base;
    expect(findBuilding(emptied.buildings, 'lab')?.modifications).toEqual([]);
    // Nowhere to be found: not on the structure, and not on a shelf either, because there is none.
    expect(addonsOf(emptied).built).toEqual([]);

    expect(clearSlot(repos, emptied, 'lab', 0)).toEqual({
      kind: 'refused',
      reason: 'already_empty',
    });
  });

  it('refuses a bracket the structure does not have', () => {
    const repos = openStack();
    const base = seedBase(repos, { buildings: [build('nexus', 20), build('lab', 20)] });
    // A slot index past the three every structure has.
    expect(clearSlot(repos, base, 'lab', 9)).toEqual({ kind: 'refused', reason: 'bad_slot' });
    // ...and a structure that is not standing at all.
    expect(clearSlot(repos, base, 'gate', 0)).toEqual({
      kind: 'refused',
      reason: 'no_structure',
    });
  });
});

/**
 * §B4: the Generator's paid burn.
 *
 * Three claims the maintainer made and one it did not have to: it costs oil by Generator level, it runs
 * for two hours, it reaches work already in the queue, and buying a second one while one runs is
 * refused rather than stacked.
 */
describe('§B4: the Generator’s two-hour burn', () => {
  const RICH: Resources = {
    caps: 99999,
    supplies: 99999,
    oil: 99999,
    scrap: 99999,
    highQualityMetal: 99999,
    planks: 99999,
  };

  it('charges 250 oil a Generator level and refuses a second burn', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      resources: RICH,
      buildings: [build('nexus', 6), build('generator', 4)],
    });

    const lit = buyBuildBoost(repos, base, NOW);
    expect(lit.kind).toBe('lit');
    if (lit.kind !== 'lit') return;
    expect(lit.paid.oil).toBe(4 * BUILD_BOOST_OIL_PER_LEVEL);
    expect(lit.base.resources.oil).toBe(RICH.oil - 4 * BUILD_BOOST_OIL_PER_LEVEL);
    expect(buildBoostActive(lit.base.economy.buildBoostUntil, NOW)).toBe(true);

    expect(buyBuildBoost(repos, lit.base, NOW)).toEqual({
      kind: 'refused',
      reason: 'already_running',
    });
    // ...and it has run out two hours later, to the second.
    const after = new Date(NOW.getTime() + BUILD_BOOST_MS);
    expect(buildBoostActive(lit.base.economy.buildBoostUntil, after)).toBe(false);
  });

  it('refuses a crew with no Generator, and one that cannot cover the oil', () => {
    const repos = openStack();
    const noGenerator = seedBase(repos, { buildings: [build('nexus', 6)] });
    expect(buyBuildBoost(repos, noGenerator, NOW)).toEqual({
      kind: 'refused',
      reason: 'no_generator',
    });

    const broke: Base = {
      ...noGenerator,
      buildings: [build('nexus', 6), build('generator', 4)],
      resources: { ...RICH, oil: 10 },
    };
    expect(buyBuildBoost(repos, broke, NOW)).toEqual({ kind: 'refused', reason: 'cannot_afford' });
  });

  it('shortens work already in the queue and work ordered during it', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      resources: RICH,
      buildings: [build('nexus', 6), build('generator', 4)],
    });

    const first = queueBuild(repos, { base, structure: 'quarters', id: 'q1', now: NOW });
    expect(first.kind).toBe('queued');
    if (first.kind !== 'queued') return;
    const beforeSeconds = first.entry.durationSeconds;

    const lit = buyBuildBoost(repos, first.base, NOW);
    expect(lit.kind).toBe('lit');
    if (lit.kind !== 'lit') return;
    // Nothing has been worked yet, so the whole order shrinks by the burn's percentage.
    expect(lit.base.buildQueue[0]?.durationSeconds).toBe(
      Math.round(beforeSeconds * (1 - BUILD_BOOST_PERCENT / 100)),
    );

    // And an order placed during the burn arrives already short.
    const during = queueBuild(repos, {
      base: lit.base,
      structure: 'greenhouse',
      id: 'q2',
      now: NOW,
    });
    expect(during.kind).toBe('queued');
    if (during.kind !== 'queued') return;
    const unboosted = queueBuild(repos, {
      base: { ...lit.base, economy: { ...lit.base.economy, buildBoostUntil: null } },
      structure: 'greenhouse',
      id: 'q3',
      now: NOW,
    });
    expect(unboosted.kind).toBe('queued');
    if (unboosted.kind !== 'queued') return;
    expect(during.entry.durationSeconds).toBeLessThan(unboosted.entry.durationSeconds);
  });
});

describe('the build clock a player is quoted is the one they get', () => {
  it('freezes the duration at order time, so raising the Nexus cannot retime it', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      resources: {
        caps: 99999,
        supplies: 99999,
        oil: 99999,
        scrap: 99999,
        highQualityMetal: 99999,
        planks: 99999,
      },
    });

    const quoted = buildingBuildSeconds('quarters', 1, base.buildings);
    const result = queueBuild(repos, { base, structure: 'quarters', id: 'q1', now: NOW });
    expect(result.kind).toBe('queued');
    if (result.kind !== 'queued') return;
    expect(result.entry.durationSeconds).toBe(quoted);

    // §B4: a Generator that goes up afterwards shortens the *next* order, not this one.
    const raised: Base = {
      ...result.base,
      buildings: [build('nexus', 10), build('generator', 10)],
    };
    expect(raised.buildQueue[0]?.durationSeconds).toBe(quoted);
    expect(buildingBuildSeconds('quarters', 1, raised.buildings)).toBeLessThan(quoted);
  });

  /**
   * The dialog quotes `/me`'s clock, and that clock has to be the one the order freezes. It used
   * to quote the catalogue's bare seconds, which no crew with a lit Generator or a speed effect
   * was ever actually charged.
   */
  it('quotes a clock that is exactly what the order then freezes, burn included', () => {
    const repos = openStack();
    const seeded = seedBase(repos, {
      resources: {
        caps: 99999,
        supplies: 99999,
        oil: 99999,
        scrap: 99999,
        highQualityMetal: 99999,
        planks: 99999,
      },
    });
    const lit: Base = {
      ...seeded,
      economy: {
        ...seeded.economy,
        buildBoostUntil: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
      },
    };
    repos.bases.updateEconomy(lit.id, lit.economy);

    const clocks = buildClocksFor(repos, lit, NOW, false);
    const quoted = clocks.quarters;
    expect(quoted).toBeDefined();
    expect(quoted).toBeLessThan(buildingBuildSeconds('quarters', 1, lit.buildings));

    const result = queueBuild(repos, { base: lit, structure: 'quarters', id: 'q1', now: NOW });
    expect(result.kind).toBe('queued');
    if (result.kind !== 'queued') return;
    expect(result.entry.durationSeconds).toBe(quoted);
  });
});

/**
 * §A5: calling a batch off, and the crash that made the whole game unloadable.
 *
 * Run against a real sqlite stack because half of what is asserted is that the row survives a
 * write and a read: the bug this pins was a *read* refusing a row the write had allowed.
 */
describe('the bench (§A5)', () => {
  const rich: Resources = {
    caps: 900_000,
    supplies: 900_000,
    oil: 900_000,
    scrap: 900_000,
    highQualityMetal: 900_000,
    planks: 900_000,
  };

  const stack = () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [build('nexus', 1), build('generator', 1), build('gauntlet', 6)],
      resources: rich,
    });
    return { repos, base };
  };

  it('records what a batch was charged, so a refund is against the price paid', () => {
    const { repos, base } = stack();
    const razors = findUnit('razors')!;
    const result = queueTraining(repos, { base, unit: razors, count: 4, now: NOW });
    expect(result.kind).toBe('queued');
    if (result.kind !== 'queued') return;

    expect(result.order.paid).toEqual(trainingCost(razors, 4));
    // And it is on the row after a round trip, which is the half a unit test cannot see.
    expect(repos.bases.findById(base.id)!.trainingQueue[0]!.paid).toEqual(trainingCost(razors, 4));
  });

  it('hands 95% back inside the window and refuses once the work has started', () => {
    const { repos, base } = stack();
    const razors = findUnit('razors')!;
    const queued = queueTraining(repos, { base, unit: razors, count: 4, now: NOW });
    if (queued.kind !== 'queued') throw new Error('expected the batch to be queued');

    const order = queued.order;
    const late = new Date(NOW.getTime() + order.durationSeconds * 1000 * 0.5);
    expect(cancelTraining(repos, queued.base, order.id, late)).toEqual({
      kind: 'refused',
      reason: 'window_closed',
    });

    const cancelled = cancelTraining(repos, queued.base, order.id, NOW);
    expect(cancelled.kind).toBe('cancelled');
    if (cancelled.kind !== 'cancelled') return;

    expect(cancelled.base.trainingQueue).toHaveLength(0);
    // Back on the row, not only in the answer.
    const stored = repos.bases.findById(base.id)!;
    expect(stored.trainingQueue).toHaveLength(0);
    expect(stored.resources.caps).toBe(queued.base.resources.caps + (cancelled.refund.caps ?? 0));
    // Ninety-five percent, so the crew is out of pocket either way.
    expect(stored.resources.caps).toBeLessThan(base.resources.caps);
  });

  it('says so rather than throwing when the order is not there', () => {
    const { repos, base } = stack();
    expect(cancelTraining(repos, base, 'no-such-order', NOW)).toEqual({
      kind: 'refused',
      reason: 'unknown_order',
    });
  });

  /**
   * The bench closes up behind a cancelled order.
   *
   * Every order's `startedAt` is absolute and frozen at the completion time of the order in front
   * of it, so removing one from the middle used to leave the ones behind it waiting out a batch
   * that no longer existed. Twenty-two idle minutes on the shipped numbers, on top of the 5% the
   * rules do state.
   */
  it('pulls the orders behind a cancelled one forward', () => {
    const { repos, base } = stack();
    const razors = findUnit('razors')!;
    const first = queueTraining(repos, { base, unit: razors, count: 20, now: NOW });
    if (first.kind !== 'queued') throw new Error('expected the first batch to be queued');
    const second = queueTraining(repos, { base: first.base, unit: razors, count: 2, now: NOW });
    if (second.kind !== 'queued') throw new Error('expected the second batch to be queued');

    // The precondition: the second batch really is parked behind the first, or there is no gap to
    // close and the assertion below would pass on any implementation.
    expect(Date.parse(second.order.startedAt)).toBeGreaterThan(NOW.getTime());

    const cancelled = cancelTraining(repos, second.base, first.order.id, NOW);
    if (cancelled.kind !== 'cancelled') throw new Error(`refused: ${cancelled.reason}`);

    const remaining = cancelled.base.trainingQueue;
    expect(remaining).toHaveLength(1);
    expect(Date.parse(remaining[0]!.startedAt)).toBe(NOW.getTime());
    // On the row too, not only in the answer.
    expect(Date.parse(repos.bases.findById(base.id)!.trainingQueue[0]!.startedAt)).toBe(
      NOW.getTime(),
    );
  });

  it('does not move an order that has already begun', () => {
    const { repos, base } = stack();
    const razors = findUnit('razors')!;
    const first = queueTraining(repos, { base, unit: razors, count: 2, now: NOW });
    if (first.kind !== 'queued') throw new Error('expected the first batch to be queued');
    const second = queueTraining(repos, { base: first.base, unit: razors, count: 20, now: NOW });
    if (second.kind !== 'queued') throw new Error('expected the second batch to be queued');
    const third = queueTraining(repos, { base: second.base, unit: razors, count: 2, now: NOW });
    if (third.kind !== 'queued') throw new Error('expected the third batch to be queued');

    // Cancel the middle one while the first is still running.
    const cancelled = cancelTraining(repos, third.base, second.order.id, NOW);
    if (cancelled.kind !== 'cancelled') throw new Error(`refused: ${cancelled.reason}`);

    const [running, next] = cancelled.base.trainingQueue;
    expect(running!.startedAt).toBe(first.order.startedAt);
    // The one behind now starts when the running batch finishes, not when the cancelled one would
    // have.
    expect(Date.parse(next!.startedAt)).toBe(
      Date.parse(first.order.startedAt) + first.order.durationSeconds * 1000,
    );
  });

  /**
   * The crash. Testing mode waives `queue_full`, so a sixth order went onto the bench, and the
   * stored schema then capped the array at five: every later read of that crew threw out of
   * `rowToBase`, `GET /me` 500ed, and the client showed `UPLINK FAILED` with no way back, because
   * the crew could not be loaded to drain the queue either.
   */
  it('loads a crew whose bench is longer than the cap', () => {
    const { repos, base } = stack();
    const razors = findUnit('razors')!;
    let current = base;
    for (let i = 0; i < MAX_TRAINING_QUEUE + 2; i += 1) {
      const result = queueTraining(repos, {
        base: current,
        unit: razors,
        count: 1,
        now: NOW,
        admin: true,
      });
      if (result.kind !== 'queued') throw new Error(`refused at ${i}: ${result.reason}`);
      current = result.base;
    }

    const reloaded = repos.bases.findById(base.id);
    expect(reloaded?.trainingQueue).toHaveLength(MAX_TRAINING_QUEUE + 2);
  });

  /** ...and the gate itself still holds for anybody not in testing mode. */
  it('still refuses a sixth order in an ordinary build', () => {
    const { repos, base } = stack();
    const razors = findUnit('razors')!;
    let current = base;
    for (let i = 0; i < MAX_TRAINING_QUEUE; i += 1) {
      const result = queueTraining(repos, { base: current, unit: razors, count: 1, now: NOW });
      if (result.kind !== 'queued') throw new Error(`refused at ${i}: ${result.reason}`);
      current = result.base;
    }
    expect(queueTraining(repos, { base: current, unit: razors, count: 1, now: NOW })).toEqual({
      kind: 'refused',
      reason: 'queue_full',
    });
  });
});

/**
 * §A4: the ground pays, and for a long time it did not.
 *
 * Every `resource` bonus in `city/locations.ts` folds into `TerritoryEffects.perHour`, and
 * `combineEffects` merges it with the crew's. Nothing then spent it. `accrueProduction` priced the
 * window off `districtProduction(buildings)` alone, so a crew that had taken and held **every
 * location in the city** banked exactly nothing from any of them: the whole map game, which is
 * what §A4 is, paid zero resources.
 *
 * It was invisible because holding ground pays in other ways too (housing, defence, unlocks) and
 * because a district almost always has structures making the same resources, so the stockpile was
 * always moving. It was found by settling a crew with **no buildings at all** and a full sweep of
 * the map, where the only thing that could have paid is the ground.
 *
 * That is what the first test does, and it is the shape worth keeping: with nothing built, every
 * cap in the stockpile came off the map.
 */
describe('what the ground makes (§A4)', () => {
  const HOURS = 10;
  const noBuildings: Building[] = [];

  function holdingEverything(repos: Repositories): Base {
    const base = seedBase(repos, {
      buildings: noBuildings,
      settledAt: '2026-09-01T00:00:00.000Z',
    });
    for (const location of CITY_LOCATIONS) {
      const control = repos.city.control(location.id);
      if (control) {
        repos.city.put({ ...control, holder: { kind: 'crew', baseId: base.id }, garrison: {} });
      }
    }
    return repos.bases.findById(base.id)!;
  }

  it('pays a crew that holds the city, with nothing built at all', () => {
    const repos = openStack();
    const base = holdingEverything(repos);
    const before = base.resources;

    const after = settleBase(
      repos,
      base,
      new Date(Date.parse(base.economy.productionSettledAt!) + HOURS * 3600_000),
    ).base;

    // Caps have no storage ceiling, so this is the line that shows the full rate arriving.
    const territory = territoryEffectsFor(base.id, CITY_LOCATIONS, repos.city.controls());
    expect(territory.perHour.caps ?? 0).toBeGreaterThan(0);
    expect(after.resources.caps - before.caps).toBe((territory.perHour.caps ?? 0) * HOURS);
  });

  it('pays nothing to a crew that holds no ground', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: noBuildings,
      settledAt: '2026-09-01T00:00:00.000Z',
    });

    const after = settleBase(
      repos,
      base,
      new Date(Date.parse(base.economy.productionSettledAt!) + HOURS * 3600_000),
    ).base;

    expect(after.resources.caps).toBe(base.resources.caps);
  });

  /** And the ground's output is added to what is built rather than replacing it. */
  it('adds to what the district makes for itself', () => {
    const bare = openStack();
    const held = openStack();
    const withoutGround = seedBase(bare, {
      buildings: [build('scrapyard', 5)],
      settledAt: '2026-09-01T00:00:00.000Z',
    });
    const withGround = (() => {
      const base = seedBase(held, {
        buildings: [build('scrapyard', 5)],
        settledAt: '2026-09-01T00:00:00.000Z',
      });
      for (const location of CITY_LOCATIONS) {
        const control = held.city.control(location.id);
        if (control) {
          held.city.put({ ...control, holder: { kind: 'crew', baseId: base.id }, garrison: {} });
        }
      }
      return held.bases.findById(base.id)!;
    })();

    const at = (base: Base) =>
      new Date(Date.parse(base.economy.productionSettledAt!) + HOURS * 3600_000);
    const plain = settleBase(bare, withoutGround, at(withoutGround)).base;
    const rich = settleBase(held, withGround, at(withGround)).base;

    expect(rich.resources.caps).toBeGreaterThan(plain.resources.caps);
  });
});
