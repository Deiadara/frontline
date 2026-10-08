import { CHAIR_PASSIVE_CAP } from '../crew/passives.js';
import { softCap } from '../battle/soft-cap.js';
import { travelSpeedCut } from '../economy/soft-bounds.js';

/**
 * Speed, and what a speed is worth on a clock.
 *
 * Two different quantities live in this file and the game used to spend both the same way, which
 * is where a long run of confusing numbers came from.
 *
 * **Speed** is a stat, 0 to 100, on units and on machines. It says how fast a unit crosses the
 * city, and it is spent as a divisor: `base / (1 + speed/100)`. A unit on 100 halves the road, a
 * unit on 30 takes twenty minutes down to about fifteen and a half. That is the maintainer's rule,
 * "a 30 speed unit makes it 30% faster to go there", and it is the whole of {@link roadMinutes}.
 *
 * **A travel-time reduction** is a percentage the ground or the crew takes off whatever clock the
 * speed produced: the Rail Yard, the Smuggler's Tunnel, an officer's perk. It multiplies rather
 * than divides, so twenty minutes at speed 100 is ten, and another ten percent off that is nine.
 * Reductions stack on top of the speed and never replace it.
 *
 * Other channels (research, building, mustering, the mission's job leg) are still divisors, which
 * is why {@link timeSavingPercent} exists: a card that prints the raw percentage of a divisor
 * channel is lying, and the card and the clock have to agree.
 *
 * The caps and the muster taper live here rather than beside the arithmetic that spends them,
 * because the card and the clock both read them and `units/muster.ts` imports `city/locations.ts`. A leaf module both can
 * read is the only way round that without a cycle; their original homes re-export them, so nothing
 * outside this file had to move.
 */

/**
 * The ceiling on a speed, for a unit and for a machine alike.
 *
 * A road that takes no time is a map with no geography on it, and 100 is where the division stops
 * being interesting: it halves the walk, and every point below it is worth something.
 */
export const MAX_SPEED = 100;

/**
 * What the muster bench makes of its summed speed: in full up to the knee, then less for every
 * point after, closing on the ceiling and never reaching it.
 *
 * It was a hard 60 until 2026-10-01 (`MAX_TRAINING_SPEED_BONUS`). A Gauntlet at 20 is 40 points on
 * its own, so a crew with 20 more from its people sat on the stop, and every muster-time card
 * and the Automation set paid nothing while the yard sold them at full price (bugs file, B3). The
 * maintainer's ruling that day: the curve held ground and medic points already use. The knee sits
 * five points under the old stop, so ordinary crews barely move, and the ceiling is a third above
 * the old stop, so a deep stack still buys a little. Measured on it: 40 is 40, the old stop of 60 is
 * 59.5 (a 330 s unit takes 207 s rather than 206), 80 is 70.8, 110 is 77.2, and nothing reaches 80.
 */
export const MUSTER_SPEED_KNEE = 55;
export const MUSTER_SPEED_CEILING = 80;

/** The muster bench's speed after its taper. See {@link MUSTER_SPEED_KNEE}. */
export function musterSpeedAfterTaper(percent: number): number {
  return softCap(Math.max(0, percent), MUSTER_SPEED_KNEE, MUSTER_SPEED_CEILING);
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * A speed after the bonuses that move it, never past {@link MAX_SPEED}.
 *
 * One helper for units and machines both, because the cap is the same rule for both: a flat +3 on
 * a sheet already at 99 is worth one point, not three, and a percentage channel on top of that
 * cannot push a unit past the ceiling either. Deliberately not rounded: the battle engine reads a
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
 * multiplies. Both roads use this: `travelMinutesBetween` for a march or a spy job, and
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
   * The Cartographer's passive (`passives.ts`, maintainer 2026-10-04): a share off the road's
   * **base**, before the column's pace and every speed bonus, so an hour's road is half an hour
   * under a perfect Cartographer and every other cut is then taken off the half hour. Outside the
   * clamp on `reductionPercent`: it is a shorter road, not a faster crew.
   */
  baseCutPercent = 0,
): number {
  const pace = clamp(speed, 0, MAX_SPEED);
  // Bent, not stopped (`travelSpeedCut`, maintainer 2026-10-05).
  const off = travelSpeedCut(reductionPercent);
  const road = baseMinutes * (1 - clamp(baseCutPercent, 0, CHAIR_PASSIVE_CAP.travel_time) / 100);
  const minutes = (road / (1 + pace / 100)) * (1 - off / 100);
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
