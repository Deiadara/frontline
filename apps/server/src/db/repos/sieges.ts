import {
  withoutRetiredUnits,
  withoutRetiredVehicles,
  BattleAnalysisSchema,
  BattleDeploymentSchema,
  BattleSideSchema,
  BattleTargetSchema,
  LocationHolderSchema,
  ScheduledBattleSchema,
  type BattleAnalysis,
  type BattleDeployment,
  type BattleSide,
  type BattleTarget,
  type DistrictGate,
  type ScheduledBattle,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { Statement } from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

/**
 * Declared battles and everything that hangs off one (GDD §A4, battle rework).
 *
 * Separate from `BattlesRepo`, which writes the after-the-fact `battles` log the instant raid paths
 * still produce. This one owns the *coming* fight: the declaration, the forces moved up for it, the
 * trap set under it and the gate it may break.
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
  defender_json: string;
  scheduled_for: string;
  declared_at: string;
  resolved_at: string | null;
  seed: string;
  hold_after_capture: number;
  woke_sleepers: number;
  analysis_json: string | null;
}

interface DeploymentRow {
  battle_id: string;
  base_id: string | null;
  side: BattleSide;
  army_json: string;
  perimeter_json: string;
  boost_ids_json: string;
  /** §D1: the one officer this crew is sending to lead. Null is nobody, which is most rows. */
  officer_id: string | null;
  /** §I4: the one trap this crew has set under this fight. Defenders only. */
  trap_id: string | null;
  /** §C3: the machines committed to this fight, out of the Garage. */
  vehicles_json: string;
  updated_at: string;
}

/**
 * The stored columns, back as a target.
 *
 * There is no legacy branch for the retired `building` kind and there does not need to be:
 * migration `0087` rewrites every stored row, resolved history included, into the `district` target
 * of the same district. A resolved row is read back by `resolvedFor` and parsed with the same
 * schema as a pending one, so leaving old rows alone and reading them leniently here would have
 * meant carrying a fourth kind through `ScheduledBattleSchema` for ever to serve a battle board.
 */
function targetOf(row: BattleRow): BattleTarget {
  switch (row.target_kind) {
    case 'location':
      return { kind: 'location', districtId: row.district_id, locationId: row.location_id ?? '' };
    case 'gate':
      return { kind: 'gate', districtId: row.district_id };
    case 'district':
      return { kind: 'district', districtId: row.district_id };
  }
}

/** The rows this build can read, each one it cannot named in the log and left out. */
function readableBattles(rows: readonly BattleRow[]): ScheduledBattle[] {
  return rows.flatMap((row) => {
    try {
      return [rowToBattle(row)];
    } catch (error) {
      console.warn(`battle ${row.id}: stored fight is not readable by this build, skipping`, error);
      return [];
    }
  });
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
    wokeSleepers: row.woke_sleepers === 1,
  });
}

function rowToDeployment(row: DeploymentRow): BattleDeployment {
  return BattleDeploymentSchema.parse({
    battleId: row.battle_id,
    baseId: row.base_id,
    side: row.side,
    army: withoutRetiredUnits(readJson(row.army_json)),
    perimeter: withoutRetiredUnits(readJson(row.perimeter_json)),
    boostIds: readJson(row.boost_ids_json),
    officerId: row.officer_id,
    trapId: row.trap_id,
    // Same repair the army and the perimeter get above, and it matters more here: this row is read
    // by the global settler, so a retired vehicle id does not brick one save, it throws inside
    // `settleBattles` and takes the world tick down for everybody.
    vehicles: withoutRetiredVehicles(readJson(row.vehicles_json)),
    updatedAt: row.updated_at,
  });
}

export interface ResolvedBattle {
  battle: ScheduledBattle;
  analysis: BattleAnalysis;
}

/** A fight still to run that this build cannot read, and where it was, when that much reads. */
export interface UnreadableFight {
  id: string;
  /** Null when the stored target is itself a kind this build does not have. */
  target: BattleTarget | null;
  error: unknown;
}

