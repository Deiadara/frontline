import { isMissionDue, type SkirmishEngine } from '@frontline/shared';
import { settleAndResolveMissions } from '../missions/resolve.js';
import { settleWorld } from '../world/settle.js';
import { recordTick } from '../world/vitals.js';
import type { Repositories } from '../db/repos/index.js';
import {
  guardStage,
  reportTickFailuresTo,
  settleEach,
  type TickFailureSink,
} from '../world/guard.js';
import { settleFinishedWork } from '../district/finished.js';

/**
 * The world clock: the one thing in this server that happens without being asked.
 *
 * ## Why there is a tick now, when every other clock in the game is lazy
 *
 * Nearly all of this game's timed state is *deterministic and private*: a stockpile filling, a roof
 * going up, a crew learning something. Nobody but the owner can observe it, and what it will read
 * at any future instant is a function of the timestamps already in the row. Computing it when
 * somebody looks is not a shortcut, it is the correct design, and it stays: see `district/settle.ts`
 * and `research/settle.ts`.
 *
 * A fight is the exception, and it is the exception for a reason that has nothing to do with
 * performance. It is **not private**: it moves somebody else's army, takes somebody else's ground,
 * and writes a receipt to an account that did not ask for one. Resolved lazily, it happens the
 * first time any player loads a page, which means the moment a fight lands depends on who else
 * happens to be online. Two attacks marked for the same minute could resolve minutes apart, and the
 * later one would read a board the earlier one had already changed. In a game whose whole premise
 * is that timing matters, that is not a latency problem, it is a fairness problem: the mark on the
 * clock has to be the mark, or declaring one for 21:04 means nothing.
 *
 * So the rule this file draws: **private and deterministic stays lazy, shared and contested gets a
 * tick.** Battles and the columns marching towards them are the clearest case.
 *
 * ## Missions are here for the other half of the promise
 *
 * A mission is private, and by the rule above it could have stayed lazy. It is here because of what
 * it *writes*: a crew coming home files a report, and a report is only worth having when it arrives.
 * Settled on the owner's read of one screen, the bell for a job that finished at 21:04 rang
 * whenever they next opened Missions, which could be the following morning. Everything else about
 * the run stays exactly as it was, because this calls the same `resolveDueMissions` the route does.
 *
 * ## The tick is not a simulation step
 *
 * It runs the same `settleBattles` the read paths run, on the same `now`, and it holds no state of
 * its own. Nothing here is a second implementation of anything: a read that arrives between two
 * ticks still settles what it finds, exactly as before, and finds nothing left because the tick got
 * there first. That is what makes this safe to add to a working game rather than a rewrite of it.
 *
 * A slow tick can never overlap itself: `settleBattles` is synchronous, and so is the database
 * driver under it, so the interval callback runs to completion before the next one is dispatched.
 */

/**
 * How often the world is advanced.
 *
 * One second, because that is the resolution a player can actually perceive on a countdown, and
 * because the query behind it is `WHERE resolved_at IS NULL AND scheduled_for <= ?` against
 * `idx_scheduled_battles_due`. On an empty board that is an index probe returning nothing, which is
 * the state the server is in almost all of the time. Making it cheaper by making it slower would
 * buy nothing and cost the thing the tick exists for.
 */
export const WORLD_TICK_MS = 1_000;

export interface WorldClockOptions {
  repos: Repositories;
  engine: SkirmishEngine;
  /** Wired to the log by the caller. A tick that throws must not take the timer down with it. */
  onError?: (error: unknown) => void;
  /**
   * Where a single stage or row that failed inside a tick is told (`world/guard.ts`). Those are
   * caught where they happen so the rest of the tick still runs, which means `onError` never sees
   * them: this is the only place they surface.
   */
  onFailure?: TickFailureSink;
  /** Called with what a tick resolved, when it resolved anything. For logging and for tests. */
  onSettled?: (resolved: number, now: Date) => void;
  intervalMs?: number;
  now?: () => Date;
  /**
   * Admin mode, so the Right Hand's parties run on the five second clock like every manual one.
   * The manual launch route passes `app.config.admin` into `launchMission`; the world clock has
   * no request to read it off, so it is handed in once here.
   */
  admin?: boolean;
}

/**
 * Advances the world once. Exported so a test can drive it without a timer.
 *
 * Returns how many fights it resolved, which is the only observable a caller has: everything else
 * it does is a write to the database the caller can go and read.
 */
