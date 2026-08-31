import { ScoutingRunSchema, type ScoutingRun } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * Scouting runs: who is out, where, and when they are back.
 *
 * A settled run is kept rather than deleted. It is the record that this crew has had eyes on that
 * ground, and the city's own `markScouted` is derived from it: two places holding one fact is how
 * a fog of war ends up disagreeing with the journey that lifted it.
 */
export interface ScoutingRepo {
  insert(run: ScoutingRun): void;
  /** Every run whose mark has passed and which has not been settled. For the world clock. */
  due(nowIso: string): ScoutingRun[];
  /** What this crew has out right now. At most one, but returned as a list so the cap is a rule. */
  activeFor(baseId: string): ScoutingRun[];
  markSettled(id: string, atIso: string): void;
}

interface Row {
  id: string;
  base_id: string;
  district_id: string;
  officer_id: string;
  departed_at: string;
  returns_at: string;
  settled_at: string | null;
}

const toRun = (row: Row): ScoutingRun =>
  ScoutingRunSchema.parse({
    id: row.id,
    baseId: row.base_id,
    districtId: row.district_id,
    officerId: row.officer_id,
    departedAt: row.departed_at,
    returnsAt: row.returns_at,
  });

export function createScoutingRepo(db: AppDatabase): ScoutingRepo {
  const insertStmt = db.prepare(
    `INSERT INTO scouting_runs (id, base_id, district_id, officer_id, departed_at, returns_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const dueStmt = db.prepare(
    'SELECT * FROM scouting_runs WHERE settled_at IS NULL AND returns_at <= ? ORDER BY returns_at',
  );
  const activeStmt = db.prepare(
    'SELECT * FROM scouting_runs WHERE base_id = ? AND settled_at IS NULL ORDER BY returns_at',
  );
  const settleStmt = db.prepare('UPDATE scouting_runs SET settled_at = ? WHERE id = ?');

  return {
    insert(run) {
      insertStmt.run(
        run.id,
        run.baseId,
        run.districtId,
        run.officerId,
        run.departedAt,
        run.returnsAt,
      );
    },
    due(nowIso) {
      return (dueStmt.all(nowIso) as Row[]).map(toRun);
    },
    activeFor(baseId) {
      return (activeStmt.all(baseId) as Row[]).map(toRun);
    },
    markSettled(id, atIso) {
      settleStmt.run(atIso, id);
    },
  };
}
