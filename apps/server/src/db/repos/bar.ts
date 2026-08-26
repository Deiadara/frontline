import type { Negotiation, Standoff } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * The Bar's shared state (GDD §H2, §H2b) and the private half of it (§H7).
 *
 * The roster itself is still never stored. It is computed from the UTC date and the per-seat
 * turnover counts this repo holds, so two players asking on the same day with the same counters are
 * served the same room. What is stored is only what a player has *done* to it: who they hired, and
 * how far into a conversation they have talked themselves.
 */

export interface BarHire {
  id: string;
  day: string;
  userId: string;
  recruitId: string;
  hiredAt: string;
}

export interface BarRepo {
  /**
   * Turnover per seat for `day`, indexed by seat number: `[0, 2, 0, ...]` meaning seat 1 has been
   * hired out of twice. Seats nobody has taken have no row and read as 0, so a fresh day needs no
   * rows written before it can be read.
   */
  generations(day: string, seats: number): number[];
  /** How many people this player has hired today: the §H2b limit reads this. */
  hiresBy(userId: string, day: string): number;
  /**
   * Records a hire and moves the seat on, as one statement pair inside the caller's transaction.
   * The two must not be separable: a hire that did not turn the seat over would leave the same
   * person standing there for the next player to hire again.
   */
  recordHire(hire: BarHire, slot: number): void;
  /** §H7: every conversation this player has open today, keyed by recruit id. */
  negotiations(userId: string, day: string): Record<string, Negotiation>;
  /** One conversation, or `undefined` when they have not spoken to this character yet. */
  negotiation(userId: string, day: string, recruitId: string): Negotiation | undefined;
  /** Writes a conversation's new state. Upserts: the first exchange has no row to update. */
  saveNegotiation(
    userId: string,
    day: string,
    recruitId: string,
    negotiation: Negotiation,
    at: string,
  ): void;
  /**
   * Every recruit this player has walked out on, keyed by recruit id.
   *
   * Not scoped to a day: a standoff outlives the roster it was earned on, which is the only way
   * six hours can mean six hours across the midnight UTC boundary.
   */
  standoffs(userId: string): Record<string, Standoff>;
  standoff(userId: string, recruitId: string): Standoff | undefined;
  /** Records a walkout: pushes the clock out and adds one to the count. */
  saveStandoff(userId: string, recruitId: string, standoff: Standoff): void;
}

interface StandoffRow {
  recruit_id: string;
  until: string;
  walkouts: number;
}

interface GenerationRow {
  slot: number;
  generation: number;
}

interface NegotiationRow {
  recruit_id: string;
  rounds: number;
  patience: number;
  standing: number;
  last_offer: number | null;
  mood: string;
  closed: number;
}

/**
 * A stored row as the domain reads it.
 *
 * `mood` is widened back to the enum by the caller's schema rather than validated here: the repo's
 * job is the shape, and a mood this build does not know about is a parse error worth seeing at the
 * boundary rather than a silent fallback five layers in.
 */
function rowToNegotiation(row: NegotiationRow): Negotiation {
  return {
    rounds: row.rounds,
    patience: row.patience,
    standing: row.standing,
    lastOffer: row.last_offer,
    mood: row.mood as Negotiation['mood'],
    closed: row.closed === 1,
  };
}

export function createBarRepo(db: AppDatabase): BarRepo {
  const generationsStmt = db.prepare('SELECT slot, generation FROM bar_slots WHERE day = ?');
  const hireCountStmt = db.prepare(
    'SELECT count(*) AS n FROM bar_hires WHERE user_id = ? AND day = ?',
  );
  const insertHireStmt = db.prepare(
    'INSERT INTO bar_hires (id, day, user_id, recruit_id, hired_at) VALUES (?, ?, ?, ?, ?)',
  );
  // Upsert, because a seat's first hire has no row to increment yet.
  const bumpSlotStmt = db.prepare(
    `INSERT INTO bar_slots (day, slot, generation) VALUES (?, ?, 1)
     ON CONFLICT (day, slot) DO UPDATE SET generation = generation + 1`,
  );
  const negotiationsStmt = db.prepare(
    `SELECT recruit_id, rounds, patience, standing, last_offer, mood, closed
       FROM bar_negotiations WHERE user_id = ? AND day = ?`,
  );
  const negotiationStmt = db.prepare(
    `SELECT recruit_id, rounds, patience, standing, last_offer, mood, closed
       FROM bar_negotiations WHERE user_id = ? AND day = ? AND recruit_id = ?`,
  );
  const saveNegotiationStmt = db.prepare(
    `INSERT INTO bar_negotiations
       (user_id, day, recruit_id, rounds, patience, standing, last_offer, mood, closed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, day, recruit_id) DO UPDATE SET
       rounds = excluded.rounds,
       patience = excluded.patience,
       standing = excluded.standing,
       last_offer = excluded.last_offer,
       mood = excluded.mood,
       closed = excluded.closed,
       updated_at = excluded.updated_at`,
  );

  const standoffsStmt = db.prepare(
    'SELECT recruit_id, until, walkouts FROM bar_standoffs WHERE user_id = ?',
  );
  const standoffStmt = db.prepare(
    'SELECT recruit_id, until, walkouts FROM bar_standoffs WHERE user_id = ? AND recruit_id = ?',
  );
  const saveStandoffStmt = db.prepare(
    `INSERT INTO bar_standoffs (user_id, recruit_id, until, walkouts) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, recruit_id) DO UPDATE SET
       until = excluded.until,
       walkouts = excluded.walkouts`,
  );

  return {
    generations(day, seats) {
      const rows = generationsStmt.all(day) as GenerationRow[];
      const counts = new Array<number>(seats).fill(0);
      for (const row of rows) {
        if (row.slot >= 0 && row.slot < seats) counts[row.slot] = row.generation;
      }
      return counts;
    },
    hiresBy(userId, day) {
      const row = hireCountStmt.get(userId, day) as { n: number } | undefined;
      return row?.n ?? 0;
    },
    recordHire(hire, slot) {
      insertHireStmt.run(hire.id, hire.day, hire.userId, hire.recruitId, hire.hiredAt);
      bumpSlotStmt.run(hire.day, slot);
    },
    negotiations(userId, day) {
      const rows = negotiationsStmt.all(userId, day) as NegotiationRow[];
      return Object.fromEntries(rows.map((row) => [row.recruit_id, rowToNegotiation(row)]));
    },
    negotiation(userId, day, recruitId) {
      const row = negotiationStmt.get(userId, day, recruitId) as NegotiationRow | undefined;
      return row ? rowToNegotiation(row) : undefined;
    },
    saveNegotiation(userId, day, recruitId, negotiation, at) {
      saveNegotiationStmt.run(
        userId,
        day,
        recruitId,
        negotiation.rounds,
        negotiation.patience,
        negotiation.standing,
        negotiation.lastOffer,
        negotiation.mood,
        negotiation.closed ? 1 : 0,
        at,
      );
    },
    standoffs(userId) {
      const rows = standoffsStmt.all(userId) as StandoffRow[];
      return Object.fromEntries(
        rows.map((row) => [row.recruit_id, { until: row.until, walkouts: row.walkouts }]),
      );
    },
    standoff(userId, recruitId) {
      const row = standoffStmt.get(userId, recruitId) as StandoffRow | undefined;
      return row ? { until: row.until, walkouts: row.walkouts } : undefined;
    },
    saveStandoff(userId, recruitId, standoff) {
      saveStandoffStmt.run(userId, recruitId, standoff.until, standoff.walkouts);
    },
  };
}
