import {
  BUILDING_MAX_LEVEL,
  MAX_BUILD_QUEUE,
  MODIFICATIONS,
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
  findModification,
  queueCompletesAt,
  researchCost,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Base,
  type Building,
  type BuildQueue,
  type Resources,
  startingTraining,
  CITY_LOCATIONS,
  POPULATION_PER_LOCATION,
  xpForClock,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { queueBuild } from './build.js';
import { fitModification, modificationBlocker, modificationOptions } from './modifications.js';
import { districtPopulation } from './population.js';
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
  damage: 0,
  fortification: 0,
});

interface SeedOptions {
  buildings?: Building[];
  buildQueue?: BuildQueue;
  resources?: Resources;
  settledAt?: string | null;
  officers?: Base['commanders'];
  level?: number;
  trainingQueue?: Base['trainingQueue'];
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

    for (const [index, kind] of (['quarters', 'greenhouse'] as const).entries()) {
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
    const capped = seedBase(repos, { buildings: [build('nexus', 1), build('generator', 1)] });
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

  it('refuses a seventh order', () => {
    const repos = openStack();
    const full = seedBase(repos, {
      buildings: [build('nexus', BUILDING_MAX_LEVEL)],
      buildQueue: Array.from({ length: MAX_BUILD_QUEUE }, (_, i) =>
        entry('quarters', i + 1, NOW, 60),
      ),
    });
    expect(queueBuild(repos, { base: full, structure: 'greenhouse', id: 'q7', now: NOW })).toEqual({
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
   * Per body at a flat rate is what would make Razors an XP faucet: forty-five seconds apiece,
   * twenty XP apiece, forever. The unit's own clock is what prices it, so a Colossus is worth
   * bringing off the bench and a Razor is worth what a Razor takes.
   */
  it('pays more XP for a body that took longer to train', () => {
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

    const grown = lateSettled.base.resources.supplies - late.resources.supplies;
    // One hour's worth, not three.
    expect(grown).toBeCloseTo(alwaysThere ?? 0, 4);
    expect(grown).toBeLessThan((alwaysThere ?? 0) * 2);
  });

  it('burns the Generator’s fuel over a long absence', () => {
    const repos = openStack();
    const start = new Date(NOW.getTime() - 72 * HOUR_MS);
    const base = seedBase(repos, { settledAt: start.toISOString() });

    const settled = settleDistrict(repos, base, NOW);
    expect(settled.base.resources.oil).toBeLessThan(base.resources.oil);
    // But not to nothing: a new district's Generator is barely loaded, so three days of neglect
    // must not be what ends the first session.
    expect(settled.base.resources.oil).toBeGreaterThan(base.resources.oil * 0.5);
  });

  it('starts the clock rather than back-paying a base that predates production', () => {
    const repos = openStack();
    const base = seedBase(repos, { settledAt: null });
    const settled = settleDistrict(repos, base, NOW);
    expect(settled.base.resources).toEqual(base.resources);
    expect(settled.base.economy.productionSettledAt).toBe(NOW.toISOString());
  });
});

describe('population (§A1: one pool)', () => {
  it('counts officers and soldiers against the same ceiling', () => {
    const repos = openStack();
    const officers = [createCommander('o1', 'One', 'head_spy')];
    const base = seedBase(repos, {
      officers,
      buildings: [build('nexus', 1), build('generator', 1), build('quarters', 2)],
    });

    const withOfficer = districtPopulation(repos, base);
    expect(withOfficer.total).toBe(1);

    // §A5, and the army draws on the same beds, which is the whole point of merging the pools.
    // Razors are supply 1 apiece, so five of them is five bodies and not one entry on a roster.
    const withArmy: Base = { ...base, army: { razors: 5 } };
    const fielded = districtPopulation(repos, withArmy);
    expect(fielded.army).toBe(5);
    expect(fielded.total).toBe(withOfficer.total + 5);
    expect(fielded.spare).toBe(withOfficer.spare - 5);
  });

  /**
   * §A5 through the real route: the pool is a ceiling on the army, and officers eat into it.
   *
   * This is the consequence the merge exists for. Before it, the Gauntlet ran a separate army cap
   * and a crew could fill both pools without either noticing; the only way to see that the merge
   * actually happened is to hire somebody and watch the roster get smaller.
   */
  it('refuses an order the district has no beds for, and officers make it refuse sooner', () => {
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
    const room = districtPopulation(repos, base).spare;

    expect(queueTraining(repos, { base, unit: razors, count: room + 1, now: NOW })).toEqual({
      kind: 'refused',
      reason: 'no_supply',
    });

    const filled = queueTraining(repos, { base, unit: razors, count: room, now: NOW });
    expect(filled.kind).toBe('queued');

    // And the beds an officer is in are beds a soldier is not.
    const withOfficer = { ...base, commanders: [createCommander('o1', 'One', 'head_spy')] };
    expect(districtPopulation(repos, withOfficer).spare).toBe(room - 1);
  });

  it('houses more people for every location the crew holds', () => {
    const repos = openStack();
    const base = seedBase(repos, { buildings: [build('nexus', 1), build('quarters', 2)] });
    const bare = districtPopulation(repos, base).capacity;

    const location = CITY_LOCATIONS[0]!;
    const held = repos.city.control(location.id)!;
    repos.city.put({ ...held, holder: { kind: 'faction', baseId: base.id } });

    expect(districtPopulation(repos, base).capacity).toBe(bare + POPULATION_PER_LOCATION);
  });
});

describe('modifications (§A1, §C4)', () => {
  const engineer = () => [createCommander('eng', 'Wrench', 'lead_engineer')];
  const rich: Resources = {
    caps: 9999,
    supplies: 9999,
    oil: 9999,
    scrap: 9999,
    highQualityMetal: 9999,
    planks: 9999,
  };

  it('reports the whole catalogue, every entry with a reason it is not startable', () => {
    const repos = openStack();
    const base = seedBase(repos);
    const options = modificationOptions(base);

    expect(options).toHaveLength(MODIFICATIONS.length);
    // A brand-new district has built almost nothing, so everything belonging to a structure that is
    // not standing reports `not_built`: exactly that many, no more and no fewer. Counted off the
    // catalogue rather than written down, because a magic number here is a number that goes stale
    // the next time a structure joins or leaves the game and reports nothing when it does.
    const standing = MODIFICATIONS.filter(
      (spec) => buildingLevel(base.buildings, spec.building) > 0,
    );
    expect(standing.length, 'a brand-new district has something built').toBeGreaterThan(0);
    expect(options.filter((o) => o.blocker === 'not_built')).toHaveLength(
      MODIFICATIONS.length - standing.length,
    );
    expect(options.every((o) => !o.installed)).toBe(true);
  });

  it('walks the gates in order: build it, open a slot, hire an engineer, then pay', () => {
    const spec = findModification('lab_quantum_modeling');
    if (!spec) throw new Error('fixture error: the Lab modification is missing');

    const withLab = (level: number, options: Partial<SeedOptions> = {}) =>
      seedBase(openStack(), {
        buildings: [build('nexus', 10), build('generator', 1), build('lab', level)],
        ...options,
      });

    // Not built at all is the first thing a player is told, before anything about slots.
    expect(
      modificationBlocker(
        seedBase(openStack(), { buildings: [build('nexus', 10), build('generator', 1)] }),
        spec,
      ),
    ).toBe('not_built');

    expect(modificationBlocker(withLab(4), spec)).toBe('no_slot');
    expect(modificationBlocker(withLab(5), spec)).toBe('no_lead_engineer');
    expect(modificationBlocker(withLab(5, { officers: engineer() }), spec)).toBe('cannot_afford');
    expect(modificationBlocker(withLab(5, { officers: engineer(), resources: rich }), spec)).toBe(
      null,
    );
  });

  it('refuses a fourth modification once all three slots are full', () => {
    const spec = findModification('lab_shielded_datacore');
    if (!spec) throw new Error('fixture error: the Lab modification is missing');

    const full = seedBase(openStack(), {
      buildings: [
        build('nexus', 20),
        build('generator', 1),
        build('lab', 20, [
          'lab_quantum_modeling',
          'lab_neural_drafting_table',
          'lab_redundant_testing_chambers',
        ]),
      ],
      officers: engineer(),
      resources: rich,
    });
    expect(modificationBlocker(full, spec)).toBe('no_slot');
  });

  it('prices modification work in materials as well as caps', () => {
    const cost = researchCost('modification');
    expect(cost.caps).toBeGreaterThan(0);
    expect(cost.highQualityMetal ?? 0).toBeGreaterThan(0);
    expect(researchCost('investigation').highQualityMetal).toBeUndefined();
  });

  it('fits a finished modification, and never fits it twice', () => {
    const lab = [build('lab', 20)];
    const once = fitModification(lab, 'lab_quantum_modeling');
    expect(once[0]?.modifications).toEqual(['lab_quantum_modeling']);

    const twice = fitModification(once, 'lab_quantum_modeling');
    expect(twice[0]?.modifications).toEqual(['lab_quantum_modeling']);
  });

  it('lands harmlessly when the structure it was for is gone', () => {
    expect(() => fitModification([], 'lab_quantum_modeling')).not.toThrow();
    expect(fitModification([], 'lab_quantum_modeling')).toEqual([]);
    // And an id the catalogue no longer knows changes nothing rather than throwing.
    expect(fitModification([build('lab', 20)], 'lab_retired')[0]?.modifications).toEqual([]);
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

    // A Nexus that goes up afterwards discounts the *next* order, not this one.
    const raised: Base = {
      ...result.base,
      buildings: [build('nexus', 10), build('generator', 1)],
    };
    expect(raised.buildQueue[0]?.durationSeconds).toBe(quoted);
    expect(buildingBuildSeconds('quarters', 1, raised.buildings)).toBeLessThan(quoted);
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
