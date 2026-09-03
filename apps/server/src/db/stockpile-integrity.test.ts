import {
  BUILDING_KINDS,
  createCommander,
  BUILDING_MAX_LEVEL,
  STARTING_RESOURCES,
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
 * The backfill that gave every save a `planks` amount (§D5b).
 *
 * Rewound alongside the repair because a save old enough to hold the nulls is older than planks
 * too, so both are new to it. `0024` cannot restore planks and is not being asked to: it is
 * immutable history, written before the resource existed, and it repairs the five it knew about.
 */
const PLANKS_MIGRATION = '0032_planks.sql';

/**
 * The rename that made `food` into `supplies`.
 *
 * Rewound wherever a row is forged in the old shape, for the same reason as the two above: a save
 * old enough to hold nulls or fractions spells the key `food`, and the repairs that know how to
 * fix it are written against that spelling. Forging the *new* key and rewinding only the old
 * repairs would test a chain no real database has ever walked.
 */
const SUPPLIES_MIGRATION = '0037_supplies.sql';
/**
 * Every migration that sweeps a retired unit out of a save, and there is a list because there is
 * more than one: units leave the roster in ones and twos and each departure needs its own sweep.
 * The tests below forget all of them and re-run, so a new sweep is covered by adding its filename
 * and its ids rather than by writing the same three tests again.
 */
const RETIRED_UNITS_MIGRATIONS = ['0038_retired_units.sql', '0039_bell_ringers_retired.sql'];
const forgetRetirements = (db: Parameters<typeof runMigrations>[0]): void => {
  for (const file of RETIRED_UNITS_MIGRATIONS) forget(db, file);
};

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
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
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
        planks: null,
      }),
      id,
    );
    expect(() => repos.bases.findById(id), 'the forged row must be unreadable').toThrow();

    // Rewound to a save that predates the repair, which is the only shape the repair can reach.
    // `runMigrations` records what it has applied and skips it next time, so re-running against an
    // already-current database does nothing at all, and a test that did that would pass whether
    // the migration worked or not.
    forget(db, REPAIR_MIGRATION);
    forget(db, PLANKS_MIGRATION);
    forget(db, SUPPLIES_MIGRATION);
    runMigrations(db);

    /*
     * The five the repair knew about come back at their starting amounts; planks comes back at
     * **zero**, not at its starting amount, and that is the right answer rather than a gap.
     *
     * A save this old predates the resource. Handing it 420 planks would be inventing a stockpile
     * a player never earned, on the strength of the save having been corrupt, which is a reward
     * for a bug. Zero is what a crew that never had planks has.
     */
    const repaired = repos.bases.findById(id);
    expect(repaired?.resources).toEqual({ ...STARTING_RESOURCES, planks: 0 });
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
        planks: 500,
      }),
      id,
    );
    expect(() => repos.bases.findById(id), 'the forged row must be unreadable').toThrow();

    forget(db, WHOLE_MIGRATION);
    forget(db, SUPPLIES_MIGRATION);
    runMigrations(db);

    // Down, never up: a repair must not hand a crew a resource it did not earn.
    expect(repos.bases.findById(id)?.resources).toEqual({
      caps: 37_772,
      supplies: 300,
      oil: 120,
      scrap: 500,
      highQualityMetal: 40,
      planks: 500,
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

  it('refuses a fractional commitment in the payroll book, and rebuilds the row', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    const economy = startingEconomy(NOW);
    db.prepare('UPDATE bases SET economy_json = ? WHERE id = ?').run(
      JSON.stringify({
        ...economy,
        payroll: { ...economy.payroll, commitments: { 'officer-1': 42.75, 'officer-2': 30 } },
      }),
      id,
    );
    // A fractional commitment is not repairable the way a fractional stockpile is: there is no
    // migration that rounds it, because a fee is a number two people said out loud and the schema
    // is what stops a hand-written row smuggling a fraction into the committed total.
    expect(() => repos.bases.findById(id), 'the forged row must be unreadable').toThrow();
  });
});

/**
 * The rename, on a save that spells the resource the old way.
 *
 * A key rename inside a JSON blob is the one migration shape that can silently *lose* a stockpile:
 * set the new key without removing the old and the row carries both for ever; remove the old
 * without reading it first and the crew's supplies go to zero on a schema that has no default. So
 * the amount is asserted, not just the key.
 */
/**
 * A save that still names a unit the roster no longer has.
 *
 * This is the same class of failure as the `food` rename above and it presented the same way: the
 * server would not start. `UnitIdSchema` is a key schema over the live catalogue, so an army
 * holding a retired id fails `BaseSchema.parse` on the way *out of the database*, before any
 * request is served. It happened twice: three units left the roster in one change and the
 * Bell-Ringers in another, and both times the crew that owned some could not log in.
 *
 * There are two defences now and they do different jobs. The **loader** drops content it does not
 * recognise (`withoutRetiredUnits` and its siblings in `repos/bases.ts`), so a save is never
 * unopenable, including one restored from a backup older than any migration. These **migrations**
 * clean the stored rows, so the database does not carry ghosts for ever. The tests below check the
 * migration; that the loader survives without it is asserted inside each one.
 *
 * Both shapes are covered because both exist: an army is a map keyed by unit id, and the training
 * queue is an array of orders that each name one. A sweep that only knew about maps left a crew
 * mid-batch unable to load, which is the same bug one table along.
 */
