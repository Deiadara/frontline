import { openDatabase, runMigrations, type AppDatabase } from './index.js';

/** One table whose columns differ from what a fresh migration run builds. */
export interface TableDrift {
  table: string;
  /** Columns a fresh run has and this database does not. A missing table lists all of them. */
  missing: string[];
  /** Columns this database has and a fresh run does not. A table no migration makes lists all. */
  extra: string[];
}

function columnsByTable(db: AppDatabase): Map<string, Set<string>> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return new Map(
    tables.map(({ name }) => [
      name,
      new Set(
        (db.prepare('SELECT name FROM pragma_table_info(?)').all(name) as { name: string }[]).map(
          (column) => column.name,
        ),
      ),
    ]),
  );
}

/**
 * Every table whose columns differ from a fresh in-memory run of the same migrations.
 *
 * The runner skips a file it has already applied, so a migration edited after it ran somewhere
 * leaves that save on a schema no test ever sees. It happened to the dev save: 0102 gained
 * `sleeper_cells.travel_ms` three days after the save applied it, and planting sleepers answered
 * 500 from then on (bug pass, 2026-09-29). Comparing against a fresh run catches the next edited
 * migration too, whichever table it touches. Column names only, which is the drift found so far: an
 * edit that changes a column's type or default in place would still pass unseen.
 */
export function schemaDrift(db: AppDatabase, migrationsDir?: string): TableDrift[] {
  const reference = openDatabase(':memory:');
  try {
    runMigrations(reference, migrationsDir);
    const want = columnsByTable(reference);
    const have = columnsByTable(db);
    const tables = [...new Set([...want.keys(), ...have.keys()])].sort();
    return tables.flatMap((table) => {
      const wanted = want.get(table) ?? new Set<string>();
      const held = have.get(table) ?? new Set<string>();
      const missing = [...wanted].filter((column) => !held.has(column)).sort();
      const extra = [...held].filter((column) => !wanted.has(column)).sort();
      return missing.length === 0 && extra.length === 0 ? [] : [{ table, missing, extra }];
    });
  } finally {
    reference.close();
  }
}

/** One line a person can act on, naming each table and what it is missing or carrying extra. */
export function describeDrift(drift: readonly TableDrift[]): string {
  const tables = drift.map(({ table, missing, extra }) => {
    const parts = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      extra.length > 0 ? `extra ${extra.join(', ')}` : '',
    ].filter((part) => part !== '');
    return `${table} (${parts.join('; ')})`;
  });
  return (
    `The database schema differs from a fresh migration run: ${tables.join('; ')}. ` +
    'A migration was probably edited after this save applied it; bring the save in line by hand.'
  );
}
