import {
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  STARTING_RESOURCES,
  startingAssignees,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  storageCapacity,
  type Building,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';
import { createRepositories, type Repositories } from './repos/index.js';

/**
 * The bug that would not let the server start, from all three directions.
 *
 * A `Building` that had skipped the parser had no `damage`. `Math.max(0, undefined)` is `NaN`; NaN
 * went through `buildingEffectiveness` into the storage ceiling, the ceiling into the sandbox's
 * stockpile, and `JSON.stringify` wrote NaN as `null` without a word. `ResourcesSchema` refuses
 * null, so the *next* boot threw reading a column nothing had knowingly touched and the process
 * died before it served a request.
 *
 * Three separate things had to be true for a missing field to brick a save, so there are three
 * tests: the arithmetic must not produce NaN, the repository must not store it if something else
 * ever does, and a database already holding the nulls must be repairable rather than deleted.
 * Fixing only the first would leave the next arithmetic hole free to do the same thing.
 */

const NOW = '2026-08-16T12:00:00.000Z';

/** The repair, by the name the runner records it under. */
const REPAIR_MIGRATION = '0024_repair_null_stockpiles.sql';

/**
 * Rewinds one migration so it runs again.
 *
 * A save that broke did so on a build that did not have the repair yet, so the repair is *new* to
 * it. Re-running the runner against a database that has already recorded the file is a no-op, and
 * a test built on that would pass with the migration emptied out.
 */
function forget(db: AppDatabase, file: string): void {
  db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(file);
}

const dbs: AppDatabase[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function openStack(): { db: AppDatabase; repos: Repositories } {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return { db, repos: createRepositories(db) };
}

/** A crew with a readable stockpile, for the writes below to break. */
function seed(repos: Repositories): string {
  repos.users.insert({ id: 'u', username: 'keeper', passwordHash: 'x', createdAt: NOW });
  const base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Vault',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(NOW),
    progression: startingProgression(),
    research: startingResearch(),
    assignees: startingAssignees(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW),
    inventory: {},
    fittedUpgrades: [],
    fleet: {},
    commanders: [],
    createdAt: NOW,
  };
  repos.bases.insert(base);
  return base.id;
}

/** A district as it was stored before `damage` and `garrisons` existed. */
const LEGACY_DISTRICT = BUILDING_KINDS.map((kind) => ({
  id: `legacy-${kind}`,
  kind,
  level: BUILDING_MAX_LEVEL,
  modifications: [],
})) as unknown as Building[];

describe('a structure with no damage field', () => {
  it('is read as undamaged rather than as NaN', () => {
    const ceiling = storageCapacity(LEGACY_DISTRICT);
    expect(Number.isFinite(ceiling), 'the storage ceiling must be a number').toBe(true);
    expect(ceiling).toBeGreaterThan(0);
  });

  /**
   * The ceiling a *parsed* district gives and the one a legacy district gives must be the same
   * number, not merely both finite. A guard that returned zero would also be "not NaN" and would
   * quietly halve everybody's storage.
   */
  it('gives exactly the ceiling an intact district gives', () => {
    const intact: Building[] = BUILDING_KINDS.map((kind) => ({
      id: `intact-${kind}`,
      kind,
      level: BUILDING_MAX_LEVEL,
      modifications: [],
      damage: 0,
      garrisons: 0,
    }));
    expect(storageCapacity(LEGACY_DISTRICT)).toBe(storageCapacity(intact));
  });
});

describe('the repository refuses to store a stockpile that is not numbers', () => {
  it('throws on NaN rather than writing a null the next read cannot parse', () => {
    const { repos } = openStack();
    const id = seed(repos);
    expect(() =>
      repos.bases.updateResources(id, { ...STARTING_RESOURCES, scrap: Number.NaN }),
    ).toThrow(/scrap/);
    // And nothing was written: the row still reads.
    expect(repos.bases.findById(id)?.resources.scrap).toBe(STARTING_RESOURCES.scrap);
  });

  it('throws on Infinity too, which stringifies to null the same way', () => {
    const { repos } = openStack();
    const id = seed(repos);
    expect(() =>
      repos.bases.updateHoldings(id, { ...STARTING_RESOURCES, caps: Number.POSITIVE_INFINITY }, {}),
    ).toThrow(/caps/);
  });

  it('stores a real stockpile without complaint', () => {
    const { repos } = openStack();
    const id = seed(repos);
    repos.bases.updateResources(id, { ...STARTING_RESOURCES, scrap: 4242 });
    expect(repos.bases.findById(id)?.resources.scrap).toBe(4242);
  });
});

describe('a save that already holds the nulls', () => {
  /**
   * Written straight past the repository on purpose.
   *
   * The guard above means the application can no longer produce this row, which is the point of
   * the guard, and also why the repair has to be tested by forging the row rather than by causing
   * it. A backup taken during the broken window still holds one.
   */
  it('is repaired by the migration rather than needing to be deleted', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?').run(
      JSON.stringify({
        caps: null,
        food: null,
        oil: null,
        scrap: null,
        highQualityMetal: null,
      }),
      id,
    );
    expect(() => repos.bases.findById(id), 'the forged row must be unreadable').toThrow();

    // Rewound to a save that predates the repair, which is the only shape the repair can reach.
    // `runMigrations` records what it has applied and skips it next time, so re-running against an
    // already-current database does nothing at all, and a test that did that would pass whether
    // the migration worked or not.
    forget(db, REPAIR_MIGRATION);
    runMigrations(db);

    const repaired = repos.bases.findById(id);
    expect(repaired?.resources).toEqual(STARTING_RESOURCES);
  });

  it('leaves a healthy stockpile exactly alone', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    repos.bases.updateResources(id, { ...STARTING_RESOURCES, scrap: 91_000 });
    forget(db, REPAIR_MIGRATION);
    runMigrations(db);
    expect(repos.bases.findById(id)?.resources.scrap).toBe(91_000);
  });

  /** One null among four good numbers keeps the four. */
  it('repairs only the fields that are actually broken', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?').run(
      JSON.stringify({ ...STARTING_RESOURCES, scrap: 77_000, caps: null }),
      id,
    );
    forget(db, REPAIR_MIGRATION);
    runMigrations(db);
    const repaired = repos.bases.findById(id);
    expect(repaired?.resources.scrap).toBe(77_000);
    expect(repaired?.resources.caps).toBe(STARTING_RESOURCES.caps);
  });
});

