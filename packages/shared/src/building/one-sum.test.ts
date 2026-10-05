import { describe, expect, it } from 'vitest';
import {
  BUILD_COST_CEILING,
  BUILD_TIME_CEILING,
  baseBuildSeconds,
  baseBuildingCost,
  buildCostCut,
  buildTimeCut,
  buildingBuildSeconds,
  buildingCost,
  generatorTimeDiscount,
} from './cost.js';
import { STORAGE_BASE, STORAGE_GROWTH, productionRates, storageCapacity } from './production.js';
import type { Building } from './state.js';

/**
 * A structure's percentage and the crew's on one sum, under one bound per channel (maintainer,
 * 2026-10-01: "make them add").
 *
 * Before this, the structures' cut was applied first and the crew's on what was left, so a card
 * was worth more to a crew that already had a big bonus, and on price and clock two ceilings
 * compounded. Each case is measured against the bare district and the bare crew, so the claim is
 * the sum itself rather than a figure typed twice.
 */

const at = (kind: Building['kind'], level: number, modifications: string[] = []): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications,
});

const NO_CREW = { productionPercent: 0, storageCapacityPercent: 0 };

describe('production', () => {
  it('adds a card to the crew rather than multiplying it', () => {
    const farm = [at('greenhouse', 20, ['greenhouse_insect_farm'])];
    const bare = productionRates([at('greenhouse', 20)], NO_CREW).supplies!;
    expect(bare).toBeCloseTo(384, 6);
    // Positive control: the card alone pays its 28%.
    expect(productionRates(farm, NO_CREW).supplies).toBeCloseTo(bare * 1.28, 6);
    // With a crew on +16 the two add to 44, where they used to come to x1.485.
    expect(productionRates(farm, { ...NO_CREW, productionPercent: 16 }).supplies).toBeCloseTo(
      bare * 1.44,
      6,
    );
  });
});

describe('storage', () => {
  const racked = [at('apothecary', 20, ['apothecary_deep_racking'])];
  const shelf = STORAGE_BASE * STORAGE_GROWTH ** 20;

  it('adds the crew to the cards rather than multiplying them', () => {
    expect(storageCapacity(racked)).toBe(Math.round(shelf * 1.26));
    expect(storageCapacity(racked, 20)).toBe(Math.round(shelf * 1.46));
  });

  it('never lets a crew penalty shrink what the cards hold', () => {
    expect(storageCapacity(racked, -50)).toBe(storageCapacity(racked));
  });
});

describe('a build bill', () => {
  const ledger = [at('nexus', 10, ['nexus_requisition_ledger'])];

  it('takes the cards and the crew off as one sum', () => {
    const list = baseBuildingCost('quarters', 10).caps!;
    // 10 points of cards and 15 of crew: one sum of 25 through the taper (24.5% off since the late
    // end was cut on 2026-10-04), where the compound came to 23.5%.
    expect(buildingCost('quarters', 10, ledger, 15).caps).toBe(
      Math.round(list * (1 - buildCostCut(25) / 100)),
    );
    expect(buildCostCut(25)).toBeCloseTo(24.5, 1);
    // Positive control: the crew's points alone, under the knee, come off at face value.
    expect(buildingCost('quarters', 10, [at('nexus', 10)], 15).caps).toBe(Math.round(list * 0.85));
  });

  it('tapers past the knee and never reaches its ceiling, so nothing is free', () => {
    expect(buildCostCut(20)).toBe(20);
    expect(buildCostCut(40)).toBeLessThan(40);
    // The deep late crew of the 2026-10-04 cut: 62 points of cards and 40 of its own, about 45%.
    expect(buildCostCut(102)).toBeCloseTo(44.9, 1);
    expect(buildCostCut(102)).toBeLessThan(buildCostCut(103));
    expect(buildCostCut(300)).toBeLessThan(BUILD_COST_CEILING);
    const bill = buildingCost('quarters', 1, ledger, 10_000);
    for (const amount of Object.values(bill)) expect(amount).toBeGreaterThanOrEqual(1);
  });
});

describe('a build clock', () => {
  const generator = [at('generator', 10, ['nexus_automated_protocols'])];

  it('adds the Generator, the cards and the crew into one sum', () => {
    const points = generatorTimeDiscount('quarters', generator) + 10 + 15;
    expect(points).toBe(50);
    expect(buildingBuildSeconds('quarters', 10, generator, 15)).toBe(
      Math.round(baseBuildSeconds('quarters', 10) * (1 - buildTimeCut(points) / 100)),
    );
    // Positive control: under the knee a point is a point, the crew's included.
    expect(buildingBuildSeconds('quarters', 10, [], 20)).toBe(
      Math.round(baseBuildSeconds('quarters', 10) * 0.8),
    );
  });

  it('tapers past the knee and never reaches its ceiling', () => {
    expect(buildTimeCut(30)).toBe(30);
    expect(buildTimeCut(120)).toBeLessThan(buildTimeCut(121));
    expect(buildTimeCut(300)).toBeLessThan(BUILD_TIME_CEILING);
  });
});
