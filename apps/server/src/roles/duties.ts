import type { Attributes, CrewMember, OfficerRole } from '@frontline/shared';

/**
 * The two ways a person enters `crewSheet`: an officer in a chair, and the Overseer in none.
 *
 * Which skills a chair puts to work is `ROLE_IMPORTANCE` in `@frontline/shared`, public because
 * the officer sheet draws it as coloured borders. The in-or-out duty table this file used to hold
 * was superseded by it and nothing read it any more (cleanup, 2026-09-30).
 */

/** One officer, ready for `crewSheet`: their sheet, their chair and what they bring. */
export function seatedMember(
  attributes: Attributes,
  role: OfficerRole,
  perks: readonly string[],
): CrewMember {
  return { attributes, role, perks };
}

/** The Overseer: no seat, no discount, everything they know available all the time. */
export function overseerMember(attributes: Attributes, perks: readonly string[]): CrewMember {
  return { attributes, role: null, perks };
}
