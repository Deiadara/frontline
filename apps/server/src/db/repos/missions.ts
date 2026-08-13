import { MissionSchema, type Mission, type PartialResources } from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

interface MissionRow {
  id: string;
  base_id: string;
  template_id: string;
  started_at: string;
  travel_minutes: number;
  duration_minutes: number;
  success_chance: number;
  seed: number;
  status: string;
  outcome: string | null;
  rewards_json: string;
  resolved_at: string | null;
}

/**
 * A mission as persisted: the public record plus the two fields that decide its outcome and must
 * never reach a client. `seed` in particular is the whole reason the timer cannot be gamed — a
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
  rewards: PartialResources;
  resolvedAt: string;
}

export interface MissionsRepo {
  insert(stored: StoredMission): void;
  /** Every mission this base has ever run, newest launch first. */
  listByBaseId(baseId: string): StoredMission[];
  listActiveByBaseId(baseId: string): StoredMission[];
  countActiveByBaseId(baseId: string): number;
  markResolved(missionId: string, resolution: MissionResolution): void;
}

function rowToStored(row: MissionRow): StoredMission {
  return {
    mission: MissionSchema.parse({
      id: row.id,
      baseId: row.base_id,
      templateId: row.template_id,
      startedAt: row.started_at,
      travelMinutes: row.travel_minutes,
      durationMinutes: row.duration_minutes,
      status: row.status,
      outcome: row.outcome,
      rewards: readJson(row.rewards_json),
      resolvedAt: row.resolved_at,
    }),
    seed: row.seed,
    successChance: row.success_chance,
  };
}

export function createMissionsRepo(db: AppDatabase): MissionsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO missions
       (id, base_id, template_id, started_at, travel_minutes, duration_minutes,
        success_chance, seed, status, outcome, rewards_json, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byBaseStmt = db.prepare(
    'SELECT * FROM missions WHERE base_id = ? ORDER BY started_at DESC, id DESC',
  );
  const activeByBaseStmt = db.prepare(
    "SELECT * FROM missions WHERE base_id = ? AND status = 'active' ORDER BY started_at ASC, id ASC",
  );
  const countActiveStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM missions WHERE base_id = ? AND status = 'active'",
  );
  const resolveStmt = db.prepare(
    `UPDATE missions
        SET status = 'resolved', outcome = ?, rewards_json = ?, resolved_at = ?
      WHERE id = ?`,
  );

  return {
    insert({ mission, seed, successChance }) {
      insertStmt.run(
        mission.id,
        mission.baseId,
        mission.templateId,
        mission.startedAt,
        mission.travelMinutes,
        mission.durationMinutes,
        successChance,
        seed,
        mission.status,
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
    countActiveByBaseId(baseId) {
      return (countActiveStmt.get(baseId) as { count: number }).count;
    },
    markResolved(missionId, { outcome, rewards, resolvedAt }) {
      resolveStmt.run(outcome, JSON.stringify(rewards), resolvedAt, missionId);
    },
  };
}
