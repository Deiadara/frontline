import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDING_KINDS, isModificationId, type Building } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Every migration up to but not including `stopBefore` — the schema a legacy save was written by. */
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

/**
 * The Commons removal, checked the only way that means anything: against a row written *before* it.
 *
 * The catalogue no longer has the kind, so no fixture built from `BUILDING_CATALOG` can produce one
 * and nothing in the rest of the suite can reach this state at all. It is reached by writing the
 * JSON a pre-removal district would have had, which is exactly what is sitting in anyone's database
 * right now.
 */
describe('0014 — dropping the Commons from saved districts', () => {
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
    // Not just the kind — the surviving rows keep their levels, so the rebuild is a filter and not
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
   * name, so an installed copy under the old id reads as *not installed* — the player keeps the
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
