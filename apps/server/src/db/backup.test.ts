import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKUP_TIERS,
  backupFileName,
  backupsToKeep,
  checkSnapshot,
  backupTakenAt,
  listBackups,
  pruneBackups,
  startBackupSchedule,
  takeBackup,
} from './backup.js';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';

/**
 * The backup is only worth having if it can be *restored*, so that is what these measure: not that
 * a file appeared, but that the file opens as a database and still has the row that was written a
 * moment before it was taken.
 *
 * The WAL case is the sharp one. The database runs in WAL mode, so a freshly written row lives in
 * the `-wal` sidecar rather than in the main file: a backup taken by copying `frontline.sqlite`
 * would come back missing it, silently and only under load. `VACUUM INTO` is what avoids that, and
 * the test that would fail without it is the round-trip below.
 */

const scratch: string[] = [];
const opened: AppDatabase[] = [];

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'frontline-backup-'));
  scratch.push(dir);
  return dir;
}

function liveDatabase(dir: string): AppDatabase {
  const db = openDatabase(path.join(dir, 'frontline.sqlite'));
  runMigrations(db);
  opened.push(db);
  return db;
}

describe('a snapshot', () => {
  it('is a whole database, with everything committed up to the moment it was taken', () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    db.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1','operator','x','2026-08-16T00:00:00.000Z')",
    ).run();

    const file = takeBackup(db, path.join(dir, 'backups'));

    const restored = openDatabase(path.join(dir, 'backups', file));
    opened.push(restored);
    const row = restored.prepare('SELECT username FROM users').get() as
      { username: string } | undefined;
    // In WAL mode this row is in the sidecar, not the main file. A file copy loses it.
    expect(row?.username).toBe('operator');
    // And the migration ledger travels with it, so a restore needs no replay of anything.
    const applied = restored.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {
      n: number;
    };
    expect(applied.n).toBeGreaterThan(0);
  });

  it('keeps taking snapshots without disturbing the live database', () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');

    takeBackup(db, backups, new Date('2026-08-16T10:00:00.000Z'));
    db.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u2','later','x','2026-08-16T10:05:00.000Z')",
    ).run();
    takeBackup(db, backups, new Date('2026-08-16T10:10:00.000Z'));

    const [newest, oldest] = listBackups(backups);
    const first = openDatabase(path.join(backups, oldest!.file));
    const second = openDatabase(path.join(backups, newest!.file));
    opened.push(first, second);
    expect((first.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(0);
    expect((second.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
  });

  it('carries a sortable timestamp that round-trips out of its own name', () => {
    const at = new Date('2026-08-16T09:07:05.123Z');
    const file = backupFileName(at);
    expect(backupTakenAt(file)?.toISOString()).toBe(at.toISOString());
    // Lexicographic order is chronological order, which is what makes the retention sweep a sort.
    expect(backupFileName(new Date('2026-08-16T09:07:04.000Z')) < file).toBe(true);
    expect(backupTakenAt('frontline.sqlite')).toBeNull();
    expect(backupTakenAt('notes.txt')).toBeNull();
  });
});

