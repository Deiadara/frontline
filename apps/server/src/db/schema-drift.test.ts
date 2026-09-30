import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';
import { describeDrift, schemaDrift } from './schema-drift.js';

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

function migrated(): AppDatabase {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return db;
}

describe('the boot check against a fresh migration run', () => {
  it('finds nothing on a save built by the migrations it is compared with', () => {
    expect(schemaDrift(migrated())).toEqual([]);
  });

  /** The dev save's gap: 0102 gained `travel_ms` after the save had applied it. */
  it('names the table and the column a save is missing', () => {
    const db = migrated();
    db.exec('ALTER TABLE sleeper_cells DROP COLUMN travel_ms');

    const drift = schemaDrift(db);
    expect(drift).toEqual([{ table: 'sleeper_cells', missing: ['travel_ms'], extra: [] }]);
    expect(describeDrift(drift)).toContain('sleeper_cells (missing travel_ms)');
  });

  it('names a column and a table no migration makes', () => {
    const db = migrated();
    db.exec('ALTER TABLE sleeper_cells ADD COLUMN stray INTEGER');
    db.exec('CREATE TABLE leftovers (id TEXT)');

    expect(schemaDrift(db)).toEqual([
      { table: 'leftovers', missing: [], extra: ['id'] },
      { table: 'sleeper_cells', missing: [], extra: ['stray'] },
    ]);
  });

  it('lists every column of a table the save does not have at all', () => {
    const db = migrated();
    const columns = (
      db.prepare("SELECT name FROM pragma_table_info('sleeper_cells')").all() as { name: string }[]
    ).map((column) => column.name);
    db.exec('DROP TABLE sleeper_cells');

    expect(schemaDrift(db)).toEqual([
      { table: 'sleeper_cells', missing: [...columns].sort(), extra: [] },
    ]);
  });
});
