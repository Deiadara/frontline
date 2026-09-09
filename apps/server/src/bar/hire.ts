import { randomUUID } from 'node:crypto';
import {
  askingWage,
  assessJoin,
  buildingLevel,
  dismissalFee,
  payrollBonusPercent,
  payrollFits,
  payrollLedger,
  playerLevelGrants,
  type Base,
  type Commander,
  type JoinBlocker,
  type PayrollLedger,
} from '@frontline/shared';
import { adminCaps, adminWaives } from '../admin/mode.js';
import { crewEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { barDay, type BarCharacter } from './roster.js';

/**
 * Signing somebody out of the Bar (GDD §H3, §H7, §H8), and letting them go again.
 *
 * There is no hire *route* any more. The auction decides who signs (`bar/auction.ts`), and this is
 * the gate it walks a ranking through: the first crew that clears everything here takes the person.
 * So the file is smaller than it was by exactly the parts that were a conversation, a daily
 * allowance and a walk-out, all of which the auction replaced with a price.
 *
 * No caps change hands. An officer's fee is a **commitment against the payroll book**
 * (`economy/payroll.ts`), so signing writes the agreed figure into `payroll.commitments` and takes
 * nothing out of the stockpile; the only thing the book can refuse is a fee that does not fit in
 * what is left of it. The caps side of the contract is a single charge at the *other* end, when
 * somebody is let go: see `releaseOfficer`.
 */

export interface SignInput {
  base: Base;
  /** The account whose crew they join. The signing log is keyed by it. */
  userId: string;
  recruit: BarCharacter;
  /** §H7: the price the table closed at, which is the city's number and not this crew's. */
  price: number;
  now: Date;
}

/** Why a crew cannot take the person they just won. */
export const HIRE_REFUSALS = [
  'already_hired',
  'no_slots',
  'requirement',
  'level',
  'no_payroll',
] as const;
export type HireRefusal = (typeof HIRE_REFUSALS)[number];

export type SignResult =
  | { kind: 'refused'; reason: HireRefusal }
  | {
      kind: 'signed';
      base: Base;
      officer: Commander;
      /** What the book is actually charged: the price after this crew's negotiators (§H7). */
      wage: number;
      payroll: PayrollLedger;
    };

/** §H3 judged against this crew: the one place the two doors are read for a base. */
export function assessAgainst(base: Base, recruit: BarCharacter): ReturnType<typeof assessJoin> {
  return assessJoin(recruit.requirement, {
    notoriety: base.economy.notoriety,
    level: base.level,
  });
}

/**
 * What this character asks for, which is what their auction opens at once `reservationWage` has
 * taken its cut (§H7).
 *
 * ## The asking price is the city's, not this crew's
 *
 * `discountPercent` is `wageDiscountPercent`, the channel four perks, two attributes and a
 * technology feed, and every Bar path passes nothing here on purpose. An auction has **one**
 * floor, because two crews bidding against each other have to be bidding against the same number:
 * a per-crew reserve would mean a bid that is legal for one crew and under the floor for the other
 * at the same table, and a close that has to pick which of two reserves the ranking is measured
 * against.
 *
 * The channel has a sink all the same, one table further down: see {@link committedWage}. What the
 * crew's negotiators buy is not a cheaper table, it is a cheaper **contract**, which keeps the
 * bidding fair and still pays for hiring a Union Rep.
 */
export function wageAskedOf(recruit: BarCharacter, discountPercent = 0): number {
  return askingWage(recruit.attributes, discountPercent);
}

/**
 * §H7a: the highest price a crew can bid and still hold the contract.
 *
 * The inverse of {@link committedWage} against what is left of the book: the largest whole number
 * whose talked-down figure still fits, which is what makes "the server refuses above this and only
 * above this" true on the wire.
 */
export function bidCeilingFor(available: number, discountPercent: number): number {
  const room = Math.max(0, Math.floor(available));
  if (room <= 0) return 0;
  const share = Math.max(0, 1 - Math.max(0, discountPercent) / 100);
  if (share <= 0) return room;
  // Rounding means several raw prices land on the same charged figure, so the arithmetic answer
  // can sit a cap or two under the true edge as easily as over it. Walk to the edge from wherever
  // it lands, in both directions, so the ceiling is exactly the last bid the gate takes.
  let ceiling = Math.floor(room / share);
  while (ceiling > 0 && committedWage(ceiling, discountPercent) > room) ceiling -= 1;
  while (committedWage(ceiling + 1, discountPercent) <= room) ceiling += 1;
  return ceiling;
}

/**
 * What the payroll book is actually charged for a contract that closed at `price` (§H7, board
 * 2026-09-07).
 *
 * The auction compares, reports and remembers the price everybody at the table could see. What the
 * winner's own negotiators do is talk that number down **after** it is won, so the crew's Union
 * Rep, its Authority and its Negotiation come off the book entry and off nothing anybody bid
 * against. Everything shared stays shared: the result row, the notification, the results panel and
 * every leaderboard read the price, and only this crew's ledger and their officer's `weeklyWage`
 * carry the figure below it.
 *
 * Deliberately not capped at `MAX_WAGE_DISCOUNT`, which belongs to the asking price: the floor
 * here is one cap, because a contract nobody is paid for is not a contract.
 */
export function committedWage(price: number, discountPercent: number): number {
  return Math.max(1, Math.round(price * (1 - Math.max(0, discountPercent) / 100)));
}

/**
 * The crew's payroll book as every gate in this file reads it.
 *
 * `stepDiscountPercent` is the perk channel for officers who make widening the book cheaper, and
 * it has to be threaded through rather than defaulted at the screen: `nextStepCost` on this ledger
 * is the price the Bar *prints*, and `POST /bar/payroll` charges the same function. A default here
 * with the discount applied only at the charge would put a different number on the screen from the
 * one that comes out of the stockpile, which is the worst kind of pricing bug because it looks
 * like a refund.
 */
export function ledgerFor(base: Base, stepDiscountPercent = 0): PayrollLedger {
  return payrollLedger(
    base.economy.payroll,
    buildingLevel(base.buildings, 'nexus'),
    payrollBonusPercent(base.buildings),
    stepDiscountPercent,
  );
}

/**
 * §H3 and §H8: everything that has to be true before this crew can put somebody on the books.
 *
 * Ordered by what a player most wants to be told. The same list gates a *bid*
 * (`bar/auction.ts`), which is the point: a crew that cannot take somebody should be told at the
 * table rather than at the close, when there is nothing left to do about it.
 */
function refusalFor(
  base: Base,
  recruit: BarCharacter,
  blockers: readonly JoinBlocker[],
  slots: number,
): HireRefusal | null {
  if (base.commanders.some((officer) => officer.id === recruit.id)) return 'already_hired';
  // §H8: 2 at the start, +1 per level, read off W6's grant table rather than restated here.
  if (base.commanders.length >= slots) return 'no_slots';
  if (blockers.includes('notoriety')) return 'requirement';
  if (blockers.includes('level')) return 'level';
  return null;
}

/**
 * Puts a won recruit on the books at the price their table closed at, or says why not.
 *
 * Always onto the **bench**: a role is a decision the player makes on the Crew screen, and the
 * close happens while they are asleep. Two things happen together: the officer joins the books,
 * and the fee is committed against the payroll book. Nothing is charged.
 */
export function signRecruit(repos: Repositories, input: SignInput): SignResult {
  const { base, userId, recruit, now } = input;
  const price = Math.max(0, Math.round(input.price));

  const { blockers } = assessAgainst(base, recruit);
  const refusal = refusalFor(base, recruit, blockers, recruitSlotsFor(repos, base));
  if (refusal) return { kind: 'refused', reason: refusal };

  // Read once. The step discount is the same figure `GET /bar` and the payroll route apply, or the
  // step price on the response differs from the one that leaves the stockpile when the button is
  // pressed; the wage discount is what this crew's negotiators take off the contract.
  const effects = crewEffectsFor(repos, base);
  const wage = committedWage(price, effects.wageDiscountPercent);
  const ledger = ledgerFor(base, effects.payrollStepDiscountPercent);
  if (!payrollFits(ledger, wage)) return { kind: 'refused', reason: 'no_payroll' };

  const officer: Commander = {
    id: recruit.id,
    name: recruit.name,
    role: null,
    attributes: recruit.attributes,
    // §D4: nobody is hired hurt. The clock is only ever written by a fight the settler ran.
    injuredUntil: null,
    // §B7: the perks come with the person, exactly as the card at the Bar advertised them.
    perks: recruit.perks,
    // §H7: what the book is charged and what the crew card prints, which is the closing price
    // after this crew's own negotiators have been at it. The whole of the relationship now.
    weeklyWage: wage,
  };

  const signed: Base = {
    ...base,
    economy: {
      ...base.economy,
      payroll: {
        ...base.economy.payroll,
        commitments: { ...base.economy.payroll.commitments, [officer.id]: wage },
      },
    },
    commanders: [...base.commanders, officer],
  };

  repos.bases.updateEconomy(signed.id, signed.economy);
  repos.bases.updateCommanders(signed.id, signed.commanders);
  repos.bar.recordHire({
    id: randomUUID(),
    day: barDay(now),
    userId,
    recruitId: recruit.id,
    hiredAt: now.toISOString(),
  });

  return {
    kind: 'signed',
    base: signed,
    officer,
    wage,
    payroll: ledgerFor(signed, effects.payrollStepDiscountPercent),
  };
}

/**
 * Letting somebody go (§H7).
 *
 * Their slice of the book is freed the moment it happens, and it costs `DISMISSAL_WEEKS` of that
 * slice in caps, paid there and then. That asymmetry is the whole design: committing costs
 * nothing, so a player will sign somebody; walking it back costs five weeks, so they will think
 * about it first. Without it the book would be a scratch pad a crew could rewrite every time a
 * better sheet walked into the Bar.
 */
export type ReleaseResult =
  | { kind: 'refused'; reason: 'not_on_the_books' | 'cannot_afford' }
  | { kind: 'released'; base: Base; officer: Commander; fee: number; payroll: PayrollLedger };

export function releaseOfficer(
  repos: Repositories,
  base: Base,
  officerId: string,
  admin = false,
): ReleaseResult {
  const officer = base.commanders.find((held) => held.id === officerId);
  if (!officer) return { kind: 'refused', reason: 'not_on_the_books' };

  const committed = base.economy.payroll.commitments[officerId] ?? 0;
  const fee = dismissalFee(committed);
  if (fee > base.resources.caps && !adminWaives('cannot_afford', admin)) {
    return { kind: 'refused', reason: 'cannot_afford' };
  }

  const commitments = { ...base.economy.payroll.commitments };
  delete commitments[officerId];

  const released: Base = {
    ...base,
    resources: { ...base.resources, caps: base.resources.caps - adminCaps(fee, admin) },
    economy: { ...base.economy, payroll: { ...base.economy.payroll, commitments } },
    commanders: base.commanders.filter((held) => held.id !== officerId),
  };

  repos.bases.updateResources(released.id, released.resources);
  repos.bases.updateEconomy(released.id, released.economy);
  repos.bases.updateCommanders(released.id, released.commanders);

  return {
    kind: 'released',
    base: released,
    officer,
    fee,
    payroll: ledgerFor(released, crewEffectsFor(repos, released).payrollStepDiscountPercent),
  };
}

/**
 * How many officers the books hold: the level's chairs, plus the ones research has added (the
 * Right Hand's ninth rung, the Consigliere's tenth). Through the crew fold rather than the
 * territory one, because a chair at the Bar is nothing the ground grants.
 */
export function recruitSlotsFor(repos: Repositories, base: Base): number {
  return playerLevelGrants(base.level).recruitSlots + crewEffectsFor(repos, base).recruitSlotsFlat;
}
