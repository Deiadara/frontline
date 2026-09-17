import {
  MODIFICATION_RARITIES,
  MODIFICATION_RARITY_LABELS,
  ModificationRaritySchema,
  type ModificationRarity,
} from '../modification-rarity.js';

/**
 * How good a thing a crew can hold is, on the one ladder the whole game grades on.
 *
 * It is the modification ladder (maintainer request, 2026-09-16): a component, a blueprint page, a
 * document, a consumable and a bench card are all graded basic to masterpiece, in the same four
 * words and the same four colours. The game used to run two vocabularies, common to exotic for
 * loot and basic to masterpiece for engineering, which meant a player learned purple twice and the
 * client carried two colour tables that had already drifted apart.
 *
 * These are aliases rather than a second enum. One list means the two halves cannot drift, and
 * keeping the item-side names lets every call site that already reads `ItemRarity` keep reading it.
 *
 * The module still imports nothing heavier than `modification-rarity.ts`, which imports nothing but
 * zod. That matters: `items/catalog.ts` reads `blueprints/catalog.ts` to turn every page into an
 * item, so a rarity declared in the first and read by the second would close the loop at
 * module-load time.
 */
export const ITEM_RARITIES = MODIFICATION_RARITIES;
export const ItemRaritySchema = ModificationRaritySchema;
export type ItemRarity = ModificationRarity;
export const ITEM_RARITY_LABELS = MODIFICATION_RARITY_LABELS;

/** Rarest last, so "one step up" and "one step down" are a single index shift. */
export const RARITY_ORDER: Readonly<Record<ItemRarity, number>> = Object.fromEntries(
  ITEM_RARITIES.map((rarity, index) => [rarity, index]),
) as Record<ItemRarity, number>;
