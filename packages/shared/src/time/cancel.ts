import { RESOURCE_KEYS, type PartialResources } from '../resources.js';

/**
 * Changing your mind (maintainer request, 2026-09-12): one rule for everything that takes time.
 *
 * Anything a crew sets going, a build, a batch, a project, a dig, a scout, a crew on a job, a
 * column on the road, can be called off in the **first tenth** of its own clock, and a spend
 * called off comes back at **ninety percent**. The same two numbers everywhere, because a player
 * learns them once: the Gauntlet used to give ninety-five back and nothing else could be cancelled
 * at all, so whether a misclick was recoverable depended on which screen it happened on.
 *
 * A tenth of the thing's *own* clock, so a run of Razors gives seconds and a Nexus level gives
 * an hour: the longer a thing takes, the longer there is to notice the wrong button. Ninety back
 * rather than all of it, so the bench is never a free place to park resources; the missing tenth
 * is the material already cut up before anybody said stop.
 *
 * A journey has no bill to refund. What it pays back instead is time: a crew or a scout turned
 * round in the first tenth of the way out walks home the distance already covered, so the return
 * takes exactly as long as the going did.
 */
export const CANCEL_WINDOW = 0.1;
export const CANCEL_REFUND = 0.9;

/**
 * Whether a clock that started at `startedAtMs` and runs `totalMs` is still inside its window.
 *
 * Open before the clock has started as well (a queued build waiting behind another): nothing has
 * been done yet, so there is nothing to be too late for.
 */
export function cancelWindowOpen(startedAtMs: number, totalMs: number, nowMs: number): boolean {
  if (totalMs <= 0) return false;
  return (nowMs - startedAtMs) / totalMs < CANCEL_WINDOW;
}

/**
 * How long a party turned round at `now` needs to get home.
 *
 * The distance they have covered, capped at the way out (maintainer, 2026-09-22). Before the
 * window became a tenth of the **whole** job it could not outlast the outbound leg, so "as far
 * back as they have come" was always the right answer and the cap never bound. It binds now: on
 * a job that is mostly time on the ground, a tenth of the total is longer than the walk out, so a
 * party recalled while already standing there would otherwise be sent home for longer than the
 * entire journey took.
 *
 * Shared by the scout, the spy job and a column of units, because all three turn round the same
 * way and three copies of one sum is three chances to fix it once.
 */
export function turnaroundMs(
  leg: { departedAt: string; travelMinutes: number },
  now: Date,
): number {
  const elapsed = Math.max(0, now.getTime() - Date.parse(leg.departedAt));
  return Math.min(elapsed, leg.travelMinutes * 60_000);
}

/** Milliseconds left to decide, or zero once the window has shut. */
export function cancelWindowMs(startedAtMs: number, totalMs: number, nowMs: number): number {
  return Math.max(0, startedAtMs + totalMs * CANCEL_WINDOW - nowMs);
}

/** What comes back: whole units of each material, rounded down, never more than was paid. */
export function cancelRefund(paid: PartialResources): PartialResources {
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = paid[key];
      if (amount === undefined || amount <= 0) return [];
      return [[key, Math.floor(amount * CANCEL_REFUND)] as const];
    }),
  );
}
