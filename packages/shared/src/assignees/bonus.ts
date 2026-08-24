/**
 * The §G7 assignee bonus table: the core of the assignee layer (GDD §G5, §G7).
 *
 * This is a **verbatim lookup table**, not a fitted curve, and it must stay one. The board's
 * figures are not monotonically diminishing: the step at n=6 is +5.5 after three +4.5 steps, and
 * the step at n=12 is +5.0 after a +2.0. Any formula smooth enough to be worth writing would
 * "correct" those two bumps and quietly ship different numbers than the board asked for. Constants
 * are cheap to change if the board revises them; a curve is not.
 *
 * ## Rows 13-24 are an extension, not the board's figures
 *
 * §G7 as written stops at "12 assignees at 50% is the maximum", but §G3a caps placement at
 * `max(1, floor(level / 2))` **with no ceiling**, and there is no maximum player level, so the
 * formula passes 12 at level 24 and keeps going forever. Something had to give: either placement
 * stops at 12 and every later grant is dead weight, or the table continues. The board asked for
 * the table to continue.
 *
 * The extension keeps the board's own rhythm rather than inventing a new one:
 *
 *   * **Blocks of six**, each worth less than the last: the board's own blocks are +29 (1-6) and
 *     +21 (7-12), so the extension continues +15 (13-18) and +10 (19-24).
 *   * **A bump on the block boundary**, because the board put one at 6 (+5.5) and 12 (+5.0). The
 *     extension puts one at 18 (+3.5) and 24 (+2.0).
 *   * **Half-point granularity**, because every figure the board wrote is a multiple of 0.5.
 *
 * Milestones therefore read 6→29 · 12→50 · 18→65 · 24→75. The ceiling stays well under 100 on
 * purpose: `assigneeSpeedMultiplier` is `1 - bonus`, so a 100% bonus would make work take no time
 * at all, and the gap is what keeps that unreachable rather than merely unreached.
 *
 * Rows 1-12 are the board's and must not be edited to smooth the join.
 */

/**
 * §G7: bonus percent by assignee count, indexed by `count - 1`.
 *
 * Board:     1→5 · 2→10 · 3→14.5 · 4→19 · 5→23.5 · 6→29 · 7→33 · 8→37 · 9→40 · 10→43 · 11→45 · 12→50
 * Extension: 13→53 · 14→56 · 15→58 · 16→60 · 17→61.5 · 18→65 · 19→67 · 20→69 · 21→70.5 · 22→72 ·
 *            23→73 · 24→75
 */
export const ASSIGNEE_BONUS_PERCENT: readonly number[] = [
  // The board's twelve (§G7, verbatim).
  5, 10, 14.5, 19, 23.5, 29, 33, 37, 40, 43, 45, 50,
  // The extension: see the note above before changing any of these.
  53, 56, 58, 60, 61.5, 65, 67, 69, 70.5, 72, 73, 75,
];

/**
 * Where the table ends, and with it the benefit of one more body.
 *
 * This is also the placement cap: `assigneeCapPerOfficer` reads it, so extending the table above
 * is the single edit that lets players place more. A 25th assignee would be worth exactly 0%, which
 * is the reason to stop them standing there at all.
 */
export const MAX_ASSIGNEES_PER_OFFICER = ASSIGNEE_BONUS_PERCENT.length;

/** The value the table saturates at, named so callers can state the ceiling without indexing. */
export const MAX_ASSIGNEE_BONUS_PERCENT =
  ASSIGNEE_BONUS_PERCENT[MAX_ASSIGNEES_PER_OFFICER - 1] ?? 0;

/**
 * The §G7 bonus for `count` assignees, as a percentage.
 *
 * Clamped at both ends rather than throwing: this sits on a read path that renders a number next
 * to every officer, and a stored placement that somehow drifted out of range must not take the
 * page down with it. Past the end of the table the marginal assignee is worth exactly zero, and
 * `assigneeCapPerOfficer` in `./placement.js` is what stops a player parking one there in the
 * first place.
 */
export function assigneeBonusPercent(count: number): number {
  const placed = Math.min(Math.trunc(count), MAX_ASSIGNEES_PER_OFFICER);
  if (placed < 1) return 0;
  return ASSIGNEE_BONUS_PERCENT[placed - 1] ?? 0;
}

/** The same bonus as a 0..0.5 fraction: what the two multipliers below are built from. */
export function assigneeBonus(count: number): number {
  return assigneeBonusPercent(count) / 100;
}

/**
 * §G5/§G7 time reduction: the fraction of the original clock the work now takes.
 *
 * 12 assignees take 50% of the time. This is deliberately the *same* bonus the power multiplier
 * reads: §G7 says the table applies to both, so there is one table and one lookup, not two that
 * can drift.
 */
export function assigneeSpeedMultiplier(count: number): number {
  return 1 - assigneeBonus(count);
}

/** §G5/§G7 power: 12 assignees make the officer's work 50% stronger. */
export function assigneePowerMultiplier(count: number): number {
  return 1 + assigneeBonus(count);
}

/**
 * A duration in whole minutes after the §G5 reduction, floored at one minute.
 *
 * Rounds rather than truncates so a 3-minute scrap run with one assignee comes back at 3 rather
 * than 2, and never returns zero: a mission that takes no time at all would resolve inside its
 * own launch request.
 */
export function assigneeReducedMinutes(minutes: number, count: number): number {
  return Math.max(1, Math.round(minutes * assigneeSpeedMultiplier(count)));
}
