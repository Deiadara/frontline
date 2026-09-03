/**
 * The width promise, checked as a width.
 *
 * Every case here exists because the box is fixed: the assertion that matters is not "this number
 * reads nicely" but "no reading is wider than the column reserves". So the sweep at the bottom is
 * the real test and the named cases are the readability.
 */
import { describe, expect, it } from 'vitest';
import { FIGURE_FULL_CEILING, FIGURE_MAX_CHARS, compactFigure } from './index.js';

describe('a figure in a fixed-width readout', () => {
  it('writes six digits and fewer out in full, with separators', () => {
    expect(compactFigure(0)).toBe('0');
    expect(compactFigure(600)).toBe('600');
    expect(compactFigure(36_710)).toBe('36,710');
    expect(compactFigure(999_999)).toBe('999,999');
  });

  it('goes to millions above that, to at most two decimals', () => {
    expect(compactFigure(1_000_000)).toBe('1M');
    expect(compactFigure(1_100_000)).toBe('1.1M');
    expect(compactFigure(1_234_000)).toBe('1.23M');
    expect(compactFigure(9_999_999)).toBe('10M');
  });

  it('trims trailing zeros, so a round number reads round', () => {
    expect(compactFigure(2_000_000)).toBe('2M');
    expect(compactFigure(2_500_000)).toBe('2.5M');
    expect(compactFigure(2_050_000)).toBe('2.05M');
  });

  it('goes to billions rather than printing a five-digit million', () => {
    expect(compactFigure(1_000_000_000)).toBe('1B');
    expect(compactFigure(2_340_000_000)).toBe('2.34B');
  });

  it('rounds a fractional stockpile rather than printing a decimal', () => {
    expect(compactFigure(36_710.4)).toBe('36,710');
    expect(compactFigure(36_710.6)).toBe('36,711');
  });

  /**
   * Every reading still means the number it was given.
   *
   * This is the assertion the file was missing, and its absence let a two-order-of-magnitude bug
   * through: the width sweep below walked over 100,000,000 and passed, because `1M` is a perfectly
   * good four characters. It was `100M` trimmed to `1M` by a regex that took the zeros off a whole
   * number, and 250,000,000 read as `25M`.
   *
   * So the property is a round trip rather than a list of expected strings: read the rendering back
   * as a number and it has to be the input, within the precision the rendering itself claims. That
   * holds for magnitudes nobody will author a case for, which is exactly where this went wrong.
   */
  it('reads back as the number it was given, at every magnitude', () => {
    const UNITS: Record<string, number> = { M: 1e6, B: 1e9, T: 1e12 };
    for (let power = 0; power <= 15; power += 1) {
      for (const factor of [1, 1.5, 2.5, 9.87, 1.004]) {
        const value = Math.round(10 ** power * factor);
        const written = compactFigure(value);
        const suffix = written.slice(-1);
        const read =
          suffix in UNITS
            ? Number(written.slice(0, -1)) * UNITS[suffix]!
            : Number(written.replace(/,/g, ''));

        expect(Number.isFinite(read), `${value} rendered unparseable as "${written}"`).toBe(true);
        // Within half a step of the precision the string itself carries: `1.23M` claims two
        // decimals of a million, so it may be up to 5,000 out and no more.
        const decimals = (written.match(/\.(\d+)/)?.[1] ?? '').length;
        const step = (suffix in UNITS ? UNITS[suffix]! : 1) / 10 ** decimals;
        expect(
          Math.abs(read - value),
          `${value} rendered as "${written}", which reads back as ${read}`,
        ).toBeLessThanOrEqual(step / 2 + 1);
      }
    }
  });

  /**
   * The promise the columns are measured against.
   *
   * Swept rather than sampled: the boundary cases are where a formatter gets wider than intended,
   * and `999,999` to `1M` is exactly such a boundary. A decade of magnitudes is cheap to check and
   * a regression here is a cut number in the standing bar.
   *
   * On its own this is not enough, and that is worth saying out loud: it is a check on the *shape*
   * of the string and it will pass any wrong number that happens to be short. The round trip above
   * is what checks the value.
   */
  it('never exceeds the width a column reserves for it', () => {
    const cases = [0, 1, 9, 10, 999, 1_000, FIGURE_FULL_CEILING - 1, FIGURE_FULL_CEILING];
    for (let power = 0; power <= 15; power += 1) {
      cases.push(10 ** power, 10 ** power - 1, Math.round(10 ** power * 1.23456));
    }
    for (const value of cases) {
      const written = compactFigure(value);
      expect(written.length, `${value} renders as "${written}"`).toBeLessThanOrEqual(
        FIGURE_MAX_CHARS,
      );
    }
  });
});
