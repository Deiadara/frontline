import type { BuildQueue, BuildQueueEntry } from './queue.js';
import { queueCompletesAt } from './queue.js';
import { buildingLevel, type Building } from './state.js';

/**
 * The Generator's paid burn (§B4): two hours of oil for a quarter off the whole queue.
 *
 * The one thing in the district a player *buys with time in mind*. Everything else in the game
 * trades materials for a number that goes up; this trades materials for the clock, which is the
 * currency a base-builder actually spends. It is deliberately expensive per hour and deliberately
 * short, so it is a thing you fire before going to bed on a Nexus level rather than a subscription
 * you keep topped up.
 *
 * ## It is one timestamp
 *
 * Like every other clock in this game there is no scheduler: the district stores when the burn ends
 * and every reader works it out from `now`. That is what makes it survive a reload, and it is why
 * a countdown on the Generator's dialog needs nothing but the base it was already handed.
 *
 * ## Work already queued is re-timed once, at purchase
 *
 * The board asked for the boost to reach work already under way as well as work ordered during it.
 * A queue entry's `durationSeconds` is frozen at order time on purpose (raising anything must never
 * silently re-time work in flight), so the boost cannot be a multiplier applied at read time
 * without every consumer of the queue learning about it. Instead the purchase itself rewrites the
 * queue exactly once, through {@link boostedQueue}: what is left of each entry shrinks by
 * {@link BUILD_BOOST_PERCENT} and the chain is re-linked behind it. Orders placed *during* the burn
 * get the same percentage off at order time, where every other build discount is applied.
 *
 * The consequence worth stating: buying a second burn while one runs would re-time the queue a
 * second time, which is a quarter off a quarter. That is why buying one is refused rather than
 * extending, which is also what the board asked for.
 */

/** How long one burn lasts. */
export const BUILD_BOOST_HOURS = 2;
export const BUILD_BOOST_MS = BUILD_BOOST_HOURS * 3_600_000;

/** Percentage points off the clock of everything queued while it runs. */
export const BUILD_BOOST_PERCENT = 25;

/**
 * Oil per Generator level. A bigger turbine drinks more to run hot, so the price rises with the
 * structure that sells it: this is not a discount that gets cheaper as the district grows.
 */
export const BUILD_BOOST_OIL_PER_LEVEL = 250;

/** What a burn costs this district, in oil. Zero when there is no Generator to run it. */
export function buildBoostOilCost(buildings: readonly Building[]): number {
  return buildingLevel(buildings, 'generator') * BUILD_BOOST_OIL_PER_LEVEL;
}

/** Whether a burn is running at `now`. */
export function buildBoostActive(until: string | null, now: Date): boolean {
  return buildBoostRemainingMs(until, now) > 0;
}

/** How much of the burn is left, in milliseconds. Zero when none is running. */
export function buildBoostRemainingMs(until: string | null, now: Date): number {
  if (until === null) return 0;
  return Math.max(0, Date.parse(until) - now.getTime());
}

/** Percentage points off a build ordered at `now`: the burn's, or nothing. */
export function buildBoostPercent(until: string | null, now: Date): number {
  return buildBoostActive(until, now) ? BUILD_BOOST_PERCENT : 0;
}

/** Why a burn cannot be bought. Ordered as they are checked, most structural first. */
export const BUILD_BOOST_REFUSALS = ['no_generator', 'already_running', 'cannot_afford'] as const;
export type BuildBoostRefusal = (typeof BUILD_BOOST_REFUSALS)[number];

/**
 * The queue with the burn applied to work already in it.
 *
 * Head entry keeps its `startedAt`, so the progress bar a player is watching does not jump
 * backwards: what shrinks is the part that has not happened yet. Everything behind it has not
 * started, so its whole clock shrinks and its start is re-linked to the entry in front.
 *
 * Floored at one second per entry, the same floor `buildingBuildSeconds` uses: an order that
 * completes in the instant it is re-timed has no queue position to occupy.
 */
export function boostedQueue(queue: BuildQueue, now: Date, percent: number): BuildQueue {
  if (queue.length === 0 || percent <= 0) return queue;
  const keep = 1 - Math.min(100, percent) / 100;
  const boosted: BuildQueueEntry[] = [];
  let cursor: Date | null = null;

  for (const entry of queue) {
    const startedAt = cursor ?? new Date(Date.parse(entry.startedAt));
    // Time already served on the entry at the head. Clamped at zero for an entry whose clock has
    // not begun, and at its own duration for one whose clock has run out but which the settle has
    // not picked up yet: neither is allowed to lengthen the order.
    const elapsedMs = Math.min(
      entry.durationSeconds * 1000,
      Math.max(0, now.getTime() - startedAt.getTime()),
    );
    const remainingMs = entry.durationSeconds * 1000 - elapsedMs;
    const seconds = Math.max(1, Math.round((elapsedMs + remainingMs * keep) / 1000));
    const next: BuildQueueEntry = {
      ...entry,
      startedAt: startedAt.toISOString(),
      durationSeconds: seconds,
    };
    boosted.push(next);
    cursor = queueCompletesAt(next);
  }
  return boosted;
}
