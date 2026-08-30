import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AttributesSchema,
  BUILDING_KINDS,
  isModificationId,
  type Building,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Every migration up to but not including `stopBefore`: the schema a legacy save was written by. */
function migrateUpTo(db: AppDatabase, stopBefore: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (file >= stopBefore) break;
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
  }
}

const DROP_COMMONS = '0014_drop_commons.sql';

/** One fixed timestamp for every row these tests write. */
const NOW = '2026-08-16T12:00:00.000Z';

/**
 * The Commons removal, checked the only way that means anything: against a row written *before* it.
 *
 * The catalogue no longer has the kind, so no fixture built from `BUILDING_CATALOG` can produce one
 * and nothing in the rest of the suite can reach this state at all. It is reached by writing the
 * JSON a pre-removal district would have had, which is exactly what is sitting in anyone's database
 * right now.
 */
describe('0014: dropping the Commons from saved districts', () => {
  const legacyBase = (buildings: unknown[], queue: unknown[] = []) => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, DROP_COMMONS);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u1', 'legacy', 'x', '2026-01-01T00:00:00.000Z');
    const columns = (db.prepare('SELECT * FROM bases LIMIT 0').columns() as { name: string }[]).map(
      (c) => c.name,
    );
    const values: Record<string, string | number> = {};
    for (const name of columns) {
      values[name] = name.endsWith('_json')
        ? '[]'
        : name === 'level' || name.startsWith('is_')
          ? 0
          : name === 'owner_id'
            ? 'u1'
            : 'x';
    }
    values.buildings_json = JSON.stringify(buildings);
    values.build_queue_json = JSON.stringify(queue);
    db.prepare(
      `INSERT INTO bases (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(...columns.map((name) => values[name]));
    return db;
  };

  const buildingsAfter = (db: AppDatabase): Building[] => {
    runMigrations(db);
    const row = db.prepare('SELECT buildings_json FROM bases').get() as { buildings_json: string };
    return JSON.parse(row.buildings_json) as Building[];
  };

  it('removes the Commons and leaves every other structure alone', () => {
    const db = legacyBase([
      { kind: 'nexus', level: 3, modifications: [] },
      { kind: 'commons', level: 7, modifications: ['commons_notice_board'] },
      { kind: 'quarters', level: 2, modifications: [] },
    ]);

    const after = buildingsAfter(db);
    expect(after.map((b) => b.kind)).toEqual(['nexus', 'quarters']);
    // Not just the kind: the surviving rows keep their levels, so the rebuild is a filter and not
    // a re-creation from defaults.
    expect(after.map((b) => b.level)).toEqual([3, 2]);
  });

  it('leaves a district that never built one exactly as it was', () => {
    const before = [
      { kind: 'nexus', level: 1, modifications: [] },
      { kind: 'lab', level: 4, modifications: ['lab_quantum_modeling'] },
    ];
    expect(buildingsAfter(legacyBase(before))).toEqual(before);
  });

  /** A district whose *only* structure was the Commons must end up with an empty list, not null. */
  it('empties the list rather than nulling it', () => {
    const db = legacyBase([{ kind: 'commons', level: 1, modifications: [] }]);
    expect(buildingsAfter(db)).toEqual([]);
  });

  it('drops a queued Commons, which would otherwise complete back into the list', () => {
    const db = legacyBase(
      [{ kind: 'nexus', level: 1, modifications: [] }],
      [
        { kind: 'commons', level: 1, doneAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'lab', level: 1, doneAt: '2026-01-01T00:00:00.000Z' },
      ],
    );
    runMigrations(db);
    const row = db.prepare('SELECT build_queue_json FROM bases').get() as {
      build_queue_json: string;
    };
    expect((JSON.parse(row.build_queue_json) as { kind: string }[]).map((e) => e.kind)).toEqual([
      'lab',
    ]);
  });

  /**
   * The Cistern's fifth modification was renamed with the morale it fed. Its id is derived from its
   * name, so an installed copy under the old id reads as *not installed*: the player keeps the
   * effect and gets the slot back, which is the quiet half of this migration.
   */
  it('renames the Cistern modification the Commons took its name from', () => {
    const db = legacyBase([
      {
        kind: 'cistern',
        level: 9,
        modifications: ['cistern_clean_line_to_the_commons'],
      },
    ]);

    const [cistern] = buildingsAfter(db);
    expect(cistern?.modifications).toEqual(['cistern_clean_line_to_the_quarters']);
    // The point of the rename, rather than its spelling: the id the player ends up holding is one
    // the catalogue can actually find.
    expect(isModificationId(cistern?.modifications[0] ?? '')).toBe(true);
  });

  /** Nothing that survives may name a structure the game no longer has. */
  it('leaves no building the catalogue cannot resolve', () => {
    const db = legacyBase([
      { kind: 'commons', level: 5, modifications: [] },
      { kind: 'garage', level: 1, modifications: [] },
    ]);
    for (const building of buildingsAfter(db)) {
      expect(BUILDING_KINDS as readonly string[]).toContain(building.kind);
    }
  });
});

/**
 * The attribute rename, checked against sheets written before it.
 *
 * Nine attributes changed name, one was retired and two were added. A stored sheet is JSON keyed by
 * attribute name, so nothing rejects the old keys on write and nothing rejects them on read: the
 * failure is `AttributesSchema` complaining that the *new* keys are missing, which reads as a bug in
 * the schema rather than as old data. No fixture built from the current model can produce this
 * state, so it is written by hand, exactly as it sits in anybody's database right now.
 */
describe('0015: renaming the attribute sheet', () => {
  const OLD_SHEET = {
    strength: 20,
    endurance: 21,
    agility: 22,
    speed: 23,
    reflexes: 24,
    toughness: 25,
    marksmanship: 26,
    stealth: 27,
    tactics: 30,
    analysis: 31,
    imagination: 32,
    cunning: 33,
    composure: 34,
    vigilance: 35,
    scholarship: 36,
    appraisal: 37,
    leadership: 40,
    charisma: 41,
    communication: 42,
    intimidation: 43,
    negotiation: 44,
    deception: 45,
    empathy: 46,
    mentoring: 47,
    engineering: 50,
    hacking: 51,
    fabrication: 52,
    medicine: 53,
    cybernetics: 54,
    salvage: 55,
    demolition: 56,
    navigation: 57,
    chemistry: 58,
    logistics: 59,
  };

  const legacyOverseer = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0015_attribute_rename.sql');
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u1', 'legacy', 'x', NOW);
    db.prepare(
      `INSERT INTO overseers (id, user_id, preset_id, name, archetype, portrait_id, bio, attributes_json, traits_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'o1',
      'u1',
      'enforcer',
      'Kane',
      'enforcer',
      'overseer-1',
      'bio',
      JSON.stringify(OLD_SHEET),
      '[]',
      NOW,
    );
    return db;
  };

  const sheetAfter = (db: AppDatabase): Record<string, number> => {
    runMigrations(db);
    const row = db.prepare('SELECT attributes_json FROM overseers').get() as {
      attributes_json: string;
    };
    return JSON.parse(row.attributes_json) as Record<string, number>;
  };

  it('carries every renamed rating across without changing it', () => {
    const sheet = sheetAfter(legacyOverseer());
    expect(sheet.stamina).toBe(OLD_SHEET.endurance);
    expect(sheet.dexterity).toBe(OLD_SHEET.agility);
    expect(sheet.organization).toBe(OLD_SHEET.tactics);
    expect(sheet.logic).toBe(OLD_SHEET.cunning);
    expect(sheet.intuition).toBe(OLD_SHEET.scholarship);
    expect(sheet.resolve).toBe(OLD_SHEET.vigilance);
    expect(sheet.improvisation).toBe(OLD_SHEET.imagination);
    expect(sheet.strategy).toBe(OLD_SHEET.appraisal);
    expect(sheet.diplomacy).toBe(OLD_SHEET.mentoring);
  });

  it('leaves none of the old names behind', () => {
    const sheet = sheetAfter(legacyOverseer());
    for (const gone of [
      'endurance',
      'agility',
      'tactics',
      'cunning',
      'scholarship',
      'vigilance',
      'imagination',
      'appraisal',
      'mentoring',
      'marksmanship',
    ]) {
      expect(sheet, gone).not.toHaveProperty(gone);
    }
  });

  /** A sheet the current schema cannot parse is a character the game cannot load. */
  it('leaves a sheet the current model accepts', () => {
    expect(() => AttributesSchema.parse(sheetAfter(legacyOverseer()))).not.toThrow();
  });

  it('gives the two new attributes a rating nobody was rolled for, rather than a zero', () => {
    const sheet = sheetAfter(legacyOverseer());
    // Zero is a statement about a person. These were never rolled, so they start at the floor.
    expect(sheet.authority).toBeGreaterThan(0);
    expect(sheet.cryptography).toBeGreaterThan(0);
  });

  it('migrates an officer nested inside a crew, not just the overseer', () => {
    const db = legacyOverseer();
    db.prepare('UPDATE bases SET commanders_json = ? WHERE 1=0').run('[]');
    db.prepare(
      `INSERT INTO bases (id, owner_id, name, district_id, level, resources_json, buildings_json, created_at, commanders_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'b1',
      'u1',
      'Crew',
      'neon-docks',
      1,
      '{}',
      '[]',
      NOW,
      JSON.stringify([{ id: 'c1', name: 'Rask', attributes: OLD_SHEET }]),
    );

    runMigrations(db);
    const row = db.prepare('SELECT commanders_json FROM bases WHERE id = ?').get('b1') as {
      commanders_json: string;
    };
    const [officer] = JSON.parse(row.commanders_json) as { attributes: Record<string, number> }[];
    expect(officer?.attributes.stamina).toBe(OLD_SHEET.endurance);
    expect(officer?.attributes).not.toHaveProperty('marksmanship');
    expect(officer?.attributes.cryptography).toBeGreaterThan(0);
  });
});

/**
 * The migration chain itself, rather than any one migration's effect.
 *
 * These are the properties the runner quietly depends on. It sorts filenames and keys
 * `schema_migrations` on the full name, so a chain that satisfies all of this applies each file
 * exactly once, in one order, on a cold database and on a live one alike.
 */
describe('the migration chain', () => {
  const DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), 'migrations');
  const files = readdirSync(DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  it('has a chain to check, so none of this is vacuous', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * Two migrations sharing a number is a live hazard, and there is exactly one pair.
   *
   * `0003_attribute_model.sql` and `0003_economy.sql` both exist, and today they are harmless: the
   * runner sorts on the *whole* filename, so their order is fixed, and the tracking table keys on
   * the whole name, so each applies once. What is not safe is a **third** one. A new `0003_aaa.sql`
   * would sort ahead of both on a cold database and be applied after both on a live one, which is
   * two different schemas from one chain, and the kind of thing that is found in production.
   *
   * The pair is grandfathered by name rather than renamed: `schema_migrations` keys on the filename,
   * so renaming an applied migration makes every existing database run it a second time.
   */
  it('gives every new migration a number of its own', () => {
    const GRANDFATHERED = ['0003_attribute_model.sql', '0003_economy.sql'];
    const byNumber = new Map<string, string[]>();
    for (const file of files) {
      const number = file.slice(0, 4);
      byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
    }
    const shared = [...byNumber.values()]
      .filter((group) => group.length > 1)
      .filter((group) => group.join() !== GRANDFATHERED.join());
    expect(
      shared,
      'two migrations with one number apply in a different order on a fresh database',
    ).toEqual([]);
  });

  it('names every migration `NNNN_something.sql`', () => {
    expect(files.filter((file) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(file))).toEqual([]);
  });

  it('applies the whole chain to a cold database, and re-running changes nothing', () => {
    const db = openDatabase(':memory:');
    try {
      const first = runMigrations(db);
      expect(first).toHaveLength(files.length);
      expect(runMigrations(db), 'a second run must apply nothing').toEqual([]);
    } finally {
      db.close();
    }
  });

  /** Two independent cold runs must land on the same schema, or the chain is order-dependent. */
  it('reaches one schema however many times it is run', () => {
    const shapeOf = (db: ReturnType<typeof openDatabase>): string =>
      (
        db
          .prepare(
            "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name",
          )
          .all() as { name: string; sql: string | null }[]
      )
        .map((row) => `${row.name}:${(row.sql ?? '').replace(/\s+/g, ' ')}`)
        .join('\n');

    const one = openDatabase(':memory:');
    const two = openDatabase(':memory:');
    try {
      runMigrations(one);
      runMigrations(two);
      runMigrations(two);
      expect(shapeOf(one)).toBe(shapeOf(two));
    } finally {
      one.close();
      two.close();
    }
  });
});
