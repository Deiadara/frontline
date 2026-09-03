/**
 * What a "+N% speed" channel is actually worth on a clock.
 *
 * Every speed channel in the game is spent the same way: `time / (1 + percent/100)`. That is not the
 * same number as `percent`, and the card used to print `percent` as a *reduction in time*. A
 * Smuggler's Tunnel at level 10 scales `mission_speed` 12 to 66 and read "-66% mission time", while
 * `hastenedMinutes` clamps 66 to 50 and turns a 60-minute leg into 40: a 33% saving against a card
 * promising 66. Even at level 1 with no clamp, the University's "-12% research time" is really
 * 1 - 1/1.12 = 10.7%.
 *
 * The caps live here rather than beside the arithmetic that spends them, because the card and the
 * clock have to agree about them and `units/training.ts` imports `city/locations.ts`. A leaf module
 * both can read is the only way round that without a cycle; both of their original homes re-export
 * their own constant, so nothing outside this file had to move.
 */

/** A mission that lands the moment it is launched is a mission with no decision in it. */
export const MAX_MISSION_SPEED_BONUS = 50;

/** The same argument for the training bench. */
export const MAX_TRAINING_SPEED_BONUS = 60;

/**
 * The share of a clock a speed bonus removes, as a whole percentage.
 *
 * `cap` is the ceiling the consumer applies before it divides. Omitted for the channels that have
 * none (research and building), which are still not the raw percentage: the divisor is what makes
 * the difference, not the clamp.
 */
export function timeSavingPercent(percent: number, cap = Number.POSITIVE_INFINITY): number {
  const bonus = Math.min(cap, Math.max(0, percent));
  return Math.round((1 - 1 / (1 + bonus / 100)) * 100);
}
