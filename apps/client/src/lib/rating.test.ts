import { describe, expect, it } from 'vitest';
import { RATING_FILL, RATING_TEXT, ratingBand, ratingPercent } from './rating';

/**
 * The one scale every 0-100 rating in the game is drawn on.
 *
 * Three screens used to colour the same quantity three different ways, so the boundaries are the
 * thing worth pinning: they are a rule a player learns once and then reads everywhere, and a band
 * that moved by one would make a number mean something different on the screen it moved on.
 */
describe('the rating bands', () => {
  it('cuts on the quarters, inclusive at the top of each band', () => {
    // The boundaries themselves, which is where an off-by-one lives.
    expect(ratingBand(25)).toBe('poor');
    expect(ratingBand(26)).toBe('fair');
    expect(ratingBand(50)).toBe('fair');
    expect(ratingBand(51)).toBe('good');
    expect(ratingBand(75)).toBe('good');
    expect(ratingBand(76)).toBe('great');
  });

  it('reads the ends and anything outside them', () => {
    expect(ratingBand(0)).toBe('poor');
    expect(ratingBand(100)).toBe('great');
    // Nothing should hand it these, but a band is a lookup and a lookup must answer.
    expect(ratingBand(-5)).toBe('poor');
    expect(ratingBand(140)).toBe('great');
  });

  it('never skips a band across the whole scale', () => {
    // Walked rather than sampled: a table with a gap in it would leave one value with no colour,
    // and `ratingBand` returning `undefined` is a bar drawn with no class at all.
    const seen = new Set<string>();
    for (let value = 0; value <= 100; value += 1) {
      const band = ratingBand(value);
      expect(RATING_FILL[band], `no fill for ${value}`).toBeTruthy();
      expect(RATING_TEXT[band], `no ink for ${value}`).toBeTruthy();
      seen.add(band);
    }
    expect([...seen].sort()).toEqual(['fair', 'good', 'great', 'poor']);
  });

  it('is monotonic: a bigger rating never reads worse', () => {
    const order = { poor: 0, fair: 1, good: 2, great: 3 } as const;
    for (let value = 1; value <= 100; value += 1) {
      expect(
        order[ratingBand(value)],
        `${value} reads worse than ${value - 1}`,
      ).toBeGreaterThanOrEqual(order[ratingBand(value - 1)]);
    }
  });

  it('clamps a bar width to the track', () => {
    expect(ratingPercent(-10)).toBe(0);
    expect(ratingPercent(42)).toBe(42);
    expect(ratingPercent(180)).toBe(100);
  });

  /** Four bands, four distinct colours: two that matched would make one boundary invisible. */
  it('gives each band its own colour', () => {
    expect(new Set(Object.values(RATING_FILL)).size).toBe(4);
    expect(new Set(Object.values(RATING_TEXT)).size).toBe(4);
  });
});
