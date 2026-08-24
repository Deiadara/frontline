/**
 * The luck a side draws on the day (GDD §A5).
 *
 * Drawn **after both forces are committed**, which is the whole point of it: it cannot be planned
 * around, only survived. Grepolis rolls its luck the same way and for the same reason: a fight
 * whose every input is known before you commit is a spreadsheet, and one where luck is drawn first
 * would let a player wait for a good roll.
 *
 * Deliberately small. At ±5% it is the difference between a close fight and a slightly closer one;
 * it is never the difference between a good plan and a bad one. A luck roll big enough to overturn
 * a considered attack teaches a player that considering is pointless.
 *
 * It touches two things and nothing else:
 *
 * - **Critical strikes.** Added as percentage points to a unit's own `lethality`, not multiplied
 *   into it. Multiplying makes luck worth almost nothing to the units that need it most: a Razor
 *   at 8% lethality would gain 0.4 points from a perfect roll, while percentage points move the
 *   rabble meaningfully and the assassins barely at all, which is the right way round.
 * - **Getting away.** The same points on the flee roll, so a lucky crew that loses still brings
 *   more of itself home. Luck cannot save a fight; it can save the people in one.
 */

/** The furthest luck reaches in either direction, in percentage points. */
export const LUCK_LIMIT = 5;

/** ...and the granularity. One decimal, so a report can print it without rounding away the roll. */
export const LUCK_STEP = 0.1;

/** How many distinct values there are: −5.0 … +5.0 inclusive. */
export const LUCK_VALUES = Math.round((LUCK_LIMIT * 2) / LUCK_STEP) + 1;

/**
 * One draw, quantised to {@link LUCK_STEP}.
 *
 * Rounded through integers rather than by `toFixed`, because `Math.round(x * 10) / 10` on a float
 * is the one form that cannot land on 4.999999999999999 and print as 5.0 while comparing as less.
 */
export function drawLuck(next: () => number): number {
  const step = Math.floor(next() * LUCK_VALUES);
  const clamped = Math.min(LUCK_VALUES - 1, Math.max(0, step));
  return Math.round((-LUCK_LIMIT + clamped * LUCK_STEP) * 10) / 10;
}

/** Percentage points of critical-strike chance a roll of `luck` is worth. */
export function luckyCritPercent(luck: number): number {
  return clampLuck(luck);
}

/** ...and of flee chance, as a fraction, for `rout.ts`. */
export function luckyFleeChance(luck: number): number {
  return clampLuck(luck) / 100;
}

function clampLuck(luck: number): number {
  return Math.min(LUCK_LIMIT, Math.max(-LUCK_LIMIT, luck));
}

/** The roll as a player reads it: `+2.4%`, `-0.7%`, `even`. */
export function describeLuck(luck: number): string {
  if (luck === 0) return 'even';
  return `${luck > 0 ? '+' : ''}${luck.toFixed(1)}%`;
}
