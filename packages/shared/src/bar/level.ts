import {
  ATTRIBUTE_NAMES,
  clampAttribute,
  type AttributeName,
  type Attributes,
} from '../attributes.js';

/**
 * The per-character level (GDD §H6, §H6a) — INTERFACES §2 R1's `Commander.level`.
 *
 * This is emphatically **not** player progression. `Base.level` (W6) is the one player level and
 * nothing here reads, mirrors or recomputes it; what a character level buys is attribute points on
 * that character's own sheet. Every symbol is prefixed `CHARACTER_*` per R1, because the shared
 * package re-exports with `export *`.
 */

/** Characters start at 1, like every other level in the game. */
export const CHARACTER_LEVEL_MIN = 1;

/**
 * XP to clear character level 1. §H6 says characters "evolve slowly", so the step is set well
 * above what any single activity is worth and the curve is triangular on top of that: 120, 360,
 * 720, … Same shape as the player curve, integer-exact at every level.
 */
export const CHARACTER_XP_LEVEL_STEP = 120;

/** XP required to advance *from* `level` to `level + 1`. Strictly increasing and always positive. */
export function characterXpToNextLevel(level: number): number {
  const from = Math.max(CHARACTER_LEVEL_MIN, Math.trunc(level));
  return (CHARACTER_XP_LEVEL_STEP * from * (from + 1)) / 2;
}

/** §H6 — "5 skill points to add" on every level-up. */
export const CHARACTER_LEVEL_POINTS = 5;

/**
 * §H6a — of those 5, how many the player assigns by hand.
 *
 * §H6's board text is *"2 separate points you can individually assign"*, which does not say what
 * the other 3 do. The CEO's reading is that they auto-allocate along the character's affinities;
 * it is provisional and flagged to the board. **This constant and `autoAllocatedAttributes` below
 * are the whole of that reading** — flipping it to "all 5 are player-assigned" is changing this
 * one number to 5, and nothing else in the codebase moves.
 */
export const CHARACTER_LEVEL_PLAYER_POINTS = 2;

/** The remainder of the §H6 grant, spent for the player along their affinities (§H6a). */
export const CHARACTER_LEVEL_AUTO_POINTS = CHARACTER_LEVEL_POINTS - CHARACTER_LEVEL_PLAYER_POINTS;

/**
 * §H6a — the attributes the auto-allocated points land on: the ones the character is already best
 * at, ties broken by canonical attribute order.
 *
 * "Along the character's affinities" is read off the *visible* sheet, not off the hidden role
 * template that shaped the original roll (§B8a). That is not a convenience: an auto-allocation
 * that tracked the hidden affinity would publish it one point at a time, since a player can watch
 * which attributes rise. Reading the sheet leaks nothing the player is not already looking at.
 */
export function autoAllocatedAttributes(attributes: Attributes): AttributeName[] {
  return [...ATTRIBUTE_NAMES]
    .sort(
      (a, b) =>
        attributes[b] - attributes[a] || ATTRIBUTE_NAMES.indexOf(a) - ATTRIBUTE_NAMES.indexOf(b),
    )
    .slice(0, CHARACTER_LEVEL_AUTO_POINTS);
}

/** Where a character sits on their own curve, plus the §H6 points still waiting on the player. */
export interface CharacterProgress {
  level: number;
  xpIntoLevel: number;
  unspentPoints: number;
  attributes: Attributes;
}

export interface CharacterAdvance extends CharacterProgress {
  /** 0 when the XP did not clear the threshold; >1 when one award crossed several levels. */
  levelsGained: number;
}

/**
 * Adds character XP and applies every level-up it pays for (§H6). Pure — the caller persists it.
 *
 * Each level immediately spends its 3 auto points on the sheet and banks the 2 player points, so a
 * character who levels twice while nobody is looking is holding 4 assignable points, not 2.
 */
export function applyCharacterXp(current: CharacterProgress, xp: number): CharacterAdvance {
  const gained = Math.max(0, Math.trunc(xp));
  let level = Math.max(CHARACTER_LEVEL_MIN, Math.trunc(current.level));
  let xpIntoLevel = Math.max(0, Math.trunc(current.xpIntoLevel)) + gained;
  let unspentPoints = Math.max(0, Math.trunc(current.unspentPoints));
  let attributes = { ...current.attributes };

  let levelsGained = 0;
  for (let threshold = characterXpToNextLevel(level); xpIntoLevel >= threshold;) {
    xpIntoLevel -= threshold;
    level += 1;
    levelsGained += 1;
    unspentPoints += CHARACTER_LEVEL_PLAYER_POINTS;
    for (const name of autoAllocatedAttributes(attributes)) {
      attributes = { ...attributes, [name]: clampAttribute(attributes[name] + 1) };
    }
    threshold = characterXpToNextLevel(level);
  }

  return { level, xpIntoLevel, unspentPoints, attributes, levelsGained };
}

/**
 * §H6 — spend one of the player-assigned points on `attribute`.
 *
 * Returns `null` when there is nothing to spend, so the caller decides whether that is a 400 or a
 * no-op rather than this module throwing on a read path.
 */
export function spendCharacterPoint(
  current: CharacterProgress,
  attribute: AttributeName,
): CharacterProgress | null {
  if (current.unspentPoints <= 0) return null;
  return {
    ...current,
    unspentPoints: current.unspentPoints - 1,
    attributes: {
      ...current.attributes,
      [attribute]: clampAttribute(current.attributes[attribute] + 1),
    },
  };
}

/**
 * INTERFACES §2 R2 — where character XP comes from.
 *
 * The GDD never says. §I1 lists XP sources for the *player*; §H6 says characters "evolve slowly"
 * and stops. The CTO's reading, provisional and flagged to the board alongside §H6a:
 *
 * > A character earns XP from the missions and internal processes **they are assigned to**
 * > (§E, §G6) — the only per-character activity the GDD defines.
 *
 * This function is the whole of that reading, so a board correction is a one-line change here.
 *
 * Both halves of the reading are live, and both pay through `awardCharacterXp` — the mirror of the
 * player-XP award INTERFACES R7 describes:
 *
 *   * **Missions** (§E) — the officer on `Mission.officerId` is paid for the run's total minutes.
 *   * **Internal processes** (§G6) — a research investigation names a `leadOfficerId` and runs on a
 *     clock, so its lead is paid for the project's duration.
 *
 * Nothing else in the game assigns a *named character* to a timed job. Assignees deliberately do
 * not pay: §G1 makes them a fungible pool with no individual identity, so there is no one to
 * credit. A training project does not pay either — it develops the Overseer, who carries no
 * character level of their own.
 */
export function characterXpForActivity(minutesEngaged: number): number {
  return Math.max(0, Math.trunc(minutesEngaged));
}
