import {
  MissionSchema,
  withoutRetiredUnits,
  type Mission,
  type PartialResources,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

interface MissionRow {
  id: string;
  base_id: string;
  template_id: string;
  area_id: string;
  pay_percent: number;
  xp: number;
  force_json: string;
  vehicles_json: string;
  started_at: string;
  recalled_at: string | null;
  travel_minutes: number;
  duration_minutes: number;
  success_chance: number;
  seed: number;
  status: string;
  officer_id: string | null;
  outcome: string | null;
  rewards_json: string;
  spoils_json: string;
  resolved_at: string | null;
}

/**
 * A mission as persisted: the public record plus the two fields that decide its outcome and must
 * never reach a client. `seed` in particular is the whole reason the timer cannot be gamed: a
 * player who could read it would know how their mission ends before it does.
 */
export interface StoredMission {
  mission: Mission;
  seed: number;
  /** Frozen at launch, so retuning the board cannot re-price a run already in flight. */
  successChance: number;
}

export interface MissionResolution {
  outcome: 'success' | 'failure';
  /** Banked: the payout after the crew's carrying capacity. */
  rewards: PartialResources;
  /** Earned: the payout before it. The report draws the difference. */
  spoils: PartialResources;
  resolvedAt: string;
}

export interface MissionsRepo {
  insert(stored: StoredMission): void;
  /** Every mission this base has ever run, newest launch first. */
  listByBaseId(baseId: string): StoredMission[];
  listActiveByBaseId(baseId: string): StoredMission[];
  countActiveByBaseId(baseId: string): number;
  /**
   * Every district with a crew still out, for the world clock.
   *
   * Deliberately not "every district with a crew that is *due*". Whether a run is home is decided
   * by `isMissionDue`, off the clock frozen on the row, and expressing that rule a second time in
   * SQL would be two definitions of the same thing waiting to disagree after the next retune. This
   * hands back the small set that could possibly be due and lets the one authority decide.
   */
  basesWithActiveRuns(): string[];
  markResolved(missionId: string, resolution: MissionResolution): void;
  /** §E: turn a crew around. The return leg is derived from this instant, not stored. */
  markRecalled(missionId: string, recalledAt: string): void;
  findById(missionId: string): StoredMission | undefined;
}

function rowToStored(row: MissionRow): StoredMission {
  return {
    mission: MissionSchema.parse({
      id: row.id,
      baseId: row.base_id,
      templateId: row.template_id,
      areaId: row.area_id,
      payPercent: row.pay_percent,
      xp: row.xp,
      force: withoutRetiredUnits(readJson(row.force_json)),
      // §C3: whatever carried them, frozen at launch like the force and the clock.
      vehicles: readJson(row.vehicles_json),
      startedAt: row.started_at,
      recalledAt: row.recalled_at,
      travelMinutes: row.travel_minutes,
      durationMinutes: row.duration_minutes,
      status: row.status,
      officerId: row.officer_id,
      outcome: row.outcome,
      rewards: readJson(row.rewards_json),
      spoils: readJson(row.spoils_json),
      resolvedAt: row.resolved_at,
    }),
    seed: row.seed,
    successChance: row.success_chance,
  };
}

export function createMissionsRepo(db: AppDatabase): MissionsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO missions
       (id, base_id, template_id, area_id, pay_percent, xp, force_json, vehicles_json,
        started_at, travel_minutes, duration_minutes, success_chance, seed, status, officer_id,
        outcome, rewards_json, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const markRecalledStmt = db.prepare('UPDATE missions SET recalled_at = ? WHERE id = ?');
  const byIdStmt = db.prepare('SELECT * FROM missions WHERE id = ?');
  const byBaseStmt = db.prepare(
    'SELECT * FROM missions WHERE base_id = ? ORDER BY started_at DESC, id DESC',
  );
  const activeByBaseStmt = db.prepare(
    "SELECT * FROM missions WHERE base_id = ? AND status = 'active' ORDER BY started_at ASC, id ASC",
  );
  const countActiveStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM missions WHERE base_id = ? AND status = 'active'",
  );
  const activeBasesStmt = db.prepare(
    "SELECT DISTINCT base_id FROM missions WHERE status = 'active'",
  );
  const resolveStmt = db.prepare(
    `UPDATE missions
        SET status = 'resolved', outcome = ?, rewards_json = ?, spoils_json = ?, resolved_at = ?
      WHERE id = ?`,
  );

  return {
    insert({ mission, seed, successChance }) {
      insertStmt.run(
        mission.id,
        mission.baseId,
        mission.templateId,
        mission.areaId,
        mission.payPercent,
        mission.xp,
        JSON.stringify(mission.force),
        JSON.stringify(mission.vehicles),
        mission.startedAt,
        mission.travelMinutes,
        mission.durationMinutes,
        successChance,
        seed,
        mission.status,
        mission.officerId,
        mission.outcome,
        JSON.stringify(mission.rewards),
        mission.resolvedAt,
      );
    },
    listByBaseId(baseId) {
      return (byBaseStmt.all(baseId) as MissionRow[]).map(rowToStored);
    },
    listActiveByBaseId(baseId) {
      return (activeByBaseStmt.all(baseId) as MissionRow[]).map(rowToStored);
    },
    basesWithActiveRuns() {
      return (activeBasesStmt.all() as { base_id: string }[]).map((row) => row.base_id);
    },
    countActiveByBaseId(baseId) {
      return (countActiveStmt.get(baseId) as { count: number }).count;
    },
    markRecalled(missionId, recalledAt) {
      markRecalledStmt.run(recalledAt, missionId);
    },
    findById(missionId) {
      const row = byIdStmt.get(missionId) as MissionRow | undefined;
      return row ? rowToStored(row) : undefined;
    },
    markResolved(missionId, { outcome, rewards, spoils, resolvedAt }) {
      resolveStmt.run(
        outcome,
        JSON.stringify(rewards),
        JSON.stringify(spoils),
        resolvedAt,
        missionId,
      );
    },
  };
}
