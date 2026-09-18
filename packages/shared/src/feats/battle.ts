import type { FeatMeasure } from './measures.js';

/**
 * Which of the four "that one was worth telling somebody about" counters a fight earns.
 *
 * ## Why the rule lives in shared rather than at the settle site
 *
 * The server knows what happened; it should not also be the thing that decides what counts as
 * winning against the odds. Four thresholds written into `battle/resolve.ts` would be four numbers
 * nobody could test without a database, sitting a long way from the blurbs that promise them, and
 * the blurbs are the contract: "beat a line twice your own" has to mean the same thing on the
 * board as it does in the settler. One pure function over five numbers is testable on its own and
 * is the only place the thresholds are written down.
 *
 * ## Force is counted in unit slots, not in heads
 *
 * A Juggernaut is not one body, and the game already prices a force by the beds it needs
 * everywhere else it matters: housing, the deployment screen and `supply_deployed` all count unit
 * slots. Counting heads instead would make "outnumbered" a statement about how cheap the other
 * crew's units were, so a crew could farm the ladder by walking a maxed line into a mob of Razors.
 */

/** How much bigger the other line has to be before a win counts as one against the odds. */
export const OUTNUMBERED_AT = 2;

/** ...and before it counts as the kind nobody expected. */
export const OVERWHELMED_AT = 4;

/**
 * How well a winner has to trade for the win to count as a rout, and the floor under it.
 *
 * Both halves are needed. The ratio alone makes a fight where one Razor died and eleven of theirs
 * did a "ten to one rout", which is a skirmish; the floor alone would pay out for any big win
 * however expensive it was. Ten of theirs for one of yours, and at least ten of theirs.
 */
export const LOPSIDED_AT = 10;

/** One crew's side of a settled fight, in the five numbers the counters are decided on. */
export interface BattleFeatFacts {
  /** Whether this crew was on the winning side. Nothing below is earned by losing. */
  readonly won: boolean;
  /** Unit slots this crew's side had on the ground at the mark. */
  readonly ownForce: number;
  /** ...and what stood against it. */
  readonly enemyForce: number;
  /** Units this side took off the other, counting the trap and the ring. */
  readonly killed: number;
  /** ...and units of its own that did not walk off the field. */
  readonly lost: number;
}

/**
 * The counters this fight earns for one crew, in catalogue order.
 *
 * A fight can earn several: a win at four to one is also a win at two to one, and a rout the
 * winner walked away from whole is both flawless and lopsided. That is the same relation
 * `battles_won` already has with `battles_fought`, and the ladders are separate chains, so every
 * one of them ticks.
 *
 * Both force tests want a real enemy on the ground. An unoccupied lot has nobody on it, and a
 * walkover that paid out a flawless win every time would make the ladder a measure of how much of
 * the map is empty.
 */
export function battleFeatsEarned(facts: BattleFeatFacts): FeatMeasure[] {
  if (!facts.won) return [];
  const earned: FeatMeasure[] = [];
  const contested = facts.ownForce > 0 && facts.enemyForce > 0;

  if (contested && facts.enemyForce >= facts.ownForce * OUTNUMBERED_AT) {
    earned.push('battles_won_outnumbered');
  }
  if (contested && facts.enemyForce >= facts.ownForce * OVERWHELMED_AT) {
    earned.push('battles_won_overwhelmed');
  }
  if (facts.enemyForce > 0 && facts.lost === 0) earned.push('battles_won_flawless');
  if (facts.killed >= LOPSIDED_AT && facts.killed >= facts.lost * LOPSIDED_AT) {
    earned.push('battles_won_lopsided');
  }
  return earned;
}
