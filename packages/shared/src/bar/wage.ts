import { ATTRIBUTE_NAMES, type Attributes } from '../attributes.js';

/**
 * What an officer's contract costs (GDD §H7).
 *
 * §H7 splits cleanly in two and only the first half is here: *what number the two sides agree on*.
 * Where that number is then carried is the payroll book (`../economy/payroll.js`), which is a
 * capacity rather than a weekly bill, and this module deliberately does not reimplement any of it.
 *
 * The fee is still quoted per week, because a week is the unit the book is written in and because
 * "forty caps a week" is a thing a person says. Nothing is deducted weekly: signing commits the
 * slice, releasing frees it, and the stockpile is only ever touched at those two moments.
 */

/** What the least impressive plausible recruit costs per week, before anything is added. */
export const RECRUIT_BASE_WAGE = 12;

/**
 * Rating at which an attribute stops being free. It is the recruitment base mean, so an ordinary
 * sheet prices at close to `RECRUIT_BASE_WAGE` and what a player pays for is the tail above
 * average: the part that actually distinguishes one recruit from the next (§B2).
 */
export const WAGE_FREE_RATING = 18;

/** Rating points above `WAGE_FREE_RATING` that buy one cap of weekly fee. */
export const WAGE_RATING_PER_CAP = 2;

/**
 * What a walked negotiation adds to the same person's price the next time they will sit down.
 *
 * Ten percent, compounding per walkout. It is the whole cost of haggling badly: the six-hour
 * standoff is a delay, and a delay by itself is only an annoyance. The markup is what makes a
 * player think before opening at half the asking price, because the person across the table
 * remembers being insulted and prices it in.
 */
export const WALKOUT_MARKUP = 0.1;

/**
 * §F2: what Authority and Negotiation talk off an opening number.
 *
 * It used to come off a weekly bill that no longer exists, so it comes off the *asking price* now,
 * which is the better place for it anyway: people take less to work under somebody worth working
 * for, and every fee is an opening number to a good trader. Capped, because a crew that works for
 * nothing is not a crew.
 */
export const MAX_WAGE_DISCOUNT = 50;

/**
 * The fraction of their asking price a character will actually settle for. Derivable by the
 * player from the asking price, and meant to be: §H7 asks for a negotiation, not a guessing game.
 * What the player is trading is caps against the risk of insulting someone they wanted.
 */
export const WAGE_RESERVATION_FRACTION = 0.8;

/** Everything above average on the sheet, in rating points. The one measure of "how good". */
function ratingAboveAverage(attributes: Attributes): number {
  return ATTRIBUTE_NAMES.reduce(
    (total, name) => total + Math.max(0, attributes[name] - WAGE_FREE_RATING),
    0,
  );
}

/**
 * §H7: the weekly fee in caps a character opens the negotiation at.
 *
 * Priced off the sheet the player can already see, and off nothing else. The reputation discount
 * that used to sit here is gone with reputation: what moves the number now is how many times this
 * particular person has walked away from this particular crew, which is a thing the player did
 * rather than a word the game applied to them.
 *
 * Nothing here reads the hidden role table: a fee that tracked role fit would be exactly the §B8
 * hint, on the wire, with a price tag on it.
 */
export function askingWage(attributes: Attributes, walkouts = 0, discountPercent = 0): number {
  const merit = RECRUIT_BASE_WAGE + ratingAboveAverage(attributes) / WAGE_RATING_PER_CAP;
  const marked = merit * (1 + WALKOUT_MARKUP) ** Math.max(0, Math.trunc(walkouts));
  const off = Math.min(MAX_WAGE_DISCOUNT, Math.max(0, discountPercent)) / 100;
  return Math.max(RECRUIT_BASE_WAGE, Math.round(marked * (1 - off)));
}

/** §H7: the lowest weekly fee this character will sign for. */
export function reservationWage(asking: number): number {
  return Math.ceil(asking * WAGE_RESERVATION_FRACTION);
}
