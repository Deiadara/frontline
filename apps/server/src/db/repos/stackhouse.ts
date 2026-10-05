import type { Statement } from 'better-sqlite3';
import type { BattleSide, StackhouseOutcome } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/** One bet on the Stackhouse's book (migration 0145). */
export interface StackhouseBetRow {
  id: string;
  baseId: string;
  battleId: string;
  side: BattleSide;
  stake: number;
  /** The place and the side's name, kept so the receipt reads the same after the fight is gone. */
  place: string;
  backing: string;
  startsAt: string;
  placedAt: string;
  settledAt: string | null;
  outcome: StackhouseOutcome | null;
  payout: number;
}

export interface StackhouseRepo {
  /** Writes a new bet. The table refuses a second unsettled bet for the same crew. */
  place(bet: Omit<StackhouseBetRow, 'settledAt' | 'outcome' | 'payout'>): void;
  /** The crew's one bet still riding, if any. */
  riding(baseId: string): StackhouseBetRow | undefined;
  /** The crew's most recently settled bet. */
  lastSettled(baseId: string): StackhouseBetRow | undefined;
  /** Every bet still riding, for the settle sweep. */
  unsettled(): StackhouseBetRow[];
  /** Closes a bet. Answers whether this call was the one that closed it. */
  settle(id: string, outcome: StackhouseOutcome, payout: number, at: string): boolean;
}

interface Row {
  id: string;
  base_id: string;
  battle_id: string;
  side: BattleSide;
  stake: number;
  place: string;
  backing: string;
  starts_at: string;
  placed_at: string;
  settled_at: string | null;
  outcome: StackhouseOutcome | null;
  payout: number;
}

function rowToBet(row: Row): StackhouseBetRow {
  return {
    id: row.id,
    baseId: row.base_id,
    battleId: row.battle_id,
    side: row.side,
    stake: row.stake,
    place: row.place,
    backing: row.backing,
    startsAt: row.starts_at,
    placedAt: row.placed_at,
    settledAt: row.settled_at,
    outcome: row.outcome,
    payout: row.payout,
  };
}

export function createStackhouseRepo(db: AppDatabase): StackhouseRepo {
  // Compiled on first use, like `regrowth.ts`: the migration tests open a database stopped short of
  // 0145, where an eager prepare would throw `no such table`.
  let placeStmt: Statement | null = null;
  let ridingStmt: Statement | null = null;
  let lastStmt: Statement | null = null;
  let unsettledStmt: Statement | null = null;
  let settleStmt: Statement | null = null;

  return {
    place(bet) {
      placeStmt ??= db.prepare(
        `INSERT INTO stackhouse_bets
           (id, base_id, battle_id, side, stake, place, backing, starts_at, placed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      placeStmt.run(
        bet.id,
        bet.baseId,
        bet.battleId,
        bet.side,
        bet.stake,
        bet.place,
        bet.backing,
        bet.startsAt,
        bet.placedAt,
      );
    },
    riding(baseId) {
      ridingStmt ??= db.prepare(
        'SELECT * FROM stackhouse_bets WHERE base_id = ? AND settled_at IS NULL',
      );
      const row = ridingStmt.get(baseId) as Row | undefined;
      return row ? rowToBet(row) : undefined;
    },
    lastSettled(baseId) {
      lastStmt ??= db.prepare(
        `SELECT * FROM stackhouse_bets WHERE base_id = ? AND settled_at IS NOT NULL
         ORDER BY settled_at DESC LIMIT 1`,
      );
      const row = lastStmt.get(baseId) as Row | undefined;
      return row ? rowToBet(row) : undefined;
    },
    unsettled() {
      unsettledStmt ??= db.prepare('SELECT * FROM stackhouse_bets WHERE settled_at IS NULL');
      return (unsettledStmt.all() as Row[]).map(rowToBet);
    },
    settle(id, outcome, payout, at) {
      settleStmt ??= db.prepare(
        `UPDATE stackhouse_bets SET settled_at = ?, outcome = ?, payout = ?
         WHERE id = ? AND settled_at IS NULL`,
      );
      return settleStmt.run(at, outcome, payout, id).changes === 1;
    },
  };
}
