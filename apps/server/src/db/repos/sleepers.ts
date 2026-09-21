import { SleeperCellSchema, type Army, type SleeperCell } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * Sleeper cells: who is planted where, and who is still on the road to it.
 *
 * See `sleepers.ts` in shared for what a cell is. The shape worth knowing here is that a crew has
 * **one row per location**, merged on arrival: a crew that plants twice on the same ground has
 * one cell of the two forces added together, not two rows every reader would have to sum.
 *
 * Merging happens when the second lot *arrives*, not when it is sent, because until then they are
 * two columns on two different marks.
 */
export interface SleeperRepo {
  insert(cell: SleeperCell): void;
  /** Everything whose mark has passed: outbound cells to land, returning ones to bring home. */
  due(nowIso: string): SleeperCell[];
  /** Everything this crew has out, in any phase. The Monitor's list. */
  forBase(baseId: string): SleeperCell[];
  /** The cell this crew has waiting on this ground, if any. What `assemble` asks. */
  waitingAt(baseId: string, locationId: string): SleeperCell | undefined;
  findById(id: string): SleeperCell | undefined;
  /** Landed: the phase becomes `waiting` and `arrivesAt` becomes the moment they went to ground. */
  markWaiting(id: string, atIso: string): void;
  /** Turned round. The walk home is the new mark. */
  markReturning(id: string, departedIso: string, homeIso: string): void;
  /** What a cell is holding, after a withdrawal or after the fight took some of them. */
  setArmy(id: string, army: Army): void;
  remove(id: string): void;
}

interface Row {
  id: string;
  base_id: string;
  location_id: string;
  army_json: string;
  phase: string;
  departed_at: string;
  arrives_at: string;
  travel_ms: number;
}

const read = (row: Row): SleeperCell =>
  SleeperCellSchema.parse({
    id: row.id,
    baseId: row.base_id,
    locationId: row.location_id,
    army: JSON.parse(row.army_json) as Army,
    phase: row.phase,
    departedAt: row.departed_at,
    arrivesAt: row.arrives_at,
    travelMs: row.travel_ms,
  });

export function createSleeperRepo(db: AppDatabase): SleeperRepo {
  /*
   * Prepared on first use, not at construction, which is a deviation worth the sentence.
   *
   * better-sqlite3 validates the SQL when a statement is prepared, so a repo that prepares in its
   * constructor requires its tables to exist the moment `createRepositories` is called. That is
   * true of every other repo here and it is *not* true of this one: `stockpile-integrity.test.ts`
   * deliberately builds the repositories against a database migrated only as far as 0093, to
   * measure what 0094 does to a save, and `sleeper_cells` arrives in 0102. Eagerly prepared, this
   * repo turned that test into `no such table: sleeper_cells`, which says nothing about refits.
   */
  const lazy = (sql: string) => {
    let stmt: ReturnType<AppDatabase['prepare']> | undefined;
    return () => (stmt ??= db.prepare(sql));
  };

  const insertStmt = lazy(
    `INSERT INTO sleeper_cells
       (id, base_id, location_id, army_json, phase, departed_at, arrives_at, travel_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Only the two phases that have a mark in front of them. A `waiting` cell has no clock on it,
  // which is the whole point of one, so it must never come back from here however old it is.
  const dueStmt = lazy(
    `SELECT * FROM sleeper_cells
     WHERE phase IN ('outbound', 'returning') AND arrives_at <= ?
     ORDER BY arrives_at`,
  );
  const forBaseStmt = lazy('SELECT * FROM sleeper_cells WHERE base_id = ? ORDER BY arrives_at');
  const waitingStmt = lazy(
    "SELECT * FROM sleeper_cells WHERE base_id = ? AND location_id = ? AND phase = 'waiting'",
  );
  const byIdStmt = lazy('SELECT * FROM sleeper_cells WHERE id = ?');
  const waitStmt = lazy("UPDATE sleeper_cells SET phase = 'waiting', arrives_at = ? WHERE id = ?");
  const returnStmt = lazy(
    "UPDATE sleeper_cells SET phase = 'returning', departed_at = ?, arrives_at = ? WHERE id = ?",
  );
  const armyStmt = lazy('UPDATE sleeper_cells SET army_json = ? WHERE id = ?');
  const removeStmt = lazy('DELETE FROM sleeper_cells WHERE id = ?');

  return {
    insert(cell) {
      insertStmt().run(
        cell.id,
        cell.baseId,
        cell.locationId,
        JSON.stringify(cell.army),
        cell.phase,
        cell.departedAt,
        cell.arrivesAt,
        cell.travelMs,
      );
    },
    due(nowIso) {
      return (dueStmt().all(nowIso) as Row[]).map(read);
    },
    forBase(baseId) {
      return (forBaseStmt().all(baseId) as Row[]).map(read);
    },
    waitingAt(baseId, locationId) {
      const row = waitingStmt().get(baseId, locationId) as Row | undefined;
      return row ? read(row) : undefined;
    },
    findById(id) {
      const row = byIdStmt().get(id) as Row | undefined;
      return row ? read(row) : undefined;
    },
    markWaiting(id, atIso) {
      waitStmt().run(atIso, id);
    },
    markReturning(id, departedIso, homeIso) {
      returnStmt().run(departedIso, homeIso, id);
    },
    setArmy(id, army) {
      armyStmt().run(JSON.stringify(army), id);
    },
    remove(id) {
      removeStmt().run(id);
    },
  };
}
