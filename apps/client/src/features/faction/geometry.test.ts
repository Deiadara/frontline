import { describe, expect, it } from 'vitest';
import { seatTicks } from './geometry';

/**
 * The arc a dial fills, which is the one thing on the faction screen that is arithmetic.
 *
 * A sweep or large-arc flag taken from the wrong comparison draws a plausible arc of the wrong
 * length, and there is no screenshot on which that looks broken: a seat dial reading three fifths
 * when one seat of five is filled is just a picture of a number nobody checks.
 */

/** Every number in a path, in order: `M x y A r r 0 large sweep x y`. */
const numbers = (path: string): number[] =>
  path
    .split(/[MAL\s]+/)
    .filter((part) => part !== '')
    .map(Number);

describe('the ticks round a counted reading', () => {
  it('draws one per thing counted, and nothing for a countless one', () => {
    expect(seatTicks(5, 46, 8)).toHaveLength(5);
    expect(seatTicks(0, 46, 8)).toEqual([]);
  });

  it('points each tick at the centre', () => {
    const [first] = seatTicks(4, 46, 8);
    const [outerX, outerY, innerX, innerY] = numbers(first ?? '');
    expect(outerX).toBeCloseTo(50, 6);
    expect(outerY).toBeCloseTo(4, 6);
    expect(innerX).toBeCloseTo(50, 6);
    // Eight units further in, which is what makes it a tick rather than a spoke.
    expect(innerY).toBeCloseTo(12, 6);
  });
});
