import {
  alignedAttributes,
  dismissalFee,
  alignmentBand,
  alignmentBonusAttributes,
  alignmentSkillBonus,
  threatensToLeave,
  type BarOfficer,
  type BarRecruit,
  type Base,
  type Commander,
  type Standoff,
} from '@frontline/shared';
import { assessAgainst, wageAskedOf } from './hire.js';
import type { BarCharacter } from './roster.js';

/**
 * What the Bar puts on the wire (GDD §H).
 *
 * Separated from the route because this is the surface INTERFACES R4 cares about: the roster is
 * where character data first reaches a player, and everything here has to be derivable from the
 * sheet the player can already see. `hidden-table.leak.test.ts` asserts exactly that against the
 * output of these two functions, which is only possible if they are importable.
 */

/** One roster entry as this crew sees it: the §H3 doors already judged against them. */
export function projectRecruit(
  base: Base,
  recruit: BarCharacter,
  standoff: Standoff | undefined,
): BarRecruit {
  const assessment = assessAgainst(base, recruit);
  return {
    id: recruit.id,
    name: recruit.name,
    attributes: recruit.attributes,
    traits: recruit.traits,
    ambition: recruit.ambition,
    moralCompass: recruit.moralCompass,
    requirement: recruit.requirement,
    assessment,
    // §H7 prices a fee only "if the character is interested". There is no number to show someone
    // who will not sit down, and inventing one would advertise a hire that cannot happen.
    askingWage: assessment.interested ? wageAskedOf(recruit, standoff) : null,
    hired: base.commanders.some((officer) => officer.id === recruit.id),
    standoff: standoff ?? null,
  };
}

/** One held officer with their §H5 standing spelled out. */
export function projectOfficer(base: Base, officer: Commander): BarOfficer {
  const skillBonus = alignmentSkillBonus(officer.alignment);
  const fee = base.economy.payroll.commitments[officer.id] ?? 0;
  return {
    commander: officer,
    effectiveAttributes: alignedAttributes(officer.attributes, officer.alignment),
    band: alignmentBand(officer.alignment),
    threateningToLeave: threatensToLeave(officer.alignment),
    skillBonus,
    bonusAttributes: skillBonus > 0 ? alignmentBonusAttributes(officer.attributes) : [],
    weeklyWage: fee,
    dismissalFee: dismissalFee(fee),
  };
}
