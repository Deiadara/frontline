/**
 * The Scrapyard's door onto the one rarity table.
 *
 * The table and the tag moved to `lib/rarity.tsx` when the item ladder was folded into this one
 * (2026-09-16) and every screen that grades anything started reading the same four colours. This
 * re-export stays so the benches, the roster's brackets and the structure dialog keep the import
 * they have always had.
 */
export { RARITY_BRACKET, RARITY_TEXT, RarityTag } from '../../lib/rarity';