export function tickWorld(
  repos: Repositories,
  engine: SkirmishEngine,
  now: Date,
  admin = false,
): number {
  // One order, shared with every read path that settles the world: see `world/settle.ts` for why
  // each step is where it is. It used to be spelled out here and separately in `routes/city.ts` and
  // `battle/routes.ts`, and this comment used to claim the three agreed. They did not.
  //
  // §A4: the spy jobs and the crews coming home are settled inside it. What a finished run writes
  // is a receipt, and a receipt only matters when it arrives. A player who sent somebody out and
  // closed the tab should come back to a report and a rung bell, not cause both by opening a screen.
  /*
   * The crews' own failures are reported rather than thrown (bug pass, 2026-09-23; robustness
   * pass, 2026-09-25).
   *
   * `settleWorld` calls this callback *before* the automations, the spies and every
   * auction, so a throw from inside it skipped all of them, for every player, once a second, for
   * as long as one unparseable row existed. The first fix collected the failing ids and threw one
   * error naming them after the tick, with each cause thrown away; each failure now goes to the
   * tick's failure sink with its own error (`world/guard.ts`), and nothing is thrown.
   */
  const resolved = settleWorld(repos, engine, now, settleCrewsComingHome, admin);
  /*
   * Then every crew's own finished work (maintainer ruling, 2026-09-29). Private and
   * deterministic, which by the rule above could stay lazy, and did: but the standings, a crew's
   * file and a faction's page show other people's levels and structures, and those were as old as
   * the owner's last look. After the fights, which settle the crews they touch themselves.
   */
  guardStage('finished work', 0, () => settleFinishedWork(repos, now));
  return resolved;
}

/**
 * Brings home every crew whose run has ended, wherever they are.
 *
 * The candidate set is districts with a crew still out, which is small: a player runs a handful of
 * jobs at a time and a finished one leaves the set. Each is settled in its own transaction, so one
 * unreadable run cannot roll back the crews that came home cleanly beside it, and a base that
 * throws is reported with its own error and left for the next tick (`settleEach`).
 *
 * The cost of the sweep grows with the number of *runs in flight*, not with the number of accounts,
 * and every second it does a primary-key lookup per district with one. That is the right shape for
 * a game of this size and the wrong one for a very large one: past a few thousand concurrent runs
 * this wants an index on a stored return time and a query that asks only for what is actually due.
 */
function settleCrewsComingHome(repos: Repositories, now: Date): void {
  settleEach(
    repos,
    'crews coming home',
    repos.missions.basesWithActiveRuns(),
    (id) => id,
    (id) => {
      // The runs first, the crew only if one of them is home: a crew is the heaviest row there is,
      // and most seconds nothing out there has finished (hardening pass, 2026-09-27).
      const home = repos.missions
        .listActiveByBaseId(id)
        .some((stored) => isMissionDue(stored.mission, now));
      if (!home) return;
      const base = repos.bases.findById(id);
      if (base) settleAndResolveMissions(repos, base, now);
    },
  );
}

/**
 * Starts the clock. Returns the way to stop it.
 *
 * Started from `index.ts` rather than `buildApp`, for the same reason the backup schedule is: a
 * test suite builds an app per case, and a timer resolving battles underneath a test that is trying
 * to assert on an unresolved one is a source of failures nobody would enjoy tracking down.
 */
export function startWorldClock({
  repos,
  engine,
  onError,
  onFailure,
  onSettled,
  intervalMs = WORLD_TICK_MS,
  now = () => new Date(),
  admin = false,
}: WorldClockOptions): () => void {
  const restoreSink = onFailure ? reportTickFailuresTo(onFailure) : () => undefined;
  const timer = setInterval(() => {
    try {
      const at = now();
      const resolved = tickWorld(repos, engine, at, admin);
      if (resolved > 0) onSettled?.(resolved, at);
    } catch (error) {
      // Swallowed on purpose. One unreadable row must not stop every future fight in the world,
      // and the 500 that `/api/battles` once served for months is the standing evidence that a
      // single bad row can otherwise take a whole system down.
      onError?.(error);
    } finally {
      recordTick();
    }
  }, intervalMs);
  // Without this a `pnpm test` that started a clock would hang on an open handle rather than exit.
  timer.unref?.();
  return () => {
    clearInterval(timer);
    restoreSink();
  };
}
