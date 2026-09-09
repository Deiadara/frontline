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
 * §F2: what Authority and Negotiation talk off an opening number.
 *
 * It used to come off a weekly bill that no longer exists, so it comes off the *asking price* now,
 * which is the better place for it anyway: people take less to work under somebody worth working
 * for, and every fee is an opening number to a good trader. Capped, because a crew that works for
 * nothing is not a crew.
 */
export const MAX_WAGE_DISCOUNT = 50;

/**
 * The fraction of their asking price a character will actually settle for: the floor their
 * auction opens at. Printed on the card, because a hidden floor in an auction is a guessing game.
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
 * §H7: the weekly fee in caps a character asks for.
 *
 * Priced off the sheet the player can already see, and off nothing else. The walkout markup that
 * used to sit here went with the haggle: nobody walks out of an auction.
 *
 * Nothing here reads the hidden role table: a fee that tracked role fit would be exactly the §B8
 * hint, on the wire, with a price tag on it.
 */
export function askingWage(attributes: Attributes, discountPercent = 0): number {
  const merit = RECRUIT_BASE_WAGE + ratingAboveAverage(attributes) / WAGE_RATING_PER_CAP;
  const off = Math.min(MAX_WAGE_DISCOUNT, Math.max(0, discountPercent)) / 100;
  return Math.max(RECRUIT_BASE_WAGE, Math.round(merit * (1 - off)));
}

/** §H7: the lowest weekly fee this character will sign for, and where their auction opens. */
export function reservationWage(asking: number): number {
  return Math.ceil(asking * WAGE_RESERVATION_FRACTION);
}
