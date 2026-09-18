import { ITEM_RARITIES, RARITY_ORDER, type ItemRarity } from '../items/rarity.js';

/**
 * What the Reimagining bench pays out, as a function of what was put into it (maintainer,
 * 2026-09-18).
 *
 * The trade used to pick the returned page uniformly out of every page the crew had never seen, so
 * three Basic sheets and three Masterpiece sheets bought exactly the same thing. That made the
 * bench a laundry: a player with a drawer of cheap duplicates fed them in three at a time and the
 * dear pages fell out at the same rate as anything else. The rule now is the obvious one: the
 * quality of the three sheets in the sockets sets the odds on the tier of the sheet that comes
 * back.
 *
 * ## The two ends
 *
 * Three Basic pages buy {@link REIMAGINING_BASE_ODDS}: 80% Basic, 15% Intricate, 4.5% Advanced,
 * 0.5% Masterpiece. Three Masterpiece pages buy that ladder read backwards, 80% Masterpiece down
 * to 0.5% Basic. Everything between the two ends is one number, {@link reimaginingQuality}.
 *
 * ## Why the curve is geometric and not a straight line
 *
 * `q` is the mean tier of the three inputs, scaled so all-Basic is 0 and all-Masterpiece is 1, and
 * the ladder at `q` is the two ends blended **in log space**: each tier's odds are
 * `base^(1-q) * reversed^q`, renormalised. Both ends sum to one and `x^1 * y^0` is exactly `x`, so
 * the endpoints come out bit-exact rather than nearly right.
 *
 * A straight line between the same two ends was measured first and it is wrong in a way a player
 * would feel in the first session. Swapping one Basic sheet for one Intricate (`q` = 1/9) moves
 * Masterpiece from 0.5% to **9.3%** on the linear blend, an eighteen-fold jump for one cheap sheet,
 * while Intricate goes *down* from 15% to 13.8%. Adding a better page made the tier it belongs to
 * less likely, which is the opposite of "it all goes up". The geometric blend at the same point
 * reads 70.4 / 20.3 / 8.0 / 1.4: everything above Basic went up, Basic paid for it, and the top
 * tier moved by a factor of under three.
 *
 * The blend is an exponential family in the tier index, so it has the monotone likelihood ratio
 * property, and that is the guarantee worth stating: **raising any one input page by a tier
 * improves the payout by first-order stochastic dominance.** For every tier `k`, the chance of
 * getting `k` or better never falls. It does not mean each tier's own odds move one way, and they
 * do not: Intricate peaks at 30.0% around `q` = 0.4 and Advanced at 30.0% around `q` = 0.6,
 * because a ladder that ends at 80% Masterpiece has to give the middle back eventually. See
 * `reimagine-odds.test.ts`, which walks all twenty input multisets.
 *
 * ## What `q` deliberately forgets
 *
 * Only the sum of the three tiers, so two Basic and one Masterpiece buys exactly what three
 * Intricate buys. That is the average the brief asked for and it keeps the bench legible: a player
 * can read the tray and know where they are without a table.
 */
export const REIMAGINING_BASE_ODDS: Readonly<Record<ItemRarity, number>> = {
  basic: 0.8,
  intricate: 0.15,
  advanced: 0.045,
  masterpiece: 0.005,
};

/** The top of the ladder, which is what `q` divides by to land in [0, 1]. */
const TOP_TIER = ITEM_RARITIES.length - 1;

/**
 * How good the three sheets in the sockets are, as a number from 0 (all Basic) to 1 (all
 * Masterpiece).
 *
 * The mean tier index over the input, scaled by the top tier. Exported so a test can pin the
 * midpoint without going through the ladder, and so a screen that ever wants to draw a quality
 * meter reads the same number the draw does.
 */
export function reimaginingQuality(rarities: readonly ItemRarity[]): number {
  if (rarities.length === 0) return 0;
  const sum = rarities.reduce((total, rarity) => total + RARITY_ORDER[rarity], 0);
  return sum / (rarities.length * TOP_TIER);
}

/** The base ladder read backwards: what an all-Masterpiece input buys. */
function reversedOdds(rarity: ItemRarity): number {
  return REIMAGINING_BASE_ODDS[ITEM_RARITIES[TOP_TIER - RARITY_ORDER[rarity]]!];
}

/**
 * The payout ladder at a given quality, normalised to sum to 1.
 *
 * Split out from {@link reimaginingOdds} so the curve can be walked on a fine grid by a test
 * without inventing input pages for every point on it.
 */
export function reimaginingOddsAt(quality: number): Readonly<Record<ItemRarity, number>> {
  const raw = ITEM_RARITIES.map(
    (rarity) =>
      Math.pow(REIMAGINING_BASE_ODDS[rarity], 1 - quality) *
      Math.pow(reversedOdds(rarity), quality),
  );
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(
    ITEM_RARITIES.map((rarity, index) => [rarity, raw[index]! / total]),
  ) as Record<ItemRarity, number>;
}

/** The payout ladder for one set of input sheets. */
export function reimaginingOdds(
  rarities: readonly ItemRarity[],
): Readonly<Record<ItemRarity, number>> {
  return reimaginingOddsAt(reimaginingQuality(rarities));
}
