import { CHANNEL_LABELS, MAX_WAGE_DISCOUNT, TRAVEL_SPEED_CEILING } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { channelFigure } from './channelFigure';

/**
 * The reviewer's late crew (maintainer ruling P7-A, 2026-10-02): every rung, top rank, best
 * sheets. The cards printed the raw sums, "+87%" of muster speed and "+153%" off the research
 * clock, which no clock or price ever takes.
 */
describe('what a crew card prints', () => {
  it('prints the joined channels as points, not as a share of a clock', () => {
    for (const channel of [
      'researchSpeedPercent',
      'buildSpeedPercent',
      'buildCostPercent',
    ] as const) {
      expect(CHANNEL_LABELS[channel].unit, channel).toBe('flat');
      expect(CHANNEL_LABELS[channel].label, channel).toMatch(/^Points off /);
      expect(channelFigure(channel, 153)).toBe(153);
    }
  });

  it('prints what the curve gives on muster speed and on numbers', () => {
    expect(channelFigure('musterSpeedPercent', 40)).toBe(40);
    expect(channelFigure('musterSpeedPercent', 87)).toBeLessThan(80);
    expect(channelFigure('musterSpeedPercent', 87)).toBeGreaterThan(70);
    expect(channelFigure('cohesionPercent', 99)).toBeLessThan(65);
  });

  it('bends the road under its ceiling and stops the wage at the contract', () => {
    expect(channelFigure('travelSpeedPercent', 63)).toBeLessThan(63);
    expect(channelFigure('travelSpeedPercent', 500)).toBeLessThan(TRAVEL_SPEED_CEILING);
    expect(channelFigure('travelSpeedPercent', 20)).toBe(20);
    expect(channelFigure('wageDiscountPercent', 119)).toBe(MAX_WAGE_DISCOUNT);
  });
});
