import type { AppDatabase } from '../index.js';

/**
 * The Bar's shared state (GDD §H2, §H2b).
 *
 * Two counters and nothing else. The roster itself is still never stored — it is computed from the
 * UTC date and the per-seat turnover counts this repo holds, so two players asking on the same day
 * with the same counters are served the same room.
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
   * Turnover per seat for `day`, indexed by seat number — `[0, 2, 0, ...]` meaning seat 1 has been
   * hired out of twice. Seats nobody has taken have no row and read as 0, so a fresh day needs no
   * rows written before it can be read.
   */
  generations(day: string, seats: number): number[];
  /** How many people this player has hired today — the §H2b limit reads this. */
  hiresBy(userId: string, day: string): number;
  /**
   * Records a hire and moves the seat on, as one statement pair inside the caller's transaction.
   * The two must not be separable: a hire that did not turn the seat over would leave the same
   * person standing there for the next player to hire again.
   */
  recordHire(hire: BarHire, slot: number): void;
}

interface GenerationRow {
  slot: number;
  generation: number;
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
  };
}
