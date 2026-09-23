import { AutomationSchema, type Automation } from '@frontline/shared';
import type { Statement } from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

/**
 * The Right Hand's standing orders (`automations/automations.ts`).
 *
 * One row per slot per base, keyed `(base_id, slot)`, so turning a slot on twice writes the same
 * row rather than growing a second one. Every write is an upsert on that pair for the same
 * reason: the screen sends a whole slot, not a patch, and a slot the player has never touched has
 * no row until they do.
 */
export interface AutomationsRepo {
  forBase(baseId: string): Automation[];
  /** Every slot that is switched on, for the world clock. */
  enabled(): Automation[];
  get(baseId: string, slot: number): Automation | undefined;
  put(automation: Automation): void;
  remove(baseId: string, slot: number): void;
}

interface Row {
  id: string;
  base_id: string;
  slot: number;
  kind: string;
  enabled: number;
  order_kind: string;
  step: number;
  force_json: string;
  officer_id: string | null;
  unit_slots: number | null;
  optimise_for: string | null;
  mission_id: string | null;
  resting_since: string | null;
  stalled: string | null;
}

function toAutomation(row: Row): Automation {
  return AutomationSchema.parse({
    id: row.id,
    baseId: row.base_id,
    slot: row.slot,
    kind: row.kind,
    // SQLite has no boolean; anything but 0 is on.
    enabled: row.enabled !== 0,
    order: row.order_kind,
    step: row.step,
    force: JSON.parse(row.force_json) as Record<string, number>,
    officerId: row.officer_id,
    unitSlots: row.unit_slots,
    optimiseFor: row.optimise_for,
    missionId: row.mission_id,
    restingSince: row.resting_since,
    stalled: row.stalled,
  });
}

export function createAutomationsRepo(db: AppDatabase): AutomationsRepo {
  /*
   * Compiled on first use, not at construction.
   *
   * `db.prepare` compiles immediately, and the migration tests build a repo against a database
   * deliberately stopped part-way up the chain to see what an old save does. Every statement here
   * names a table that did not exist until 0113, so an eager prepare throws `no such table`
   * before those tests can assert anything at all.
   */
  const lazily = (sql: string): (() => Statement) => {
    let held: Statement | null = null;
    return () => (held ??= db.prepare(sql));
  };

  const forBaseStmt = lazily('SELECT * FROM automations WHERE base_id = ? ORDER BY slot');
  const enabledStmt = lazily('SELECT * FROM automations WHERE enabled = 1');
  const getStmt = lazily('SELECT * FROM automations WHERE base_id = ? AND slot = ?');
  const removeStmt = lazily('DELETE FROM automations WHERE base_id = ? AND slot = ?');
  const putStmt = lazily(
    `INSERT INTO automations
       (id, base_id, slot, kind, enabled, order_kind, step, force_json, officer_id, unit_slots,
        optimise_for, mission_id, resting_since, stalled)
     VALUES (@id, @baseId, @slot, @kind, @enabled, @order, @step, @force, @officerId, @unitSlots,
             @optimiseFor, @missionId, @restingSince, @stalled)
     ON CONFLICT (base_id, slot) DO UPDATE SET
       kind = excluded.kind,
       enabled = excluded.enabled,
       order_kind = excluded.order_kind,
       step = excluded.step,
       force_json = excluded.force_json,
       officer_id = excluded.officer_id,
       unit_slots = excluded.unit_slots,
       optimise_for = excluded.optimise_for,
       mission_id = excluded.mission_id,
       resting_since = excluded.resting_since,
       stalled = excluded.stalled`,
  );

  return {
    forBase(baseId) {
      return (forBaseStmt().all(baseId) as Row[]).map(toAutomation);
    },
    enabled() {
      return (enabledStmt().all() as Row[]).map(toAutomation);
    },
    get(baseId, slot) {
      const row = getStmt().get(baseId, slot) as Row | undefined;
      return row ? toAutomation(row) : undefined;
    },
    put(automation) {
      putStmt().run({
        id: automation.id,
        baseId: automation.baseId,
        slot: automation.slot,
        kind: automation.kind,
        enabled: automation.enabled ? 1 : 0,
        order: automation.order,
        step: automation.step,
        force: JSON.stringify(automation.force),
        officerId: automation.officerId,
        unitSlots: automation.unitSlots,
        optimiseFor: automation.optimiseFor,
        missionId: automation.missionId,
        restingSince: automation.restingSince,
        stalled: automation.stalled,
      });
    },
    remove(baseId, slot) {
      removeStmt().run(baseId, slot);
    },
  };
}
