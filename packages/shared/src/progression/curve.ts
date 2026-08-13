/**
 * The player level curve (GDD §I2).
 *
 * `Base.level` is the player's progression level and the *stored* source of truth for it
 * (INTERFACES §2 R1) — it is never derived on a read path. What this module stores alongside it is
 * `xpIntoLevel`: progress **towards the next level only**, reset on every level-up.
 *
 * That is deliberate. A running lifetime-XP total would make `level` a pure function of XP, i.e. a
 * second expression of the same fact that can drift out of step with the column — exactly the
 * mirror R1 forbids. With progress-into-level there is no cross-field invariant to violate: any
 * level pairs with any progress below its own threshold, and retuning the curve later moves the
 * next threshold instead of silently reassigning everyone's level.
 */

/** Levels start at 1 (`BaseSchema.level` is `int >= 1`), so there is no level-0 state to model. */
export const PLAYER_LEVEL_MIN = 1;

/**
 * XP to clear level 1. Each subsequent level costs a further multiple of it, so the curve is
 * `PLAYER_XP_LEVEL_STEP * triangular(level)` — integer-exact at every level, no rounding.
 */
export const PLAYER_XP_LEVEL_STEP = 100;

/**
 * XP required to advance *from* `level` to `level + 1`: 100, 300, 600, 1000, 1500, …
 *
 * Strictly increasing and always positive, which is what makes `applyPlayerXp`'s loop terminate.
 */
export function playerXpToNextLevel(level: number): number {
  const from = Math.max(PLAYER_LEVEL_MIN, Math.trunc(level));
  return (PLAYER_XP_LEVEL_STEP * from * (from + 1)) / 2;
}

/** Where a player sits on the curve — `Base.level` plus progress towards the next one. */
export interface PlayerLevelProgress {
  level: number;
  xpIntoLevel: number;
}

export interface PlayerLevelAdvance extends PlayerLevelProgress {
  /** 0 when the XP did not clear the threshold; >1 when one award crossed several levels. */
  levelsGained: number;
}

/**
 * Adds XP and applies every level-up it pays for. Pure — the caller persists the result.
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
