import { z } from 'zod';

/**
 * How good a modification card is, in four words.
 *
 * One vocabulary for both catalogues: a building card in `building/modifications.ts` and a unit
 * card in `units/modifications.ts` are sold from the same Scrapyard bench and the maintainer wants
 * them read the same way ("the building modifications work exactly the same as the unit ones, only
 * they go in buildings"). It lives in a module of its own because the two catalogues cannot share
 * it any other way: `units/` already imports `building/`, so the building catalogue importing the
 * unit one would close a cycle at module load.
 *
 * Not the item ladder. `items/rarity.ts` grades loot and blueprint pages on common to exotic; this
 * grades a piece of engineering, and the two never appear on the same card.
 *
 * Ordered worst to best, and that order is the ordering: `indexOf` is the comparison, so a new
 * band goes in at its place in the line rather than into a separate table of ranks that could
 * disagree with this one.
 */
export const MODIFICATION_RARITIES = ['basic', 'intricate', 'advanced', 'masterpiece'] as const;
export const ModificationRaritySchema = z.enum(MODIFICATION_RARITIES);
export type ModificationRarity = z.infer<typeof ModificationRaritySchema>;

/** Shouted, because that is how the maintainer wants them on the card. */
export const MODIFICATION_RARITY_LABELS: Readonly<Record<ModificationRarity, string>> = {
  basic: 'BASIC',
  intricate: 'INTRICATE',
  advanced: 'ADVANCED',
  masterpiece: 'MASTERPIECE',
};
