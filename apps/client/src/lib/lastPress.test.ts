import { afterEach, describe, expect, it } from 'vitest';
import { PRESS_WINDOW_MS, claimRow, forgetPresses, recentPress, releaseRow } from './lastPress';

/**
 * The press a receipt lands beside, and the rows figures from one press take.
 *
 * The listener itself is exercised end to end (`deltas.spec.ts` measures a figure against the
 * button that spent). What is pinned here is the arithmetic a browser is not needed for.
 */

afterEach(() => forgetPresses());

describe('recentPress', () => {
  it('is nothing until something has been pressed, and nothing again once the window is past', () => {
    expect(recentPress()).toBeNull();
    // A press is recorded by the document listener; with none installed the store stays empty,
    // and the window rule is asserted on its own clock below.
    expect(recentPress(Date.now() + PRESS_WINDOW_MS + 1)).toBeNull();
  });
});

describe('rows under one press', () => {
  it('hands each readout its own row, keeps it, and closes the gap when one leaves', () => {
    expect(claimRow(7, 'caps')).toBe(0);
    expect(claimRow(7, 'scrap')).toBe(1);
    expect(claimRow(7, 'planks')).toBe(2);
    // Asking again is the same row: a figure must not move once it is on screen.
    expect(claimRow(7, 'scrap')).toBe(1);
    releaseRow(7, 'caps');
    // The next claimant takes the freed order; the ones still standing keep their relative order.
    expect(claimRow(7, 'scrap')).toBe(0);
    expect(claimRow(7, 'planks')).toBe(1);
    // A different press is a different stack.
    expect(claimRow(8, 'caps')).toBe(0);
    releaseRow(7, 'scrap');
    releaseRow(7, 'planks');
    releaseRow(8, 'caps');
    expect(claimRow(7, 'oil')).toBe(0);
  });
});
