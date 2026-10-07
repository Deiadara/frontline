import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { holdEffectsUntilCommit } from './after-commit.js';

export type AppDatabase = Database.Database;

/** Resolved relative to this module: works from src/ (tsx) and dist/ (build copies the .sql files). */
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Open (creating if missing) the sqlite database. Pass ':memory:' in tests. */
export function openDatabase(databasePath: string): AppDatabase {
  // How long a statement waits on a lock another process holds (a `sqlite3` shell, say) before
  // SQLITE_BUSY. Short, because the wait blocks the event loop and every player with it.
  const db = new Database(databasePath, { timeout: 2_000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  /*
   * Durability and footprint, stated rather than inherited (hardening pass, 2026-09-27).
   *
   * `synchronous = FULL`: every commit is on disk before the write returns, so a power cut loses
   * nothing a player was told had happened. NORMAL is the usual WAL trade and is faster, but it
   * can drop the last commits on power loss, and the maintainer's rule is that progress is never
   * lost. The WAL is kept to 64 MB after each checkpoint rather than growing to its high-water mark,
   * the page cache is 16 MB, and temporary b-trees stay in memory.
   */
  db.pragma('synchronous = FULL');
  db.pragma('journal_size_limit = 67108864');
  db.pragma('cache_size = -16000');
  db.pragma('temp_store = MEMORY');
  holdEffectsUntilCommit(db);
  return db;
}

/**
 * Applies every not-yet-applied `NNNN_name.sql` file in lexicographic order,
 * tracking applied files in `schema_migrations`. Each migration runs in a transaction.
 * Returns the file names applied by this call.
 */
/**
 * Drafts that reached a save and were then abandoned, with nothing left that matters: a record of
 * them is expected, not a disagreement. `0142_bar_withdrawals.sql` was applied to the development
 * save on 2026-10-02 and replaced by `0142_chair_rework.sql`; its empty table is harmless.
 */
const ABANDONED_MIGRATIONS: ReadonlySet<string> = new Set(['0142_bar_withdrawals.sql']);

/**
 * Refuses to start when the record of applied migrations and the files disagree (maintainer,
 * 2026-10-06: refuse, in development and production alike).
 *
 * Two ways they can: a file that sorts before one already applied would run out of order, and an
 * applied name with no file means the history on disk is not the history the save went through. A
 * migration renumbered after the development server ran it is both at once, and applying it again
 * stops boot on a repeated `ADD COLUMN` or, worse, quietly runs a data change twice.
 */
function refuseADisagreeingRecord(files: readonly string[], applied: ReadonlySet<string>): void {
  const onDisk = new Set(files);
  const vanished = [...applied].filter(
    (name) => !onDisk.has(name) && !ABANDONED_MIGRATIONS.has(name),
  );
  const last = [...applied]
    .filter((name) => onDisk.has(name))
    .sort()
    .at(-1);
  const late = last === undefined ? [] : files.filter((file) => !applied.has(file) && file < last);
  if (vanished.length === 0 && late.length === 0) return;
  const lines = [
    'The record of applied migrations disagrees with the files on disk. Refusing to start.',
    ...(vanished.length > 0 ? [`Applied, but no such file: ${vanished.join(', ')}.`] : []),
    ...(late.length > 0
      ? [`Not applied, but older than ${last}: ${late.join(', ')} (renumbered after it ran?).`]
      : []),
  ];
  throw new Error(lines.join(' '));
}

export function runMigrations(
  db: AppDatabase,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): string[] {
  const { files, applied } = migrationState(db, migrationsDir);
  refuseADisagreeingRecord(files, applied);
  return applyPending(db, migrationsDir, files, applied);
}

/**
 * Applies whatever is unrecorded, in name order, without the check above.
 *
 * For tests that rewind a migration on purpose to replay it against an old shape of save: that is
 * exactly the out-of-order record `runMigrations` refuses. Never called on a live save.
 */
export function replayMigrations(
  db: AppDatabase,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): string[] {
  const { files, applied } = migrationState(db, migrationsDir);
  return applyPending(db, migrationsDir, files, applied);
}

function migrationState(
  db: AppDatabase,
  migrationsDir: string,
): { files: string[]; applied: Set<string> } {
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
  return { files, applied: new Set(appliedRows.map((row) => row.name)) };
}

function applyPending(
  db: AppDatabase,
  migrationsDir: string,
  files: readonly string[],
  applied: ReadonlySet<string>,
): string[] {
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
