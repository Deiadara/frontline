import { adminCaps, adminWaives } from '../admin/mode.js';
import { randomUUID } from 'node:crypto';
import {
  ALIGNMENT_START,
  CHARACTER_LEVEL_MIN,
  askingWage,
  assessJoin,
  barHiresPerDay,
  negotiateWage,
  playerLevelGrants,
  proratedFirstWage,
  reputationOf,
  type Base,
  type Commander,
  type JoinBlocker,
  type OfficerRole,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { districtPopulation } from '../district/population.js';
import { barDay, type BarCharacter } from './roster.js';

/**
 * Hiring out of the Bar (GDD §H3, §H4, §H7, §H8): every gate between "that one" and a signed
 * officer, in the order the fiction puts them.
 *
 * The money is not moved here beyond the §H7 first payment: the agreed weekly wage is written
 * into W2's `PayrollState.wages`, whose own doc comment says W5 negotiates the number and the
 * payroll engine moves it. Nothing in this file re-implements `startOfPayWeek` or the proration.
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
  /** §H7: the weekly wage in caps being offered. */
  offerWage: number;
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
  'reputation',
  'cannot_afford',
] as const;
export type HireRefusal = (typeof HIRE_REFUSALS)[number];

export type HireResult =
  | { kind: 'refused'; reason: HireRefusal }
  /** §H7. They are interested but not at that price, and this is what they came back with. */
  | { kind: 'countered'; wage: number }
  | { kind: 'hired'; base: Base; officer: Commander; wage: number; firstPayment: number };

/** §H3 + §H4 judged against this crew: the one place the two gates are read for a base. */
export function assessAgainst(
  base: Base,
  recruit: BarCharacter,
  now: Date,
): ReturnType<typeof assessJoin> {
  return assessJoin(recruit, recruit.requirement, {
    notoriety: base.economy.notoriety,
    reputation: reputationOf(base.economy, now),
  });
}

/** What this character is asking of *this* crew (§H7): priced with the §H4 stance folded in. */
export function wageAskedOf(recruit: BarCharacter, stance: number): number {
  return askingWage(recruit.attributes, stance);
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
  if (blockers.includes('reputation')) return 'reputation';
  return null;
}

/**
 * Signs a recruit, or says why not (§H7).
 *
 * On agreement three things happen together: the officer joins the books, the wage goes into the
 * payroll W2 owns, and the §H7 first payment is taken immediately for whatever is left of this
 * pay week. Recruiting on the Monday 00:00Z boundary therefore costs a full week and recruiting
 * an hour before it costs an hour. That is `proratedFirstWage`'s contract, not a rule restated
 * here.
 */
export function hireRecruit(repos: Repositories, input: HireInput): HireResult {
  const { base, userId, seat, recruit, role, offerWage, now, admin = false } = input;
  const day = barDay(now);

  const { stance, blockers } = assessAgainst(base, recruit, now);
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

  const negotiation = negotiateWage(offerWage, wageAskedOf(recruit, stance));
  if (!negotiation.accepted) return { kind: 'countered', wage: negotiation.wage };

  const firstPayment = proratedFirstWage(negotiation.wage, now);
  if (firstPayment > base.resources.caps && !adminWaives('cannot_afford', admin)) {
    return { kind: 'refused', reason: 'cannot_afford' };
  }

  const officer: Commander = {
    id: recruit.id,
    name: recruit.name,
    role,
    attributes: recruit.attributes,
    traits: recruit.traits,
    ambition: recruit.ambition,
    moralCompass: recruit.moralCompass,
    // §H5. They have an opinion of your reputation, but none yet of the work. The drift from
    // neutral towards that opinion starts now.
    alignment: ALIGNMENT_START,
    alignmentUpdatedAt: now.toISOString(),
    level: CHARACTER_LEVEL_MIN,
    xpIntoLevel: 0,
    unspentPoints: 0,
  };

  const hired: Base = {
    ...base,
    // Charged unless the testing build is waiving prices, in which case the *quoted* first payment
    // on the response is still the real one: the mode shows what it would cost (`admin/mode.ts`).
    resources: {
      ...base.resources,
      caps: base.resources.caps - adminCaps(firstPayment, admin),
    },
    economy: {
      ...base.economy,
      payroll: {
        ...base.economy.payroll,
        wages: { ...base.economy.payroll.wages, [officer.id]: negotiation.wage },
      },
    },
    commanders: [...base.commanders, officer],
  };

  repos.bases.updateResources(hired.id, hired.resources);
  repos.bases.updateEconomy(hired.id, hired.economy);
  repos.bases.updateCommanders(hired.id, hired.commanders);
  // §H2b, and they walk out of the room. Somebody else takes the seat on the next read, for
  // everyone, which is what makes the Bar a shop rather than a catalogue.
  repos.bar.recordHire(
    { id: randomUUID(), day, userId, recruitId: recruit.id, hiredAt: now.toISOString() },
    seat,
  );

  return { kind: 'hired', base: hired, officer, wage: negotiation.wage, firstPayment };
}
