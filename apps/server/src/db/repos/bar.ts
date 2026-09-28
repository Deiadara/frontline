import type { RoomProfile } from '@frontline/shared';
import type { Statement } from 'better-sqlite3';
import type { AppDatabase } from '../index.js';
import { lookbackFloorFromDay } from './lookback.js';

/**
 * The Bar's shared state (GDD §H2, §H7): every bid in the city, and how each table ended.
 *
 * The roster itself is still never stored. It is a pure function of the game day again, now that
 * winning somebody no longer turns their seat over, so two players asking on the same day are
 * served the same room whatever anybody has bid. What is stored is what the players did to it:
 * their positions, and the result the close wrote. And, since 2026-09-28, the one input the day
 * cannot supply: which crews the room was poured for (`bar_rooms`), frozen at the day's first read.
 */

export interface BarHire {
  id: string;
  day: string;
  userId: string;
  recruitId: string;
  hiredAt: string;
}

/** One crew's position at one table: the public bid, the sealed one, or both. */
export interface BarBid {
  day: string;
  recruitId: string;
  userId: string;
  /** The district that signs them if this wins. */
  baseId: string;
  open: number | null;
  openAt: string | null;
  sealed: number | null;
  sealedAt: string | null;
}

/** How one table ended, written once by the close. */
export interface BarResult {
  day: string;
  recruitId: string;
  /** Denormalised: yesterday's sheet cannot be regenerated once the city has levelled. */
  recruitName: string;
  /** Null when nobody in the ranking could take them. */
  winnerUserId: string | null;
  price: number | null;
  settledAt: string;
}

/** A table the close has not written a result for yet. */
export interface UnsettledAuction {
  day: string;
  recruitId: string;
}

export interface BarRepo {
  /** The signing log. Read by nothing: a hire is not a limit any more, it is a record. */
  recordHire(hire: BarHire): void;
  /** Every position at one table, for the leader board and for the close. */
  bidsFor(day: string, recruitId: string): BarBid[];
  /** Every position one crew holds on one day: the cap counts these. */
  bidsBy(userId: string, day: string): BarBid[];
  /** Every position on one day, so a whole screen of tables costs one query. */
  bidsOn(day: string): BarBid[];
  /**
   * Writes an open bid, keeping any sealed value already on the row.
   *
   * An upsert because a crew raising itself out of second place has a row already, and because the
   * first bid at a table has none. The sealed columns are deliberately not in the SET list: the
   * phases do not overlap, but a write that could blank a locked value is a write that eventually
   * will.
   */
  placeOpenBid(bid: {
    day: string;
    recruitId: string;
    userId: string;
    baseId: string;
    amount: number;
    at: string;
  }): void;
  /** Locks a final value. Same upsert shape, and it never touches the open columns. */
  sealBid(bid: {
    day: string;
    recruitId: string;
    userId: string;
    baseId: string;
    amount: number;
    at: string;
  }): void;
  /** Tables with bids on them and no result row, on any day before `beforeDay`. */
  unsettled(beforeDay: string): UnsettledAuction[];
  results(day: string): BarResult[];
  recordResult(result: BarResult): void;
  /** The profile a city's room was frozen at for a day, or `null` before anybody read it. */
  room(day: string, cityId: string): RoomProfile | null;
  /** Freezes a city's room for a day. The first write wins; a second is ignored. */
  freezeRoom(day: string, cityId: string, room: RoomProfile): void;
}

interface RoomRow {
  lowest_level: number;
  lowest_notoriety: number;
  highest_level: number;
  highest_notoriety: number;
  average_level: number;
  average_notoriety: number;
}

interface BidRow {
  day: string;
  recruit_id: string;
  user_id: string;
  base_id: string;
  open_amount: number | null;
  open_at: string | null;
  sealed_amount: number | null;
  sealed_at: string | null;
}

interface ResultRow {
  day: string;
  recruit_id: string;
  recruit_name: string;
  winner_user_id: string | null;
  price: number | null;
  settled_at: string;
}

function rowToBid(row: BidRow): BarBid {
  return {
    day: row.day,
    recruitId: row.recruit_id,
    userId: row.user_id,
    baseId: row.base_id,
    open: row.open_amount,
    openAt: row.open_at,
    sealed: row.sealed_amount,
    sealedAt: row.sealed_at,
  };
}

function rowToResult(row: ResultRow): BarResult {
  return {
    day: row.day,
    recruitId: row.recruit_id,
    recruitName: row.recruit_name,
    winnerUserId: row.winner_user_id,
    price: row.price,
    settledAt: row.settled_at,
  };
}

const BID_COLUMNS =
  'day, recruit_id, user_id, base_id, open_amount, open_at, sealed_amount, sealed_at';

