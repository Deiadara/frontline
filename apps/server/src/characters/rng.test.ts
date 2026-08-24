import { ATTRIBUTE_NAMES } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { createRng, sample, weightedSample } from './rng.js';

/**
 * A non-positive count means "draw nothing". Both helpers end in a `slice`, and a negative count
 * slices from the *end* of the pool instead, so without a guard they hand back a near-full draw
 * exactly when the caller asked for none. `pickStrengths` keeps its argument positive today, but
 * it computes it as `count - outside`, so widening the off-template band makes this reachable.
 */
describe.each([
  ['sample', (rng: () => number, count: number) => sample(rng, ATTRIBUTE_NAMES, count)],
  [
    'weightedSample',
    (rng: () => number, count: number) =>
      weightedSample(
        rng,
        ATTRIBUTE_NAMES.map((name) => [name, 1] as const),
        count,
      ),
  ],
])('%s', (_name, draw) => {
  it.each([0, -1, -5])('draws nothing on a count of %i', (count) => {
    expect(draw(createRng(7), count)).toEqual([]);
  });

  it('still draws a positive count', () => {
    expect(draw(createRng(7), 3)).toHaveLength(3);
  });
});
