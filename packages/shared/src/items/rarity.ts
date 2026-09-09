import { z } from 'zod';

/**
 * How scarce a thing is, on one scale for everything a crew can hold.
 *
 * It lives in its own module because both halves of the catalogue need it and they sit on opposite
 * sides of an import edge. `items/catalog.ts` reads `blueprints/catalog.ts` to turn every page into
 * an item, so a rarity declared in the first and read by the second would close the loop at
 * module-load time. This file imports nothing but zod, which keeps it under both.
 */
export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'exotic'] as const;
export const ItemRaritySchema = z.enum(ITEM_RARITIES);
export type ItemRarity = z.infer<typeof ItemRaritySchema>;

export const ITEM_RARITY_LABELS: Readonly<Record<ItemRarity, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  exotic: 'Exotic',
};

/** Rarest last, so "one step up" and "one step down" are a single index shift. */
export const RARITY_ORDER: Readonly<Record<ItemRarity, number>> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  exotic: 3,
};