export function createBarRepo(db: AppDatabase): BarRepo {
  const insertHireStmt = db.prepare(
    'INSERT INTO bar_hires (id, day, user_id, recruit_id, hired_at) VALUES (?, ?, ?, ?, ?)',
  );
  const bidsForStmt = db.prepare(
    `SELECT ${BID_COLUMNS} FROM bar_bids WHERE day = ? AND recruit_id = ?`,
  );
  const bidsByStmt = db.prepare(
    `SELECT ${BID_COLUMNS} FROM bar_bids WHERE user_id = ? AND day = ?`,
  );
  const bidsOnStmt = db.prepare(`SELECT ${BID_COLUMNS} FROM bar_bids WHERE day = ?`);
  const placeOpenStmt = db.prepare(
    `INSERT INTO bar_bids (day, recruit_id, user_id, base_id, open_amount, open_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, recruit_id, user_id) DO UPDATE SET
       base_id = excluded.base_id,
       open_amount = excluded.open_amount,
       open_at = excluded.open_at,
       updated_at = excluded.updated_at`,
  );
  const sealStmt = db.prepare(
    `INSERT INTO bar_bids (day, recruit_id, user_id, base_id, sealed_amount, sealed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, recruit_id, user_id) DO UPDATE SET
       base_id = excluded.base_id,
       sealed_amount = excluded.sealed_amount,
       sealed_at = excluded.sealed_at,
       updated_at = excluded.updated_at`,
  );
  // Grouped rather than DISTINCT so the shape of the answer is one row per table, which is what
  // the settler walks. The NOT EXISTS is per table and not per day: a close that fell over halfway
  // through a day leaves the tables it did write settled and the rest still due.
  const unsettledStmt = db.prepare(
    `SELECT b.day AS day, b.recruit_id AS recruit_id
       FROM bar_bids b
      WHERE b.day >= ? AND b.day < ?
        AND NOT EXISTS (
          SELECT 1 FROM bar_auction_results r
           WHERE r.day = b.day AND r.recruit_id = b.recruit_id
        )
      GROUP BY b.day, b.recruit_id
      ORDER BY b.day, b.recruit_id`,
  );
  const resultsStmt = db.prepare(
    `SELECT day, recruit_id, recruit_name, winner_user_id, price, settled_at
       FROM bar_auction_results WHERE day = ?`,
  );
  const recordResultStmt = db.prepare(
    `INSERT INTO bar_auction_results
       (day, recruit_id, recruit_name, winner_user_id, price, settled_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, recruit_id) DO NOTHING`,
  );

  // Prepared on first use: `bar_rooms` arrived with 0126, and the repositories are also built
  // over older schemas by the migration tests.
  const lazy = (sql: string): (() => Statement) => {
    let held: Statement | null = null;
    return () => (held ??= db.prepare(sql));
  };
  const roomStmt = lazy(
    `SELECT lowest_level, lowest_notoriety, highest_level, highest_notoriety,
            average_level, average_notoriety
       FROM bar_rooms WHERE day = ? AND city_id = ?`,
  );
  const freezeRoomStmt = lazy(
    `INSERT INTO bar_rooms
       (day, city_id, lowest_level, lowest_notoriety, highest_level, highest_notoriety,
        average_level, average_notoriety)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, city_id) DO NOTHING`,
  );

  return {
    recordHire(hire) {
      insertHireStmt.run(hire.id, hire.day, hire.userId, hire.recruitId, hire.hiredAt);
    },
    bidsFor(day, recruitId) {
      return (bidsForStmt.all(day, recruitId) as BidRow[]).map(rowToBid);
    },
    bidsBy(userId, day) {
      return (bidsByStmt.all(userId, day) as BidRow[]).map(rowToBid);
    },
    bidsOn(day) {
      return (bidsOnStmt.all(day) as BidRow[]).map(rowToBid);
    },
    placeOpenBid(bid) {
      placeOpenStmt.run(bid.day, bid.recruitId, bid.userId, bid.baseId, bid.amount, bid.at, bid.at);
    },
    sealBid(bid) {
      sealStmt.run(bid.day, bid.recruitId, bid.userId, bid.baseId, bid.amount, bid.at, bid.at);
    },
    unsettled(beforeDay) {
      return (
        unsettledStmt.all(lookbackFloorFromDay(beforeDay), beforeDay) as {
          day: string;
          recruit_id: string;
        }[]
      ).map((row) => ({
        day: row.day,
        recruitId: row.recruit_id,
      }));
    },
    results(day) {
      return (resultsStmt.all(day) as ResultRow[]).map(rowToResult);
    },
    recordResult(result) {
      recordResultStmt.run(
        result.day,
        result.recruitId,
        result.recruitName,
        result.winnerUserId,
        result.price,
        result.settledAt,
      );
    },
    room(day, cityId) {
      const row = roomStmt().get(day, cityId) as RoomRow | undefined;
      if (row === undefined) return null;
      return {
        lowest: { level: row.lowest_level, notoriety: row.lowest_notoriety },
        highest: { level: row.highest_level, notoriety: row.highest_notoriety },
        average: { level: row.average_level, notoriety: row.average_notoriety },
      };
    },
    freezeRoom(day, cityId, room) {
      freezeRoomStmt().run(
        day,
        cityId,
        room.lowest.level,
        room.lowest.notoriety,
        room.highest.level,
        room.highest.notoriety,
        room.average.level,
        room.average.notoriety,
      );
    },
  };
}
