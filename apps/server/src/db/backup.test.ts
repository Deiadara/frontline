import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKUP_KEEP,
  backupFileName,
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
 * the `-wal` sidecar rather than in the main file — a backup taken by copying `frontline.sqlite`
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

  it('keeps the newest N and deletes the rest', () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    for (let minute = 0; minute < 6; minute++) {
      takeBackup(db, backups, new Date(Date.UTC(2026, 7, 16, 10, minute * 10)));
    }
    expect(listBackups(backups)).toHaveLength(6);

    const removed = pruneBackups(backups, 3);
    expect(removed).toHaveLength(3);
    const left = listBackups(backups);
    expect(left).toHaveLength(3);
    // The three that survived are the three newest, not any three.
    expect(left.map((backup) => backup.takenAt)).toEqual([
      '2026-08-16T10:50:00.000Z',
      '2026-08-16T10:40:00.000Z',
      '2026-08-16T10:30:00.000Z',
    ]);
  });

  it('has a retention window worth several hours at the ten-minute cadence', () => {
    expect(BACKUP_KEEP).toBeGreaterThanOrEqual(6);
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
    // No `onBackup`. Written the obvious way — `onBackup?.(takeBackup(...))` — this schedule
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
