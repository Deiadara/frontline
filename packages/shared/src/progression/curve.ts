/**
 * The player level curve (GDD §I2).
 *
 * `Base.level` is the player's progression level and the *stored* source of truth for it
 * (INTERFACES §2 R1). It is never derived on a read path. What this module stores alongside it is
 * `xpIntoLevel`: progress **towards the next level only**, reset on every level-up.
 *
 * That is deliberate. A running lifetime-XP total would make `level` a pure function of XP, i.e. a
 * second expression of the same fact that can drift out of step with the column: exactly the
 * mirror R1 forbids. With progress-into-level there is no cross-field invariant to violate: any
 * level pairs with any progress below its own threshold, and retuning the curve later moves the
 * next threshold instead of silently reassigning everyone's level.
 */

/** Levels start at 1 (`BaseSchema.level` is `int >= 1`), so there is no level-0 state to model. */
export const PLAYER_LEVEL_MIN = 1;

/**
 * The curve: `PLAYER_XP_LEVEL_STEP * level ^ PLAYER_XP_LEVEL_POWER` to clear each level, rounded.
 *
 * Retuned 2026-09-28 (maintainer: "all the levels a little earlier and a little easier to reach",
 * the late game about two and a half months in for a crew that plays every day). It was
 * `100 * triangular(level)`, which grows with the square of the level: a crew in the progression
 * simulation (`apps/server/scripts/progression-sim.ts`) was level thirty on day 156 and never saw
 * level ninety. At a power of 1.6 it reached level ninety on day seventy nine.
 *
 * The power went to 1.41 on 2026-10-01 (maintainer), when the fight premium came down from the
 * old 1.6 to 6.7 times to 10 to 250% and the same crew slipped to level ninety on day 143. At 1.41
 * it reaches level ten on day five, forty on day thirty, sixty on day forty nine and ninety, the
 * last milestone, on day seventy six (73 to 76 over five seeds). The simulation leaves out the XP
 * from buildings, research, drills, hires, declared fights and feats, so a real crew playing that
 * much runs a few days ahead.
 */
export const PLAYER_XP_LEVEL_STEP = 52;
export const PLAYER_XP_LEVEL_POWER = 1.41;

/**
 * XP required to advance *from* `level` to `level + 1`: 52, 138, 245, 367, 503, …
 *
 * Strictly increasing and always positive, which is what makes `applyPlayerXp`'s loop terminate.
 */
export function playerXpToNextLevel(level: number): number {
  const from = Math.max(PLAYER_LEVEL_MIN, Math.trunc(level));
  return Math.round(PLAYER_XP_LEVEL_STEP * from ** PLAYER_XP_LEVEL_POWER);
}

/** Where a player sits on the curve: `Base.level` plus progress towards the next one. */
export interface PlayerLevelProgress {
  level: number;
  xpIntoLevel: number;
}

export interface PlayerLevelAdvance extends PlayerLevelProgress {
  /** 0 when the XP did not clear the threshold; >1 when one award crossed several levels. */
  levelsGained: number;
}

/**
 * Adds XP and applies every level-up it pays for. Pure: the caller persists the result.
 *
 * Leftover XP carries into the new level rather than being discarded, so a single large award
 * cannot be worth less than the same total split across two awards.
 */
export function applyPlayerXp(current: PlayerLevelProgress, xp: number): PlayerLevelAdvance {
  const gained = Math.max(0, Math.trunc(xp));
  let level = Math.max(PLAYER_LEVEL_MIN, Math.trunc(current.level));
  let xpIntoLevel = Math.max(0, Math.trunc(current.xpIntoLevel)) + gained;

  let levelsGained = 0;
  for (let threshold = playerXpToNextLevel(level); xpIntoLevel >= threshold;) {
    xpIntoLevel -= threshold;
    level += 1;
    levelsGained += 1;
    threshold = playerXpToNextLevel(level);
  }

  return { level, xpIntoLevel, levelsGained };
}
