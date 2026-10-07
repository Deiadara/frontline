import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
 * would come back missing it, silently and only under load. SQLite's backup API reads through the
 * live connection, WAL included, and the test that would fail without it is the round-trip below.
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
  it('is a whole database, with everything committed up to the moment it was taken', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    db.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1','operator','x','2026-08-16T00:00:00.000Z')",
    ).run();

    const file = await takeBackup(db, path.join(dir, 'backups'));

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

  it('keeps taking snapshots without disturbing the live database', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');

    await takeBackup(db, backups, new Date('2026-08-16T10:00:00.000Z'));
    db.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u2','later','x','2026-08-16T10:05:00.000Z')",
    ).run();
    await takeBackup(db, backups, new Date('2026-08-16T10:10:00.000Z'));

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
  it('reports snapshots newest first and ignores anything that is not one', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    await takeBackup(db, backups, new Date('2026-08-16T10:00:00.000Z'));
    await takeBackup(db, backups, new Date('2026-08-16T10:10:00.000Z'));
    writeFileSync(path.join(backups, 'README.txt'), 'not a snapshot');

    const listed = listBackups(backups);
    expect(listed).toHaveLength(2);
    expect(listed[0]!.takenAt).toBe('2026-08-16T10:10:00.000Z');
    expect(listed[0]!.bytes).toBeGreaterThan(0);
  });

  // Bug pass, 2026-10-02: a snapshot cut off mid-write left its `.partial` for ever.
  it('sweeps the partial of a snapshot that was cut off, and leaves a fresh one alone', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const now = new Date('2026-09-27T12:00:00.000Z');
    await takeBackup(db, backups, new Date(now.getTime() - 60_000));
    const old = `${backupFileName(new Date(now.getTime() - 30 * 60_000))}.partial`;
    const fresh = `${backupFileName(new Date(now.getTime() - 60_000 + 1))}.partial`;
    writeFileSync(path.join(backups, old), 'cut off');
    writeFileSync(path.join(backups, fresh), 'still being written');

    pruneBackups(backups, now);
    const left = readdirSync(backups);
    expect(left).not.toContain(old);
    expect(left).toContain(fresh);
    expect(listBackups(backups)).toHaveLength(1);
  });

  it('answers with nothing for a directory that does not exist yet', () => {
    expect(listBackups(path.join(workspace(), 'never-made'))).toEqual([]);
  });

  it('prunes by tier, keeping recent, hourly and daily snapshots', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const now = new Date('2026-09-27T12:00:00.000Z');
    const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    // Two recent, two in the same hour a day ago, two on the same day a week ago, one too old.
    for (const minutes of [2, 60, 24 * 60 + 5, 24 * 60 + 20, 7 * 24 * 60 + 5, 7 * 24 * 60 + 90]) {
      await takeBackup(db, backups, minutesAgo(minutes));
    }
    await takeBackup(db, backups, minutesAgo(40 * 24 * 60));

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
  it('passes its own integrity check and leaves no partial file behind', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const file = await takeBackup(db, backups);
    expect(await checkSnapshot(path.join(backups, file))).toBe('ok');
    expect(readdirSync(backups).some((name) => name.endsWith('.partial'))).toBe(false);
  });

  it('refuses a file that is not a database', async () => {
    const dir = workspace();
    const bogus = path.join(dir, 'bogus.sqlite');
    writeFileSync(bogus, 'not a database at all, and long enough to have a header');
    await expect(checkSnapshot(bogus)).rejects.toThrow();
  });

  it('lands a copy in the mirror, pruned by the same tiers', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const mirror = path.join(dir, 'elsewhere');
    // The mirror is a mounted drive, so it is there before the server is (2026-10-06).
    mkdirSync(mirror);
    const file = await takeBackup(db, backups, new Date(), mirror);
    expect(listBackups(mirror).map((backup) => backup.file)).toEqual([file]);
    expect(await checkSnapshot(path.join(mirror, file))).toBe('ok');
  });

  // Maintainer, 2026-10-06: a missing mirror is a drive that is not mounted. It was created on the
  // local disk, and the copies filled the disk they were meant to be off.
  it('never makes a mirror that is not there, and says the copy was skipped', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const mirror = path.join(dir, 'unmounted');
    const warned: string[] = [];
    const stop = startBackupSchedule({
      db,
      directory: path.join(dir, 'backups'),
      mirror,
      intervalMs: 20,
      onWarn: (message) => warned.push(message),
    });
    await until(() => warned.length > 0);
    await stop();
    expect(existsSync(mirror)).toBe(false);
    expect(warned[0]).toMatch(/not mounted/);
  });
});

