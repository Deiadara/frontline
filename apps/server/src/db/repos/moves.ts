import {
  UnitMoveSchema,
  type Army,
  type Fleet,
  type MovePlace,
  type UnitMove,
} from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/** Columns walking between a crew's own places (maintainer, 2026-09-22). See `moves/moves.ts`. */
export interface MovesRepo {
  insert(move: UnitMove): void;
  due(nowIso: string): UnitMove[];
  activeFor(baseId: string): UnitMove[];
  find(id: string): UnitMove | undefined;
  markSettled(id: string, atIso: string): void;
  markRecalled(id: string, atIso: string, returnsAtIso: string): void;
}

/** Units one crew has posted on a faction ally's ground, per location. */
export interface AlliedGarrisonsRepo {
  at(locationId: string): { baseId: string; army: Army }[];
  forBase(baseId: string): { locationId: string; army: Army }[];
  get(locationId: string, baseId: string): Army;
  /** Writes the row, or deletes it when the army is empty. */
  set(locationId: string, baseId: string, army: Army): void;
  clearAt(locationId: string): void;
}

interface Row {
  id: string;
  base_id: string;
  from_json: string;
  to_json: string;
  army_json: string;
  vehicles_json: string;
  departed_at: string;
  returns_at: string;
  travel_minutes: number;
  settled_at: string | null;
  recalled_at: string | null;
}

const toMove = (row: Row): UnitMove =>
  UnitMoveSchema.parse({
    id: row.id,
    baseId: row.base_id,
    from: JSON.parse(row.from_json) as MovePlace,
    to: JSON.parse(row.to_json) as MovePlace,
    army: JSON.parse(row.army_json) as Army,
    vehicles: JSON.parse(row.vehicles_json) as Fleet,
    departedAt: row.departed_at,
    arrivesAt: row.returns_at,
    travelMinutes: row.travel_minutes,
    recalledAt: row.recalled_at,
  });

/** Prepared on first use: the tables arrive in 0110, and some tests migrate only part way. */
function lazily(db: AppDatabase) {
  return (sql: string) => {
    let stmt: ReturnType<AppDatabase['prepare']> | undefined;
    return () => (stmt ??= db.prepare(sql));
  };
}

export function createMovesRepo(db: AppDatabase): MovesRepo {
  const lazy = lazily(db);
  const insertStmt = lazy(
    `INSERT INTO unit_moves
       (id, base_id, from_json, to_json, army_json, vehicles_json, departed_at, returns_at,
        travel_minutes, recalled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const dueStmt = lazy(
    'SELECT * FROM unit_moves WHERE settled_at IS NULL AND returns_at <= ? ORDER BY returns_at',
  );
  const activeStmt = lazy(
    'SELECT * FROM unit_moves WHERE base_id = ? AND settled_at IS NULL ORDER BY returns_at',
  );
  const findStmt = lazy('SELECT * FROM unit_moves WHERE id = ?');
  const settleStmt = lazy('UPDATE unit_moves SET settled_at = ? WHERE id = ?');
  const recallStmt = lazy('UPDATE unit_moves SET recalled_at = ?, returns_at = ? WHERE id = ?');
  return {
    insert(move) {
      insertStmt().run(
        move.id,
        move.baseId,
        JSON.stringify(move.from),
        JSON.stringify(move.to),
        JSON.stringify(move.army),
        JSON.stringify(move.vehicles),
        move.departedAt,
        move.arrivesAt,
        move.travelMinutes,
        // Written at the insert, not only by `markRecalled`: the machines driving themselves
        // home are put on the road already turned round (`moves/moves.ts`), which is what shuts
        // their recall window from the first tick.
        move.recalledAt,
      );
    },
    due(nowIso) {
      return (dueStmt().all(nowIso) as Row[]).map(toMove);
    },
    activeFor(baseId) {
      return (activeStmt().all(baseId) as Row[]).map(toMove);
    },
    find(id) {
      const row = findStmt().get(id) as Row | undefined;
      return row ? toMove(row) : undefined;
    },
    markSettled(id, atIso) {
      settleStmt().run(atIso, id);
    },
    markRecalled(id, atIso, returnsAtIso) {
      recallStmt().run(atIso, returnsAtIso, id);
    },
  };
}

interface PostedRow {
  location_id: string;
  base_id: string;
  army_json: string;
}

export function createAlliedGarrisonsRepo(db: AppDatabase): AlliedGarrisonsRepo {
  const lazy = lazily(db);
  const atStmt = lazy('SELECT * FROM allied_garrisons WHERE location_id = ? ORDER BY base_id');
  const forBaseStmt = lazy('SELECT * FROM allied_garrisons WHERE base_id = ? ORDER BY location_id');
  const getStmt = lazy('SELECT * FROM allied_garrisons WHERE location_id = ? AND base_id = ?');
  const putStmt = lazy(
    `INSERT INTO allied_garrisons (location_id, base_id, army_json) VALUES (?, ?, ?)
     ON CONFLICT(location_id, base_id) DO UPDATE SET army_json = excluded.army_json`,
  );
  const deleteStmt = lazy('DELETE FROM allied_garrisons WHERE location_id = ? AND base_id = ?');
  const clearStmt = lazy('DELETE FROM allied_garrisons WHERE location_id = ?');
  const army = (row: PostedRow): Army => JSON.parse(row.army_json) as Army;
  return {
    at(locationId) {
      return (atStmt().all(locationId) as PostedRow[]).map((row) => ({
        baseId: row.base_id,
        army: army(row),
      }));
    },
    forBase(baseId) {
      return (forBaseStmt().all(baseId) as PostedRow[]).map((row) => ({
        locationId: row.location_id,
        army: army(row),
      }));
    },
    get(locationId, baseId) {
      const row = getStmt().get(locationId, baseId) as PostedRow | undefined;
      return row ? army(row) : {};
    },
    set(locationId, baseId, next) {
      const standing = Object.values(next).some((count) => count > 0);
      if (standing) putStmt().run(locationId, baseId, JSON.stringify(next));
      else deleteStmt().run(locationId, baseId);
    },
    clearAt(locationId) {
      clearStmt().run(locationId);
    },
  };
}
