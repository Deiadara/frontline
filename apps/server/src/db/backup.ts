import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from './index.js';

/**
 * Point-in-time snapshots, so a corrupted save is an inconvenience rather than the end of a world.
 *
 * ## Why `VACUUM INTO` and not a file copy
 *
 * The database runs in WAL mode, which means the newest committed data is in `frontline.sqlite-wal`
 * and not yet in `frontline.sqlite`. Copying the main file alone is the classic way to take a backup
 * that silently loses the last few minutes, or worse, captures a torn page mid-checkpoint. SQLite's
 * own advice is that the `-wal` file is part of the database's persistent state and must travel with
 * it, so we do not copy files at all.
 *
 * `VACUUM INTO` is the sanctioned online backup: it runs inside a single read transaction, so what
 * lands is one consistent instant, and what it writes is a *defragmented* single file with no
 * sidecars. A live server can keep taking writes throughout. The one requirement is SQLite ≥ 3.27,
 * which every better-sqlite3 build in the last several years satisfies.
 *
 * ## The schedule
 *
 * Every ten minutes, which is the board's number and a sensible one: the worst case is ten minutes
 * of a player's evening, and at this database's size a snapshot costs milliseconds. The timer is
 * `unref`'d so it never holds the process open on shutdown, and a failed snapshot is logged and
 * skipped rather than thrown: a backup that can take the server down with it has inverted its own
 * purpose.
 *
 * ## Retention
 *
 * The newest {@link BACKUP_KEEP} snapshots are kept and older ones deleted, which at a ten-minute
 * cadence is a rolling window of several hours. Filenames carry a sortable UTC timestamp, so the
 * sweep is a sort and a slice rather than a stat of every file.
 *
 * ## Recovering
 *
 * Documented in `docs/RECOVERY.md`, and it is three commands: stop the server, move the corrupt
 * `frontline.sqlite` (and its `-wal`/`-shm` sidecars) aside, copy the chosen snapshot into place,
 * start the server. Nothing has to be replayed and no migration has to be re-run: a snapshot is a
 * whole database, `schema_migrations` included. The admin bench lists what is on disk so the choice
 * can be made without an ssh session.
 */

/** How often a snapshot is taken. The board's number. */
export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

/** How many snapshots are kept. At ten minutes apart, a rolling window of four hours. */
export const BACKUP_KEEP = 24;

const PREFIX = 'frontline-';
const SUFFIX = '.sqlite';

/** `frontline-2026-08-16T12-30-00-000Z.sqlite`: sortable, and legal on every filesystem. */
export function backupFileName(at: Date): string {
  return `${PREFIX}${at.toISOString().replace(/[:.]/g, '-')}${SUFFIX}`;
}

/** The instant a snapshot file was taken, read back out of its name. `null` if it is not one. */
export function backupTakenAt(file: string): Date | null {
  if (!file.startsWith(PREFIX) || !file.endsWith(SUFFIX)) return null;
  const stamp = file.slice(PREFIX.length, -SUFFIX.length);
  // The name replaced `:` and `.` with `-`; putting them back is positional, which is safe because
  // the format is fixed at `YYYY-MM-DDTHH-MM-SS-mmmZ`.
  const iso = stamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

export interface BackupFile {
  file: string;
  takenAt: string;
  bytes: number;
}

/** Every snapshot in the directory, newest first. Anything that is not one is ignored. */
export function listBackups(directory: string): BackupFile[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .flatMap((file) => {
      const takenAt = backupTakenAt(file);
      if (!takenAt) return [];
      let bytes = 0;
      try {
        bytes = statSync(path.join(directory, file)).size;
      } catch {
        return [];
      }
      return [{ file, takenAt: takenAt.toISOString(), bytes }];
    })
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/**
 * Takes one snapshot and prunes the old ones. Returns the file written.
 *
 * `VACUUM INTO` refuses to run inside a transaction, which is why nothing here wraps it in one,
 * and why this must never be called from a handler that is already in `db.transaction`.
 */
export function takeBackup(db: AppDatabase, directory: string, at = new Date()): string {
  mkdirSync(directory, { recursive: true });
  const file = backupFileName(at);
  const into = path.join(directory, file);
  // Bound as a parameter rather than interpolated: the path comes from configuration, and a
  // configuration value spliced into SQL is the same defect as a request body spliced into SQL.
  db.prepare('VACUUM INTO ?').run(into);
  pruneBackups(directory);
  return file;
}

/** Deletes everything past the newest {@link BACKUP_KEEP}. */
export function pruneBackups(directory: string, keep = BACKUP_KEEP): string[] {
  const stale = listBackups(directory).slice(keep);
  for (const backup of stale) {
    try {
      rmSync(path.join(directory, backup.file));
    } catch {
      // A snapshot that will not delete is not worth failing a backup over; the next sweep retries.
    }
  }
  return stale.map((backup) => backup.file);
}

export interface BackupScheduleOptions {
  db: AppDatabase;
  directory: string;
  intervalMs?: number;
  /** Called with whatever went wrong. The server passes its logger; tests pass a spy. */
  onError?: (error: unknown) => void;
  onBackup?: (file: string) => void;
}

/**
 * Starts the ten-minute timer. Returns the stop function.
 *
 * The first snapshot is taken on the first tick rather than immediately: a server that crash-loops
 * on boot would otherwise fill the directory with copies of the same broken state and push every
 * good snapshot out of the retention window.
 */
export function startBackupSchedule({
  db,
  directory,
  intervalMs = BACKUP_INTERVAL_MS,
  onError,
  onBackup,
}: BackupScheduleOptions): () => void {
  const timer = setInterval(() => {
    try {
      // Taken first, *then* announced. Written as `onBackup?.(takeBackup(…))` this schedule took no
      // backups at all whenever the caller passed no listener: optional call syntax does not
      // evaluate its arguments when the callee is undefined, so the whole snapshot short-circuited
      // away. It ran correctly in the one place that happened to pass a logger, which is exactly
      // how a backup system ends up with an empty directory and nobody noticing.
      const file = takeBackup(db, directory);
      onBackup?.(file);
    } catch (error) {
      onError?.(error);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
