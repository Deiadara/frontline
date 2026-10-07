import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

/**
 * The runner refuses to start when its record and the files disagree (maintainer, 2026-10-06):
 * a file renumbered after it ran would run again, and a vanished one means the save went through a
 * history that is not on disk.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(...names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'frontline-record-'));
  dirs.push(dir);
  for (const name of names) {
    writeFileSync(path.join(dir, name), `CREATE TABLE t_${name.slice(0, 4)} (id INTEGER);`);
  }
  return dir;
}

describe('a record that disagrees with the files', () => {
  it('starts on a record that agrees, and applies what is new after it', () => {
    const dir = folder('0001_a.sql', '0002_b.sql');
    const db = openDatabase(':memory:');
    expect(runMigrations(db, dir)).toEqual(['0001_a.sql', '0002_b.sql']);
    writeFileSync(path.join(dir, '0003_c.sql'), 'CREATE TABLE t_3 (id INTEGER);');
    expect(runMigrations(db, dir)).toEqual(['0003_c.sql']);
  });

  it('refuses a file older than one already applied', () => {
    const dir = folder('0001_a.sql', '0003_c.sql');
    const db = openDatabase(':memory:');
    runMigrations(db, dir);
    writeFileSync(path.join(dir, '0002_b.sql'), 'CREATE TABLE t_2 (id INTEGER);');
    expect(() => runMigrations(db, dir)).toThrow(/0002_b\.sql/);
  });

  it('refuses an applied migration whose file is gone', () => {
    const dir = folder('0001_a.sql', '0002_b.sql');
    const db = openDatabase(':memory:');
    runMigrations(db, dir);
    unlinkSync(path.join(dir, '0001_a.sql'));
    expect(() => runMigrations(db, dir)).toThrow(/0001_a\.sql/);
  });

  it('accepts the one draft known to have been abandoned', () => {
    const dir = folder('0001_a.sql');
    const db = openDatabase(':memory:');
    runMigrations(db, dir);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run('0142_bar_withdrawals.sql');
    expect(() => runMigrations(db, dir)).not.toThrow();
  });
});
