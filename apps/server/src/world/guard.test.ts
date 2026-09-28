import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories } from '../db/repos/index.js';
import {
  TICK_FAILURE_REPORT_MS,
  guardStage,
  reportTickFailure,
  reportTickFailuresTo,
  settleEach,
  type TickFailure,
} from './guard.js';

/**
 * One bad row is one bad row (robustness pass, 2026-09-25). See `world/guard.ts`.
 */

const dbs: AppDatabase[] = [];
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  for (const db of dbs.splice(0)) db.close();
});

function world() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  dbs.push(db);
  db.exec('CREATE TABLE scratch (id TEXT PRIMARY KEY)');
  const failures: TickFailure[] = [];
  restores.push(reportTickFailuresTo((failure) => failures.push(failure)));
  const rows = () =>
    (db.prepare('SELECT id FROM scratch ORDER BY id').all() as { id: string }[]).map((r) => r.id);
  return { db, repos: createRepositories(db), failures, rows };
}

describe('settling item by item', () => {
  it('settles the items after one that throws, and says which one it was', () => {
    const { db, repos, failures, rows } = world();
    const settled = settleEach(
      repos,
      'test stage',
      ['a', 'b', 'c'],
      (id) => id,
      (id) => {
        if (id === 'b') throw new Error('b is unreadable');
        db.prepare('INSERT INTO scratch (id) VALUES (?)').run(id);
      },
    );
    expect(settled).toBe(2);
    expect(rows()).toEqual(['a', 'c']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ stage: 'test stage', item: 'b' });
  });

  /*
   * The reason each item gets a transaction: a stage that made two writes per item and threw
   * between them left the first standing, and the next tick did the whole item again.
   */
  it('rolls an item that throws back to where it started, first write included', () => {
    const { db, repos, rows } = world();
    settleEach(
      repos,
      'test stage',
      ['half'],
      (id) => id,
      (id) => {
        db.prepare('INSERT INTO scratch (id) VALUES (?)').run(id);
        throw new Error('fell over between the two writes');
      },
    );
    expect(rows()).toEqual([]);
  });

  it('rolls back only its own item when it runs inside an outer transaction', () => {
    const { db, repos, rows } = world();
    repos.tx(() => {
      db.prepare('INSERT INTO scratch (id) VALUES (?)').run('outer');
      settleEach(
        repos,
        'test stage',
        ['x', 'y'],
        (id) => id,
        (id) => {
          db.prepare('INSERT INTO scratch (id) VALUES (?)').run(id);
          if (id === 'x') throw new Error('x fails');
        },
      );
    });
    expect(rows()).toEqual(['outer', 'y']);
  });
});

describe('guarding a whole stage', () => {
  it('answers the fallback and reports, so the stages after it still run', () => {
    const { failures } = world();
    const ran: string[] = [];
    const first = guardStage('broken', -1, () => {
      throw new Error('no table');
    });
    guardStage('next', 0, () => ran.push('next'));
    expect(first).toBe(-1);
    expect(ran).toEqual(['next']);
    expect(failures.map((one) => one.stage)).toEqual(['broken']);
  });

  it('survives a sink that throws', () => {
    restores.push(
      reportTickFailuresTo(() => {
        throw new Error('the logger is down');
      }),
    );
    expect(() =>
      guardStage('stage', 0, () => {
        throw new Error('x');
      }),
    ).not.toThrow();
  });
});

describe('reporting', () => {
  it('reports the same row once a minute, not once a tick', () => {
    const { failures } = world();
    const failure = { stage: 'battles', item: 'the-same-one', error: new Error('again') };
    reportTickFailure(failure, 1_000);
    reportTickFailure(failure, 2_000);
    reportTickFailure(failure, 1_000 + TICK_FAILURE_REPORT_MS - 1);
    expect(failures).toHaveLength(1);
    reportTickFailure(failure, 1_000 + TICK_FAILURE_REPORT_MS);
    expect(failures).toHaveLength(2);
    // A different row is its own report.
    reportTickFailure({ ...failure, item: 'another' }, 2_000);
    expect(failures).toHaveLength(3);
  });
});
