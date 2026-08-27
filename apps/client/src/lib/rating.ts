/**
 * The one colour scale every 0-100 rating in the game is read on.
 *
 * A rating out of a hundred is the same kind of fact wherever it appears: an officer's Logic, a
 * unit's Penetration, a recruit's Charisma. They were drawn three different ways. The training
 * sheet coloured its bars by *which column they were in*, so a 90 and a 9 in the same group came
 * out the same red; `AttributeSheet` used the four `attributeTier` bands, which turn over at 14,
 * 28 and 60; and the roster's unit ratings were a flat cyan at every value. Three scales for one
 * quantity means a number learned on one screen is worthless on the next.
 *
 * Four bands, on the quarters, high is good:
 *
 * | rating   | reads as | colour           |
 * | -------- | -------- | ---------------- |
 * | 0 to 25  | poor     | oxblood (red)    |
 * | 25 to 50 | fair     | brass (amber)    |
 * | 50 to 75 | good     | bile (green)     |
 * | 75 to 100| great    | hextech (cyan)   |
 *
 * The boundaries are inclusive at the top of each band, so a flat 25 is poor and a flat 50 is fair:
 * a rating that has only just reached a quarter has not cleared it.
 *
 * ## What this is not for
 *
 * Only bars whose scale is a rating *out of a hundred where more is better*. Not progress bars: a
 * mission a tenth of the way home is not doing badly. Not the stockpile fills, where full is the
 * state worth warning about and this scale would say the opposite. Those keep their own colours,
 * and `ProgressBar`'s `tone` is how a caller asks for one.
 */

export const RATING_BANDS = ['poor', 'fair', 'good', 'great'] as const;
export type RatingBand = (typeof RATING_BANDS)[number];

/** Where each band ends. Read in order; anything above the last is `great`. */
export const RATING_BAND_CEILINGS: readonly { band: RatingBand; upTo: number }[] = [
  { band: 'poor', upTo: 25 },
  { band: 'fair', upTo: 50 },
  { band: 'good', upTo: 75 },
];

export function ratingBand(value: number): RatingBand {
  for (const { band, upTo } of RATING_BAND_CEILINGS) {
    if (value <= upTo) return band;
  }
  return 'great';
}

/** The pigment in the bar. */
export const RATING_FILL: Readonly<Record<RatingBand, string>> = {
  poor: 'bg-oxblood-300',
  fair: 'bg-brass-300',
  good: 'bg-bile-300',
  great: 'bg-hextech-300',
};

/**
 * And the figure beside it.
 *
 * A step lighter than the fill for the two darkest bands: `bile-300` and `hextech-300` are sized to
 * carry a 5px bar and go muddy at 12px of condensed type on this ground.
 */
export const RATING_TEXT: Readonly<Record<RatingBand, string>> = {
  poor: 'text-oxblood-300',
  fair: 'text-brass-300',
  good: 'text-bile-100',
  great: 'text-hextech-100',
};

/** How far along the hundred a rating sits, clamped, as a percentage for a bar's width. */
export function ratingPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
