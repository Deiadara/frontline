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
 *
 * ## A curve, not a ceiling (maintainer, 2026-10-01)
 *
 * The sources used to be summed and clamped at 45. A Downtown Market at level 8 paid 45 on its own,
 * so from there every rung, perk and set on this line paid nothing while its card still printed its
 * full figure. The raw sum `s` now goes through `60 x s / (s + 60)`, the hyperbola the raid cut
 * uses: 20 raw is 15 off, 45 is 26, 100 is 37.5. Every source always pays something, each pays less
 * than the one before, and the discount closes on 60 without reaching it, so no price ever reaches
 * zero and the Broker's cut never reaches nothing.
 *
 * Everything here takes the **raw sum** and applies the curve itself, once. A caller that curved
 * the figure first and passed it on would be discounted twice.
 */

/** What the discount closes on and never reaches, however many sources a crew stacks. */
export const MARKET_DISCOUNT_ASYMPTOTE = 60;

/** The raw sum that buys half the asymptote. */
const MARKET_DISCOUNT_HALF_SUM = 60;

/** The discount a crew actually gets, in percent, from its sources summed. See the curve above. */
export function effectiveMarketDiscount(percent: number): number {
  const sum = Math.max(0, percent);
  return (MARKET_DISCOUNT_ASYMPTOTE * sum) / (sum + MARKET_DISCOUNT_HALF_SUM);
}

/** A caps price with the discount off. Floored at one cap: no amount of ground makes a thing free. */
export function discountedCaps(price: number, percent: number): number {
  return Math.max(1, Math.round(price * (1 - effectiveMarketDiscount(percent) / 100)));
}
