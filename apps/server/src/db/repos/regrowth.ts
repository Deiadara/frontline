import type { Statement } from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

/**
 * The weeks the city's garrisons have already been rebuilt on (migration 0119).
 *
 * One row per weekly mark, and the row *is* the claim: `city/regrowth.ts` asks for the week it is
 * in, and gets an answer once. A table of its own rather than a column somewhere, because the
 * question is about the world rather than about any one plot, and because a marker with no rows is
 * the honest state of a world that has never turned a week over.
 */
export interface RegrowthRepo {
  /**
   * Claims one week's regrowth, answering true for the first caller and false for every later one.
   *
   * An insert that does nothing on a conflict is the whole mechanism: two ticks racing each other
   * both try, one writes the row, and the other is told the week is spoken for. `mark` is the
   * instant the week began in Athens (`lastWeekBoundary`), so a server that was down over a Sunday
   * comes up inside a week nobody has claimed and pays it on its first tick.
   */
  claim(mark: string, at: string): boolean;
  /** Whether this week's regrowth has already been claimed. A read, so it opens no write. */
  claimed(mark: string): boolean;
}

export function createRegrowthRepo(db: AppDatabase): RegrowthRepo {
  /*
   * Compiled on first use, the way `automations.ts` does and for the same reason: `db.prepare`
   * compiles immediately, and the migration tests build a repo against a database deliberately
   * stopped part-way up the chain. This table did not exist until 0119, so an eager prepare
   * throws `no such table` before those tests can assert anything at all.
   */
  let claimStmt: Statement | null = null;
  let claimedStmt: Statement | null = null;

  return {
    claim(mark, at) {
      claimStmt ??= db.prepare(
        'INSERT INTO garrison_regrowth (mark, at) VALUES (?, ?) ON CONFLICT (mark) DO NOTHING',
      );
      return claimStmt.run(mark, at).changes === 1;
    },
    claimed(mark) {
      claimedStmt ??= db.prepare('SELECT 1 FROM garrison_regrowth WHERE mark = ?');
      return claimedStmt.get(mark) !== undefined;
    },
  };
}