describe('a save that still names a retired unit', () => {
  it('drops it from the army, and the base loads again', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare('UPDATE bases SET army_json = ? WHERE id = ?').run(
      JSON.stringify({ razors: 4, muckrakers: 7, jammers: 2, wrecking_crew: 1, bell_ringers: 3 }),
      id,
    );
    /*
     * Unmigrated, the row **still loads**, and the retired units are simply not in the army.
     *
     * This used to assert the opposite: that the read threw and the account was unopenable until
     * the migration ran. That was the bug written down as the spec. The loader salvages now
     * (`withoutRetiredUnits`), because a migration is one-shot and a backup restored from before
     * it, or the next removal nobody writes one for, would put the account straight back in the
     * ground. The migration below is still what tidies the stored row.
     */
    expect(repos.bases.findById(id)?.army).toEqual({ razors: 4 });

    forgetRetirements(db);
    runMigrations(db);

    expect(repos.bases.findById(id)?.army).toEqual({ razors: 4 });
  });

  it('drops a part-trained batch of one, since there is nothing left to hand over', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare('UPDATE bases SET training_queue_json = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'o1', unitId: 'razors', count: 3, delivered: 1, startedAt: NOW, durationSeconds: 60 },
        {
          id: 'o2',
          unitId: 'jammers',
          count: 5,
          delivered: 2,
          startedAt: NOW,
          durationSeconds: 90,
        },
        {
          id: 'o3',
          unitId: 'bell_ringers',
          count: 2,
          delivered: 0,
          startedAt: NOW,
          durationSeconds: 90,
        },
      ]),
      id,
    );
    // Loads unmigrated too, with the retired order already filtered out of the queue.
    expect((repos.bases.findById(id)?.trainingQueue ?? []).map((order) => order.unitId)).toEqual([
      'razors',
    ]);

    forgetRetirements(db);
    runMigrations(db);

    const queue = repos.bases.findById(id)?.trainingQueue ?? [];
    expect(queue.map((order) => order.unitId)).toEqual(['razors']);
  });

  it('sweeps the garrison a crew left standing on a location', () => {
    const { db, repos } = openStack();
    seed(repos);
    db.prepare(
      `INSERT INTO location_control (location_id, holder_kind, holder_base_id, level, garrison_json)
       VALUES ('rustyard-scrap-press', 'crew', 'b', 1, ?)`,
    ).run(JSON.stringify({ razors: 2, muckrakers: 9, bell_ringers: 4 }));

    forgetRetirements(db);
    runMigrations(db);

    const raw = db
      .prepare(`SELECT garrison_json AS json FROM location_control WHERE location_id = ?`)
      .get('rustyard-scrap-press') as { json: string };
    expect(JSON.parse(raw.json)).toEqual({ razors: 2 });
  });
});

describe('a save that still calls it food', () => {
  it('carries the amount across to supplies and leaves nothing behind', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?').run(
      JSON.stringify({ ...STARTING_RESOURCES, supplies: undefined, food: 812 }),
      id,
    );
    // Read without the migration this is not an error, which is the danger: the missing-amount
    // repair loads an absent `supplies` as **zero**, so an unmigrated save reads as a crew whose
    // stores were emptied rather than as a crew whose row needs moving.
    expect(repos.bases.findById(id)?.resources.supplies).toBe(0);

    forget(db, SUPPLIES_MIGRATION);
    runMigrations(db);

    expect(repos.bases.findById(id)?.resources.supplies).toBe(812);
    const raw = db.prepare('SELECT resources_json AS json FROM bases WHERE id = ?').get(id) as {
      json: string;
    };
    expect(JSON.parse(raw.json)).not.toHaveProperty('food');
  });

  it('carries the production remainder across too, so a settle does not lose its part-unit', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    const economy = { ...startingEconomy(NOW), productionCarry: { food: 0.25 } };
    db.prepare('UPDATE bases SET economy_json = ? WHERE id = ?').run(JSON.stringify(economy), id);

    forget(db, SUPPLIES_MIGRATION);
    runMigrations(db);

    expect(repos.bases.findById(id)?.economy.productionCarry).toEqual({ supplies: 0.25 });
  });
});

