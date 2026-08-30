import { withoutRetiredUnits, MovementSchema, type Movement } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * Columns on the road (§A4).
 *
 * Rows live only while a column is walking: it is created when units leave the district and
 * deleted when they arrive, are turned around, or the fight they were walking to resolves without
 * them. Nothing here is history; the report is the record of what happened.
 */

interface MovementRow {
  id: string;
  base_id: string;
  battle_id: string;
  side: Movement['side'];
  from_district_id: string;
  to_district_id: string;
  army_json: string;
  perimeter_json: string;
  departed_at: string;
  arrives_at: string;
}

function readJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function rowToMovement(row: MovementRow): Movement {
  return MovementSchema.parse({
    id: row.id,
    baseId: row.base_id,
    battleId: row.battle_id,
    side: row.side,
    fromDistrictId: row.from_district_id,
    toDistrictId: row.to_district_id,
    army: withoutRetiredUnits(readJson(row.army_json)),
    perimeter: withoutRetiredUnits(readJson(row.perimeter_json)),
    departedAt: row.departed_at,
    arrivesAt: row.arrives_at,
  });
}

export interface MovementRepo {
  /** Everything this crew currently has walking, soonest to arrive first. */
  forBase(baseId: string): Movement[];
  find(id: string): Movement | undefined;
  /** Every column that has landed by `now`, in arrival order. The settler's whole query. */
  arrivedBy(now: string): Movement[];
  /** Whatever is still walking to this fight, whoever sent it. */
  forBattle(battleId: string): Movement[];
  put(movement: Movement): void;
  remove(id: string): void;
}

export function createMovementRepo(db: AppDatabase): MovementRepo {
  const forBaseStmt = db.prepare(
    'SELECT * FROM troop_movements WHERE base_id = ? ORDER BY arrives_at',
  );
  const findStmt = db.prepare('SELECT * FROM troop_movements WHERE id = ?');
  const arrivedStmt = db.prepare(
    'SELECT * FROM troop_movements WHERE arrives_at <= ? ORDER BY arrives_at',
  );
  const forBattleStmt = db.prepare(
    'SELECT * FROM troop_movements WHERE battle_id = ? ORDER BY arrives_at',
  );
  const putStmt = db.prepare(
    `INSERT INTO troop_movements
       (id, base_id, battle_id, side, from_district_id, to_district_id,
        army_json, perimeter_json, departed_at, arrives_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       army_json = excluded.army_json,
       perimeter_json = excluded.perimeter_json,
       arrives_at = excluded.arrives_at`,
  );
  const removeStmt = db.prepare('DELETE FROM troop_movements WHERE id = ?');

  return {
    forBase(baseId) {
      return (forBaseStmt.all(baseId) as MovementRow[]).map(rowToMovement);
    },
    find(id) {
      const row = findStmt.get(id) as MovementRow | undefined;
      return row ? rowToMovement(row) : undefined;
    },
    arrivedBy(now) {
      return (arrivedStmt.all(now) as MovementRow[]).map(rowToMovement);
    },
    forBattle(battleId) {
      return (forBattleStmt.all(battleId) as MovementRow[]).map(rowToMovement);
    },
    put(movement) {
      putStmt.run(
        movement.id,
        movement.baseId,
        movement.battleId,
        movement.side,
        movement.fromDistrictId,
        movement.toDistrictId,
        JSON.stringify(movement.army),
        JSON.stringify(movement.perimeter),
        movement.departedAt,
        movement.arrivesAt,
      );
    },
    remove(id) {
      removeStmt.run(id);
    },
  };
}
