import { adminCaps, adminWaives } from '../admin/mode.js';
import { randomUUID } from 'node:crypto';
import {
  ALIGNMENT_START,
  CHARACTER_LEVEL_MIN,
  askingWage,
  assessJoin,
  barHiresPerDay,
  buildingLevel,
  dismissalFee,
  payrollBonusPercent,
  payrollFits,
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
import { districtPopulation } from '../district/population.js';
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
  /** §C2: the role the player is hiring them *into*. A character has none until now. */
  role: OfficerRole;
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
  'no_housing',
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

/** The crew's payroll book as every gate in this file reads it. */
export function ledgerFor(base: Base): PayrollLedger {
  return payrollLedger(
    base.economy.payroll,
    buildingLevel(base.buildings, 'nexus'),
    payrollBonusPercent(base.buildings),
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
    hiresToday,
    spare,
  }: Omit<HireInput, 'offerWage' | 'now' | 'userId' | 'seat'> & {
    hiresToday: number;
    /** Beds left in the district (§A1), read once by the caller that has the repositories. */
    spare: number;
  },
  blockers: readonly JoinBlocker[],
): HireRefusal | null {
  if (base.commanders.some((officer) => officer.id === recruit.id)) return 'already_hired';
  // §H8: 2 at the start, +1 per level, read off W6's grant table rather than restated here.
  if (base.commanders.length >= playerLevelGrants(base.level).recruitSlots) return 'no_slots';
  // §C3: a role is either filled or empty, so an occupied one cannot take a second officer.
  if (base.commanders.some((officer) => officer.role === role)) return 'role_taken';

  // The two limits that are about the crew's *capacity* rather than about this request being
  // nonsense, so they come after the three above: a player asking to fill a post that is already
  // held should be told that, not told to come back tomorrow.
  //
  // §H2b: the shared room's stock is finite, so one signing per player per UTC day. Two from
  // level 40 (§I3), read off the same function the Bar screen quotes.
  if (hiresToday >= barHiresPerDay(base.level)) return 'daily_limit';
  // §A1: an officer needs a bed like anyone else. Counted against the whole district population,
  // assignees and soldiers included, because the Quarters do not care what somebody's job title is.
  if (spare < 1) return 'no_housing';

  if (blockers.includes('notoriety')) return 'requirement';
  if (blockers.includes('level')) return 'level';
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
      hiresToday: repos.bar.hiresBy(userId, day),
      spare: districtPopulation(repos, base).spare,
    },
    blockers,
  );
  if (refusal && !adminWaives(refusal, admin)) return { kind: 'refused', reason: refusal };

  // The conversation is the negotiation route's business, and it has already happened: what
  // arrives here is the number the two of them shook on. This is the backstop, not the haggle. A
  // request that skipped the window and posted a lowball gets their floor back as a counter.
  const asking = wageAskedOf(recruit, standoff);
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
    traits: recruit.traits,
    ambition: recruit.ambition,
    moralCompass: recruit.moralCompass,
    // §H5. They have an opinion of the deal they just signed, but none yet of the work. The drift
    // from neutral towards that opinion starts now: see `contractStance`.
    alignment: ALIGNMENT_START,
    alignmentUpdatedAt: now.toISOString(),
    // What they were asking when they signed. The gap between this and what they settled for is
    // what §H5 drifts on for the rest of their tenure.
    askingWage: asking,
    level: CHARACTER_LEVEL_MIN,
    xpIntoLevel: 0,
    unspentPoints: 0,
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
