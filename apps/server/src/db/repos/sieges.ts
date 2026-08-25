import {
  ArmedTrapSchema,
  BattleAnalysisSchema,
  BattleDeploymentSchema,
  LocationHolderSchema,
  ScheduledBattleSchema,
  type ArmedTrap,
  type BattleAnalysis,
  type BattleDeployment,
  type BattleSide,
  type BattleTarget,
  type DistrictGate,
  type ScheduledBattle,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

/**
 * Declared battles and everything that hangs off one (GDD §A4, battle rework).
 *
 * Separate from `BattlesRepo`, which writes the after-the-fact `battles` log the instant raid paths
 * still produce. This one owns the *coming* fight: the declaration, the forces moved up for it, the
 * gate it may break and the trap that may go off under it.
 *
 * Everything here is read on the settle path, so every query is either keyed or bounded. The one
 * unkeyed read, {@link SiegeRepo.due}, is the settler's, and it is indexed on exactly the two
 * columns it filters.
 */

interface BattleRow {
  id: string;
  attacker_base_id: string;
  target_kind: BattleTarget['kind'];
  district_id: string;
  location_id: string | null;
  building_id: string | null;
  defender_json: string;
  scheduled_for: string;
  declared_at: string;
  resolved_at: string | null;
  seed: string;
  hold_after_capture: number;
  analysis_json: string | null;
}

interface DeploymentRow {
  battle_id: string;
  base_id: string | null;
  side: BattleSide;
  army_json: string;
  perimeter_json: string;
  boost_id: string | null;
  updated_at: string;
}

function targetOf(row: BattleRow): BattleTarget {
  switch (row.target_kind) {
    case 'location':
      return { kind: 'location', districtId: row.district_id, locationId: row.location_id ?? '' };
    case 'gate':
      return { kind: 'gate', districtId: row.district_id };
    case 'building':
      return { kind: 'building', districtId: row.district_id, buildingId: row.building_id ?? '' };
  }
}

function rowToBattle(row: BattleRow): ScheduledBattle {
  return ScheduledBattleSchema.parse({
    id: row.id,
    target: targetOf(row),
    attackerBaseId: row.attacker_base_id,
    defender: LocationHolderSchema.parse(readJson(row.defender_json)),
    scheduledFor: row.scheduled_for,
    declaredAt: row.declared_at,
    resolvedAt: row.resolved_at,
    seed: row.seed,
    // sqlite has no boolean: the column is 0/1 and the schema wants a boolean, so the coercion
    // happens here rather than being left for every reader to remember.
    holdAfterCapture: row.hold_after_capture === 1,
  });
}

function rowToDeployment(row: DeploymentRow): BattleDeployment {
  return BattleDeploymentSchema.parse({
    battleId: row.battle_id,
    baseId: row.base_id,
    side: row.side,
    army: readJson(row.army_json),
    perimeter: readJson(row.perimeter_json),
    boostId: row.boost_id,
    updatedAt: row.updated_at,
  });
}

export interface ResolvedBattle {
  battle: ScheduledBattle;
  analysis: BattleAnalysis;
}

export interface SiegeRepo {
  insert(battle: ScheduledBattle): void;
  find(id: string): ScheduledBattle | undefined;
  /** Everything past its mark that has not been run. The settler's whole query. */
  due(now: string): ScheduledBattle[];
  /** Every fight still coming, soonest first. */
  pending(): ScheduledBattle[];
  /** How many unresolved calls this crew already has out: the cap on declaring. */
  pendingCountFor(baseId: string): number;
  /** Finished fights this crew was in, most recent first. */
  resolvedFor(baseId: string, limit: number): ResolvedBattle[];
  /** Marks it run and files the ledger, in one statement. */
  markResolved(id: string, at: string, analysis: BattleAnalysis): void;

  deployments(battleId: string): BattleDeployment[];
  deployment(battleId: string, side: BattleSide): BattleDeployment | undefined;
  /** Every deployment this crew has standing, across every fight still to come. */
  deploymentsFor(baseId: string): BattleDeployment[];
  putDeployment(deployment: BattleDeployment): void;

  gate(districtId: string): DistrictGate | undefined;
  breakGate(districtId: string, until: string): void;

  trap(locationId: string): ArmedTrap | undefined;
  setTrap(locationId: string, trap: ArmedTrap | null): void;
}

export function createSiegeRepo(db: AppDatabase): SiegeRepo {
  const insertStmt = db.prepare(
    `INSERT INTO scheduled_battles
       (id, attacker_base_id, target_kind, district_id, location_id, building_id,
        defender_json, scheduled_for, declared_at, resolved_at, seed, hold_after_capture,
        analysis_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
  );
  const findStmt = db.prepare('SELECT * FROM scheduled_battles WHERE id = ?');
  const dueStmt = db.prepare(
    'SELECT * FROM scheduled_battles WHERE resolved_at IS NULL AND scheduled_for <= ? ORDER BY scheduled_for',
  );
  const pendingStmt = db.prepare(
    'SELECT * FROM scheduled_battles WHERE resolved_at IS NULL ORDER BY scheduled_for',
  );
  const pendingCountStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM scheduled_battles WHERE resolved_at IS NULL AND attacker_base_id = ?',
  );
  // A crew's history is every fight it declared plus every fight it was deployed into: the
  // deployment table is the only record that a defender was ever involved.
  const resolvedStmt = db.prepare(
    `SELECT DISTINCT b.* FROM scheduled_battles b
       LEFT JOIN battle_deployments d ON d.battle_id = b.id
     WHERE b.resolved_at IS NOT NULL AND (b.attacker_base_id = ? OR d.base_id = ?)
     ORDER BY b.resolved_at DESC
     LIMIT ?`,
  );
  const resolveStmt = db.prepare(
    'UPDATE scheduled_battles SET resolved_at = ?, analysis_json = ? WHERE id = ?',
  );

  const deploymentsStmt = db.prepare('SELECT * FROM battle_deployments WHERE battle_id = ?');
  const deploymentStmt = db.prepare(
    'SELECT * FROM battle_deployments WHERE battle_id = ? AND side = ?',
  );
  /*
   * Joined against the battle rather than read flat, because a deployment row outlives its fight:
   * nothing deletes one when the battle resolves, so the flat query answers "every muster this crew
   * has ever sent" while every caller wants the ones still standing. The join is the difference
   * between counting an army twice and counting it once.
   */
  const deploymentsForStmt = db.prepare(
    `SELECT d.* FROM battle_deployments d
       JOIN scheduled_battles b ON b.id = d.battle_id
      WHERE d.base_id = ? AND b.resolved_at IS NULL`,
  );
  const putDeploymentStmt = db.prepare(
    `INSERT INTO battle_deployments
       (battle_id, base_id, side, army_json, perimeter_json, boost_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (battle_id, side) DO UPDATE SET
       base_id = excluded.base_id,
       army_json = excluded.army_json,
       perimeter_json = excluded.perimeter_json,
       boost_id = excluded.boost_id,
       updated_at = excluded.updated_at`,
  );

  const gateStmt = db.prepare('SELECT * FROM district_gates WHERE district_id = ?');
  const breakGateStmt = db.prepare(
    `INSERT INTO district_gates (district_id, broken_until) VALUES (?, ?)
     ON CONFLICT (district_id) DO UPDATE SET broken_until = excluded.broken_until`,
  );

  const trapStmt = db.prepare('SELECT trap_json FROM location_control WHERE location_id = ?');
  const setTrapStmt = db.prepare('UPDATE location_control SET trap_json = ? WHERE location_id = ?');

  return {
    insert(battle) {
      const target = battle.target;
      insertStmt.run(
        battle.id,
        battle.attackerBaseId,
        target.kind,
        target.districtId,
        target.kind === 'location' ? target.locationId : null,
        target.kind === 'building' ? target.buildingId : null,
        JSON.stringify(battle.defender),
        battle.scheduledFor,
        battle.declaredAt,
        battle.seed,
        battle.holdAfterCapture ? 1 : 0,
      );
    },
    find(id) {
      const row = findStmt.get(id) as BattleRow | undefined;
      return row ? rowToBattle(row) : undefined;
    },
    due(now) {
      return (dueStmt.all(now) as BattleRow[]).map(rowToBattle);
    },
    pending() {
      return (pendingStmt.all() as BattleRow[]).map(rowToBattle);
    },
    pendingCountFor(baseId) {
      return (pendingCountStmt.get(baseId) as { n: number }).n;
    },
    resolvedFor(baseId, limit) {
      return (resolvedStmt.all(baseId, baseId, limit) as BattleRow[]).flatMap((row) => {
        if (row.analysis_json === null) return [];
        return [
          {
            battle: rowToBattle(row),
            analysis: BattleAnalysisSchema.parse(readJson(row.analysis_json)),
          },
        ];
      });
    },
    markResolved(id, at, analysis) {
      resolveStmt.run(at, JSON.stringify(analysis), id);
    },

    deployments(battleId) {
      return (deploymentsStmt.all(battleId) as DeploymentRow[]).map(rowToDeployment);
    },
    deployment(battleId, side) {
      const row = deploymentStmt.get(battleId, side) as DeploymentRow | undefined;
      return row ? rowToDeployment(row) : undefined;
    },
    deploymentsFor(baseId) {
      return (deploymentsForStmt.all(baseId) as DeploymentRow[]).map(rowToDeployment);
    },
    putDeployment(deployment) {
      putDeploymentStmt.run(
        deployment.battleId,
        deployment.baseId,
        deployment.side,
        JSON.stringify(deployment.army),
        JSON.stringify(deployment.perimeter),
        deployment.boostId,
        deployment.updatedAt,
      );
    },

    gate(districtId) {
      const row = gateStmt.get(districtId) as
        { district_id: string; broken_until: string | null } | undefined;
      return row ? { districtId: row.district_id, brokenUntil: row.broken_until } : undefined;
    },
    breakGate(districtId, until) {
      breakGateStmt.run(districtId, until);
    },

    trap(locationId) {
      const row = trapStmt.get(locationId) as { trap_json: string | null } | undefined;
      if (!row || row.trap_json === null) return undefined;
      return ArmedTrapSchema.parse(readJson(row.trap_json));
    },
    setTrap(locationId, trap) {
      setTrapStmt.run(trap === null ? null : JSON.stringify(trap), locationId);
    },
  };
}
