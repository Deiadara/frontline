/**
 * Speed, and what a speed is worth on a clock.
 *
 * Two different quantities live in this file and the game used to spend both the same way, which
 * is where a long run of confusing numbers came from.
 *
 * **Speed** is a stat, 0 to 100, on units and on machines. It says how fast a body crosses the
 * city, and it is spent as a divisor: `base / (1 + speed/100)`. A unit on 100 halves the road, a
 * unit on 30 takes twenty minutes down to about fifteen and a half. That is the board's rule,
 * "a 30 speed unit makes it 30% faster to go there", and it is the whole of {@link roadMinutes}.
 *
 * **A travel-time reduction** is a percentage the ground or the crew takes off whatever clock the
 * speed produced: the Rail Yard, the Smuggler's Tunnel, an officer's perk. It multiplies rather
 * than divides, so twenty minutes at speed 100 is ten, and another ten percent off that is nine.
 * Reductions stack on top of the speed and never replace it.
 *
 * Other channels (research, building, training, the mission's job leg) are still divisors, which
 * is why {@link timeSavingPercent} exists: a card that prints the raw percentage of a divisor
 * channel is lying, and the card and the clock have to agree.
 *
 * The caps live here rather than beside the arithmetic that spends them, because the card and the
 * clock both read them and `units/training.ts` imports `city/locations.ts`. A leaf module both can
 * read is the only way round that without a cycle; their original homes re-export them, so nothing
 * outside this file had to move.
 */

/** A mission that lands the moment it is launched is a mission with no decision in it. */
export const MAX_MISSION_SPEED_BONUS = 50;

/**
 * The ceiling on a speed, for a body and for a machine alike.
 *
 * A road that takes no time is a map with no geography on it, and 100 is where the division stops
 * being interesting: it halves the walk, and every point below it is worth something.
 */
export const MAX_SPEED = 100;

/**
 * The most the ground and the crew may take off a road, as a percentage of what is left.
 *
 * A separate ceiling from {@link MAX_SPEED} because it is a separate quantity: speed decides the
 * pace, and this decides how much of the resulting clock a crew's holdings can buy away. At 60 the
 * best-supplied crew in the game still spends four tenths of every road it walks.
 */
export const MAX_TRAVEL_SPEED_BONUS = 60;

/** The same argument for the training bench. */
export const MAX_TRAINING_SPEED_BONUS = 60;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * A speed after the bonuses that move it, never past {@link MAX_SPEED}.
 *
 * One helper for units and machines both, because the cap is the same rule for both: a flat +3 on
 * a sheet already at 99 is worth one point, not three, and a percentage channel on top of that
 * cannot push a body past the ceiling either. Deliberately not rounded: the battle engine reads a
 * unit's effective speed as a continuous figure and rounding it here would move matchups.
 */
export function effectiveSpeed(
  base: number,
  bonus: { percent?: number; flat?: number } = {},
): number {
  const raised = base * (1 + (bonus.percent ?? 0) / 100) + (bonus.flat ?? 0);
  return clamp(raised, 0, MAX_SPEED);
}

/**
 * How long a road takes: the one arithmetic every journey in the game is measured with.
 *
 * `speed` is the pace of the slowest group in the column (`building/vehicles.ts`, `columnSpeed`),
 * and it divides. `reductionPercent` is what the ground and the crew take off the result, and it
 * multiplies. Both roads use this: `travelMinutesBetween` for a march or a scouting run, and
 * `hastenedRoadMinutes` for a mission's travel leg.
 *
 * Nobody walking at nothing with no holdings gets the base back, which is the property that makes
 * this safe to put under a road that used to have no speed in it at all.
 */
export function roadMinutes(
  baseMinutes: number,
  speed = 0,
  reductionPercent = 0,
  /**
   * Whole minutes cut off the answer, after everything else (the `road_shortcut` bonus).
   *
   * Last on purpose, and it is the whole reason the channel exists. A percentage is worth what the
   * clock is worth, so on the nine-minute hop between two neighbouring districts every travel
   * holding in the game together saves under four minutes; a flat cut is worth the same on that hop
   * as on an hour's march, which is what makes it the bonus a crew fighting over one corner of the
   * city can feel. The one-minute floor below is what keeps it from paying a road that is not there.
   */
  flatMinutesOff = 0,
): number {
  const pace = clamp(speed, 0, MAX_SPEED);
  const off = clamp(reductionPercent, 0, MAX_TRAVEL_SPEED_BONUS);
  const minutes = (baseMinutes / (1 + pace / 100)) * (1 - off / 100) - Math.max(0, flatMinutesOff);
  return Math.max(1, Math.round(minutes));
}

/**
 * The share of a clock a **divisor** channel removes, as a whole percentage.
 *
 * `cap` is the ceiling the consumer applies before it divides. Omitted for the channels that have
 * none (research and building), which are still not the raw percentage: the divisor is what makes
 * the difference, not the clamp.
 */
export function timeSavingPercent(percent: number, cap = Number.POSITIVE_INFINITY): number {
  const bonus = Math.min(cap, Math.max(0, percent));
  return Math.round((1 - 1 / (1 + bonus / 100)) * 100);
}
