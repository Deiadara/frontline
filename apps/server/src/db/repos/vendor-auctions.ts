import { visitClosesAt } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * The barrow's shared state (market extension, board 2026-09-08): every bid on every lot, and how
 * each lot ended.
 *
 * What the Runner carries is still never stored. `vendorSessionsFor` and `vendorStockFor` are pure
 * functions of the game day, so two crews asking on the same day are served the same barrow. What
 * is stored is what the players did to it: their bids, and the result the close wrote.
 *
 * Separate from `market.ts` because that repo is the trading board between players, and this is the
 * city bidding against the city. The only thing they share is `vendor_sales`, which stays where the
 * stock counter has always been.
 */

/** One crew's bid on one lot. */
export interface VendorBid {
  day: string;
  session: number;
  lineId: string;
  userId: string;
  /** The district that takes the goods if this wins, and whose caps pay for them. */
  baseId: string;
  amount: number;
  at: string;
}

/** How one lot ended, written once by the close. */
export interface VendorLotResult {
  day: string;
  session: number;
  lineId: string;
  /** Denormalised: the catalogue a barrow was drawn from can move under a results panel. */
  item: string;
  /** Null when nobody in the ranking could pay. */
  winnerUserId: string | null;
  price: number | null;
  settledAt: string;
}

/** A lot the close has not written a result for yet. */
export interface UnsettledLot {
  day: string;
  session: number;
  lineId: string;
}

export interface VendorAuctionsRepo {
  /** Every bid on one lot, for the leader board and for the close. */
  bidsFor(day: string, session: number, lineId: string): VendorBid[];
  /** Every bid one crew has on one visit: the results panel reads these. */
  bidsBy(userId: string, day: string, session: number): VendorBid[];
  /** Every bid on one visit, so a whole barrow of lots costs one query. */
  bidsOn(day: string, session: number): VendorBid[];
  /**
   * Writes a bid, replacing whatever this crew was at.
   *
   * An upsert because a crew raising itself out of second place has a row already, and because the
   * first bid on a lot has none. A bid is a position rather than a history: the close only ever
   * reads the latest number, and keeping the earlier ones would mean the ranking had to know which
   * of a crew's rows counted.
   */
  placeBid(bid: VendorBid): void;
  /** Lots with bids on them, no result row, and a visit that has already closed. */
  unsettled(now: Date): UnsettledLot[];
  results(day: string, session: number): VendorLotResult[];
  recordResult(result: VendorLotResult): void;
}

interface BidRow {
  day: string;
  session: number;
  line_id: string;
  user_id: string;
  base_id: string;
  amount: number;
  at: string;
}

interface ResultRow {
  day: string;
  session: number;
  line_id: string;
  item: string;
  winner_user_id: string | null;
  price: number | null;
  settled_at: string;
}

function rowToBid(row: BidRow): VendorBid {
  return {
    day: row.day,
    session: row.session,
    lineId: row.line_id,
    userId: row.user_id,
    baseId: row.base_id,
    amount: row.amount,
    at: row.at,
  };
}

function rowToResult(row: ResultRow): VendorLotResult {
  return {
    day: row.day,
    session: row.session,
    lineId: row.line_id,
    item: row.item,
    winnerUserId: row.winner_user_id,
    price: row.price,
    settledAt: row.settled_at,
  };
}

const BID_COLUMNS = 'day, session, line_id, user_id, base_id, amount, at';
const RESULT_COLUMNS = 'day, session, line_id, item, winner_user_id, price, settled_at';

/**
 * Whether a visit is over.
 *
 * A session index that names no slot on its day cannot be closed by `visitClosesAt`, which throws
 * on one. Treated as over rather than as an error: a row like that can only come from a day whose
 * sessions have changed shape under it, and leaving it out of every settle would leave it due for
 * ever and its bidders never told anything.
 */
function hasClosed(day: string, session: number, now: Date): boolean {
  try {
    return visitClosesAt(day, session).getTime() <= now.getTime();
  } catch {
    return true;
  }
}

export function createVendorAuctionsRepo(db: AppDatabase): VendorAuctionsRepo {
  const bidsForStmt = db.prepare(
    `SELECT ${BID_COLUMNS} FROM vendor_bids WHERE day = ? AND session = ? AND line_id = ?`,
  );
  const bidsByStmt = db.prepare(
    `SELECT ${BID_COLUMNS} FROM vendor_bids WHERE user_id = ? AND day = ? AND session = ?`,
  );
  const bidsOnStmt = db.prepare(
    `SELECT ${BID_COLUMNS} FROM vendor_bids WHERE day = ? AND session = ?`,
  );
  const placeBidStmt = db.prepare(
    `INSERT INTO vendor_bids (day, session, line_id, user_id, base_id, amount, at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, session, line_id, user_id) DO UPDATE SET
       base_id = excluded.base_id,
       amount = excluded.amount,
       at = excluded.at,
       updated_at = excluded.updated_at`,
  );
  // Grouped rather than DISTINCT so the shape of the answer is one row per lot, which is what the
  // settler walks. The NOT EXISTS is per lot and not per visit: a close that fell over halfway
  // through leaves the lots it did write settled and the rest still due.
  const openLotsStmt = db.prepare(
    `SELECT b.day AS day, b.session AS session, b.line_id AS line_id
       FROM vendor_bids b
      WHERE NOT EXISTS (
              SELECT 1 FROM vendor_lot_results r
               WHERE r.day = b.day AND r.session = b.session AND r.line_id = b.line_id
            )
      GROUP BY b.day, b.session, b.line_id
      ORDER BY b.day, b.session, b.line_id`,
  );
  const resultsStmt = db.prepare(
    `SELECT ${RESULT_COLUMNS} FROM vendor_lot_results WHERE day = ? AND session = ?`,
  );
  const recordResultStmt = db.prepare(
    `INSERT INTO vendor_lot_results (${RESULT_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, session, line_id) DO NOTHING`,
  );

  return {
    bidsFor(day, session, lineId) {
      return (bidsForStmt.all(day, session, lineId) as BidRow[]).map(rowToBid);
    },
    bidsBy(userId, day, session) {
      return (bidsByStmt.all(userId, day, session) as BidRow[]).map(rowToBid);
    },
    bidsOn(day, session) {
      return (bidsOnStmt.all(day, session) as BidRow[]).map(rowToBid);
    },
    placeBid(bid) {
      placeBidStmt.run(
        bid.day,
        bid.session,
        bid.lineId,
        bid.userId,
        bid.baseId,
        bid.amount,
        bid.at,
        bid.at,
      );
    },
    unsettled(now) {
      /*
       * Whether a visit is over is a question about the game clock, and the game clock is a
       * function of the day and the session rather than a column anybody wrote. So the row filter
       * is here rather than in SQL: the query asks the cheap question (which lots have no result),
       * and `visitClosesAt` answers the one only the shared rules can.
       */
      const rows = openLotsStmt.all() as { day: string; session: number; line_id: string }[];
      return rows
        .filter((row) => hasClosed(row.day, row.session, now))
        .map((row) => ({ day: row.day, session: row.session, lineId: row.line_id }));
    },
    results(day, session) {
      return (resultsStmt.all(day, session) as ResultRow[]).map(rowToResult);
    },
    recordResult(result) {
      recordResultStmt.run(
        result.day,
        result.session,
        result.lineId,
        result.item,
        result.winnerUserId,
        result.price,
        result.settledAt,
      );
    },
  };
}
