import { describe, expect, it } from 'vitest';
import { STARTING_RESOURCES } from '../resources.js';
import { storageCapacityFor } from './production.js';
import { creditStores, describeWaste, storeCeilings, wasteWarning } from './stores.js';
import type { Building } from './state.js';

const DISTRICT: Building[] = [
  { id: 'b-apothecary', kind: 'apothecary', level: 3, modifications: [] },
];

describe('the stores are a hard ceiling (maintainer ruling, 2026-09-28)', () => {
  const ceilings = storeCeilings(DISTRICT);

  it('reads every ceiling off the same shelf the stockpile panel draws', () => {
    expect(ceilings.scrap).toBe(storageCapacityFor(DISTRICT, 'scrap'));
    expect(ceilings.highQualityMetal).toBe(storageCapacityFor(DISTRICT, 'highQualityMetal'));
    expect(ceilings.caps).toBe(Number.POSITIVE_INFINITY);
    // The crew's storage bonus widens it, as it widens the production clamp.
    expect(storeCeilings(DISTRICT, 50).scrap).toBeGreaterThan(ceilings.scrap);
  });

  it('lands what fits and throws the rest away', () => {
    const stock = { ...STARTING_RESOURCES, scrap: ceilings.scrap - 30 };
    const credit = creditStores(stock, { scrap: 100, oil: 5 }, ceilings);
    expect(credit.resources.scrap).toBe(ceilings.scrap);
    expect(credit.resources.oil).toBe(stock.oil + 5);
    expect(credit.landed).toEqual({ scrap: 30, oil: 5 });
    expect(credit.wasted).toEqual({ scrap: 70 });
  });

  it('wastes nothing when everything fits, and never caps the caps', () => {
    const credit = creditStores(STARTING_RESOURCES, { caps: 10_000_000, scrap: 1 }, ceilings);
    expect(credit.wasted).toBeUndefined();
    expect(credit.resources.caps).toBe(STARTING_RESOURCES.caps + 10_000_000);
  });

  it('leaves a store that is already over its ceiling where it is', () => {
    const stock = { ...STARTING_RESOURCES, scrap: ceilings.scrap + 500 };
    const credit = creditStores(stock, { scrap: 40 }, ceilings);
    expect(credit.resources.scrap).toBe(ceilings.scrap + 500);
    expect(credit.landed).toEqual({});
    expect(credit.wasted).toEqual({ scrap: 40 });
  });

  it('names the loss in one sentence', () => {
    expect(describeWaste({ scrap: 1200 })).toBe('1,200 Scrap');
    expect(describeWaste({ scrap: 120, oil: 40, planks: 3 })).toBe(
      '40 Oil, 120 Scrap and 3 Planks',
    );
    expect(wasteWarning({ scrap: 120 })).toBe(
      'This would put you over your storage: 120 Scrap would go to waste',
    );
  });
});
