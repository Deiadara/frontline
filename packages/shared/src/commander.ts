import { z } from 'zod';
import { AttributesSchema, DEFAULT_ATTRIBUTES, type Attributes } from './attributes.js';
import { PerksSchema } from './crew/perks.js';
import { IdSchema } from './primitives.js';
import { OfficerRoleSchema, type OfficerRole } from './roles.js';

/**
 * A character hired into one of the officer positions in GDD §C1.
 *
 * ## What an officer is, and what they used to be
 *
 * Four things came off this sheet, and they came off together because they were one idea: that a
 * hire was a *relationship* you maintained. An officer had an `ambition` and a `moralCompass`
 * (what they were after), an `alignment` that drifted while you were not looking, and a `level`
 * with banked XP and points to spend. Between them they asked a player to keep nineteen people
 * happy and nineteen people levelled, on top of a city, an army and a research tree.
 *
 * None of it survived contact with what the screens actually showed. Alignment was a number that
 * moved on its own and could be read as a mood badge nobody could act on; the level was a second
 * progression track running beside the player's own, paying out points into the same attributes
 * the Bar had already sold you on.
 *
 * So an officer is now exactly two things: **the sheet they were hired with**, and **what they
 * bring** ({@link PerksSchema}). Both are visible at the Bar before a single cap is committed,
 * neither changes behind the player's back, and the only ongoing cost is the wage. What used to be
 * "manage your people" is now "choose your people", which is the decision the Bar was always for.
 */
export const CommanderSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  role: OfficerRoleSchema,
  attributes: AttributesSchema,
  /**
   * §B7: nought to three perks, the things this person brings to the whole crew.
   *
   * Defaulted so an officer written before the perk book existed parses as somebody who brings
   * nothing but their sheet, which is what they were.
   */
  perks: PerksSchema.default([]),
  /**
   * §H7: what they agreed to, in caps a week.
   *
   * Named for what it is. It was `askingWage`, holding the price they *opened* at, because the
   * §H5 drift measured how far the player had ground them below it: an officer who took their
   * floor resented it for the rest of their tenure. With that mechanic gone the opening number has
   * no reader left, and the number that matters is the one the payroll book is charged every week.
   *
   * Frozen at hire, so an officer who talked their way to a low number stays cheap for as long as
   * they are on the books.
   */
  weeklyWage: z.number().int().nonnegative().default(0),
});
export type Commander = z.infer<typeof CommanderSchema>;

/**
 * Example factory: unlisted attributes default to the recruitment mean.
 *
 * Recruits hired at the Bar are built by the server from a rolled sheet instead (§H2).
 */
export function createCommander(
  id: string,
  name: string,
  role: OfficerRole,
  attributes: Partial<Attributes> = {},
  perks: readonly string[] = [],
  weeklyWage = 0,
): Commander {
  return {
    id,
    name,
    role,
    attributes: { ...DEFAULT_ATTRIBUTES, ...attributes },
    perks: [...perks],
    weeklyWage,
  };
}
