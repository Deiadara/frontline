import {
  ALIGNMENT_START,
  CHARACTER_LEVEL_MIN,
  askingWage,
  assessJoin,
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
import type { BarCharacter } from './roster.js';

/**
 * Hiring out of the Bar (GDD §H3, §H4, §H7, §H8) — every gate between "that one" and a signed
 * officer, in the order the fiction puts them.
 *
 * The money is not moved here beyond the §H7 first payment: the agreed weekly wage is written
 * into W2's `PayrollState.wages`, whose own doc comment says W5 negotiates the number and the
 * payroll engine moves it. Nothing in this file re-implements `startOfPayWeek` or the proration.
 */

export interface HireInput {
  base: Base;
  recruit: BarCharacter;
  /** §C2 — the role the player is hiring them *into*. A character has none until now. */
  role: OfficerRole;
  /** §H7 — the weekly wage in caps being offered. */
  offerWage: number;
  now: Date;
}

/** Why the hire cannot proceed at all — as opposed to §H7's counter-offer, which is a negotiation. */
export const HIRE_REFUSALS = [
  'already_hired',
  'no_slots',
  'role_taken',
  'requirement',
  'reputation',
  'cannot_afford',
] as const;
export type HireRefusal = (typeof HIRE_REFUSALS)[number];

export type HireResult =
  | { kind: 'refused'; reason: HireRefusal }
  /** §H7 — they are interested but not at that price, and this is what they came back with. */
  | { kind: 'countered'; wage: number }
  | { kind: 'hired'; base: Base; officer: Commander; wage: number; firstPayment: number };

/** §H3 + §H4 judged against this crew — the one place the two gates are read for a base. */
export function assessAgainst(
  base: Base,
  recruit: BarCharacter,
  now: Date,
): ReturnType<typeof assessJoin> {
  return assessJoin(recruit, recruit.requirement, {
    infamy: base.economy.infamy,
    reputation: reputationOf(base.economy, now),
  });
}

/** What this character is asking of *this* crew (§H7) — priced with the §H4 stance folded in. */
export function wageAskedOf(recruit: BarCharacter, stance: number): number {
  return askingWage(recruit.attributes, stance);
}

/**
 * §H3, §H4, §H8 and §C3 — everything that has to be true before a salary is even discussed.
 * Returns the first reason it is not, or `null` when the character will talk terms.
 */
function refusalFor(
  { base, recruit, role }: Omit<HireInput, 'offerWage' | 'now'>,
  blockers: readonly JoinBlocker[],
): HireRefusal | null {
  if (base.commanders.some((officer) => officer.id === recruit.id)) return 'already_hired';
  // §H8 — 2 at the start, +1 per level, read off W6's grant table rather than restated here.
  if (base.commanders.length >= playerLevelGrants(base.level).recruitSlots) return 'no_slots';
  // §C3 — a role is either filled or empty, so an occupied one cannot take a second officer.
  if (base.commanders.some((officer) => officer.role === role)) return 'role_taken';

  if (blockers.includes('infamy')) return 'requirement';
  if (blockers.includes('reputation')) return 'reputation';
  return null;
}

/**
 * Signs a recruit, or says why not (§H7).
 *
 * On agreement three things happen together: the officer joins the books, the wage goes into the
 * payroll W2 owns, and the §H7 first payment is taken immediately for whatever is left of this
 * pay week. Recruiting on the Monday 00:00Z boundary therefore costs a full week and recruiting
 * an hour before it costs an hour — that is `proratedFirstWage`'s contract, not a rule restated
 * here.
 */
export function hireRecruit(repos: Repositories, input: HireInput): HireResult {
  const { base, recruit, role, offerWage, now } = input;

  const { stance, blockers } = assessAgainst(base, recruit, now);
  const refusal = refusalFor(input, blockers);
  if (refusal) return { kind: 'refused', reason: refusal };

  const negotiation = negotiateWage(offerWage, wageAskedOf(recruit, stance));
  if (!negotiation.accepted) return { kind: 'countered', wage: negotiation.wage };

  const firstPayment = proratedFirstWage(negotiation.wage, now);
  if (firstPayment > base.resources.caps) return { kind: 'refused', reason: 'cannot_afford' };

  const officer: Commander = {
    id: recruit.id,
    name: recruit.name,
    role,
    attributes: recruit.attributes,
    traits: recruit.traits,
    ambition: recruit.ambition,
    moralCompass: recruit.moralCompass,
    // §H5 — they have an opinion of your reputation, but none yet of the work. The drift from
    // neutral towards that opinion starts now.
    alignment: ALIGNMENT_START,
    alignmentUpdatedAt: now.toISOString(),
    level: CHARACTER_LEVEL_MIN,
    xpIntoLevel: 0,
    unspentPoints: 0,
  };

  const hired: Base = {
    ...base,
    resources: { ...base.resources, caps: base.resources.caps - firstPayment },
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

  return { kind: 'hired', base: hired, officer, wage: negotiation.wage, firstPayment };
}
