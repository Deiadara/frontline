import { CapturedGateSchema, type CapturedGate } from '@frontline/shared';
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
}

const rowToGate = (row: GateRow): CapturedGate =>
  CapturedGateSchema.parse({
    districtId: row.district_id,
    level: row.level,
    upgradingTo: row.upgrading_to,
    upgradingUntil: row.upgrading_until,
  });

export function createCapturedGatesRepo(db: AppDatabase): CapturedGatesRepo {
  const findStmt = db.prepare('SELECT * FROM captured_gates WHERE district_id = ?');
  const allStmt = db.prepare('SELECT * FROM captured_gates');
  const dueStmt = db.prepare(
    'SELECT * FROM captured_gates WHERE upgrading_until IS NOT NULL AND upgrading_until <= ?',
  );
  const putStmt = db.prepare(
    `INSERT INTO captured_gates (district_id, level, upgrading_to, upgrading_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (district_id) DO UPDATE SET
       level = excluded.level,
       upgrading_to = excluded.upgrading_to,
       upgrading_until = excluded.upgrading_until`,
  );

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
      putStmt.run(gate.districtId, gate.level, gate.upgradingTo, gate.upgradingUntil);
    },
  };
}
