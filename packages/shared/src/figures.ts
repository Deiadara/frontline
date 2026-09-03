/**
 * How a number is written where the space for it is fixed.
 *
 * The standing bar is a row of instruments, and an instrument's width is a property of the
 * instrument rather than of its reading: a figure that grows with its value pushes everything to
 * its right along, and at seven digits it shoved the identity plaque off the line entirely. The
 * fix has two halves and this is the second one. The first is a reserved column; this is the
 * promise that the reading fits in it.
 *
 * Six digits are written out in full, because that is the range the game actually plays in and a
 * player counting caps wants the caps. Above that the figure goes to millions with up to two
 * decimals, so `1M`, `1.1M` and `1.23M` rather than a number that needs a wider box or, worse, an
 * ellipsis. The widest string either branch can produce is seven characters (`999,999` and
 * `999.99M`), which is exactly what the columns in `Resources` and `Meters` reserve.
 *
 * Trailing zeros are trimmed on purpose: `1M` reads as a round number and `1.00M` reads as a
 * measurement that happens to be round, and the first is the truth.
 */

/** Above this, a figure is written in millions rather than in full. */
export const FIGURE_FULL_CEILING = 1_000_000;

/** The most characters {@link compactFigure} can return, which is what a column must reserve. */
export const FIGURE_MAX_CHARS = 7;

/**
 * The mantissa, at as many decimals as the width can afford.
 *
 * Two decimals below ten, one below a hundred, none above: the point of the whole function is that
 * the string fits a fixed column, so precision is what gives when the integer part grows. Written
 * as a rule rather than as a constant `2`, because a flat two decimals produces `1234.56B` at a
 * trillion, which is eight characters in a box measured for seven. The sweep in `figures.test.ts`
 * found that; it was not reasoned out in advance.
 */
function scaled(value: number, suffix: string): string {
  const magnitude = Math.abs(value);
  const decimals = magnitude < 10 ? 2 : magnitude < 100 ? 1 : 0;
  const fixed = value.toFixed(decimals);
  /*
   * Trailing zeros taken off the *fraction* only: `1.20M` is `1.2M` and `1.00M` is `1M`.
   *
   * The guard is the whole point. Trimming `/\.?0+$/` unconditionally also eats the zeros off a
   * whole number, because above a mantissa of a hundred there is no decimal point to protect them:
   * `100` became `1` and `250` became `25`, so a hundred million rendered as `1M` and a quarter of
   * a billion as `25M`. A readout that is wrong by two orders of magnitude is worse than one that
   * is too wide, which is the failure this function was written to avoid.
   */
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return `${trimmed}${suffix}`;
}

/**
 * A figure for a fixed-width readout.
 *
 * Rounded to a whole number first, so a fractional stockpile (production settles in fractions) does
 * not print a decimal in the full-number branch.
 */
export function compactFigure(value: number): string {
  const whole = Math.round(value);
  const magnitude = Math.abs(whole);
  if (magnitude < FIGURE_FULL_CEILING) return whole.toLocaleString('en-US');
  // Each unit carries three orders of magnitude, so the mantissa never has to grow past four
  // figures inside one of them.
  if (magnitude >= 1_000_000_000_000) return scaled(whole / 1_000_000_000_000, 'T');
  if (magnitude >= 1_000_000_000) return scaled(whole / 1_000_000_000, 'B');
  return scaled(whole / 1_000_000, 'M');
}
