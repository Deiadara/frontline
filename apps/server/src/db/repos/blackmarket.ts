import { BoostStashSchema, type BoostStash } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * The back room's storage.
 *
 * Almost nothing is here, and that is the design: what stands on the shelf is derived from
 * `(day, slot, generation)` in `@frontline/shared`, so the only rows are the turnover counters, the
 * receipts and the boosts a crew has not spent yet. Nothing in this file decides anything.
 */

interface SlotRow {
  slot_index: number;
  generation: number;
}

interface StashRow {
  good_id: string;
  count: number;
}

export interface Taking {
  id: string;
  baseId: string;
  day: string;
  slotIndex: number;
  goodId: string;
  infamySpent: number;
  takenAt: string;
}

export interface BlackMarketRepo {
  /**
   * How many times each slot has turned over on this day, indexed by slot.
   *
   * Sparse: a slot nobody has emptied has no row, and the caller reads that as generation zero.
   */
  generations(day: string): number[];
  /** Bumps one slot's counter, minting the row if the slot has not moved today. Returns the new value. */
  bumpGeneration(day: string, slotIndex: number): number;
  /** How many things this crew has taken on this day. The daily limit is this number. */
  takenOn(baseId: string, day: string): number;
  recordTaking(taking: Taking): void;
  /** Everything this crew has ever taken, newest first. History, not state. */
  historyFor(baseId: string, limit: number): Taking[];
  stashFor(baseId: string): BoostStash;
  /** Rewrites the whole stash for one crew. Small enough that a diff would be more code than value. */
  writeStash(baseId: string, stash: BoostStash): void;
}

export function createBlackMarketRepo(db: AppDatabase): BlackMarketRepo {
  const slotsStmt = db.prepare(
    'SELECT slot_index, generation FROM black_market_slots WHERE day = ?',
  );
  // One statement for "insert or increment": the shelf is shared, so two crews taking from
  // different slots in the same millisecond must not race each other through a read-then-write.
  const bumpStmt = db.prepare(
    `INSERT INTO black_market_slots (day, slot_index, generation) VALUES (?, ?, 1)
     ON CONFLICT (day, slot_index) DO UPDATE SET generation = generation + 1
     RETURNING generation`,
  );
  const countStmt = db.prepare(
    'SELECT COUNT(*) AS taken FROM black_market_takings WHERE base_id = ? AND day = ?',
  );
  const recordStmt = db.prepare(
    `INSERT INTO black_market_takings
       (id, base_id, day, slot_index, good_id, infamy_spent, taken_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const historyStmt = db.prepare(
    'SELECT * FROM black_market_takings WHERE base_id = ? ORDER BY taken_at DESC LIMIT ?',
  );
  const stashStmt = db.prepare('SELECT good_id, count FROM black_market_stash WHERE base_id = ?');
  const clearStashStmt = db.prepare('DELETE FROM black_market_stash WHERE base_id = ?');
  const insertStashStmt = db.prepare(
    'INSERT INTO black_market_stash (base_id, good_id, count) VALUES (?, ?, ?)',
  );

  return {
    generations(day) {
      const rows = slotsStmt.all(day) as SlotRow[];
      const generations: number[] = [];
      for (const row of rows) generations[row.slot_index] = row.generation;
      return generations;
    },
    bumpGeneration(day, slotIndex) {
      const row = bumpStmt.get(day, slotIndex) as { generation: number } | undefined;
      return row?.generation ?? 1;
    },
    takenOn(baseId, day) {
      return (countStmt.get(baseId, day) as { taken: number }).taken;
    },
    recordTaking(taking) {
      recordStmt.run(
        taking.id,
        taking.baseId,
        taking.day,
        taking.slotIndex,
        taking.goodId,
        taking.infamySpent,
        taking.takenAt,
      );
    },
    historyFor(baseId, limit) {
      const rows = historyStmt.all(baseId, limit) as {
        id: string;
        base_id: string;
        day: string;
        slot_index: number;
        good_id: string;
        infamy_spent: number;
        taken_at: string;
      }[];
      return rows.map((row) => ({
        id: row.id,
        baseId: row.base_id,
        day: row.day,
        slotIndex: row.slot_index,
        goodId: row.good_id,
        infamySpent: row.infamy_spent,
        takenAt: row.taken_at,
      }));
    },
    stashFor(baseId) {
      const rows = stashStmt.all(baseId) as StashRow[];
      return BoostStashSchema.parse(
        Object.fromEntries(rows.map((row) => [row.good_id, row.count])),
      );
    },
    writeStash(baseId, stash) {
      db.transaction(() => {
        clearStashStmt.run(baseId);
        for (const [goodId, count] of Object.entries(stash)) {
          if (count > 0) insertStashStmt.run(baseId, goodId, count);
        }
      })();
    },
  };
}
