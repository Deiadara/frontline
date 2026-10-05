import { describe, expect, it } from 'vitest';
import { LOCATION_KINDS, MAX_LOCATION_LEVEL, upgradeCost } from '../city/locations.js';
import { BUILDING_PRICE_RISE, baseBuildingCost, buildCostCut, buildingCost } from './cost.js';
import { BUILDING_KINDS, levelCeilingFor } from './kinds.js';

/**
 * The Engineer's passive on a bill (maintainer, 2026-10-04): up to half off, applied after the
 * tapered discount rather than inside it, on a catalogue a tenth dearer than before.
 *
 * The cost doc promises that a deep late crew (62 points of cards, 40 of its own) with a perfect
 * Engineer pays about 30% of the old list. Measured here on every line of every structure at every
 * level, against `baseBuildingCost` with the rise taken back out, so a change to the knee, the
 * ceiling, the rise or the passive cap that moves the late price shows up as a number.
 */

describe('the Engineer on a build bill', () => {
  it('leaves a deep late crew paying about 30% of the old list, on every line', () => {
    const expected = BUILDING_PRICE_RISE * (1 - buildCostCut(102) / 100) * 0.5;
    expect(expected).toBeCloseTo(0.303, 3);
    let measured = 0;
    for (const kind of BUILDING_KINDS) {
      for (let level = 1; level <= levelCeilingFor(kind); level += 1) {
        const list = baseBuildingCost(kind, level);
        const paid = buildingCost(kind, level, [], 102, 50);
        for (const [key, amount] of Object.entries(list) as [string, number][]) {
          const charged = paid[key as keyof typeof paid]!;
          expect(charged, `${kind} ${level} ${key}`).toBeGreaterThanOrEqual(1);
          // Rounding moves a small line a long way in ratio terms; the claim is about real bills.
          if (amount < 100) continue;
          measured += 1;
          expect(charged / (amount / BUILDING_PRICE_RISE), `${kind} ${level} ${key}`).toBeCloseTo(
            expected,
            2,
          );
        }
      }
    }
    expect(measured, 'no line was big enough to measure').toBeGreaterThan(100);
  });

  it('stops at half however good the sheet, and never takes a line to nothing', () => {
    for (const kind of BUILDING_KINDS) {
      expect(buildingCost(kind, 3, [], 0, 500)).toEqual(buildingCost(kind, 3, [], 0, 50));
      expect(buildingCost(kind, 3, [], 0, -40)).toEqual(buildingCost(kind, 3, [], 0, 0));
    }
  });
});

describe('the Engineer on a location upgrade', () => {
  it('takes up to half off every line, stops there, and floors every line at one', () => {
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level < MAX_LOCATION_LEVEL; level += 1) {
        const list = upgradeCost(kind, level)!;
        const half = upgradeCost(kind, level, 50)!;
        expect(upgradeCost(kind, level, 1_000), `${kind} ${level}`).toEqual(half);
        for (const [key, amount] of Object.entries(list) as [string, number][]) {
          const cut = half[key as keyof typeof half]!;
          expect(cut, `${kind} ${level} ${key}`).toBeGreaterThanOrEqual(1);
          expect(cut, `${kind} ${level} ${key}`).toBeLessThanOrEqual(amount);
          if (amount >= 100) expect(cut / amount).toBeCloseTo(0.5, 2);
        }
      }
    }
  });
});