/** Waits until `done` holds, or fails the test after two seconds. */
async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the schedule');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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
    await until(() => taken.length > 0);
    // Resolves only once a snapshot in flight has landed, so the database can close behind it.
    await stop();
    const afterStop = taken.length;

    await new Promise((resolve) => setTimeout(resolve, 60));
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
    await until(() => listBackups(backups).length > 0);
    await stop();
    expect(listBackups(backups).length).toBeGreaterThan(0);
  });

  /** Bug pass, 2026-10-06: a mirror that cannot be written is not a failed snapshot. */
  it('announces a snapshot the mirror could not take, and reports the mirror on its own', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    // A file standing where the mirror should be: the copy cannot land, the primary can.
    const mirror = path.join(dir, 'mirror');
    writeFileSync(mirror, 'in the way');

    const taken: string[] = [];
    const errors: unknown[] = [];
    const stop = startBackupSchedule({
      db,
      directory: backups,
      mirror,
      intervalMs: 10,
      onBackup: (file) => taken.push(file),
      onError: (error) => errors.push(error),
    });
    const mirrored = () =>
      errors.some((error) => /was taken but not mirrored/.test(String((error as Error).message)));
    await until(() => taken.length > 0 && mirrored());
    await stop();

    // The ten-millisecond ticks also report the ones they skip; the mirror's own report is there.
    expect(listBackups(backups).length).toBeGreaterThan(0);
    expect(mirrored()).toBe(true);
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
    // More than one failure: the first one did not stop the ticks that follow it.
    await until(() => errors.length > 1);
    await stop();
    expect(errors.length).toBeGreaterThan(1);
  });

  it('never runs two snapshots at once', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    const backups = path.join(dir, 'backups');
    const taken: string[] = [];
    // A tick every millisecond against snapshots that take tens of them: without the guard, dozens
    // would be writing `.partial` files side by side.
    const stop = startBackupSchedule({
      db,
      directory: backups,
      intervalMs: 1,
      onBackup: (file) => taken.push(file),
    });
    let most = 0;
    await until(() => {
      let partials = 0;
      try {
        partials = readdirSync(backups).filter((name) => name.endsWith('.partial')).length;
      } catch {
        // Not made yet.
      }
      most = Math.max(most, partials);
      return taken.length >= 3;
    });
    await stop();
    expect(most).toBeLessThanOrEqual(1);
  });
});

describe('the event loop while a snapshot is written', () => {
  /*
   * The reason the snapshot moved to a worker (maintainer, 2026-09-30). On the main connection it
   * held the loop for its whole duration. Measured by the longest gap between 1 ms ticks while one
   * is taken.
   */
  it('never holds the loop for long, however long the snapshot takes', async () => {
    const dir = workspace();
    const db = liveDatabase(dir);
    db.exec('CREATE TABLE filler (id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO filler (note) VALUES (?)');
    db.transaction(() => {
      for (let i = 0; i < 40_000; i += 1) insert.run(`${i}`.padEnd(500, 'x'));
    })();

    let last = performance.now();
    let worstGap = 0;
    const ticker = setInterval(() => {
      const now = performance.now();
      worstGap = Math.max(worstGap, now - last);
      last = now;
    }, 1);
    // The game keeps writing on the main connection throughout, and none of it may be refused.
    let written = 0;
    const writer = setInterval(() => {
      insert.run('written while the snapshot ran');
      written += 1;
    }, 2);
    const started = performance.now();
    const file = await takeBackup(db, path.join(dir, 'backups'));
    const took = performance.now() - started;
    clearInterval(ticker);
    clearInterval(writer);

    expect(written).toBeGreaterThan(0);
    const restored = openDatabase(path.join(dir, 'backups', file));
    opened.push(restored);
    const rows = restored.prepare('SELECT COUNT(*) AS n FROM filler').get() as { n: number };
    expect(rows.n).toBeGreaterThanOrEqual(40_000);

    // About 20 MB: the snapshot takes far longer than any one pause it causes.
    expect(took).toBeGreaterThan(4 * worstGap);
    expect(worstGap).toBeLessThan(50);
  });
});
