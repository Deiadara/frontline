import { adminCaps, adminWaives } from '../admin/mode.js';
import { randomUUID } from 'node:crypto';
import {
  askingWage,
  assessJoin,
  barHiresPerDay,
  buildingLevel,
  dismissalFee,
  payrollBonusPercent,
  payrollFits,
  inStandoff,
  payrollLedger,
  playerLevelGrants,
  reservationWage,
  type Base,
  type Commander,
  type JoinBlocker,
  type OfficerRole,
  type PayrollLedger,
  type Standoff,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { crewEffectsFor } from '../crew/standing.js';
import { barDay, type BarCharacter } from './roster.js';

/**
 * Hiring out of the Bar (GDD §H3, §H4, §H7, §H8): every gate between "that one" and a signed
 * officer, in the order the fiction puts them.
 *
 * No caps change hands. An officer's fee is a **commitment against the payroll book**
 * (`economy/payroll.ts`), so signing writes the agreed figure into `payroll.commitments` and takes
 * nothing out of the stockpile; the only thing the book can refuse is a fee that does not fit in
 * what is left of it. The caps side of the contract is a single charge at the *other* end, when
 * somebody is let go: see `releaseOfficer`.
 */

export interface HireInput {
  base: Base;
  /** The account signing them. Needed for the §H2b daily limit and for the shared hire log. */
  userId: string;
  /** §H2b, which seat of the shared room they are sitting in, so it can be turned over. */
  seat: number;
  recruit: BarCharacter;
  /**
   * §C2: the role the player is hiring them *into*. A character has none until now.
   *
   * `null` signs them to the bench (board request), which is a hire with the chair left undecided.
   * Everything else about it is identical: the wage is committed, the seat at the Bar turns over,
   * the daily limit is spent. Only the assignment is deferred.
   */
  role: OfficerRole | null;
  /** §H7: the weekly fee in caps being offered. */
  offerWage: number;
  /** What this crew has already made of them: a walked negotiation marks the price up. */
  standoff?: Standoff;
  now: Date;
  /**
   * Testing mode (`admin/mode.ts`).
   *
   * Waives the daily limit, the beds, the free seats and the standing an officer would normally
   * want: every gate that is a rule about how far along a crew is. It does **not** waive the
   * negotiation: a counter-offer is the officer's answer rather than a lock, and a mode that made
   * everybody accept any number would hide the one part of hiring a reviewer is here to look at.
   */
  admin?: boolean;
}

/** Why the hire cannot proceed at all, as opposed to §H7's counter-offer, which is a negotiation. */
export const HIRE_REFUSALS = [
  'already_hired',
  'daily_limit',
  'no_slots',
  'role_taken',
  'requirement',
  'level',
  'standoff',
  'no_payroll',
] as const;
export type HireRefusal = (typeof HIRE_REFUSALS)[number];

export type HireResult =
  | { kind: 'refused'; reason: HireRefusal }
  /** §H7. They are interested but not at that price, and this is what they came back with. */
  | { kind: 'countered'; wage: number }
  | { kind: 'hired'; base: Base; officer: Commander; wage: number; payroll: PayrollLedger };

/** §H3 judged against this crew: the one place the two doors are read for a base. */
export function assessAgainst(base: Base, recruit: BarCharacter): ReturnType<typeof assessJoin> {
  return assessJoin(recruit.requirement, {
    notoriety: base.economy.notoriety,
    level: base.level,
  });
}

/**
 * What this character is asking of *this* crew (§H7).
 *
 * The only thing that moves it off their sheet is how many times they have already walked out on
 * this crew: `WALKOUT_MARKUP` per walkout, compounding. Nothing about the crew's standing discounts
 * it any more, which is the point of the rework: the price is a fact about the person and about
 * how you have treated them, not a reward for a word.
 */
export function wageAskedOf(
  recruit: BarCharacter,
  standoff?: Standoff,
  discountPercent = 0,
): number {
  return askingWage(recruit.attributes, standoff?.walkouts ?? 0, discountPercent);
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
 * §H3, §H4, §H8 and §C3: everything that has to be true before a salary is even discussed.
 * Returns the first reason it is not, or `null` when the character will talk terms.
 */
function refusalFor(
  {
    base,
    recruit,
    role,
    standoff,
    hiresToday,
    now,
  }: Omit<HireInput, 'offerWage' | 'userId' | 'seat'> & {
    hiresToday: number;
  },
  blockers: readonly JoinBlocker[],
): HireRefusal | null {
  /*
   * The two that admin mode does **not** waive come first, and that ordering is load-bearing.
   *
   * This function returns the *first* reason, and the caller applies the waiver to that single
   * reason: `if (refusal && !adminWaives(refusal, admin))`. So a waivable gate standing in front of
   * a non-waivable one hides it completely. `no_slots` is waived and used to sit ahead of
   * `role_taken`, which is not: on a full roster in admin mode the hire reached `no_slots`, had it
   * waived, and never evaluated `role_taken`, so two officers were signed into one chair. Nothing
   * dedupes by role in `crewSheetsFor`, so both were paid as the seated officer, both sets of perks
   * were summed into the crew's channels, and the row survived the flag being turned off again.
   *
   * The list below is still ordered by what a player most wants to be told; it is only these two
   * that have been lifted, and they are lifted because they are the ones a waiver must never skip.
   *
   * §C3: a role is either filled or empty, so an occupied one cannot take a second officer.
   *
   * The bench is the exception and it is not really one: `null` is the *absence* of a chair, so
   * "somebody else already has that chair" cannot be true of it however many people are sitting
   * there. Without the guard this read `officer.role === null` for a bench hire and refused the
   * second one, which would have made the bench a chair with one seat in it.
   */
  if (base.commanders.some((officer) => officer.id === recruit.id)) return 'already_hired';
  if (role !== null && base.commanders.some((officer) => officer.role === role)) {
    return 'role_taken';
  }

  // §H8: 2 at the start, +1 per level, read off W6's grant table rather than restated here.
  if (base.commanders.length >= playerLevelGrants(base.level).recruitSlots) return 'no_slots';

  // The two limits that are about the crew's *capacity* rather than about this request being
  // nonsense, so they come after the ones above: a player asking to fill a post that is already
  // held should be told that, not told to come back tomorrow.
  //
  // §H2b: the shared room's stock is finite, so one signing per player per UTC day. Two from
  // level 40 (§I3), read off the same function the Bar screen quotes.
  if (hiresToday >= barHiresPerDay(base.level)) return 'daily_limit';
  if (blockers.includes('notoriety')) return 'requirement';
  if (blockers.includes('level')) return 'level';
  /*
   * §H7: the six hours a walkout buys, enforced *here* and not only in the conversation.
   *
   * `/bar/negotiate` refuses to open a chair that is still cold, which is what a player sees. It
   * is not what a request has to go through: signing is its own route, and a tab left open across
   * a walkout, or anything posting the floor price straight at `/bar/hire`, would put the officer
   * on the books during the standoff. The markup already applied because `wageAskedOf` reads the
   * same record; the clock did not, and the clock is the half that makes a walkout cost something
   * today rather than next week.
   */
  if (inStandoff(standoff, now)) return 'standoff';
  return null;
}

/**
 * Signs a recruit, or says why not (§H7).
 *
 * On agreement two things happen together: the officer joins the books, and the agreed fee is
 * committed against the payroll book. Nothing is charged. A fee that does not fit in what is left
 * of the book is refused outright, and that refusal is the one the whole mechanic turns on: the
 * question a player answers at the table is not "can I afford this week" but "is this person worth
 * this much of a ceiling I have to buy".
 */
export function hireRecruit(repos: Repositories, input: HireInput): HireResult {
  const { base, userId, seat, recruit, role, offerWage, standoff, now, admin = false } = input;
  const day = barDay(now);

  const { blockers } = assessAgainst(base, recruit);
  const refusal = refusalFor(
    {
      base,
      recruit,
      role,
      ...(standoff ? { standoff } : {}),
      now,
      hiresToday: repos.bar.hiresBy(userId, day),
    },
    blockers,
  );
  if (refusal && !adminWaives(refusal, admin)) return { kind: 'refused', reason: refusal };

  // The conversation is the negotiation route's business, and it has already happened: what
  // arrives here is the number the two of them shook on. This is the backstop, not the haggle. A
  // request that skipped the window and posted a lowball gets their floor back as a counter.
  /*
   * §H7: what the crew's own negotiators take off the ask.
   *
   * Computed here rather than passed in, because this is the backstop every path ends at and a
   * parameter is a thing a caller can forget. `wageDiscountPercent` was folded by four perks, two
   * attributes and a technology and read by nobody at all: hiring a negotiator moved no number at
   * the Bar, in the window, or on the books.
   *
   * The same figure has to reach `projectRecruit` and the negotiation route, or the price on the
   * screen and the price charged would differ, which is the one pricing bug that looks like a
   * refund. See the note on `ledgerFor` about exactly that.
   */
  const asking = wageAskedOf(recruit, standoff, crewEffectsFor(repos, base).wageDiscountPercent);
  const wage = Math.max(0, Math.round(offerWage));
  const floor = reservationWage(asking);
  if (wage < floor) return { kind: 'countered', wage: floor };

  const ledger = ledgerFor(base);
  if (!payrollFits(ledger, wage) && !adminWaives('no_payroll', admin)) {
    return { kind: 'refused', reason: 'no_payroll' };
  }

  const officer: Commander = {
    id: recruit.id,
    name: recruit.name,
    role,
    attributes: recruit.attributes,
    // §D4: nobody is hired hurt. The clock is only ever written by a fight the settler ran.
    injuredUntil: null,
    // §B7: the perks come with the person, exactly as the card at the Bar advertised them.
    perks: recruit.perks,
    // §H7: the wage that was actually agreed, which is what the payroll book is charged and what
    // the crew card prints. It is the whole of the ongoing relationship now.
    weeklyWage: wage,
  };

  const hired: Base = {
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

  repos.bases.updateEconomy(hired.id, hired.economy);
  repos.bases.updateCommanders(hired.id, hired.commanders);
  // §H2b, and they walk out of the room. Somebody else takes the seat on the next read, for
  // everyone, which is what makes the Bar a shop rather than a catalogue.
  repos.bar.recordHire(
    { id: randomUUID(), day, userId, recruitId: recruit.id, hiredAt: now.toISOString() },
    seat,
  );

  return { kind: 'hired', base: hired, officer, wage, payroll: ledgerFor(hired) };
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

  return { kind: 'released', base: released, officer, fee, payroll: ledgerFor(released) };
}
