import {
  withoutRetiredUnits,
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
  /** §D1: the one officer this crew is sending to lead. Null is nobody, which is most rows. */
  officer_id: string | null;
  /** §C3: the machines committed to this fight, out of the Garage. */
  vehicles_json: string;
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
    army: withoutRetiredUnits(readJson(row.army_json)),
    perimeter: withoutRetiredUnits(readJson(row.perimeter_json)),
    boostId: row.boost_id,
    officerId: row.officer_id,
    vehicles: readJson(row.vehicles_json),
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
  /**
   * Everyone standing on one side of a fight, in the order they committed.
   *
   * The declarer plus any ally who reinforced them. `deployment` still answers for one crew, which
   * is what a screen showing "what have *I* sent" wants; this is what the resolver wants.
   */
  side(battleId: string, side: BattleSide): BattleDeployment[];
  /** One crew's own row on a side. `baseId` is null for the Combine and the looters. */
  deployment(
    battleId: string,
    side: BattleSide,
    baseId?: string | null,
  ): BattleDeployment | undefined;
  /** Every deployment this crew has standing, across every fight still to come. */
  deploymentsFor(baseId: string): BattleDeployment[];
  putDeployment(deployment: BattleDeployment): void;
  /**
   * The coming fights this officer is already named on, other than `exceptBattleId`.
   *
   * §D1: one officer, one fight. Nothing stopped the same person being written onto two different
   * deployments, so a crew with one good leader could put them at the head of every battle it had
   * declared and collect their sheet and their perks in all of them at once.
   */
  leadingElsewhere(officerId: string, exceptBattleId: string): string[];

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
  /*
   * One side's rows, oldest first.
   *
   * Plural, because a side is no longer one crew: an ally reinforcing your battle is a second
   * contributor with a row of their own (migration `0045`). The declarer is `base_id = ?` and
   * everybody else is a reinforcement; the resolver sums them and splits the survivors back.
   */
  const sideStmt = db.prepare(
    'SELECT * FROM battle_deployments WHERE battle_id = ? AND side = ? ORDER BY updated_at, base_id',
  );
  const deploymentStmt = db.prepare(
    'SELECT * FROM battle_deployments WHERE battle_id = ? AND side = ? AND base_id IS ?',
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
       (battle_id, base_id, side, army_json, perimeter_json, boost_id, officer_id,
        vehicles_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (battle_id, side, base_id) DO UPDATE SET
       army_json = excluded.army_json,
       perimeter_json = excluded.perimeter_json,
       boost_id = excluded.boost_id,
       officer_id = excluded.officer_id,
       vehicles_json = excluded.vehicles_json,
       updated_at = excluded.updated_at`,
  );

  /*
   * §D1: the coming fights an officer is already named on.
   *
   * Joined to `scheduled_battles` so a leader on a fight that has already run does not block them
   * from the next one: what is being asked is "are they committed", not "have they ever led".
   */
  const leadingElsewhereStmt = db.prepare(
    `SELECT d.battle_id AS battle_id
       FROM battle_deployments d
       JOIN scheduled_battles b ON b.id = d.battle_id
      WHERE d.officer_id = ? AND d.battle_id != ? AND b.resolved_at IS NULL`,
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
        /*
         * Skipped rather than thrown on, and this is why the whole board once went dark.
         *
         * `GET /battles` answered 500 for one account for months because a single stored report
         * carried a field an older build had written under a different name. One unreadable row
         * took down the entire screen, and the screen drew every non-data state as "Reading the
         * board...", so it looked like a slow network for ever.
         *
         * A report is history. It cannot be repaired from here and nothing else on the board
         * depends on it, so the honest answer is to leave it out and serve the rest.
         */
        const parsed = BattleAnalysisSchema.safeParse(readJson(row.analysis_json));
        if (!parsed.success) {
          console.warn(
            `battle ${row.id}: stored report is not readable by this build, skipping`,
            parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
          );
          return [];
        }
        return [{ battle: rowToBattle(row), analysis: parsed.data }];
      });
    },
    markResolved(id, at, analysis) {
      resolveStmt.run(at, JSON.stringify(analysis), id);
    },

    deployments(battleId) {
      return (deploymentsStmt.all(battleId) as DeploymentRow[]).map(rowToDeployment);
    },
    deployment(battleId, side, baseId = null) {
      const row = deploymentStmt.get(battleId, side, baseId) as DeploymentRow | undefined;
      return row ? rowToDeployment(row) : undefined;
    },
    side(battleId, side) {
      return (sideStmt.all(battleId, side) as DeploymentRow[]).map(rowToDeployment);
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
        deployment.officerId,
        JSON.stringify(deployment.vehicles),
        deployment.updatedAt,
      );
    },

    leadingElsewhere(officerId, exceptBattleId) {
      return (leadingElsewhereStmt.all(officerId, exceptBattleId) as { battle_id: string }[]).map(
        (row) => row.battle_id,
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