/**
 * The same three directions, for the other way a stockpile becomes unreadable.
 *
 * `ResourcesSchema` is whole numbers now. Production used to write whatever a settle of arbitrary
 * length produced, `37772.751872` caps was a real stored value, so the fraction is exactly the
 * `null` bug arriving from the other side: a row that parsed on the build that wrote it and refuses
 * to parse on the next one. Three tests again, and for the same reason: the arithmetic must not
 * produce a fraction, the repository must refuse to store one if something else ever does, and a
 * database already holding them must come back rather than be deleted.
 */
const WHOLE_MIGRATION = '0025_whole_resources.sql';

describe('a fractional stockpile', () => {
  it('is refused at the write, with the base named', () => {
    const { repos } = openStack();
    const id = seed(repos);
    expect(() =>
      repos.bases.updateResources(id, { ...STARTING_RESOURCES, caps: 37_772.751872 }),
    ).toThrow(/fractional caps/);
  });

  it('is still refused through the holdings write, which is the one production uses', () => {
    const { repos } = openStack();
    const id = seed(repos);
    expect(() => repos.bases.updateHoldings(id, { ...STARTING_RESOURCES, oil: 119.5 }, {})).toThrow(
      /fractional oil/,
    );
  });

  it('is floored by the repair, not rounded up and not reset', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    // Written past the guard on purpose: this is the shape a save that predates the rule holds.
    db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?').run(
      JSON.stringify({
        caps: 37_772.751872,
        food: 300.9,
        oil: 120,
        scrap: 500.000001,
        highQualityMetal: 40.5,
      }),
      id,
    );
    expect(() => repos.bases.findById(id), 'the forged row must be unreadable').toThrow();

    forget(db, WHOLE_MIGRATION);
    runMigrations(db);

    // Down, never up: a repair must not hand a crew a resource it did not earn.
    expect(repos.bases.findById(id)?.resources).toEqual({
      caps: 37_772,
      food: 300,
      oil: 120,
      scrap: 500,
      highQualityMetal: 40,
    });
  });

  it('leaves a whole stockpile exactly alone', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    repos.bases.updateResources(id, { ...STARTING_RESOURCES, scrap: 91_000 });
    forget(db, WHOLE_MIGRATION);
    runMigrations(db);
    expect(repos.bases.findById(id)?.resources.scrap).toBe(91_000);
  });

  it('floors a fractional wage in the book, which caps are paid out of', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    const economy = startingEconomy(NOW);
    db.prepare('UPDATE bases SET economy_json = ? WHERE id = ?').run(
      JSON.stringify({
        ...economy,
        payroll: { ...economy.payroll, wages: { 'officer-1': 42.75, 'officer-2': 30 } },
      }),
      id,
    );
    expect(() => repos.bases.findById(id), 'the forged row must be unreadable').toThrow();

    forget(db, WHOLE_MIGRATION);
    runMigrations(db);
    expect(repos.bases.findById(id)?.economy.payroll.wages).toEqual({
      'officer-1': 42,
      'officer-2': 30,
    });
  });
});
