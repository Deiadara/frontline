import {
  CHANNEL_LABELS,
  MAX_MUSTER_DISCOUNT,
  MAX_WAGE_DISCOUNT,
  TRAVEL_SPEED_CEILING,
} from '@frontline/shared';
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
    // Floored where `committedWage` floors it: a sum below nothing is no discount, not a markup.
    expect(channelFigure('wageDiscountPercent', -5)).toBe(0);
  });

  it('prints the defence figure the fight spends when the server sends it, else the raw sum', () => {
    // Gate included and tapered on the server (`heldDefensePercent`, maintainer 2026-10-13): a
    // crew at 60 raw with a level 20 Gate is spent as about 80, which the raw channel cannot say.
    expect(channelFigure('defensePercent', 60, { heldDefensePercent: 80.2 })).toBe(80.2);
    expect(channelFigure('defensePercent', 60)).toBe(60);
  });

  it('prints every medic point a win is recovered on when the server sends it', () => {
    // The people's 12 and a level 10 Infirmary's 40 (`medicPointsOf`, maintainer 2026-10-15).
    expect(channelFigure('casualtyRecoveryPercent', 12, { medicPoints: 52 })).toBe(52);
    expect(channelFigure('casualtyRecoveryPercent', 12)).toBe(12);
  });

  it('stops the muster cut at the floor price, as the bill does', () => {
    expect(channelFigure('musterCostPercent', 30)).toBe(30);
    expect(channelFigure('musterCostPercent', 70)).toBe(MAX_MUSTER_DISCOUNT);
    // A negative sum (a raid biting) is a cut of nothing, not a surcharge.
    expect(channelFigure('musterCostPercent', -10)).toBe(0);
  });
});
