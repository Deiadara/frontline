import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
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
 * Every two minutes (maintainer, 2026-09-27; it was ten), and once more on a clean shutdown: the
 * worst case a restore loses is two minutes of play. At this database's size a snapshot costs a few
 * milliseconds of the event loop. The timer is `unref`'d so it never holds the process open, and a
 * failed snapshot is logged and skipped rather than thrown: a backup that can take the server down
 * with it has inverted its own purpose.
 *
 * ## Every snapshot is checked, and lands whole or not at all
 *
 * Written under a `.partial` name, checked with `PRAGMA quick_check` on a connection of its own,
 * and only then renamed into place. A crash mid-write leaves a `.partial` that nothing lists, and a
 * snapshot that fails its check is deleted and reported rather than kept as a restore target that
 * turns out to be damaged on the day it is needed.
 *
 * ## Retention, in tiers
 *
 * Everything from the last two hours, the newest of each hour for two days, and the newest of each
 * day for thirty (`backupsToKeep`). Tiers rather than "the newest N" because a server crash-looping
 * for an hour writes an hour of snapshots of the same state, and with a flat window those would push
 * every good snapshot out; the hourly and daily tiers cannot be displaced that way.
 *
 * ## A second copy
 *
 * With `BACKUP_MIRROR_DIR` set, every checked snapshot is copied there too and pruned by the same
 * tiers. A backup on the disk the database lives on dies with that disk; point the mirror at
 * another one, or at a folder a sync client carries off the machine.
 *
 * ## Recovering
 *
 * Documented in `docs/RECOVERY.md`, and it is three commands: stop the server, move the corrupt
 * `frontline.sqlite` (and its `-wal`/`-shm` sidecars) aside, copy the chosen snapshot into place,
 * start the server. Nothing has to be replayed and no migration has to be re-run: a snapshot is a
 * whole database, `schema_migrations` included. The admin bench lists what is on disk so the choice
 * can be made without an ssh session.
 */

/** How often a snapshot is taken (maintainer, 2026-09-27). */
export const BACKUP_INTERVAL_MS = 2 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The retention tiers. See the module note. */
export const BACKUP_TIERS = {
  /** Everything newer than this is kept. */
  keepAllMs: 2 * HOUR_MS,
  /** The newest of each hour is kept back to here. */
  hourlyMs: 2 * DAY_MS,
  /** The newest of each day is kept back to here, and nothing older. */
  dailyMs: 30 * DAY_MS,
} as const;

const PARTIAL = '.partial';

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
 * Takes one snapshot, checks it, copies it to the mirror, and prunes both. Returns the file written.
 *
 * `VACUUM INTO` refuses to run inside a transaction, which is why nothing here wraps it in one,
 * and why this must never be called from a handler that is already in `db.transaction`.
 */
export function takeBackup(
  db: AppDatabase,
  directory: string,
  at = new Date(),
  mirror = '',
): string {
  mkdirSync(directory, { recursive: true });
  const file = backupFileName(at);
  const into = path.join(directory, file);
  const partial = `${into}${PARTIAL}`;
  rmSync(partial, { force: true });
  // Bound as a parameter rather than interpolated: the path comes from configuration, and a
  // configuration value spliced into SQL is the same defect as a request body spliced into SQL.
  db.prepare('VACUUM INTO ?').run(partial);
  const verdict = checkSnapshot(partial);
  if (verdict !== 'ok') {
    rmSync(partial, { force: true });
    throw new Error(`snapshot ${file} failed its integrity check: ${verdict}`);
  }
  renameSync(partial, into);
  pruneBackups(directory, at);
  if (mirror !== '') {
    mkdirSync(mirror, { recursive: true });
    const copy = path.join(mirror, file);
    copyFileSync(into, `${copy}${PARTIAL}`);
    renameSync(`${copy}${PARTIAL}`, copy);
    pruneBackups(mirror, at);
  }
  return file;
}

/** `ok`, or what SQLite found wrong, read on a connection of its own that is closed after. */
export function checkSnapshot(file: string): string {
  const snapshot = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const rows = snapshot.pragma('quick_check') as { quick_check: string }[];
    return rows.map((row) => row.quick_check).join('; ');
  } finally {
    snapshot.close();
  }
}

/**
 * Which snapshots the tiers keep: everything recent, the newest of each hour, the newest of each
 * day, and nothing past the daily tier. `backups` is newest first, as {@link listBackups} lists.
 */
export function backupsToKeep(backups: readonly BackupFile[], now: Date): Set<string> {
  const keep = new Set<string>();
  const hours = new Set<string>();
  const days = new Set<string>();
  for (const backup of backups) {
    const age = now.getTime() - Date.parse(backup.takenAt);
    const hour = backup.takenAt.slice(0, 13);
    const day = backup.takenAt.slice(0, 10);
    if (age <= BACKUP_TIERS.keepAllMs) keep.add(backup.file);
    else if (age <= BACKUP_TIERS.hourlyMs && !hours.has(hour)) keep.add(backup.file);
    else if (age <= BACKUP_TIERS.dailyMs && !days.has(day)) keep.add(backup.file);
    // Newest first, so the first snapshot seen in an hour or a day is the newest of it.
    hours.add(hour);
    days.add(day);
  }
  return keep;
}

/** Deletes every snapshot the tiers do not keep. Returns what went. */
export function pruneBackups(directory: string, now = new Date()): string[] {
  const all = listBackups(directory);
  const keep = backupsToKeep(all, now);
  const stale = all.filter((backup) => !keep.has(backup.file));
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
  /** A second directory each snapshot is copied to. Empty for none. */
  mirror?: string;
  intervalMs?: number;
  /** Called with whatever went wrong. The server passes its logger; tests pass a spy. */
  onError?: (error: unknown) => void;
  onBackup?: (file: string) => void;
}

/**
 * Starts the timer. Returns the stop function.
 *
 * The first snapshot is taken on the first tick rather than immediately: a server that crash-loops
 * on boot would otherwise fill the directory with copies of the same broken state and push every
 * good snapshot out of the retention window.
 */
export function startBackupSchedule({
  db,
  directory,
  mirror = '',
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
      const file = takeBackup(db, directory, new Date(), mirror);
      onBackup?.(file);
    } catch (error) {
      onError?.(error);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
