import type { Statement } from 'better-sqlite3';
import { CapturedGateSchema, type CapturedGate } from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

/**
 * §B7: the gates on districts crews have taken whole.
 *
 * One row per district that has ever had one, which is far fewer than one per crew per district:
 * the gate belongs to the ground (see `city/gates.ts`), so a district that has changed hands four
 * times still has exactly one row and one level.
 */
export interface CapturedGatesRepo {
  find(districtId: string): CapturedGate | undefined;
  all(): CapturedGate[];
  /** Work that has landed by `at`. Read every tick, so it is indexed. */
  due(at: string): CapturedGate[];
  put(gate: CapturedGate): void;
}

interface GateRow {
  district_id: string;
  level: number;
  upgrading_to: number | null;
  upgrading_until: string | null;
  upgrading_since: string | null;
  /** Migration 0146. Absent on a database stopped short of it, which reads as nothing stored. */
  upgrade_paid_json?: string | null;
}

const rowToGate = (row: GateRow): CapturedGate =>
  CapturedGateSchema.parse({
    districtId: row.district_id,
    level: row.level,
    upgradingTo: row.upgrading_to,
    upgradingUntil: row.upgrading_until,
    upgradingSince: row.upgrading_since,
    // Omitted rather than null when nothing is stored, so a gate read back equals the one written.
    ...(row.upgrade_paid_json == null ? {} : { upgradePaid: readJson(row.upgrade_paid_json) }),
  });

export function createCapturedGatesRepo(db: AppDatabase): CapturedGatesRepo {
  const findStmt = db.prepare('SELECT * FROM captured_gates WHERE district_id = ?');
  const allStmt = db.prepare('SELECT * FROM captured_gates');
  const dueStmt = db.prepare(
    'SELECT * FROM captured_gates WHERE upgrading_until IS NOT NULL AND upgrading_until <= ?',
  );
  // Compiled on first use: it names a column migration 0146 added, and the migration tests open a
  // database stopped short of it.
  let putStmt: Statement | null = null;
  const putSql = `INSERT INTO captured_gates
       (district_id, level, upgrading_to, upgrading_until, upgrading_since, upgrade_paid_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (district_id) DO UPDATE SET
       level = excluded.level,
       upgrading_to = excluded.upgrading_to,
       upgrading_until = excluded.upgrading_until,
       upgrading_since = excluded.upgrading_since,
       upgrade_paid_json = excluded.upgrade_paid_json`;

  return {
    find(districtId) {
      const row = findStmt.get(districtId) as GateRow | undefined;
      return row ? rowToGate(row) : undefined;
    },
    all() {
      return (allStmt.all() as GateRow[]).map(rowToGate);
    },
    due(at) {
      return (dueStmt.all(at) as GateRow[]).map(rowToGate);
    },
    put(gate) {
      putStmt ??= db.prepare(putSql);
      putStmt.run(
        gate.districtId,
        gate.level,
        gate.upgradingTo,
        gate.upgradingUntil,
        gate.upgradingSince,
        // Only while work is in progress: a landed or cleared raise has nothing to refund.
        gate.upgradingTo === null || gate.upgradePaid == null
          ? null
          : JSON.stringify(gate.upgradePaid),
      );
    },
  };
}
