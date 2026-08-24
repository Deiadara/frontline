import { z } from 'zod';

/**
 * Officer roles (GDD §C).
 *
 * Humans are generic; a role is what you hire them *into* (C2). Any character can be slotted
 * anywhere: well or badly. One officer per role slot: a role is either filled or empty (C3).
 *
 * This module is the public half of the role model: ids, display names, and the §C4 bindings.
 * What a role actually *requires* is a hidden, server-side-only table (B8, B8a). It is not in
 * this package and must never be.
 */

export const OFFICER_ROLES = [
  'head_spy',
  'lead_engineer',
  'finance_officer',
  'head_of_growth',
  'field_commander',
  'head_of_research',
  'wetware_chief',
  'fabricator',
  'salvager',
  'right_hand',
  'cartographer',
  'trader',
  'security_officer',
  'chief_medic',
  'instructor_of_the_young',
  'raid_boss',
  'scout',
  'consigliere',
  'professor',
] as const;

export const OfficerRoleSchema = z.enum(OFFICER_ROLES);
export type OfficerRole = z.infer<typeof OfficerRoleSchema>;

export const OFFICER_ROLE_LABELS: Record<OfficerRole, string> = {
  head_spy: 'Head Spy',
  lead_engineer: 'Lead Engineer',
  finance_officer: 'Finance Officer',
  head_of_growth: 'Head of Growth',
  field_commander: 'Field Commander',
  head_of_research: 'Head of Research',
  wetware_chief: 'Wetware Chief',
  fabricator: 'Fabricator',
  salvager: 'Salvager',
  right_hand: 'Right Hand',
  cartographer: 'Cartographer',
  trader: 'Trader',
  security_officer: 'Security Officer',
  chief_medic: 'Chief Medic',
  instructor_of_the_young: 'Instructor of the Young',
  raid_boss: 'Raid Boss',
  scout: 'Scout',
  consigliere: 'Consigliere',
  professor: 'Professor',
};

/**
 * C4: reskilling (§G4) is the Professor's job. W4 (assignees) gates the reassign-everyone
 * process on *this* constant rather than hardcoding its own role check.
 */
export const RESKILLING_ROLE: OfficerRole = 'professor';

/**
 * C4/B9: the librarian-ish research task that buys partial hiring insight is a Professor /
 * Head of Research activity. W7 (research) gates the task on *this* constant.
 *
 * Note what the task yields: hints about what pairs well with what. Never the raw requirement
 * table (B8).
 */
export const HIRING_INSIGHT_ROLES: readonly OfficerRole[] = ['professor', 'head_of_research'];

export function isOfficerRole(value: string): value is OfficerRole {
  return (OFFICER_ROLES as readonly string[]).includes(value);
}
