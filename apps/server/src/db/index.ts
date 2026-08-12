import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type AppDatabase = Database.Database;

/** Resolved relative to this module — works from src/ (tsx) and dist/ (build copies the .sql files). */
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Open (creating if missing) the sqlite database. Pass ':memory:' in tests. */
export function openDatabase(databasePath: string): AppDatabase {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Applies every not-yet-applied `NNNN_name.sql` file in lexicographic order,
 * tracking applied files in `schema_migrations`. Each migration runs in a transaction.
 * Returns the file names applied by this call.
 */
export function runMigrations(
  db: AppDatabase,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const appliedRows = db.prepare('SELECT name FROM schema_migrations').all() as {
    name: string;
  }[];
  const applied = new Set(appliedRows.map((row) => row.name));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    })();
    newlyApplied.push(file);
  }
  return newlyApplied;
}