/** A deployment row on a fight still to run that this build cannot read. */
export interface UnreadableDeployment {
  battleId: string;
  side: string;
  baseId: string | null;
  error: unknown;
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
  /**
   * The fights still to run, marked at or before `markBy`, that the twenty-slot rule has not
   * judged yet (`battle/understrength.ts`). The world settle passes the tick plus the lock's hour.
   */
  awaitingStrengthCheck(markBy: string): ScheduledBattle[];
  /** Records that the twenty-slot rule has judged this fight, so nothing after the lock can. */
  markStrengthJudged(id: string): void;
  /**
   * Every fight still to run that this build cannot read, and every deployment row on a fight
   * still to run that it cannot read (`battle/unreadable.ts`). The other reads skip the first and
   * throw on the second; this is the one that names them so they can be dropped.
   */
  unreadable(): { fights: UnreadableFight[]; deployments: UnreadableDeployment[] };
  /** Deletes one deployment row as stored, whatever is in it. `baseId` null is the NPC's row. */
  dropDeployment(battleId: string, side: string, baseId: string | null): void;
  /** Finished fights this crew was in, most recent first. */
  resolvedFor(baseId: string, limit: number): ResolvedBattle[];
  /** Marks it run and files the ledger, in one statement. */
  markResolved(id: string, at: string, analysis: BattleAnalysis): void;
  /**
   * Closes a fight that can never run, with no ledger behind it.
   *
   * A battle whose target district or whose attacker the world no longer has is unresolvable, and
   * before this there was nothing to do with one: `resolveOne` answered `null`, the sweep skipped
   * it, and the row stayed in `due()` for ever. It was retried on every tick, it went on holding
   * one of the crew's three declaration slots, and any column already folded into its deployment
   * was never sent home. Stamping `resolved_at` is what takes it out of all three queues; the
   * analysis stays null on purpose, because nothing happened and a synthetic report of a fight
   * that never took place would be a lie in the crew's own history.
   */
  abandon(id: string, at: string): void;
  /**
   * How a fight came out, for the Stackhouse's book: still coming (`resolvedAt` null), won by a
   * side, or closed with no winner (abandoned, or a report this build cannot read). Undefined when
   * there is no such fight.
   */
  outcomeOf(id: string): { resolvedAt: string | null; winner: BattleSide | null } | undefined;
  /**
   * The targets of the fights this crew called and lost, marked after `since` (the losing caller's
   * cooldown, `battle/declare.ts`). One indexed read of the crew's own calls, reading only the
   * winner off each report; it used to parse the crew's last fifty reports in full on every call
   * and miss a loss with fifty other fights after it (bug pass, 2026-10-06).
   */
  lostCallsSince(baseId: string, since: string): BattleTarget[];

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
   * Takes one crew's row off a side. For a crew that is on neither side, or the other side, of a
   * fight when its mark comes (`battle/alignment.ts`): an empty row left behind would still count
   * as a second contributor, which is what pays the allied perks.
   */
  removeDeployment(battleId: string, side: BattleSide, baseId: string): void;
  /** The most this crew has had at this fight, as counted toward the deployed feats (0140). */
  deployedPeak(battleId: string, baseId: string): { units: number; unitSlots: number };
  setDeployedPeak(
    battleId: string,
    baseId: string,
    peak: { units: number; unitSlots: number },
  ): void;
  /**
   * The coming fights this officer is already named on, other than `exceptBattleId`.
   *
   * §D1: one officer, one fight. Nothing stopped the same person being written onto two different
   * deployments, so a crew with one good leader could put them at the head of every battle it had
   * declared and collect their sheet and their perks in all of them at once.
   */
  /**
   * The unresolved fights this crew has `officerId` named on, other than `exceptBattleId`. Keyed on
   * the crew as well as the officer (bug pass, 2026-10-06): officer ids are unique within a crew,
   * not across crews, and the console seats the same ids on every crew it builds, so one crew's
   * fight held another crew's officer.
   */
  leadingElsewhere(officerId: string, exceptBattleId: string, baseId: string): string[];

  gate(districtId: string): DistrictGate | undefined;
  breakGate(districtId: string, until: string): void;
}

