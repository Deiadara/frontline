import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../index.js';
import { createFeatsRepo, type FeatsRepo } from './feats.js';

/**
 * The counters and the claim ledger, tested where they can actually be wrong.
 *
 * This file exists because of a test that could not fail. The route-level "two tabs press CLAIM at
 * once" case passes whether or not `claim` reports what it wrote: fastify's `inject` plus a
 * synchronous sqlite driver means each request runs to completion before the next begins, so the
 * second one is caught by the earlier `already_claimed` check and the write guard is never
 * reached. Mutating the guard away left every route test green.
 *
 * The guard is still the thing that matters, because it is the only one that survives two requests
 * genuinely interleaving. So it is tested here, directly, where a mutation to it does fail.
 */

let db: AppDatabase;
let repo: FeatsRepo;

const BASE = 'base-1';
const OTHER = 'base-2';

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  /*
   * Two crews, and the accounts they hang off.
   *
   * `bases.owner_id` references `users`, so the user rows are not scenery: without them the
   * inserts below fail the foreign key and every test in the file reports the same unhelpful
   * message. Written straight rather than through the register route, because what is under test
   * is two tables and neither of them needs a working game to exercise.
   */
  const addUser = db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at)
     VALUES (?, ?, 'x', '2026-09-13T00:00:00.000Z')`,
  );
  const addBase = db.prepare(
    `INSERT INTO bases (id, owner_id, name, district_id, level, resources_json, buildings_json, created_at)
     VALUES (?, ?, ?, 'kettle-row', 1, '{}', '[]', '2026-09-13T00:00:00.000Z')`,
  );
  addUser.run('user-1', 'one');
  addUser.run('user-2', 'two');
  addBase.run(BASE, 'user-1', 'One');
  addBase.run(OTHER, 'user-2', 'Two');
  repo = createFeatsRepo(db);
});

describe('counters', () => {
  it('starts a crew at nothing', () => {
    expect(repo.tallies(BASE)).toEqual({});
  });

  it('creates a counter on the first bump and adds to it after', () => {
    repo.bump(BASE, 'missions_done', 1);
    expect(repo.tallies(BASE)).toEqual({ missions_done: 1 });
    repo.bump(BASE, 'missions_done', 4);
    expect(repo.tallies(BASE)).toEqual({ missions_done: 5 });
  });

  /**
   * The property the whole design rests on.
   *
   * `value = value + ?` in one statement, rather than reading a number out and writing it back.
   * The busy paths bump the same row several times in a settle, and a read-modify-write would
   * lose increments the moment two of them overlapped.
   */
  it('adds rather than replaces, however many times it is called', () => {
    for (let press = 0; press < 200; press += 1) repo.bump(BASE, 'units_trained', 3);
    expect(repo.tallies(BASE).units_trained).toBe(600);
  });

  it('keeps a fraction, because production settles in fractions', () => {
    repo.bump(BASE, 'resources_earned:scrap', 0.25);
    repo.bump(BASE, 'resources_earned:scrap', 0.5);
    expect(repo.tallies(BASE)['resources_earned:scrap']).toBeCloseTo(0.75);
  });

  it('writes nothing for a bump of nothing', () => {
    repo.bump(BASE, 'kills', 0);
    expect(repo.tallies(BASE)).toEqual({});
  });

  it('refuses to go down, loudly', () => {
    // Every tally is a lifetime count and none of them has a reason to fall, so a negative amount
    // is a caller bug. Better to say so at the mistake than to bank a wrong number quietly.
    expect(() => repo.bump(BASE, 'kills', -1)).toThrow(/cannot go down/);
    expect(repo.tallies(BASE)).toEqual({});
  });

  it('moves several counters together, and none of them on an empty list', () => {
    repo.bumpMany(BASE, [
      { tally: 'missions_done', amount: 1 },
      { tally: 'missions_in_area:rustyard', amount: 1 },
      { tally: 'resources_earned:caps', amount: 120 },
    ]);
    expect(repo.tallies(BASE)).toEqual({
      missions_done: 1,
      'missions_in_area:rustyard': 1,
      'resources_earned:caps': 120,
    });
    repo.bumpMany(BASE, []);
    expect(Object.keys(repo.tallies(BASE))).toHaveLength(3);
  });

  it('banks a batch all together or not at all', () => {
    repo.bump(BASE, 'kills', 10);
    expect(() =>
      repo.bumpMany(BASE, [
        { tally: 'kills', amount: 5 },
        { tally: 'missions_done', amount: -1 },
      ]),
    ).toThrow();
    // The good half of the batch is rolled back with the bad half: a crash partway through must
    // not credit a crew with the first three of five things that happened.
    expect(repo.tallies(BASE).kills).toBe(10);
    expect(repo.tallies(BASE).missions_done).toBeUndefined();
  });

  it('keeps one crew’s counters out of another’s', () => {
    repo.bump(BASE, 'kills', 7);
    repo.bump(OTHER, 'kills', 100);
    expect(repo.tallies(BASE).kills).toBe(7);
    expect(repo.tallies(OTHER).kills).toBe(100);
  });
});

describe('the claim ledger', () => {
  it('has collected nothing to begin with', () => {
    expect(repo.claimed(BASE)).toEqual(new Set());
  });

  /**
   * The guard the route depends on, tested where a mutation to it can be seen.
   *
   * Exactly one call may come back true. That is the whole of the double-pay protection for two
   * requests that genuinely interleave: the route pays out only on a true, so a second writer is
   * told it lost and hands over nothing.
   */
  it('lets exactly one call write a claim', () => {
    expect(repo.claim(BASE, 'runs_1', '2026-09-13T00:00:00.000Z')).toBe(true);
    expect(repo.claim(BASE, 'runs_1', '2026-09-13T00:00:01.000Z')).toBe(false);
    expect(repo.claim(BASE, 'runs_1', '2026-09-13T00:00:02.000Z')).toBe(false);
    expect(repo.claimed(BASE)).toEqual(new Set(['runs_1']));
  });

  it('keeps the first claim’s time, not the last attempt’s', () => {
    repo.claim(BASE, 'runs_1', '2026-09-13T00:00:00.000Z');
    repo.claim(BASE, 'runs_1', '2027-01-01T00:00:00.000Z');
    const row = db
      .prepare('SELECT claimed_at FROM crew_feats WHERE base_id = ? AND feat_id = ?')
      .get(BASE, 'runs_1') as { claimed_at: string };
    expect(row.claimed_at).toBe('2026-09-13T00:00:00.000Z');
  });

  it('lets two crews collect the same feat', () => {
    expect(repo.claim(BASE, 'runs_1', '2026-09-13T00:00:00.000Z')).toBe(true);
    expect(repo.claim(OTHER, 'runs_1', '2026-09-13T00:00:00.000Z')).toBe(true);
    expect(repo.claimed(BASE)).toEqual(new Set(['runs_1']));
    expect(repo.claimed(OTHER)).toEqual(new Set(['runs_1']));
  });

  it('collects several feats for one crew', () => {
    for (const id of ['runs_1', 'runs_2', 'fights_1']) {
      repo.claim(BASE, id, '2026-09-13T00:00:00.000Z');
    }
    expect(repo.claimed(BASE)).toEqual(new Set(['runs_1', 'runs_2', 'fights_1']));
  });

  it('takes a crew’s counters and claims with it when the crew goes', () => {
    repo.bump(BASE, 'kills', 3);
    repo.claim(BASE, 'runs_1', '2026-09-13T00:00:00.000Z');
    db.prepare('DELETE FROM bases WHERE id = ?').run(BASE);
    // ON DELETE CASCADE on both tables: no orphan counters, no orphan claims.
    expect(repo.tallies(BASE)).toEqual({});
    expect(repo.claimed(BASE)).toEqual(new Set());
  });
});
