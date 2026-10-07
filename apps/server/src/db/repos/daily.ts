import type { Statement } from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

/**
 * The days each crew's held ground has already paid its daily grants on (migration 0154).
 *
 * The row is the claim, as `garrison_regrowth` does it: `city/daily.ts` asks for the crew and
 * the day, and gets a yes once. An insert that does nothing on a conflict is the whole mechanism.
 */
export interface DailyGrantsRepo {
  /** Claims one crew's grants for one Athens day: true for the first caller, false after. */
  claim(baseId: string, day: string, at: string): boolean;
  /** Whether the crew has been paid for that day. A read, so it opens no write. */
  claimed(baseId: string, day: string): boolean;
}

export function createDailyGrantsRepo(db: AppDatabase): DailyGrantsRepo {
  // Compiled on first use, for the reason `regrowth.ts` gives: the migration tests build a repo
  // against a database stopped part-way up the chain, before this table exists.
  let claimStmt: Statement | null = null;
  let claimedStmt: Statement | null = null;

  return {
    claim(baseId, day, at) {
      claimStmt ??= db.prepare(
        `INSERT INTO daily_grants (base_id, day, at) VALUES (?, ?, ?)
         ON CONFLICT (base_id, day) DO NOTHING`,
      );
      return claimStmt.run(baseId, day, at).changes === 1;
    },
    claimed(baseId, day) {
      claimedStmt ??= db.prepare('SELECT 1 FROM daily_grants WHERE base_id = ? AND day = ?');
      return claimedStmt.get(baseId, day) !== undefined;
    },
  };
}