export function createSiegeRepo(db: AppDatabase): SiegeRepo {
  /*
   * The insert alone is prepared on first use rather than at construction.
   *
   * better-sqlite3 validates SQL when a statement is prepared, so every repo built by
   * `createRepositories` has to be valid against whatever schema the database is on. That is
   * not always the newest one: `stockpile-integrity.test.ts` deliberately builds the
   * repositories at migration 0093 to measure what 0094 does to a save. This statement names
   * `woke_sleepers`, which arrives in 0103, so eagerly prepared it turned that test into "table
   * scheduled_battles has no column named woke_sleepers" and said nothing about refits.
   *
   * Only this one, because only this one names a column younger than that test's schema. If a
   * third repo needs the same treatment, the invariant is worth replacing with a lazy `prepare`
   * for all of them rather than a fourth copy of this comment.
   */
  let insert: ReturnType<AppDatabase['prepare']> | undefined;
  const insertStmt = () =>
    (insert ??= db.prepare(
      `INSERT INTO scheduled_battles
       (id, attacker_base_id, target_kind, district_id, location_id,
        defender_json, scheduled_for, declared_at, resolved_at, seed, hold_after_capture,
        woke_sleepers, analysis_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
    ));
  const findStmt = db.prepare('SELECT * FROM scheduled_battles WHERE id = ?');
  const dueStmt = db.prepare(
    'SELECT * FROM scheduled_battles WHERE resolved_at IS NULL AND scheduled_for <= ? ORDER BY scheduled_for',
  );
  const pendingStmt = db.prepare(
    'SELECT * FROM scheduled_battles WHERE resolved_at IS NULL ORDER BY scheduled_for',
  );
  // Prepared on first use: the column arrives in 0147, and some tests migrate only part way.
  let awaitingStrengthStmt: Statement | undefined;
  let markStrengthStmt: Statement | undefined;
  const pendingDeploymentsStmt = db.prepare(
    `SELECT d.* FROM battle_deployments d
       JOIN scheduled_battles b ON b.id = d.battle_id
      WHERE b.resolved_at IS NULL`,
  );
  const dropDeploymentStmt = db.prepare(
    'DELETE FROM battle_deployments WHERE battle_id = ? AND side = ? AND base_id IS ?',
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
  const lostCallsStmt = db.prepare(
    `SELECT * FROM scheduled_battles
     WHERE attacker_base_id = ? AND resolved_at IS NOT NULL AND analysis_json IS NOT NULL
       AND scheduled_for > ?`,
  );
  const abandonStmt = db.prepare(
    'UPDATE scheduled_battles SET resolved_at = ?, analysis_json = NULL WHERE id = ?',
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
  /*
   * The Combine's and the looters' rows carry `base_id = NULL`, and SQLite's `ON CONFLICT` never
   * fires between two NULLs: measured, two inserts with a NULL base id under the same primary key
   * produce two rows. So the NPC row is cleared by hand before the upsert below writes it, or a
   * second write to it would double the muster the engine reads.
   */
  const clearNpcDeploymentStmt = db.prepare(
    `DELETE FROM battle_deployments WHERE battle_id = ? AND side = ? AND base_id IS NULL`,
  );
  const removeDeploymentStmt = db.prepare(
    'DELETE FROM battle_deployments WHERE battle_id = ? AND side = ? AND base_id = ?',
  );
  const putDeploymentStmt = db.prepare(
    `INSERT INTO battle_deployments
       (battle_id, base_id, side, army_json, perimeter_json, boost_ids_json, officer_id, trap_id,
        vehicles_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (battle_id, side, base_id) DO UPDATE SET
       army_json = excluded.army_json,
       perimeter_json = excluded.perimeter_json,
       boost_ids_json = excluded.boost_ids_json,
       officer_id = excluded.officer_id,
       trap_id = excluded.trap_id,
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
      WHERE d.officer_id = ? AND d.battle_id != ? AND d.base_id = ? AND b.resolved_at IS NULL`,
  );

  // Prepared on first use: the table arrives in 0140, and some tests migrate only part way.
  let peakStmt: Statement | undefined;
  let putPeakStmt: Statement | undefined;

  const gateStmt = db.prepare('SELECT * FROM district_gates WHERE district_id = ?');
  const breakGateStmt = db.prepare(
    `INSERT INTO district_gates (district_id, broken_until) VALUES (?, ?)
     ON CONFLICT (district_id) DO UPDATE SET broken_until = excluded.broken_until`,
  );

  return {
    insert(battle) {
      const target = battle.target;
      insertStmt().run(
        battle.id,
        battle.attackerBaseId,
        target.kind,
        target.districtId,
        target.kind === 'location' ? target.locationId : null,
        JSON.stringify(battle.defender),
        battle.scheduledFor,
        battle.declaredAt,
        battle.seed,
        battle.holdAfterCapture ? 1 : 0,
        battle.wokeSleepers ? 1 : 0,
      );
    },
    lostCallsSince(baseId, since) {
      return (lostCallsStmt.all(baseId, since) as BattleRow[]).flatMap((row) => {
        const winner = (readJson(row.analysis_json ?? 'null') as { winner?: unknown } | null)
          ?.winner;
        return winner === 'defender' ? [targetOf(row)] : [];
      });
    },
    outcomeOf(id) {
      const row = findStmt.get(id) as BattleRow | undefined;
      if (!row) return undefined;
      if (row.resolved_at === null) return { resolvedAt: null, winner: null };
      const parsed =
        row.analysis_json === null
          ? null
          : BattleSideSchema.safeParse(
              (readJson(row.analysis_json) as { winner?: unknown } | null)?.winner,
            );
      return { resolvedAt: row.resolved_at, winner: parsed?.success ? parsed.data : null };
    },
    find(id) {
      const row = findStmt.get(id) as BattleRow | undefined;
      return row ? rowToBattle(row) : undefined;
    },
    // Both skip a row this build cannot read, as `resolvedFor` does (bug pass, 2026-10-06): one
    // pending fight with a retired defender or target threw out of the whole read, which stopped
    // every fight in the world resolving and answered 500 on the battle board for everybody.
    due(now) {
      return readableBattles(dueStmt.all(now) as BattleRow[]);
    },
    pending() {
      return readableBattles(pendingStmt.all() as BattleRow[]);
    },
    pendingCountFor(baseId) {
      return (pendingCountStmt.get(baseId) as { n: number }).n;
    },
    awaitingStrengthCheck(markBy) {
      awaitingStrengthStmt ??= db.prepare(
        `SELECT * FROM scheduled_battles
          WHERE resolved_at IS NULL AND strength_judged = 0 AND scheduled_for <= ?
          ORDER BY scheduled_for`,
      );
      return readableBattles(awaitingStrengthStmt.all(markBy) as BattleRow[]);
    },
    markStrengthJudged(id) {
      markStrengthStmt ??= db.prepare(
        'UPDATE scheduled_battles SET strength_judged = 1 WHERE id = ?',
      );
      markStrengthStmt.run(id);
    },
    unreadable() {
      const fights = (pendingStmt.all() as BattleRow[]).flatMap((row) => {
        try {
          rowToBattle(row);
          return [];
        } catch (error) {
          const target = BattleTargetSchema.safeParse(targetOf(row));
          return [{ id: row.id, target: target.success ? target.data : null, error }];
        }
      });
      const deployments = (pendingDeploymentsStmt.all() as DeploymentRow[]).flatMap((row) => {
        try {
          rowToDeployment(row);
          return [];
        } catch (error) {
          return [{ battleId: row.battle_id, side: row.side, baseId: row.base_id, error }];
        }
      });
      return { fights, deployments };
    },
    dropDeployment(battleId, side, baseId) {
      dropDeploymentStmt.run(battleId, side, baseId);
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
        // ...and the fight's own row, for the same reason (bug pass, 2026-09-29). Only the report
        // was guarded, so a defender or a target this build no longer reads still threw, and the
        // crew profile answered 500 for everybody who opened it.
        try {
          return [{ battle: rowToBattle(row), analysis: parsed.data }];
        } catch (error) {
          console.warn(
            `battle ${row.id}: stored fight is not readable by this build, skipping`,
            error,
          );
          return [];
        }
      });
    },
    markResolved(id, at, analysis) {
      resolveStmt.run(at, JSON.stringify(analysis), id);
    },
    abandon(id, at) {
      abandonStmt.run(at, id);
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
      if (deployment.baseId === null) {
        clearNpcDeploymentStmt.run(deployment.battleId, deployment.side);
      }
      putDeploymentStmt.run(
        deployment.battleId,
        deployment.baseId,
        deployment.side,
        JSON.stringify(deployment.army),
        JSON.stringify(deployment.perimeter),
        JSON.stringify(deployment.boostIds),
        deployment.officerId,
        deployment.trapId,
        JSON.stringify(deployment.vehicles),
        deployment.updatedAt,
      );
    },

    removeDeployment(battleId, side, baseId) {
      removeDeploymentStmt.run(battleId, side, baseId);
    },

    deployedPeak(battleId, baseId) {
      peakStmt ??= db.prepare(
        'SELECT units, unit_slots FROM deployed_peaks WHERE battle_id = ? AND base_id = ?',
      );
      const row = peakStmt.get(battleId, baseId) as
        { units: number; unit_slots: number } | undefined;
      return { units: row?.units ?? 0, unitSlots: row?.unit_slots ?? 0 };
    },

    setDeployedPeak(battleId, baseId, peak) {
      putPeakStmt ??= db.prepare(
        `INSERT INTO deployed_peaks (battle_id, base_id, units, unit_slots) VALUES (?, ?, ?, ?)
         ON CONFLICT (battle_id, base_id) DO UPDATE SET units = excluded.units,
           unit_slots = excluded.unit_slots`,
      );
      putPeakStmt.run(battleId, baseId, peak.units, peak.unitSlots);
    },

    leadingElsewhere(officerId, exceptBattleId, baseId) {
      return (
        leadingElsewhereStmt.all(officerId, exceptBattleId, baseId) as { battle_id: string }[]
      ).map((row) => row.battle_id);
    },

    gate(districtId) {
      const row = gateStmt.get(districtId) as
        { district_id: string; broken_until: string | null } | undefined;
      return row ? { districtId: row.district_id, brokenUntil: row.broken_until } : undefined;
    },
    breakGate(districtId, until) {
      breakGateStmt.run(districtId, until);
    },
  };
}