describe('the listing and the sweep', () => {
  it('reports snapshots newest first and ignores anything that is not one', () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    takeBackup(db, backups, new Date('2026-08-16T10:00:00.000Z'));
    takeBackup(db, backups, new Date('2026-08-16T10:10:00.000Z'));
    writeFileSync(path.join(backups, 'README.txt'), 'not a snapshot');

    const listed = listBackups(backups);
    expect(listed).toHaveLength(2);
    expect(listed[0]!.takenAt).toBe('2026-08-16T10:10:00.000Z');
    expect(listed[0]!.bytes).toBeGreaterThan(0);
  });

  it('answers with nothing for a directory that does not exist yet', () => {
    expect(listBackups(path.join(workspace(), 'never-made'))).toEqual([]);
  });

  it('prunes by tier, keeping recent, hourly and daily snapshots', () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const now = new Date('2026-09-27T12:00:00.000Z');
    const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    // Two recent, two in the same hour a day ago, two on the same day a week ago, one too old.
    for (const minutes of [2, 60, 24 * 60 + 5, 24 * 60 + 20, 7 * 24 * 60 + 5, 7 * 24 * 60 + 90]) {
      takeBackup(db, backups, minutesAgo(minutes));
    }
    takeBackup(db, backups, minutesAgo(40 * 24 * 60));

    pruneBackups(backups, now);
    expect(listBackups(backups).map((backup) => backup.takenAt)).toEqual([
      minutesAgo(2).toISOString(),
      minutesAgo(60).toISOString(),
      // The newer of the two in that hour.
      minutesAgo(24 * 60 + 5).toISOString(),
      // The newer of the two on that day.
      minutesAgo(7 * 24 * 60 + 5).toISOString(),
    ]);
  });

  /*
   * A server crash-looping for an hour writes an hour of snapshots of one broken state. With a
   * flat "newest N" those pushed every good snapshot out; the daily tier cannot be displaced.
   */
  it('keeps yesterday whatever the last hour wrote', () => {
    const now = new Date('2026-09-27T12:00:00.000Z');
    const flood = Array.from({ length: 500 }, (_, n) => ({
      file: `burst-${n}`,
      takenAt: new Date(now.getTime() - n * 1_000).toISOString(),
      bytes: 1,
    }));
    const yesterday = {
      file: 'yesterday',
      takenAt: new Date(now.getTime() - 26 * 60 * 60_000).toISOString(),
      bytes: 1,
    };
    expect(backupsToKeep([...flood, yesterday], now).has('yesterday')).toBe(true);
    expect(BACKUP_TIERS.dailyMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60_000);
  });
});

describe('a snapshot is checked and copied', () => {
  it('passes its own integrity check and leaves no partial file behind', () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const file = takeBackup(db, backups);
    expect(checkSnapshot(path.join(backups, file))).toBe('ok');
    expect(readdirSync(backups).some((name) => name.endsWith('.partial'))).toBe(false);
  });

  it('refuses a file that is not a database', () => {
    const dir = workspace();
    const bogus = path.join(dir, 'bogus.sqlite');
    writeFileSync(bogus, 'not a database at all, and long enough to have a header');
    expect(() => checkSnapshot(bogus)).toThrow();
  });

  it('lands a copy in the mirror, pruned by the same tiers', () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const mirror = path.join(dir, 'elsewhere');
    const file = takeBackup(db, backups, new Date(), mirror);
    expect(listBackups(mirror).map((backup) => backup.file)).toEqual([file]);
    expect(checkSnapshot(path.join(mirror, file))).toBe('ok');
  });
});

describe('the schedule', () => {
  it('takes nothing immediately, then one per interval, and can be stopped', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const taken: string[] = [];
    const stop = startBackupSchedule({
      db,
      directory: path.join(dir, 'backups'),
      intervalMs: 10,
      onBackup: (file) => taken.push(file),
    });

    // A crash-looping server must not fill the window with copies of its broken state, so the
    // first snapshot waits for the first tick.
    expect(taken).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    const afterStop = taken.length;
    expect(afterStop).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(taken).toHaveLength(afterStop);
  });

  it('takes the snapshot whether or not anybody is listening', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    // No `onBackup`. Written the obvious way, `onBackup?.(takeBackup(...))`, this schedule
    // silently did nothing at all here, because optional call syntax never evaluates its argument
    // when the callee is undefined. The work must not live inside the notification.
    const stop = startBackupSchedule({ db, directory: backups, intervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    expect(listBackups(backups).length).toBeGreaterThan(0);
  });

  it('reports a failure instead of throwing out of the timer', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    // A file standing where the backup directory should be. The snapshot cannot be written, and
    // the point is that the server carries on: a backup that can crash the process it is
    // protecting has inverted its own purpose.
    const blocked = path.join(dir, 'backups');
    writeFileSync(blocked, 'in the way');

    const errors: unknown[] = [];
    const stop = startBackupSchedule({
      db,
      directory: blocked,
      intervalMs: 10,
      onError: (error) => errors.push(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    expect(errors.length).toBeGreaterThan(0);
  });
});
