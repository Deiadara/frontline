/**
 * The crew's "market prices" discount (§A4), and the shops it reaches (maintainer, 2026-09-29).
 *
 * Research rungs, perks, the Downtown Market and a district set all print "-N% market prices", and
 * until this ruling only a lot won at the Runner's close was cheaper for it. It now reaches every
 * shop that sells for caps: the Runner's close, the supply run and the Broker's cut. The fence
 * sells for infamy and has a discount of its own (`discountedInfamy`); the Bar's negotiators take
 * theirs off a wage (`committedWage`).
 *
 * One function for the screen and the till, so the figure a player is shown is the figure charged.
 */

/** The most the discounts can add up to, however many a crew stacks. */
export const MAX_MARKET_DISCOUNT = 45;

/** The discount a crew actually gets: its sources summed, never below none or past the cap. */
export function effectiveMarketDiscount(percent: number): number {
  return Math.min(MAX_MARKET_DISCOUNT, Math.max(0, percent));
}

/** A caps price with the discount off. Floored at one cap: no amount of ground makes a thing free. */
export function discountedCaps(price: number, percent: number): number {
  return Math.max(1, Math.round(price * (1 - effectiveMarketDiscount(percent) / 100)));
}
