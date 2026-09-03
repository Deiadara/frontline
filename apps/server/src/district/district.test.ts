import {
  territoryEffectsFor,
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
  findBuilding,
  RESOURCE_KEYS,
  BUILD_BOOST_MS,
  BUILD_BOOST_OIL_PER_LEVEL,
  BUILD_BOOST_PERCENT,
  buildBoostActive,
  addonsOf,
  shelvedModifications,
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
import { settleBase } from './settle.js';
import { queueBuild } from './build.js';
import { buyBuildBoost } from './boost.js';
import {
  clearSlot,
  fitIntoSlot,
  isModificationDrawn,
  modificationBlocker,
  modificationOptions,
} from './modifications.js';
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
   */
  it('§A1: takes nothing off the stockpile over a long absence', () => {
    const repos = openStack();
    const start = new Date(NOW.getTime() - 72 * HOUR_MS);
    const base = seedBase(repos, { settledAt: start.toISOString() });

    const settled = settleDistrict(repos, base, NOW);
    expect(settled.base.resources.oil).toBe(base.resources.oil);
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

describe('population (§A1: one pool)', () => {
  /**
   * §A1, as the board rewrote it: **the army draws on the pool and the officers do not.**
   *
   * Officers used to be charged a bed each, which put hiring somebody in competition with training
   * somebody. That is not a trade the game wants: the crew is who you are, the army is what you can
   * field. They are still counted and still reported, just not charged.
   */
  it('charges the army against the ceiling and the officers against nothing', () => {
    const repos = openStack();
    const officers = [createCommander('o1', 'One', 'head_spy')];
    const base = seedBase(repos, {
      officers,
      buildings: [build('nexus', 1), build('generator', 1), build('quarters', 2)],
    });

    const withOfficer = districtPopulation(repos, base);
    expect(withOfficer.officers, 'still counted').toBe(1);
    expect(withOfficer.total, 'and still not charged').toBe(0);

    // §A5: Razors are supply 1 apiece, so five of them is five bodies rather than one roster entry.
    const withArmy: Base = { ...base, army: { razors: 5 } };
    const fielded = districtPopulation(repos, withArmy);
    expect(fielded.army).toBe(5);
    expect(fielded.total).toBe(5);
    expect(fielded.spare).toBe(withOfficer.spare - 5);
  });

  /**
   * §A5 through the real route: the pool is a ceiling on the army, and officers eat into it.
   *
   * This is the consequence the merge exists for. Before it, the Gauntlet ran a separate army cap
   * and a crew could fill both pools without either noticing; the only way to see that the merge
   * actually happened is to hire somebody and watch the roster get smaller.
   */
  it('refuses an order the district has no beds for, and hiring does not make it refuse sooner', () => {
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

    // ...and signing somebody takes no bed off the army, which is the board's rule (§A1).
    const withOfficer = { ...base, commanders: [createCommander('o1', 'One', 'head_spy')] };
    expect(districtPopulation(repos, withOfficer).spare).toBe(room);
  });

  it('houses more people for every location the crew holds', () => {
    const repos = openStack();
    const base = seedBase(repos, { buildings: [build('nexus', 1), build('quarters', 2)] });
    const bare = districtPopulation(repos, base).capacity;

    const location = CITY_LOCATIONS[0]!;
    const held = repos.city.control(location.id)!;
    repos.city.put({ ...held, holder: { kind: 'crew', baseId: base.id } });

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

  it('walks the gates in order: build it, hire an engineer, then pay', () => {
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

    // §B9: no slot gate. A Lab project draws a blueprint now; the Scrapyard builds it and the
    // structure's dialog fits it, so a Lab with no bracket open is still a Lab worth designing for.
    expect(modificationBlocker(withLab(4), spec)).toBe('no_lead_engineer');
    expect(modificationBlocker(withLab(5), spec)).toBe('no_lead_engineer');
    expect(modificationBlocker(withLab(5, { officers: engineer() }), spec)).toBe('cannot_afford');
    expect(modificationBlocker(withLab(5, { officers: engineer(), resources: rich }), spec)).toBe(
      null,
    );
  });

  /**
   * §B9: a full Lab is exactly the crew that wants a fourth drawing.
   *
   * This used to refuse the project outright, which was right while a project ended by bolting the
   * thing in and is wrong now: the brackets are emptiable (§E), so designing a fourth is how a
   * player buys themselves a choice about which three the Lab is.
   */
  it('offers a fourth modification even with all three slots full', () => {
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
    expect(modificationBlocker(full, spec)).toBeNull();

    // ...and one already drawn is not sold twice, whether it is on the shelf or in a wall.
    //
    // This used to assert `null` here, which is what the code did and the opposite of what the
    // line above it says: `null` means "nothing is in the way", and `research/start.ts` reads it as
    // permission, so the Lab charged for a second copy of a drawing the crew already owned and
    // banked nothing at the end of the clock.
    const fitted = findModification('lab_quantum_modeling');
    if (!fitted) throw new Error('fixture error: the Lab modification is missing');
    expect(modificationBlocker(full, fitted)).toBe('already_drawn');
    expect(isModificationDrawn(full, fitted.id)).toBe(true);
    expect(isModificationDrawn(full, spec.id)).toBe(false);
  });

  it('prices modification work in materials as well as caps', () => {
    const cost = researchCost('modification');
    expect(cost.caps).toBeGreaterThan(0);
    expect(cost.highQualityMetal ?? 0).toBeGreaterThan(0);
    expect(researchCost('investigation').highQualityMetal).toBeUndefined();
  });

  /**
   * §E: a slot is filled and emptied from the structure, out of what the Scrapyard has built.
   *
   * The whole of the change §B9 made to research is visible here: owning an add-on and having it
   * installed are two facts now, so a slot can be emptied and the thing is still yours.
   */
  it('fits a built add-on, refuses a second copy, and empties the slot again', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      buildings: [build('nexus', 20), build('lab', 20)],
      addons: { researched: ['lab_quantum_modeling'], built: ['lab_quantum_modeling'] },
    });

    const fitted = fitIntoSlot(repos, base, 'lab', 'lab_quantum_modeling');
    expect(fitted.kind).toBe('fitted');
    const withMod = fitted.kind === 'fitted' ? fitted.base : base;
    expect(findBuilding(withMod.buildings, 'lab')?.modifications).toEqual(['lab_quantum_modeling']);

    // One built, one fitted, so there is nothing left on the shelf to fit a second time.
    const again = fitIntoSlot(repos, withMod, 'lab', 'lab_quantum_modeling');
    expect(again).toEqual({ kind: 'refused', reason: 'already_fitted' });

    const cleared = clearSlot(repos, withMod, 'lab', 0);
    expect(cleared.kind).toBe('cleared');
    const emptied = cleared.kind === 'cleared' ? cleared.base : withMod;
    expect(findBuilding(emptied.buildings, 'lab')?.modifications).toEqual([]);
    // ...and it is back on the shelf, which is what makes emptying reversible.
    expect(shelvedModifications(addonsOf(emptied), emptied.buildings)).toEqual([
      'lab_quantum_modeling',
    ]);
    expect(clearSlot(repos, emptied, 'lab', 0)).toEqual({
      kind: 'refused',
      reason: 'already_empty',
    });
  });

  it('says why a slot cannot be filled, before anything is spent', () => {
    const repos = openStack();
    const shelved = seedBase(repos, {
      buildings: [build('nexus', 20), build('lab', 4)],
      addons: { researched: [], built: ['lab_quantum_modeling'] },
    });
    // One seeded crew per stack: `seedBase` inserts the same user row every time.
    // The Lab is standing but is below the level that opens the first bracket.
    expect(fitIntoSlot(repos, shelved, 'lab', 'lab_quantum_modeling')).toEqual({
      kind: 'refused',
      reason: 'slot_locked',
    });

    const empty: Base = {
      ...shelved,
      buildings: [build('nexus', 20), build('lab', 20)],
      addons: { researched: [], built: [] },
    };
    expect(fitIntoSlot(repos, empty, 'lab', 'lab_quantum_modeling')).toEqual({
      kind: 'refused',
      reason: 'not_built',
    });
    expect(fitIntoSlot(repos, empty, 'gate', 'lab_quantum_modeling')).toEqual({
      kind: 'refused',
      reason: 'no_structure',
    });
  });
});

/**
 * §B4: the Generator's paid burn.
 *
 * Three claims the board made and one it did not have to: it costs oil by Generator level, it runs
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
