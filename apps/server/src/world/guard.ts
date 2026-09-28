import type { Repositories } from '../db/repos/index.js';

/**
 * Keeping one bad row from stopping the world (robustness pass, 2026-09-25).
 *
 * The world clock settles thirteen stages every second, and none of them caught anything: one
 * battle whose stored army no longer parsed, one auction that threw, and every stage after it was
 * skipped for **every player**, on every tick, for as long as that row existed. No fight landed, no
 * crew came home and no auction closed anywhere because of one crew's bad data. The clock itself
 * survived (it catches per tick); the game did not.
 *
 * Two layers, each for its own reason:
 *
 * - {@link settleEach} runs one item in its own transaction and catches it. The transaction is the
 *   point, not a courtesy: several stages made two writes per item with nothing around them (a
 *   column merged into a deployment and then removed, a sleeper cell's army sent home and then the
 *   cell deleted), so a throw between the two left the first standing and the next tick did it
 *   again, which is units duplicated. Inside `repos.tx` an item commits whole or not at all, and
 *   nested inside an outer transaction it is a savepoint, so catching it rolls back exactly that
 *   item.
 * - {@link guardStage} catches a stage whose failure is not about any one item (a query that
 *   throws, a bad table), so the stages after it still run.
 *
 * Failures go to one sink, which the world clock points at the server log. It is rate-limited per
 * item: a row that throws every second is one line a minute, not 86,400 a day.
 */

export interface TickFailure {
  /** The stage that failed: `battles`, `automations`, `bar auctions` and so on. */
  stage: string;
  /** The row it failed on, when it was one row. */
  item?: string;
  error: unknown;
}

export type TickFailureSink = (failure: TickFailure) => void;

/** The same failure is reported at most this often. */
export const TICK_FAILURE_REPORT_MS = 60_000;

const lastReported = new Map<string, number>();

/** Until the clock says otherwise: standard error, so a test or a script still sees it. */
let sink: TickFailureSink = ({ stage, item, error }) => {
  console.error(`world tick: ${stage}${item ? ` (${item})` : ''} failed`, error);
};

/** Points tick failures somewhere. Returns a function that puts the previous sink back. */
export function reportTickFailuresTo(next: TickFailureSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

/** Reports a failure, unless the same one was reported inside the last minute. */
export function reportTickFailure(failure: TickFailure, now: number = Date.now()): void {
  const key = `${failure.stage}\u0000${failure.item ?? ''}`;
  const last = lastReported.get(key);
  if (last !== undefined && now - last < TICK_FAILURE_REPORT_MS) return;
  lastReported.set(key, now);
  // Bounded: a world with thousands of distinct failing rows forgets the oldest, it does not grow.
  if (lastReported.size > 10_000) {
    const oldest = lastReported.keys().next().value;
    if (oldest !== undefined) lastReported.delete(oldest);
  }
  try {
    sink(failure);
  } catch {
    // A logger that throws is not a reason to stop settling the world.
  }
}

/**
 * Runs `work` on every item, each in its own transaction, and reports the ones that throw.
 *
 * Returns how many settled. An item that throws is rolled back to exactly where it started and
 * left for the next tick, so a transient failure heals itself and a permanent one costs only its
 * own row.
 */
export function settleEach<T>(
  repos: Repositories,
  stage: string,
  items: Iterable<T>,
  idOf: (item: T) => string,
  work: (item: T) => void,
): number {
  let settled = 0;
  for (const item of items) {
    try {
      repos.tx(() => work(item));
      settled += 1;
    } catch (error) {
      reportTickFailure({ stage, item: idOf(item), error });
    }
  }
  return settled;
}

/** Runs one whole stage, and answers `fallback` if it throws, so the stages after it still run. */
export function guardStage<T>(stage: string, fallback: T, work: () => T): T {
  try {
    return work();
  } catch (error) {
    reportTickFailure({ stage, error });
    return fallback;
  }
}
