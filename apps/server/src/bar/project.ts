import {
  dismissalFee,
  officerPortraitId,
  type BarOfficer,
  type BarRecruit,
  type Base,
  type Commander,
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

/**
 * One roster entry as this crew sees it: the §H3 doors already judged against them.
 *
 * The asking price is the undiscounted one, because it is the number the whole city bids against:
 * see the note on `wageAskedOf` for why the crew's own negotiators do not move a table's floor.
 */
export function projectRecruit(
  base: Base,
  recruit: BarCharacter,
  /** The face free for them in the city today (`crew/faces.ts`); the hashed one for a lone card. */
  portraitId: string = officerPortraitId(recruit.id),
  /** §J8: what this crew's badge has earned, for the standout seats' faction door. */
  factionInfamy = 0,
): BarRecruit {
  const assessment = assessAgainst(base, recruit, factionInfamy);
  // Already signed by this crew: the face on the card is the face on the books, not today's pick.
  const signed = base.commanders.find((officer) => officer.id === recruit.id);
  return {
    id: recruit.id,
    portraitId: signed?.portraitId ?? portraitId,
    name: recruit.name,
    attributes: recruit.attributes,
    perks: recruit.perks,
    requirement: recruit.requirement,
    assessment,
    // §H7 prices a fee only "if the character is interested". There is no number to show someone
    // who will not sit down, and inventing one would advertise a hire that cannot happen.
    askingWage: assessment.interested ? wageAskedOf(recruit) : null,
    hired: base.commanders.some((officer) => officer.id === recruit.id),
  };
}

/** One held officer: who they are, and what the book pays them. */
export function projectOfficer(base: Base, officer: Commander): BarOfficer {
  const fee = base.economy.payroll.commitments[officer.id] ?? 0;
  return { commander: officer, weeklyWage: fee, dismissalFee: dismissalFee(fee) };
}
