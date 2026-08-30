/**
 * The game's one time curve (§E5, §I1).
 *
 * Everything with a clock on it pays out on the same shape: worth grows with how long the thing
 * took, but **sub-linearly**, so a long commitment pays far more in total while a short one stays
 * the better rate per hour. That is what keeps a mission board worth reading and a build queue
 * worth thinking about, and it is one rule rather than one per system.
 *
 * It lived inside `missions.ts` as half of `rewardScale`, which is why for a long time it applied to
 * missions and to nothing else: a 55-second first Gauntlet and a nine-hour level 20 both paid the
 * same flat 60 XP, and so did every research project and every training batch. The curve is here
 * now and the mission reward multiplies it by its own `KIND_REWARD_MULTIPLIER` on top.
 */

/** The length everything is priced against: a job of exactly this long is worth its anchor. */
export const EFFORT_BASELINE_MINUTES = 30;

/**
 * Sub-linear on purpose, and this is the number that decides how much idling beats attending.
 *
 * At 0.8 a job twenty times as long pays about eleven times as much, so it is the better absolute
 * payout and the worse hourly rate. Above 1 nothing but the longest job would ever be worth
 * starting; at exactly 1 the length of a job would stop being a decision at all.
 */
export const EFFORT_EXPONENT = 0.8;

/**
 * The least a finished thing may be worth, as a share of its anchor.
 *
 * Without a floor the curve prices a twenty-second build at 3% of the anchor, which is a level-up
 * bar that does not visibly move for the whole first session: technically correct and miserable to
 * play. A quarter is the floor because the opening of this game is a lot of very short builds, and
 * they are the player learning where the buttons are.
 */
export const MIN_EFFORT_SHARE = 0.25;

/** What a clock of `minutes` is worth, as a multiple of its system's anchor. */
export function effortScale(minutes: number): number {
  const raw = (Math.max(0, minutes) / EFFORT_BASELINE_MINUTES) ** EFFORT_EXPONENT;
  return Math.max(MIN_EFFORT_SHARE, raw);
}

/** ...and the same, from a clock quoted in seconds, which is how every build and project stores it. */
export function effortScaleSeconds(seconds: number): number {
  return effortScale(Math.max(0, seconds) / 60);
}