/**
 * A stockpile written before a resource existed (§D5b).
 *
 * The backfill migration is not enough on its own. It is one-shot, so anything that writes a full
 * stockpile from an older build puts the gap straight back, and one did: a dev process still
 * running the pre-planks code called `applyUnlockedSandbox` after the migration had landed and
 * rewrote the five keys it knew about over the six that were there. The next read threw out of
 * `BaseSchema.parse` and took the server down on boot.
 *
 * So absence is repaired on the way in as well. Only absence: a key that is present and wrong is
 * still corruption, and still an error.
 */
describe('a stockpile older than one of its resources', () => {
  it('reads a missing amount as zero rather than throwing', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?').run(
      JSON.stringify({ caps: 10, supplies: 20, oil: 30, scrap: 40, highQualityMetal: 50 }),
      id,
    );

    const read = repos.bases.findById(id);
    expect(read?.resources).toEqual({
      caps: 10,
      supplies: 20,
      oil: 30,
      scrap: 40,
      highQualityMetal: 50,
      planks: 0,
    });
  });

  it('still refuses a key that is present and not an amount', () => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?').run(
      JSON.stringify({ ...STARTING_RESOURCES, planks: 'lots' }),
      id,
    );
    expect(() => repos.bases.findById(id)).toThrow();

    db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?').run(
      JSON.stringify({ ...STARTING_RESOURCES, planks: -5 }),
      id,
    );
    expect(() => repos.bases.findById(id)).toThrow();
  });
});

/**
 * A save can always be opened, whatever content has since left the game.
 *
 * The one that has actually cost us: `UnitIdSchema` and its siblings are **key** schemas over the
 * live catalogues, so a row naming a retired id does not come back with a bad field, it does not
 * come back at all, and on the server that is the account refusing to load rather than a request
 * returning an error. Measured before this existed: of the ten columns that store a content id,
 * six refused the row outright and only four degraded.
 *
 * Two halves are asserted here and both matter. **History is repaired**: a retired unit, chair,
 * structure, refit or trait is dropped and everything else survives. **Corruption is not**: a
 * negative count or a string where a number belongs is still an error, because that is damage
 * rather than history and quietly repairing it would hide a real fault.
 */
describe('a save naming content the game no longer has', () => {
  const load = (column: string, value: unknown) => {
    const { db, repos } = openStack();
    const id = seed(repos);
    db.prepare(`UPDATE bases SET ${column} = ? WHERE id = ?`).run(JSON.stringify(value), id);
    return repos.bases.findById(id);
  };

  it('drops a retired unit from the army and keeps the rest', () => {
    expect(load('army_json', { razors: 4, gone_unit: 7 })?.army).toEqual({ razors: 4 });
  });

  it('drops a training order for a unit that no longer exists', () => {
    const order = (unitId: string, orderId: string) => ({
      id: orderId,
      unitId,
      count: 2,
      delivered: 0,
      startedAt: NOW,
      durationSeconds: 60,
    });
    const queue = load('training_queue_json', [order('razors', 'a'), order('gone_unit', 'b')]);
    expect((queue?.trainingQueue ?? []).map((one) => one.unitId)).toEqual(['razors']);
  });

  it('drops a structure of a kind that no longer exists', () => {
    const buildings = load('buildings_json', [
      { id: 'x', kind: 'gone_building', level: 3, modifications: [], damage: 0 },
      { id: 'y', kind: 'nexus', level: 3, modifications: [], damage: 0 },
    ])?.buildings;
    expect(buildings?.map((one) => one.kind)).toEqual(['nexus']);
  });

  it('drops a refit that no longer exists and keeps the structure', () => {
    const buildings = load('buildings_json', [
      {
        id: 'y',
        kind: 'nexus',
        level: 3,
        modifications: ['gone_mod'],
        damage: 0,
      },
    ])?.buildings;
    expect(buildings).toHaveLength(1);
    expect(buildings?.[0]?.modifications).toEqual([]);
  });

  it('drops an officer whose chair no longer exists, and a perk that does not', () => {
    const officer = createCommander('c1', 'A Name', 'head_spy');
    const gone = { ...officer, id: 'c2', role: 'gone_role' };
    const withGhostRole = load('commanders_json', [officer, gone])?.commanders;
    expect(withGhostRole?.map((one) => one.id)).toEqual(['c1']);

    const withGhostPerk = load('commanders_json', [{ ...officer, perks: ['gone_perk'] }]);
    expect(withGhostPerk?.commanders).toHaveLength(1);
    expect(withGhostPerk?.commanders[0]?.perks).toEqual([]);
  });

  /** The other half. Damage is not history, and repairing it silently would hide a real fault. */
  it.each([
    ['a negative count', 'army_json', { razors: -3 }],
    ['a count that is not a number', 'army_json', { razors: 'lots' }],
    ['a null army', 'army_json', null],
    [
      'a level that is not a number',
      'buildings_json',
      [{ id: 'y', kind: 'nexus', level: 'six', modifications: [], damage: 0 }],
    ],
  ])('still refuses %s', (_label, column, value) => {
    expect(() => load(column, value)).toThrow();
  });
});
