import { ATTRIBUTE_NAMES, type Attributes } from '../attributes.js';
import { perksWorth } from '../crew/perk-worth.js';

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
 * §F2: what the crew's wage discount (perks and the Lab's rungs) talks off an opening number.
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
 * What one point of perk worth costs a week (maintainer, 2026-09-16).
 *
 * Eight, which puts a strong broad tag (`battlefield_surgeon`, worth 12) at about 96 a week and a
 * narrow one (`arc_warden`, worth 2.7) at about 22. Two officers with the same sheet and different
 * tags are visibly different hires, and a mid sheet carrying something that pays everywhere asks
 * more than a slightly better sheet carrying something that pays on one unit, which is the trade.
 *
 * Sized against the **payroll book**, which is the ceiling that matters. When this was set the book
 * topped out at 2,230 and an officer carrying two of the best tags asked 1,448 a week at twelve a
 * point, more than a finished crew's entire book for one person. With `MAX_PERK_WORTH` capping a
 * single tag, the dearest two-tag hire in the game lands under 900. The book no longer tops out
 * (maintainer, 2026-09-30: expansions are always for sale), and at about 10,800 for a crew with a
 * finished Quarters and twenty eight expansions that is ten such chairs.
 */
export const CAPS_PER_PERK_POINT = 8;

/**
 * §H7: the weekly fee in caps a character asks for.
 *
 * Priced off the two halves of a person the player can already see: the sheet, and the tags.
 *
 * The tags used to be free, and that was the bug. Attributes are the half that **can be trained**:
 * an hour on the floor moves them and a crew that drills closes the gap in a fortnight. A perk
 * cannot be trained, bought or swapped, so it is the half that is permanently true about somebody,
 * and the room was charging nothing for it. A sheet at 62 carrying a perk that hands back a share
 * of your dead in every fight you ever have cost exactly the same as a sheet at 62 carrying one
 * that makes Anodics cheaper, which is the trade a player should be *paying* to make.
 *
 * Breadth rather than magnitude decides what a tag is worth: see `crew/perk-worth.ts`.
 *
 * Nothing here reads the hidden role table: a fee that tracked role fit would be exactly the §B8
 * hint, on the wire, with a price tag on it.
 */
export function askingWage(
  attributes: Attributes,
  discountPercent = 0,
  /** What they carry. Defaulted, so a caller with no tags in hand prices the sheet alone. */
  perks: readonly string[] = [],
): number {
  const merit =
    RECRUIT_BASE_WAGE +
    ratingAboveAverage(attributes) / WAGE_RATING_PER_CAP +
    perksWorth(perks) * CAPS_PER_PERK_POINT;
  const off = Math.min(MAX_WAGE_DISCOUNT, Math.max(0, discountPercent)) / 100;
  return Math.max(RECRUIT_BASE_WAGE, Math.round(merit * (1 - off)));
}

/** §H7: the lowest weekly fee this character will sign for, and where their auction opens. */
export function reservationWage(asking: number): number {
  return Math.ceil(asking * WAGE_RESERVATION_FRACTION);
}

/**
 * What the payroll book is actually charged for a contract that closed at `price` (§H7, board
 * 2026-09-07).
 *
 * The auction compares, reports and remembers the price everybody at the table could see. What the
 * winner's own negotiators do is talk that number down **after** it is won, so the crew's Union
 * Rep and its Lab rungs come off the book entry and off nothing anybody bid
 * against. Everything shared stays shared: the result row, the notification, the results panel and
 * every leaderboard read the price, and only this crew's ledger and their officer's `weeklyWage`
 * carry the figure below it.
 *
 * Capped at `MAX_WAGE_DISCOUNT`, like the asking price (bug pass, 2026-09-23).
 *
 * The note here used to say the opposite, that the ceiling "belongs to the asking price" and the
 * floor here is one cap. It was reachable: Authority, Negotiation and Empathy at eighty were 60
 * points on their own, the seven research rungs of the day added 41 and `sig_paymaster` another
 * 18, so a late crew reached 119 and every officer it signed cost **one cap a week**. Skills
 * stopped paying the channel on 2026-10-04, and the six wage rungs (37) with the four wage perks
 * (33) still clear the ceiling. The payroll ceiling
 * is the only thing limiting how many people a crew can have on the books, and at a wage of one
 * it stops binding entirely, which takes the cost out of the whole Bar.
 *
 * Half off is a large discount and the right ceiling for both halves: the two are the same
 * channel talking the same number down, and a player who reads "-50% wages" on the crew sheet
 * should not be paid a different rule by the auction than by the shelf.
 */
export function committedWage(price: number, discountPercent: number): number {
  const discount = Math.min(MAX_WAGE_DISCOUNT, Math.max(0, discountPercent));
  return Math.max(1, Math.round(price * (1 - discount / 100)));
}
