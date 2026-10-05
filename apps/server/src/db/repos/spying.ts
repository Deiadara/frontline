import {
  SpyReportSchema,
  SpyRunSchema,
  unitSlotsUsed,
  withoutRetiredUnits,
  type Army,
  type SpyReport,
  type SpyReportHolder,
  type SpyRun,
  type SpyTarget,
} from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/**
 * Spy jobs on the clock, and the reports they come home with (maintainer, 2026-09-22).
 *
 * The run half is a row per job with a target and a price. The report half is kept for ever: a
 * report is what a crew knows about a place, and `latestFor` is how the district sheet and the
 * battle board read that knowledge back.
 */
/** What `putSnapshot` keeps. `watcher` is undefined on a read stored before it was kept. */
export interface SpySnapshot {
  report: SpyReport;
  watcher: string | null | undefined;
}

export interface SpyingRepo {
  insert(run: SpyRun): void;
  /** Every run whose mark has passed and which has not been settled. For the world clock. */
  due(nowIso: string): SpyRun[];
  /** What this crew has out right now, soonest home first. `spyPartiesAllowed` is the cap. */
  activeFor(baseId: string): SpyRun[];
  markSettled(id: string, atIso: string): void;
  /** Turned round: the walk home is the new mark, and no report is written on it. */
  markRecalled(id: string, atIso: string, returnsAtIso: string): void;

  insertReport(report: SpyReport): void;
  /** Runs out, not turned round, whose runners have not yet read the ground (`snapshotSpying`). */
  unread(): SpyRun[];
  /** The report the runners took at the target, kept until they are home (P3-B, 0138). */
  /**
   * The read taken when the runners reached the target, and the crew who could have seen them
   * there: the holder told they were found out is the one whose ground it was then.
   */
  putSnapshot(id: string, snapshot: SpySnapshot): void;
  snapshotOf(id: string): SpySnapshot | undefined;
  /** Every report this crew has written, most recent first. */
  reportsFor(baseId: string, limit: number): SpyReport[];
  /** The last report this crew wrote on one place, or undefined. Failed reports count: they are news too. */
  latestFor(baseId: string, target: SpyTarget): SpyReport | undefined;
  /** Whether a report with this id has been written: the courier's once-a-day guard. */
  hasReport(id: string): boolean;
  /** Every crew that has finished this rung. For the courier, which is one rung's whole reward. */
  basesHolding(researchId: string): string[];
  /**
   * The crew's runs and reports, gone: the Console's Clean slate (bug pass, 2026-09-29). A run
   * still out wrote its report into the fresh crew, and the old ones stayed readable, so a
   * level-1 crew knew what the old life had learned.
   */
  forget(baseId: string): void;
}

interface RunRow {
  id: string;
  base_id: string;
  target_json: string;
  tier: string;
  caps_paid: number;
  departed_at: string;
  returns_at: string;
  travel_minutes: number;
  settled_at: string | null;
  recalled_at: string | null;
  chair_points: number | null;
  intel_percent: number | null;
  /** Absent on a database stopped short of 0138. */
  snapshot_json?: string | null;
}

interface ReportRow {
  id: string;
  base_id: string;
  target_json: string;
  district_id: string;
  district_name: string;
  place_name: string;
  holder_json: string;
  tier: string | null;
  caps_paid: number;
  written_at: string;
  failed: number;
  exposed_json: string;
  accuracy: number | null;
  unseen: number | null;
  accuracy_shown: number;
  exposed_slots: number | null;
  units_shown: number;
  total_slots: number | null;
  found_out: number;
  /** Absent on a database stopped short of 0138. */
  held_from_away?: number;
}

const toRun = (row: RunRow): SpyRun =>
  SpyRunSchema.parse({
    id: row.id,
    baseId: row.base_id,
    target: JSON.parse(row.target_json) as SpyTarget,
    tier: row.tier,
    capsPaid: row.caps_paid,
    departedAt: row.departed_at,
    returnsAt: row.returns_at,
    travelMinutes: row.travel_minutes,
    recalledAt: row.recalled_at,
    chairPoints: row.chair_points,
    intelPercent: row.intel_percent,
  });

const toReport = (row: ReportRow): SpyReport => {
  // A unit retired since the report was written is dropped rather than thrown on (bug pass,
  // 2026-09-29): reports are kept for ever, and one that no longer parsed took the owner's battle
  // board and every district sheet down with it.
  const exposed = withoutRetiredUnits(JSON.parse(row.exposed_json)) as Army;
  return SpyReportSchema.parse({
    id: row.id,
    baseId: row.base_id,
    target: JSON.parse(row.target_json) as SpyTarget,
    districtId: row.district_id,
    districtName: row.district_name,
    placeName: row.place_name,
    holder: JSON.parse(row.holder_json) as SpyReportHolder,
    tier: row.tier,
    capsPaid: row.caps_paid,
    writtenAt: row.written_at,
    failed: row.failed === 1,
    exposed,
    // Null only on a report written before 0131, which named its units: they are the count.
    exposedSlots: row.exposed_slots ?? unitSlotsUsed(exposed),
    unitsShown: row.units_shown === 1,
    totalSlots: row.total_slots,
    foundOut: row.found_out === 1,
    accuracy: row.accuracy,
    unseen: row.unseen,
    accuracyShown: row.accuracy_shown === 1,
    heldFromAway: row.held_from_away === 1,
  });
};

/** One string per target, so "the same place" is a column match and not a JSON comparison. */
const targetKey = (target: SpyTarget): string => JSON.stringify(target);

