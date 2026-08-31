import { z } from 'zod';
import { AttributesSchema, DEFAULT_ATTRIBUTES, type Attributes } from './attributes.js';
import { PerksSchema } from './crew/perks.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
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
  /**
   * The chair they sit in, or `null` for somebody on the bench (§C2, board request).
   *
   * The bench is not a nineteenth kind of job, it is the absence of one: an officer you have signed
   * and have not decided about yet. They are on the books, they are drawing a wage, and they are
   * doing no job in particular, which is exactly what `null` says.
   *
   * What they are still worth is the interesting half. A seated officer is paid their full rating
   * in the attributes their chair actually uses and `OFF_DUTY_SHARE` of it everywhere else; a
   * benched one is paid the off-duty share in *everything*. So hiring somebody you have nowhere to
   * put is not wasted, and it is not free either: the chair is most of what an officer is worth.
   *
   * Nullable rather than a separate list on the base, because an officer is one kind of thing and
   * which of two arrays they happen to be in is not a fact about them. Every consumer that cares
   * about the chair had to learn about the empty one anyway.
   */
  role: OfficerRoleSchema.nullable(),
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
  /**
   * §D4: when this officer is back on their feet, or null while they are fit.
   *
   * A stored timestamp settled lazily, like payroll and the build queue: nothing has to run for an
   * officer to recover, and a crew nobody has looked at for a week is exactly as recovered as one
   * that was watched. While it is in the future the officer's services and bonuses are off, which
   * `crewSheetsFor` enforces by leaving them out of the room altogether.
   *
   * Defaulted, so every officer written before an officer could be hurt reads as fit.
   */
  injuredUntil: IsoDateTimeSchema.nullable().default(null),
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
  /** `null` puts them on the bench: signed, drawing a wage, doing no job in particular. */
  role: OfficerRole | null,
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
    injuredUntil: null,
  };
}
