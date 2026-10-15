import type { PartialResources } from '../resources.js';
import { ITEM_CATALOG, type ItemId } from './catalog.js';
import type { ItemRarity } from './rarity.js';

/**
 * Breaking a component down at the Scrapyard (maintainer, 2026-10-09): one part in, HQ metal and
 * scrap out, by the part's rarity.
 *
 * Sized a little under what a part of that rarity is worth (`capsValue`, read at the market's own
 * rates: 12 caps an HQ metal, 2.5 a scrap): a basic part averages about 105 caps and pays back 98,
 * an intricate 320 against 318, an advanced 825 against 830, a masterpiece 2,250 against 2,220. A
 * part is worth breaking down when nothing on the bench wants it, and never a way to print metal.
 */
export const COMPONENT_BREAKDOWN: Readonly<Record<ItemRarity, PartialResources>> = {
  basic: { highQualityMetal: 4, scrap: 20 },
  intricate: { highQualityMetal: 15, scrap: 55 },
  advanced: { highQualityMetal: 40, scrap: 140 },
  masterpiece: { highQualityMetal: 110, scrap: 360 },
};

/** What one of this item breaks down into, or null for anything that is not a component. */
export function breakdownYield(itemId: string): PartialResources | null {
  const spec = ITEM_CATALOG[itemId as ItemId];
  if (!spec || spec.kind !== 'component') return null;
  return COMPONENT_BREAKDOWN[spec.rarity];
}