export function createSpyingRepo(db: AppDatabase): SpyingRepo {
  /*
   * Prepared on first use, for the reason the sleeper repo gives: `stockpile-integrity.test.ts`
   * builds the repositories against a database migrated only part way, and these tables arrive
   * in 0109.
   */
  const lazy = (sql: string) => {
    let stmt: ReturnType<AppDatabase['prepare']> | undefined;
    return () => (stmt ??= db.prepare(sql));
  };

  const insertStmt = lazy(
    `INSERT INTO spy_runs
       (id, base_id, target_json, tier, caps_paid, departed_at, returns_at, travel_minutes,
        chair_points, intel_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const dueStmt = lazy(
    'SELECT * FROM spy_runs WHERE settled_at IS NULL AND returns_at <= ? ORDER BY returns_at',
  );
  const activeStmt = lazy(
    'SELECT * FROM spy_runs WHERE base_id = ? AND settled_at IS NULL ORDER BY returns_at',
  );
  const settleStmt = lazy('UPDATE spy_runs SET settled_at = ? WHERE id = ?');
  const recallStmt = lazy('UPDATE spy_runs SET recalled_at = ?, returns_at = ? WHERE id = ?');
  const unreadStmt = lazy(
    `SELECT * FROM spy_runs
      WHERE settled_at IS NULL AND recalled_at IS NULL AND snapshot_json IS NULL
      ORDER BY departed_at`,
  );
  const putSnapshotStmt = lazy('UPDATE spy_runs SET snapshot_json = ? WHERE id = ?');
  const snapshotStmt = lazy('SELECT snapshot_json FROM spy_runs WHERE id = ?');

  const insertReportStmt = lazy(
    `INSERT INTO spy_reports
       (id, base_id, target_json, district_id, district_name, place_name, holder_json, tier,
        caps_paid, written_at, failed, exposed_json, accuracy, unseen, accuracy_shown,
        exposed_slots, units_shown, total_slots, found_out, held_from_away)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const hasReportStmt = lazy('SELECT 1 FROM spy_reports WHERE id = ?');
  const holdingStmt = lazy(
    `SELECT id FROM bases WHERE EXISTS (
       SELECT 1 FROM json_each(bases.research_json, '$.technologies') WHERE value = ?
     ) ORDER BY id`,
  );
  const forgetRunsStmt = lazy('DELETE FROM spy_runs WHERE base_id = ?');
  const forgetReportsStmt = lazy('DELETE FROM spy_reports WHERE base_id = ?');
  const reportsStmt = lazy(
    'SELECT * FROM spy_reports WHERE base_id = ? ORDER BY written_at DESC, id DESC LIMIT ?',
  );
  const latestStmt = lazy(
    `SELECT * FROM spy_reports WHERE base_id = ? AND target_json = ?
     ORDER BY written_at DESC, id DESC LIMIT 1`,
  );

  return {
    insert(run) {
      insertStmt().run(
        run.id,
        run.baseId,
        targetKey(run.target),
        run.tier,
        run.capsPaid,
        run.departedAt,
        run.returnsAt,
        run.travelMinutes,
        run.chairPoints,
        run.intelPercent,
      );
    },
    due(nowIso) {
      return (dueStmt().all(nowIso) as RunRow[]).map(toRun);
    },
    activeFor(baseId) {
      return (activeStmt().all(baseId) as RunRow[]).map(toRun);
    },
    markSettled(id, atIso) {
      settleStmt().run(atIso, id);
    },
    markRecalled(id, atIso, returnsAtIso) {
      recallStmt().run(atIso, returnsAtIso, id);
    },
    insertReport(report) {
      insertReportStmt().run(
        report.id,
        report.baseId,
        targetKey(report.target),
        report.districtId,
        report.districtName,
        report.placeName,
        JSON.stringify(report.holder),
        report.tier,
        report.capsPaid,
        report.writtenAt,
        report.failed ? 1 : 0,
        JSON.stringify(report.exposed),
        report.accuracy,
        report.unseen,
        report.accuracyShown ? 1 : 0,
        report.exposedSlots,
        report.unitsShown ? 1 : 0,
        report.totalSlots,
        report.foundOut ? 1 : 0,
        report.heldFromAway ? 1 : 0,
      );
    },
    unread() {
      return (unreadStmt().all() as RunRow[]).map(toRun);
    },
    putSnapshot(id, snapshot) {
      putSnapshotStmt().run(JSON.stringify(snapshot), id);
    },
    snapshotOf(id) {
      const row = snapshotStmt().get(id) as { snapshot_json: string | null } | undefined;
      if (!row?.snapshot_json) return undefined;
      const stored = JSON.parse(row.snapshot_json) as { report?: unknown; watcher?: unknown };
      // A read stored before the watcher was kept is the report itself: no watcher on it.
      if (stored.report === undefined) {
        return { report: SpyReportSchema.parse(stored), watcher: undefined };
      }
      return {
        report: SpyReportSchema.parse(stored.report),
        watcher: typeof stored.watcher === 'string' ? stored.watcher : null,
      };
    },
    reportsFor(baseId, limit) {
      return (reportsStmt().all(baseId, limit) as ReportRow[]).map(toReport);
    },
    latestFor(baseId, target) {
      const row = latestStmt().get(baseId, targetKey(target)) as ReportRow | undefined;
      return row ? toReport(row) : undefined;
    },
    hasReport(id) {
      return hasReportStmt().get(id) !== undefined;
    },
    basesHolding(researchId) {
      return (holdingStmt().all(researchId) as { id: string }[]).map((row) => row.id);
    },
    forget(baseId) {
      forgetRunsStmt().run(baseId);
      forgetReportsStmt().run(baseId);
    },
  };
}
