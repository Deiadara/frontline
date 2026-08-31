import type { SkirmishEngine } from '@frontline/shared';
import { settleBattles } from '../battle/resolve.js';
import { settleMovements } from '../battle/movement.js';
import { settleFortifications } from '../city/actions.js';
import { resolveDueMissions } from '../missions/resolve.js';
import { settleCapturedGates } from '../city/gates.js';
import { settleScouting } from '../scouting/scouting.js';
import type { Repositories } from '../db/repos/index.js';

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
  /** Called with what a tick resolved, when it resolved anything. For logging and for tests. */
  onSettled?: (resolved: number, now: Date) => void;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Advances the world once. Exported so a test can drive it without a timer.
 *
 * Returns how many fights it resolved, which is the only observable a caller has: everything else
 * it does is a write to the database the caller can go and read.
 */
export function tickWorld(repos: Repositories, engine: SkirmishEngine, now: Date): number {
  // The same order the read paths use (`battle/routes.ts`, `routes/city.ts`), and it is an order
  // rather than a list: a column whose march ended this second is *in* the district, and the fight
  // it was sent to join is marked for the same second. Settling the fight first would resolve it
  // without those bodies and land the reinforcements in a finished battle.
  settleFortifications(repos, now);
  settleMovements(repos, now);
  const fights = settleBattles(repos, engine, now).length;
  settleCrewsComingHome(repos, now);
  // §A4: and the scouts. Same argument as missions: what a finished run writes is a receipt, and a
  // receipt only matters when it arrives. A player who sent somebody out and closed the tab should
  // come back to open ground and a rung bell, not cause both by opening the city screen.
  settleScouting(repos, now);
  // §B7: a captured gate finishing changes how hard that ground is for *somebody else* to take,
  // so it has to land on its mark whether or not its owner is looking.
  settleCapturedGates(repos, now);
  return fights;
}

/**
 * Brings home every crew whose run has ended, wherever they are.
 *
 * The candidate set is districts with a crew still out, which is small: a player runs a handful of
 * jobs at a time and a finished one leaves the set. Each is settled in its own transaction, so one
 * unreadable run cannot roll back the crews that came home cleanly beside it, and a throw is left
 * to the caller's guard rather than swallowed here.
 *
 * The cost of the sweep grows with the number of *runs in flight*, not with the number of accounts,
 * and every second it does a primary-key lookup per district with one. That is the right shape for
 * a game of this size and the wrong one for a very large one: past a few thousand concurrent runs
 * this wants an index on a stored return time and a query that asks only for what is actually due.
 */
function settleCrewsComingHome(repos: Repositories, now: Date): void {
  for (const baseId of repos.missions.basesWithActiveRuns()) {
    const base = repos.bases.findById(baseId);
    if (!base) continue;
    repos.tx(() => resolveDueMissions(repos, base, now));
  }
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
  onSettled,
  intervalMs = WORLD_TICK_MS,
  now = () => new Date(),
}: WorldClockOptions): () => void {
  const timer = setInterval(() => {
    try {
      const at = now();
      const resolved = tickWorld(repos, engine, at);
      if (resolved > 0) onSettled?.(resolved, at);
    } catch (error) {
      // Swallowed on purpose. One unreadable row must not stop every future fight in the world,
      // and the 500 that `/api/battles` once served for months is the standing evidence that a
      // single bad row can otherwise take a whole system down.
      onError?.(error);
    }
  }, intervalMs);
  // Without this a `pnpm test` that started a clock would hang on an open handle rather than exit.
  timer.unref?.();
  return () => clearInterval(timer);
}
