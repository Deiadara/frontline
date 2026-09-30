import { MVP_DEV_CREDENTIALS, SEEDED_BOT_USERNAMES, isReservedName } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories } from '../db/repos/index.js';
import { seedMvpWorld } from './index.js';

/**
 * The seeded bots' names are reserved (maintainer, 2026-09-29), and the list that reserves them
 * lives in `@frontline/shared`, a package away from the seed that writes them. Read off a seeded
 * world rather than off the constants, so a fifth bot added to the seed fails here until its name
 * is on the list.
 */
describe('reserved names and the seed', () => {
  it('reserves every bot the seed writes, and not the dev operator', async () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);
      await seedMvpWorld({ db, repos: createRepositories(db) });
      const bots = (
        db
          .prepare(
            'SELECT u.username FROM users u JOIN bases b ON b.owner_id = u.id WHERE b.is_bot = 1',
          )
          .all() as { username: string }[]
      ).map((row) => row.username);

      expect(bots.length, 'fixture: the seed wrote bots').toBeGreaterThan(0);
      expect([...bots].sort()).toEqual([...SEEDED_BOT_USERNAMES].sort());
      for (const username of bots) expect(isReservedName(username), username).toBe(true);
      expect(isReservedName(MVP_DEV_CREDENTIALS.username)).toBe(false);
    } finally {
      db.close();
    }
  });
});
