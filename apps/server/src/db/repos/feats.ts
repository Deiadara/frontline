import type { AppDatabase } from '../index.js';

/**
 * The two things a feat needs kept: what a crew has ever done, and what it has already collected.
 *
 * ## Tallies
 *
 * One integer per question per crew (`0092_feats.sql`). Every write is `value = value + ?` on a
 * single row, so two requests landing at once cannot lose one of the increments the way a
 * read-modify-write of a JSON blob does. That matters more here than almost anywhere else in this
 * server: the tally sites are the busiest paths in the game, and a settle that resolves six
 * missions at once bumps the same row six times.
 *
 * Negative amounts are refused rather than clamped. Every tally is a lifetime count and none of
 * them has a reason to fall, so a negative one is a caller bug and the useful thing is to be loud
 * about it at the point of the mistake rather than to quietly bank a wrong number that a feat will
 * later read as progress lost.
 */
export interface TallyBump {
  readonly tally: string;
  readonly amount: number;
}

export interface FeatsRepo {
  /** Adds to one counter. Creates the row at the value given if it is not there yet. */
  bump(baseId: string, tally: string, amount: number): void;
  /**
   * Several counters in one transaction.
   *
   * The settle paths move four or five at once (a mission home is a mission done, a mission won, a
   * mission in an area, a mission of a kind, plus every resource it paid), and one transaction is
   * both faster and the only version where a crash halfway leaves no crew credited with half a
   * mission.
   */
  bumpMany(baseId: string, bumps: readonly TallyBump[]): void;
  /** Every counter this crew has, as the flat record the evaluator reads. */
  tallies(baseId: string): Record<string, number>;

  /** The feats this crew has collected. */
  claimed(baseId: string): Set<string>;
  /**
   * Writes the claim, and says whether it was this call that wrote it.
   *
   * `false` means somebody else got there first, which is the whole of the double-pay guard: two
   * tabs pressing CLAIM on the same feat race into one UPSERT and exactly one of them is told it
   * won. The caller pays out only on a true. See `INSERT OR IGNORE` below: the row is written once
   * and never updated, because collecting is not something that happens twice.
   */
  claim(baseId: string, featId: string, at: string): boolean;
}

interface TallyRow {
  tally: string;
  value: number;
}

export function createFeatsRepo(db: AppDatabase): FeatsRepo {
  const bumpStmt = db.prepare(
    `INSERT INTO crew_tallies (base_id, tally, value) VALUES (?, ?, ?)
       ON CONFLICT(base_id, tally) DO UPDATE SET value = value + excluded.value`,
  );
  const talliesStmt = db.prepare('SELECT tally, value FROM crew_tallies WHERE base_id = ?');
  const claimedStmt = db.prepare('SELECT feat_id FROM crew_feats WHERE base_id = ?');
  const claimStmt = db.prepare(
    'INSERT OR IGNORE INTO crew_feats (base_id, feat_id, claimed_at) VALUES (?, ?, ?)',
  );

  function bumpOne(baseId: string, tally: string, amount: number): void {
    if (amount < 0) {
      throw new Error(`a tally cannot go down: ${tally} by ${amount}`);
    }
    // Zero is a no-op rather than a row of nothing. The call sites add up a mission's haul and
    // several resources are usually absent, so this is the common case and not an edge one.
    if (amount === 0) return;
    bumpStmt.run(baseId, tally, amount);
  }

  return {
    bump(baseId, tally, amount) {
      bumpOne(baseId, tally, amount);
    },

    bumpMany(baseId, bumps) {
      if (bumps.length === 0) return;
      db.transaction(() => {
        for (const { tally, amount } of bumps) bumpOne(baseId, tally, amount);
      })();
    },

    tallies(baseId) {
      const rows = talliesStmt.all(baseId) as TallyRow[];
      return Object.fromEntries(rows.map((row) => [row.tally, row.value]));
    },

    claimed(baseId) {
      const rows = claimedStmt.all(baseId) as { feat_id: string }[];
      return new Set(rows.map((row) => row.feat_id));
    },

    claim(baseId, featId, at) {
      return claimStmt.run(baseId, featId, at).changes === 1;
    },
  };
}
