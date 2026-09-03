import { NOTIFICATION_KINDS } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../index.js';
import { createRepositories, type Repositories } from './index.js';

/**
 * The badge counts what the bell will actually show.
 *
 * `notifications()` drops a row whose kind the catalogue no longer carries, which is the right
 * repair: a retired kind must not take a player's bell down. The unread count did not, so a
 * retirement left a badge saying 3 over a list showing nothing, and nothing could clear it, because
 * `markNotificationRead` needs an id and the list never returned one. Kinds have been retired
 * before: `0054_battle_report_tiers.sql` exists to rewrite one.
 */

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

const RETIRED = 'a_kind_that_was_retired';

function openStack(): { repos: Repositories; db: AppDatabase } {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return { repos: createRepositories(db), db };
}

describe('the unread bell', () => {
  it('is not in the catalogue, so the fixture below is a real retirement', () => {
    expect(NOTIFICATION_KINDS as readonly string[]).not.toContain(RETIRED);
  });

  it('does not count a kind the list refuses to show', () => {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });

    const live = NOTIFICATION_KINDS[0] as string;
    for (const [index, kind] of [live, RETIRED, RETIRED].entries()) {
      db.prepare(
        `INSERT INTO notifications (id, user_id, kind, title, body, link, subject_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `n-${index}`,
        'user-1',
        kind,
        'Something',
        'happened',
        '/city',
        null,
        new Date().toISOString(),
      );
    }

    // Two of the three are unshowable, so the bell may only claim the one that is.
    expect(repos.social.notifications('user-1', 50)).toHaveLength(1);
    expect(repos.social.unreadNotifications('user-1')).toBe(1);
  });

  it('still counts every live kind, so the filter is not just switching the badge off', () => {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    for (const [index, kind] of NOTIFICATION_KINDS.entries()) {
      db.prepare(
        `INSERT INTO notifications (id, user_id, kind, title, body, link, subject_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `n-${index}`,
        'user-1',
        kind,
        'Something',
        'happened',
        '/city',
        null,
        new Date().toISOString(),
      );
    }
    expect(repos.social.unreadNotifications('user-1')).toBe(NOTIFICATION_KINDS.length);
  });
});
