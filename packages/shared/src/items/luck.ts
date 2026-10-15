import { ITEM_RARITIES, type ItemRarity } from './rarity.js';

/**
 * Luck on a drop (maintainer, 2026-10-15): the Joker's card at a faction's table.
 *
 * One function every page and component draw goes through: mission salvage and the Mayhem's
 * guaranteed parts, a run's page prize, the daily deliveries (the Scriptorium, the Chop Shop, the
 * Wagon Breakers, the Seized Goods Office, the Panel) and a feat's random pages. Luck does not add
 * drops and does not change which item of a rarity is drawn; it moves odds from each rarity to the
 * next one up.
 *
 * The rule, rarest first: each rarity but the top hands {@link LUCK_SHIFT_PER_POINT} of its weight
 * per point of luck to the next rarity up that the draw can give. Rarest first, so a share moved
 * up is not moved again in the same pass, and the total never changes. With the Scriptorium's
 * level 1 row (70, 25, 5, 0) a luck of 5 reads 59.5, 31.75, 8, 0.75, and a luck of 10 reads
 * 49, 38.5, 11, 1.5 (`luck.test.ts`).
 */
export const LUCK_SHIFT_PER_POINT = 0.03;

/** The share of a rarity's weight handed up at this luck, never more than all of it. */
function shiftOf(luck: number): number {
  return Math.min(1, Math.max(0, luck) * LUCK_SHIFT_PER_POINT);
}

/**
 * Rarity weights shifted toward the rarer end by `luck`.
 *
 * `holds` says which rarities the draw can actually give: weight is handed to the next rarity up
 * that holds, and a rarity with nothing above it that holds keeps its weight. A row whose rarities
 * all hold (the daily odds, salvage) moves every step.
 */
export function luckyRarityWeights(
  weights: Readonly<Record<ItemRarity, number>>,
  luck: number,
  holds: (rarity: ItemRarity) => boolean = () => true,
): Record<ItemRarity, number> {
  const out = { ...weights };
  const shift = shiftOf(luck);
  if (shift === 0) return out;
  for (let at = ITEM_RARITIES.length - 2; at >= 0; at -= 1) {
    const from = ITEM_RARITIES[at]!;
    const to = ITEM_RARITIES.slice(at + 1).find((rarity) => holds(rarity));
    if (to === undefined) continue;
    const moved = out[from] * shift;
    out[from] -= moved;
    out[to] += moved;
  }
  return out;
}

/**
 * A weighted pool of drops, each of a rarity, with its weights moved by `luck`.
 *
 * Each rarity's share of the pool shifts by {@link luckyRarityWeights}, and every entry of a
 * rarity scales by the same factor, so the odds between two pages of one rarity do not move.
 */
export function luckyPool<T extends { weight: number }>(
  pool: readonly T[],
  rarityOf: (entry: T) => ItemRarity,
  luck: number,
): T[] {
  if (shiftOf(luck) === 0) return [...pool];
  const totals = Object.fromEntries(ITEM_RARITIES.map((rarity) => [rarity, 0])) as Record<
    ItemRarity,
    number
  >;
  for (const entry of pool) totals[rarityOf(entry)] += entry.weight;
  const shifted = luckyRarityWeights(totals, luck, (rarity) => totals[rarity] > 0);
  return pool.map((entry) => {
    const rarity = rarityOf(entry);
    const total = totals[rarity];
    return { ...entry, weight: total > 0 ? (entry.weight * shifted[rarity]) / total : 0 };
  });
}
