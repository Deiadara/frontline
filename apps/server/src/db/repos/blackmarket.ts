import { blackMarketClosesAt, BoostStashSchema, type BoostStash } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * The back room's storage.
 *
 * Almost nothing is here, and that is the design: what stands on the shelf is derived from
 * `(day, slot, generation)` in `@frontline/shared`, so the only rows are the turnover counters, the
 * bids the city has said out loud, the receipts and the boosts a crew has not spent yet. Nothing in
 * this file decides anything.
 */

interface SlotRow {
  slot_index: number;
  generation: number;
}

interface StashRow {
  good_id: string;
  count: number;
}

/** One crew's bid on one lot. */
export interface BlackBid {
  day: string;
  lotId: string;
  slotIndex: number;
  userId: string;
  /** The district the crate goes to if this wins, and whose infamy pays for it. */
  baseId: string;
  amount: number;
  at: string;
}

/** How one lot ended, written once by the close. */
export interface BlackLotResult {
  day: string;
  lotId: string;
  slotIndex: number;
  /** Denormalised: the catalogue a shelf was drawn from can move under a results panel. */
  goodId: string;
  /** Null when nobody in the ranking could pay, or everybody in it was at their allowance. */
  winnerUserId: string | null;
  price: number | null;
  settledAt: string;
}

/** A lot the close has not written a result for yet. */
export interface UnsettledBlackLot {
  day: string;
  lotId: string;
  slotIndex: number;
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
  generations(day: string, cityId: string): number[];
  /** Bumps one slot's counter, minting the row if the slot has not moved today. Returns the new value. */
  bumpGeneration(day: string, cityId: string, slotIndex: number): number;
  /** How many things this crew has taken on this day. The daily limit is this number. */
  takenOn(baseId: string, day: string): number;
  recordTaking(taking: Taking): void;
  /** Everything this crew has ever taken, newest first. History, not state. */
  historyFor(baseId: string, limit: number): Taking[];
  stashFor(baseId: string): BoostStash;
  /** Rewrites the whole stash for one crew. Small enough that a diff would be more code than value. */
  writeStash(baseId: string, stash: BoostStash): void;

  /** Every bid on one lot, for the card that shows who is leading and for the close. */
  bidsFor(day: string, lotId: string): BlackBid[];
  /** Every bid on one day's shelf, so five lots cost one query. */
  bidsOn(day: string): BlackBid[];
  /**
   * Writes a bid, replacing whatever this crew was at.
   *
   * An upsert because a crew raising itself out of second place has a row already. A bid is a
   * position rather than a history: the close only ever reads the latest number.
   */
  placeBid(bid: BlackBid): void;
  /** Lots with bids on them, no result row, and a day that has already ended. */
  unsettled(now: Date): UnsettledBlackLot[];
  results(day: string): BlackLotResult[];
  recordResult(result: BlackLotResult): void;
}

const BID_COLUMNS = 'day, lot_id, slot_index, user_id, base_id, amount, at';
const LOT_RESULT_COLUMNS = 'day, lot_id, slot_index, good_id, winner_user_id, price, settled_at';

interface BidRow {
  day: string;
  lot_id: string;
  slot_index: number;
  user_id: string;
  base_id: string;
  amount: number;
  at: string;
}

interface LotResultRow {
  day: string;
  lot_id: string;
  slot_index: number;
  good_id: string;
  winner_user_id: string | null;
  price: number | null;
  settled_at: string;
}

/**
 * Compiled on first use rather than when the repo is built.
 *
 * Every other statement in this file is prepared at construction, which is right for a repo built
 * against a fully migrated database. `stockpile-integrity.test.ts` deliberately builds one against
 * a *part* migrated database, so it can seed rows before the migration it measures runs, and a
 * statement naming a table that arrives in 0098 cannot be compiled there. Deferring costs one
 * branch per call and makes the repo safe to construct at any rung of the ladder.
 */
function lazy<T>(compile: () => T): () => T {
  let compiled: T | null = null;
  return () => (compiled ??= compile());
}

function rowToBid(row: BidRow): BlackBid {
  return {
    day: row.day,
    lotId: row.lot_id,
    slotIndex: row.slot_index,
    userId: row.user_id,
    baseId: row.base_id,
    amount: row.amount,
    at: row.at,
  };
}

