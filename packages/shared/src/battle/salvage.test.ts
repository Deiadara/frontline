import { describe, expect, it } from 'vitest';
import { SALVAGE_REFUND_CEILING, SALVAGE_REFUND_KNEE, salvageRefundCut } from './salvage.js';

describe('the salvage refund curve (maintainer, 2026-10-05)', () => {
  it('pays face value to the knee and nothing below zero', () => {
    expect(salvageRefundCut(-10)).toBe(0);
    expect(salvageRefundCut(0)).toBe(0);
    expect(salvageRefundCut(12)).toBe(12);
    expect(salvageRefundCut(SALVAGE_REFUND_KNEE)).toBe(SALVAGE_REFUND_KNEE);
  });

  it('keeps rising past the knee and never reaches what was spent', () => {
    let last = salvageRefundCut(SALVAGE_REFUND_KNEE);
    for (let points = SALVAGE_REFUND_KNEE + 1; points <= 400; points += 1) {
      const cut = salvageRefundCut(points);
      expect(cut, String(points)).toBeGreaterThan(last);
      expect(cut, String(points)).toBeLessThan(SALVAGE_REFUND_CEILING);
      last = cut;
    }
    // Both markets at level 10 and both rungs: 155 points, about 94% back.
    expect(salvageRefundCut(155)).toBeCloseTo(93.9, 1);
  });
});
