/**
 * Collective: what massing one sheet is worth (`UnitSpec.pack`).
 *
 * Its own leaf module, and the reason is the same one `units/rules.ts` and `battle/line.ts` give
 * for being leaves: an import cycle. The rule has two readings now, a fighter's and a carrier's,
 * and they live at opposite ends of the package. `battle/engine.ts` spends it on offense and
 * `raid.ts` spends it on carry, so the curve cannot live in either without the other importing a
 * module that already imports it.
 *
 * This file imports nothing at all, so anybody may read it.
 */

/**
 * What massing one sheet approaches, in percentage points.
 *
 * An **asymptote**, not a cap: {@link packBonusPercent} is a curve that climbs towards this and
 * never arrives. That is the difference between this constant and the hard ceiling it replaced,
 * and it is worth being precise about, because the two behave identically right up to the point
 * where they do not. A cap is a number the bonus *reaches*, after which the next unit is worth
 * nothing at all; this is a number it gets nearer to, so the next unit is always worth something
 * and never worth much.
 *
 * Twenty-eight, which is under the biggest context modifier in the table (`tracking`, 45) and
 * near the old cap of 25. In the range anybody actually fields it is a little *weaker* than the
 * straight line was: 20 units were worth 11.4 points and are worth 15.2, and 42 units were worth
 * the full 25 and are worth 20.1.
 */
export const MAX_PACK_BONUS = 28;

/**
 * How many other units of the same sheet buy half the asymptote.
 *
 * The one knob that sets how fast the curve bends. Sixteen puts the half-way point at seventeen
 * units, which is about where massing one sheet stops being a squad and starts being a plan, and
 * keeps the first few units feeling worth adding: five of them are 5.6 points where the straight
 * line paid 2.4.
 */
export const PACK_HALF = 16;

/**
 * What massing this many units of one Collective sheet is worth, in percentage points.
 *
 * In the *other* units, so one on its own is worth nothing at all: the rule is about having more
 * than one of something.
 *
 * ## Diminishing, and deliberately not said out loud
 *
 * A straight line with a cap on it (0.6 a unit, stopping at 25) has two problems and they are
 * opposite ones. Under the cap, the fiftieth unit is worth exactly as much as the fifth, so the
 * rule rewards a number rather than a decision; over it, the forty-third is worth nothing at
 * all, so there is a cliff a player cannot see and will walk off.
 *
 * This is a hyperbola: `A(n-1) / ((n-1) + K)`. Every extra body is worth something, each is
 * worth less than the one before it, and the whole thing converges on {@link MAX_PACK_BONUS}
 * without ever touching it. Going from four to five is worth 1.2 points; going from forty-nine
 * to fifty is worth 0.12, which is the ten-to-one the maintainer asked for.
 *
 * The card says none of this. `UNIT_RULES.pack` is one sentence about being worth more in
 * numbers, which is what the mechanic feels like from the inside; a player who wants the curve
 * can find it by counting, and one who does not is not being asked to read an equation to use a
 * unit.
 *
 * ## One curve, two readings
 *
 * A fighter spends it on offense (`battle/engine.ts`) and a carrier on how much it can lift
 * (`raid.ts`, `carriedBy`). Same numbers on purpose: massing a sheet should feel like one idea
 * wherever it turns up, and a second set of constants for the carriers would be two things to
 * retune and one of them would be forgotten.
 */
export function packBonusPercent(units: number): number {
  const others = Math.max(0, units - 1);
  return (MAX_PACK_BONUS * others) / (others + PACK_HALF);
}