export function createBlackMarketRepo(db: AppDatabase): BlackMarketRepo {
  // Lazy for the same reason the 0098 statements are: `city_id` arrives in 0099, and this repo is
  // constructed against a part-migrated database by `stockpile-integrity.test.ts`.
  const slotsStmt = lazy(() =>
    db.prepare(
      'SELECT slot_index, generation FROM black_market_slots WHERE day = ? AND city_id = ?',
    ),
  );
  // One statement for "insert or increment": the shelf is shared, so two crews taking from
  // different slots in the same millisecond must not race each other through a read-then-write.
  const bumpStmt = lazy(() =>
    db.prepare(
      `INSERT INTO black_market_slots (day, city_id, slot_index, generation) VALUES (?, ?, ?, 1)
       ON CONFLICT (day, city_id, slot_index) DO UPDATE SET generation = generation + 1
       RETURNING generation`,
    ),
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
  const bidsForStmt = lazy(() =>
    db.prepare(`SELECT ${BID_COLUMNS} FROM black_market_bids WHERE day = ? AND lot_id = ?`),
  );
  const bidsOnStmt = lazy(() =>
    db.prepare(`SELECT ${BID_COLUMNS} FROM black_market_bids WHERE day = ?`),
  );
  const placeBidStmt = lazy(() =>
    db.prepare(
      `INSERT INTO black_market_bids
       (day, lot_id, slot_index, user_id, base_id, amount, at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, lot_id, user_id) DO UPDATE SET
       slot_index = excluded.slot_index,
       base_id = excluded.base_id,
       amount = excluded.amount,
       at = excluded.at,
       updated_at = excluded.updated_at`,
    ),
  );
  // Grouped rather than DISTINCT so the shape of the answer is one row per lot, which is what the
  // settler walks. The NOT EXISTS is per lot and not per day: a close that fell over halfway
  // through leaves the lots it did write settled and the rest still due.
  const openLotsStmt = lazy(() =>
    db.prepare(
      `SELECT b.day AS day, b.lot_id AS lot_id, MIN(b.slot_index) AS slot_index
       FROM black_market_bids b
      WHERE NOT EXISTS (
              SELECT 1 FROM black_market_lot_results r
               WHERE r.day = b.day AND r.lot_id = b.lot_id
            )
      GROUP BY b.day, b.lot_id
      ORDER BY b.day, b.lot_id`,
    ),
  );
  const lotResultsStmt = lazy(() =>
    db.prepare(`SELECT ${LOT_RESULT_COLUMNS} FROM black_market_lot_results WHERE day = ?`),
  );
  const recordLotResultStmt = lazy(() =>
    db.prepare(
      `INSERT INTO black_market_lot_results (${LOT_RESULT_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, lot_id) DO NOTHING`,
    ),
  );

  return {
    generations(day, cityId) {
      const rows = slotsStmt().all(day, cityId) as SlotRow[];
      const generations: number[] = [];
      for (const row of rows) generations[row.slot_index] = row.generation;
      return generations;
    },
    bumpGeneration(day, cityId, slotIndex) {
      const row = bumpStmt().get(day, cityId, slotIndex) as { generation: number } | undefined;
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
    bidsFor(day, lotId) {
      return (bidsForStmt().all(day, lotId) as BidRow[]).map(rowToBid);
    },
    bidsOn(day) {
      return (bidsOnStmt().all(day) as BidRow[]).map(rowToBid);
    },
    placeBid(bid) {
      placeBidStmt().run(
        bid.day,
        bid.lotId,
        bid.slotIndex,
        bid.userId,
        bid.baseId,
        bid.amount,
        bid.at,
        bid.at,
      );
    },
    unsettled(now) {
      /*
       * Whether a day is over is a question about the game clock, and the game clock is a function
       * of the Athens calendar rather than a column anybody wrote. So the row filter is here rather
       * than in SQL: the query asks the cheap question (which lots have no result), and
       * `blackMarketClosesAt` answers the one only the shared rules can.
       */
      const rows = openLotsStmt().all() as { day: string; lot_id: string; slot_index: number }[];
      return rows
        .filter((row) => blackMarketClosesAt(row.day).getTime() <= now.getTime())
        .map((row) => ({ day: row.day, lotId: row.lot_id, slotIndex: row.slot_index }));
    },
    results(day) {
      return (lotResultsStmt().all(day) as LotResultRow[]).map((row) => ({
        day: row.day,
        lotId: row.lot_id,
        slotIndex: row.slot_index,
        goodId: row.good_id,
        winnerUserId: row.winner_user_id,
        price: row.price,
        settledAt: row.settled_at,
      }));
    },
    recordResult(result) {
      recordLotResultStmt().run(
        result.day,
        result.lotId,
        result.slotIndex,
        result.goodId,
        result.winnerUserId,
        result.price,
        result.settledAt,
      );
    },
  };
}
