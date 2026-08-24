import {
  OFFICER_ROLES,
  type AttributeName,
  type Attributes,
  type CrewMember,
  type OfficerRole,
} from '@frontline/shared';

/**
 * ############################ SERVER-SIDE ONLY ############################
 *
 * Which skills each seat actually puts to work, and, like `requirements.ts` beside it, never
 * shipped. It reads as a job description rather than a candidate profile, but it overlaps what a
 * role wants closely enough that publishing it would publish half of §B8's hidden table, and
 * `hidden-table.leak.test.ts` fails if any per-role structure appears in `packages/shared`.
 *
 * What the player sees is the *consequence*: the crew's standing figures move when an officer is
 * put in a seat that uses what they are good at. Learning which seat that is, by trying it, is the
 * game §B8 is asking for.
 *
 * ##########################################################################
 */

/**
 * What each role actually puts to work (GDD §C2).
 *
 * ## Why it exists
 *
 * A crew's rating in an attribute used to be the best rating anybody in the room had, regardless
 * of what they had been hired as. So a cryptographer sat in the Fabricator's chair improved your
 * intel exactly as much as one sat as Head Spy, and the nineteen role slots were a filing system
 * rather than a decision. Now a person contributes their full rating only in the attributes their
 * seat uses, and {@link OFF_DUTY_SHARE} of it everywhere else. They are still in the room, they
 * are simply not doing that job.
 *
 * Each row is deliberately wider than that role's `primary`: a Head Spy is hired for Stealth and
 * spends the week on Deception, Hacking and Logic as well, and a table that listed only the
 * primary would make every officer a single number.
 */
export const ROLE_DUTIES: Readonly<Record<OfficerRole, readonly AttributeName[]>> = {
  head_spy: ['stealth', 'deception', 'hacking', 'logic'],
  lead_engineer: ['engineering', 'fabrication', 'analysis', 'cybernetics'],
  finance_officer: ['strategy', 'analysis', 'logistics', 'negotiation'],
  head_of_growth: ['charisma', 'communication', 'empathy', 'diplomacy'],
  field_commander: ['organization', 'leadership', 'composure', 'resolve'],
  head_of_research: ['analysis', 'intuition', 'improvisation', 'chemistry'],
  wetware_chief: ['cybernetics', 'medicine', 'engineering', 'chemistry'],
  fabricator: ['fabrication', 'engineering', 'salvage', 'dexterity'],
  salvager: ['salvage', 'stamina', 'navigation', 'logistics'],
  right_hand: ['leadership', 'composure', 'empathy', 'intimidation'],
  cartographer: ['navigation', 'resolve', 'analysis', 'stamina'],
  trader: ['negotiation', 'charisma', 'logistics', 'deception'],
  security_officer: ['resolve', 'reflexes', 'toughness', 'speed'],
  chief_medic: ['medicine', 'chemistry', 'composure', 'empathy'],
  instructor_of_the_young: ['diplomacy', 'communication', 'empathy', 'intuition'],
  raid_boss: ['intimidation', 'strength', 'toughness', 'demolition'],
  scout: ['speed', 'dexterity', 'stealth', 'navigation'],
  consigliere: ['logic', 'empathy', 'deception', 'strategy'],
  professor: ['intuition', 'diplomacy', 'improvisation', 'cryptography'],
};

/** Whether this seat puts that skill to work. The Overseer is not in a seat and uses everything. */
export function roleUses(role: OfficerRole, attribute: AttributeName): boolean {
  return ROLE_DUTIES[role].includes(attribute);
}

/** One officer, ready for `crewSheet`: their sheet and the duties of the chair they are in. */
export function seatedMember(attributes: Attributes, role: OfficerRole): CrewMember {
  return { attributes, duties: ROLE_DUTIES[role] };
}

/** The Overseer: no seat, no discount, everything they know available all the time. */
export function overseerMember(attributes: Attributes): CrewMember {
  return { attributes, duties: null };
}

/** Guards at load that every seat has duties, so an added role cannot silently use nothing. */
for (const role of OFFICER_ROLES) {
  if ((ROLE_DUTIES[role]?.length ?? 0) < 3) {
    throw new Error(`${role} has too few duties to be a job`);
  }
}
