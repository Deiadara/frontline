import {
  BUILDING_CATALOG,
  BUILDING_MAX_LEVEL,
  MAX_BUILD_QUEUE,
  MODIFICATIONS,
  STARTING_RESOURCES,
  buildingBuildSeconds,
  buildingCost,
  buildingLevel,
  createCommander,
  districtProduction,
  findModification,
  moraleTarget,
  queueCompletesAt,
  researchCost,
  startingAssignees,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Base,
  type Building,
  type BuildQueue,
  type Resources,
  startingTraining,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { queueBuild } from './build.js';
import { fitModification, modificationBlocker, modificationOptions } from './modifications.js';
import { housingSpare, populationUsed } from './population.js';
import { PRODUCTION_MIN_STEP_MS, settleDistrict } from './settle.js';

/**
 * The district's server half (GDD §A1): ordering a level, and everything that lands lazily on the
 * next read.
 *
 * Run against a real sqlite stack rather than a repository double, because half of what is being
 * asserted is that the queue and the structures move in the same write — a double would happily
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
  garrisons: 0,
});

interface SeedOptions {
  buildings?: Building[];
  buildQueue?: BuildQueue;
  resources?: Resources;
  settledAt?: string | null;
  officers?: Base['commanders'];
  level?: number;
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
    assignees: startingAssignees(),
    buildings: options.buildings ?? [build('nexus', 1), build('generator', 1)],
    buildQueue: options.buildQueue ?? [],
    army: {},
    trainingQueue: [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
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
      resources: { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 },
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
      resources: { caps: 99999, food: 99999, oil: 99999, scrap: 99999, highQualityMetal: 99999 },
    });

    let base = rich;
    // Three Nexus levels take it to 4, which is the Gate's gate.
    for (let i = 0; i < BUILDING_CATALOG.gate.requiresNexusLevel - 1; i += 1) {
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
    const expected = districtProduction(district).perHour.food ?? 0;
    expect(later.base.resources.food - base.resources.food).toBeCloseTo(expected, 6);
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
   * district went unread — and the only way to tell the two apart is to compare against a district
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
    ]).perHour.food;

    const grown = lateSettled.base.resources.food - late.resources.food;
    // One hour's worth, not three.
    expect(grown).toBeCloseTo(alwaysThere ?? 0, 4);
    expect(grown).toBeLessThan((alwaysThere ?? 0) * 2);
  });

  it('drifts morale towards what the district can sustain', () => {
    const repos = openStack();
    const social = [build('nexus', 1), build('generator', 2), build('quarters', 10)];
    const start = new Date(NOW.getTime() - 48 * HOUR_MS);
    const base = seedBase(repos, { buildings: social, settledAt: start.toISOString() });

    const settled = settleDistrict(repos, base, NOW);
    const target = moraleTarget(social);
    const gap = target - base.economy.morale;
    expect(gap).toBeGreaterThan(0);

    // Two days is four half-lives, so most of the gap is closed — and it never overshoots, which
    // is the property that makes the drift safe to apply over any window at all.
    expect(settled.base.economy.morale).toBeGreaterThan(base.economy.morale + gap * 0.9);
    expect(settled.base.economy.morale).toBeLessThan(target);
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

describe('housing (§A1 — the Quarters)', () => {
  it('counts officers and placed assignees against the same ceiling', () => {
    const repos = openStack();
    const officers = [createCommander('o1', 'One', 'head_spy')];
    const base = seedBase(repos, {
      officers,
      buildings: [build('nexus', 1), build('generator', 1), build('quarters', 2)],
    });

    expect(populationUsed(base)).toBe(1);
    const withPlacement: Base = {
      ...base,
      assignees: { placements: { o1: 3 } },
    };
    expect(populationUsed(withPlacement)).toBe(4);
    expect(housingSpare(withPlacement)).toBe(housingSpare(base) - 3);
  });
});

describe('modifications (§A1, §C4)', () => {
  const engineer = () => [createCommander('eng', 'Wrench', 'lead_engineer')];
  const rich: Resources = {
    caps: 9999,
    food: 9999,
    oil: 9999,
    scrap: 9999,
    highQualityMetal: 9999,
  };

  it('reports the whole catalogue, every entry with a reason it is not startable', () => {
    const repos = openStack();
    const base = seedBase(repos);
    const options = modificationOptions(base);

    expect(options).toHaveLength(MODIFICATIONS.length);
    // A brand-new district has built almost nothing, so everything belonging to a structure that is
    // not standing reports `not_built` — exactly that many, no more and no fewer. Counted off the
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
      resources: { caps: 99999, food: 99999, oil: 99999, scrap: 99999, highQualityMetal: 99999 },
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
