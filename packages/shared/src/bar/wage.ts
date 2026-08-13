import { ATTRIBUTE_NAMES, type Attributes } from '../attributes.js';

/**
 * Salary negotiation (GDD §H7).
 *
 * §H7 splits cleanly in two and only the first half is here: *what number the two sides agree on*.
 * Moving the caps — the weekly payday, the prorated first payment — is W2's payroll engine
 * (`../economy/payroll.js`), and this module deliberately does not reimplement any of it.
 */

/** What the least impressive plausible recruit costs per week, before anything is added. */
export const RECRUIT_BASE_WAGE = 12;

/**
 * Rating at which an attribute stops being free. It is the recruitment base mean, so an ordinary
 * sheet prices at close to `RECRUIT_BASE_WAGE` and what a player pays for is the tail above
 * average — the part that actually distinguishes one recruit from the next (§B2).
 */
export const WAGE_FREE_RATING = 18;

/** Rating points above `WAGE_FREE_RATING` that buy one cap of weekly wage. */
export const WAGE_RATING_PER_CAP = 2;

/** How much each point of §H4 stance moves the asking price, as a fraction. */
export const WAGE_STANCE_DISCOUNT = 0.1;

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
 * §H7 — the weekly wage in caps a character opens the negotiation at.
 *
 * Priced off the sheet the player can already see plus what the character makes of the crew
 * (§H4): someone drawn to your reputation works for less, someone holding their nose charges for
 * it. Nothing here reads the hidden role table — a wage that tracked role fit would be exactly
 * the §B8 hint, on the wire, with a price tag on it.
 */
export function askingWage(attributes: Attributes, stance: number): number {
  const merit = RECRUIT_BASE_WAGE + ratingAboveAverage(attributes) / WAGE_RATING_PER_CAP;
  return Math.max(RECRUIT_BASE_WAGE, Math.round(merit * (1 - WAGE_STANCE_DISCOUNT * stance)));
}

/** §H7 — the lowest weekly wage this character will sign for. */
export function reservationWage(asking: number): number {
  return Math.ceil(asking * WAGE_RESERVATION_FRACTION);
}

export interface WageNegotiation {
  accepted: boolean;
  /** What they will sign for: the offer when accepted, otherwise what they came back with. */
  wage: number;
}

/**
 * §H7 — the character's answer to an offer.
 *
 * An offer at or above their reservation is taken as made, so haggling well is worth caps. Below
 * it they counter halfway back towards their asking price rather than repeating it, which makes a
 * second offer worth making and keeps the counter bounded by what they would have accepted.
 */
export function negotiateWage(offer: number, asking: number): WageNegotiation {
  const floor = reservationWage(asking);
  const bid = Math.max(0, Math.round(offer));
  if (bid >= floor) return { accepted: true, wage: bid };
  return { accepted: false, wage: Math.max(floor, Math.round((bid + asking) / 2)) };
}
