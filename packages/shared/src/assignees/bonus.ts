/**
 * The §G7 assignee bonus table — the core of the assignee layer (GDD §G5, §G7).
 *
 * This is a **verbatim lookup table**, not a fitted curve, and it must stay one. The board's
 * figures are not monotonically diminishing: the step at n=6 is +5.5 after three +4.5 steps, and
 * the step at n=12 is +5.0 after a +2.0. Any formula smooth enough to be worth writing would
 * "correct" those two bumps and quietly ship different numbers than the board asked for. Twelve
 * constants are cheap to change if the board revises them; a curve is not.
 */

/**
 * §G7 — bonus percent by assignee count, indexed by `count - 1`.
 *
 * 1→5 · 2→10 · 3→14.5 · 4→19 · 5→23.5 · 6→29 · 7→33 · 8→37 · 9→40 · 10→43 · 11→45 · 12→50.
 */
export const ASSIGNEE_BONUS_PERCENT: readonly number[] = [
  5, 10, 14.5, 19, 23.5, 29, 33, 37, 40, 43, 45, 50,
];

/** §G7 — "12 assignees at 50% is the maximum". The table ends here and so does the benefit. */
export const MAX_ASSIGNEES_PER_OFFICER = ASSIGNEE_BONUS_PERCENT.length;

/** The value the table saturates at, named so callers can state the ceiling without indexing. */
export const MAX_ASSIGNEE_BONUS_PERCENT =
  ASSIGNEE_BONUS_PERCENT[MAX_ASSIGNEES_PER_OFFICER - 1] ?? 0;

/**
 * The §G7 bonus for `count` assignees, as a percentage.
 *
 * Clamped at both ends rather than throwing: this sits on a read path that renders a number next
 * to every officer, and a stored placement that somehow drifted out of range must not take the
 * page down with it. Above 12 the marginal assignee is worth exactly zero — that is the ceiling
 * §G7 states, and `assigneeCapPerOfficer` in `./placement.js` is what stops a player parking one
 * there in the first place.
 */
export function assigneeBonusPercent(count: number): number {
  const placed = Math.min(Math.trunc(count), MAX_ASSIGNEES_PER_OFFICER);
  if (placed < 1) return 0;
  return ASSIGNEE_BONUS_PERCENT[placed - 1] ?? 0;
}

/** The same bonus as a 0..0.5 fraction — what the two multipliers below are built from. */
export function assigneeBonus(count: number): number {
  return assigneeBonusPercent(count) / 100;
}

/**
 * §G5/§G7 time reduction: the fraction of the original clock the work now takes.
 *
 * 12 assignees take 50% of the time. This is deliberately the *same* bonus the power multiplier
 * reads — §G7 says the table applies to both, so there is one table and one lookup, not two that
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
 * than 2, and never returns zero — a mission that takes no time at all would resolve inside its
 * own launch request.
 */
export function assigneeReducedMinutes(minutes: number, count: number): number {
  return Math.max(1, Math.round(minutes * assigneeSpeedMultiplier(count)));
}
