/**
 * The reference attrition curve: the thing this engine is calibrated *against*.
 *
 * Browser strategy games have converged on one formula for a one-shot fight, and it has been load
 *-bearing in shipped games for two decades: the loser is wiped out, and the **winner loses
 * `(loser_power / winner_power) ^ K`** of its force. Tribal Wars uses it with `K = 1.5`; Travian
 * uses the same shape with `K` shrinking as the battle grows, so that very large battles are
 * bloodier for the winner than small ones.
 *
 * This module does not resolve anything. The engine is a round simulation, because a formula
 * cannot say *which* stack broke or why, and that is most of what makes a report worth reading.
 * What the formula is for is keeping that simulation honest: strip out the counters, the terrain
 * and the morale, and a simulated fight must land on this curve. `engine.test.ts` asserts exactly
 * that, which is what stops the round loop drifting somewhere unbalanced one tuning pass at a time.
 *
 * Sources: Tribal Wars battle mechanics, and Kirilloid's Travian combat notes.
 */

/** Travian's exponent for small engagements, and Tribal Wars' only exponent. */
export const ATTRITION_K_SMALL = 1.5;

/** ...and the floor it decays to for very large ones. */
export const ATTRITION_K_LARGE = 1.25;

/**
 * The exponent for a fight of `bodies` total combatants.
 *
 * Travian's `2 · (1.8592 − N^0.015)`, clamped. Below the clamp it is 1.5 and above it 1.25, which
 * is the whole behaviour: a hundred-body skirmish is decided cleanly, a thousand-body assault
 * grinds both sides down. Reproduced rather than invented: the shape is the part that has been
 * tested by other people's players for twenty years.
 */
export function attritionExponent(bodies: number): number {
  const raw = 2 * (1.8592 - Math.max(1, bodies) ** 0.015);
  return Math.min(ATTRITION_K_SMALL, Math.max(ATTRITION_K_LARGE, raw));
}

/**
 * The fraction of the winning side that dies, given both sides' power.
 *
 * Returns 1 when the two are equal: an even fight destroys both armies, which is correct and is
 * why nobody attacks into one.
 */
export function winnerLossFraction(winnerPower: number, loserPower: number): number {
  if (winnerPower <= 0) return 1;
  const ratio = Math.max(0, loserPower) / winnerPower;
  if (ratio >= 1) return 1;
  return ratio ** attritionExponent(winnerPower + loserPower);
}
