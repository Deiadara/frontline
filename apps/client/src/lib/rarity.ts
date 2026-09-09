import type { ItemRarity } from '@frontline/shared';

/**
 * What a rarity looks like.
 *
 * The market has carried these four colours on its lot cards since the barrow shipped, and the
 * Blueprints screen now wants the same four on its documents and page rows: a player who has
 * learned that iris means rare on a shelf label should not have to learn it again on a page.
 *
 * `MarketPage.tsx` still holds its own copy of the border-and-ink map. That file is another lane's
 * today, so folding it into this one is their edit rather than a change made underneath them; the
 * values here are that map, so the two agree until somebody does.
 */
export const RARITY_TONE: Readonly<Record<ItemRarity, string>> = {
  common: 'border-surface-600 text-ink-200',
  uncommon: 'border-verdigris-300/60 text-verdigris-100',
  rare: 'border-iris-300/60 text-iris-100',
  exotic: 'border-brass-300/70 text-brass-300',
};

/**
 * The ink only, for a glyph.
 *
 * A glyph is drawn in `currentColor` and has no border of its own, so it takes the colour half and
 * leaves the edge to whatever tile it sits in. The market's exotic tone also carries `shadow-brass`
 * and this one does not: a glow is right on one card and wrong on eight page rows in a column.
 */
export const RARITY_INK: Readonly<Record<ItemRarity, string>> = {
  common: 'text-ink-200',
  uncommon: 'text-verdigris-100',
  rare: 'text-iris-100',
  exotic: 'text-brass-300',
};
