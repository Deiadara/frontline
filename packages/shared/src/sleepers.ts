import { z } from 'zod';
import { ArmySchema } from './units/index.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';

/**
 * Sleepers, planted on ground before there is anything to fight over (maintainer, 2026-09-18).
 *
 * "They can be sent to a location despite of a battle and they just stay there doing nothing. If
 * a battle is called there they automatically participate as attackers when it's time, but up to
 * that point they are not visible by an enemy spy or anything."
 *
 * The Sleepers' own blurb has promised this since the roster was written, and nothing in the game
 * could express it: *"Planted long ago, and useful exactly once. They are already inside."*
 *
 * ## What it is worth, and the rule it bends
 *
 * Everything else in this game reaches a fight by being **sent to one**. A column leaves when the
 * fight is declared and walks; a garrison only stands on ground the crew or its faction already
 * holds (a move onto anybody else's is refused, `held_by_others`), which is exactly the ground worth
 * infiltrating. So the walk is always paid *after* the declaration, in the window everybody can see.
 *
 * Since 2026-09-28 who a waiting cell fights for is decided at the mark, like everything else on
 * the ground (`battle/alignment.ts` in the server): the declarer's own cell and a faction-mate's
 * attack, a cell of the defender's faction defends, and a neutral's keeps sleeping.
 *
 * A cell pays the walk **in advance**. That is the whole mechanic: plant them a day early, declare
 * when you like, and they are already standing there at the mark. It is the only way in the game
 * to have force somewhere before you have announced you want it.
 *
 * ## Only into an open district
 *
 * A district held end to end by one party is shut: its gate is the only thing that can be called
 * on, and a cell cannot be planted on a location behind it (`district_shut`, maintainer
 * 2026-09-29). The rule holds after the send as well: when the district a cell is sitting in
 * closes, whoever closed it, the cell turns for home the way a recalled one does
 * (`city/sleepers.ts`, `sendCellsHomeFromShutDistrict`).
 *
 * ## The three states
 *
 * One row per crew per location, merged on arrival, walking in both directions:
 *
 * - `outbound`: on the road. {@link SleeperCell.arrivesAt} is when they go to ground.
 * - `waiting`: in place. They do nothing at all, and nothing can reach them: no spy counts them
 *   without the Sleeper Lists rung, no fortification turns them up, no raid catches them. That is the maintainer's ruling
 *   and it is what "not visible by an enemy spy or anything" has to mean to be worth planting.
 * - `returning`: recalled, walking home. `arrivesAt` is when they rejoin the roster.
 *
 * They are still people the crew feeds: a planted cell counts against unit slots exactly as a
 * force at a fight does (§A1), because the alternative is a free barracks on somebody else's
 * ground.
 */
export const SLEEPER_PHASES = ['outbound', 'waiting', 'returning'] as const;
export const SleeperPhaseSchema = z.enum(SLEEPER_PHASES);

export const SleeperCellSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  /** The location they are planted on, which the crew does **not** hold. */
  locationId: IdSchema,
  army: ArmySchema,
  phase: SleeperPhaseSchema,
  departedAt: IsoDateTimeSchema,
  /**
   * The mark this phase runs to: when they go to ground, or when they are home.
   *
   * In `waiting` it is the moment they arrived and is read only as a "planted since". A cell
   * waiting has no next mark, which is the point of it: there is no clock on a Sleeper.
   */
  arrivesAt: IsoDateTimeSchema,
  /**
   * How long the walk out was, frozen at the send. The walk home is the same length.
   *
   * Stored rather than worked back out of the two marks above, because once a cell lands
   * `arrivesAt` is rewritten to the moment it went to ground: the difference then measures how
   * late the settle ran, not how far they went.
   */
  travelMs: z.number().int().nonnegative().default(0),
});
export type SleeperCell = z.infer<typeof SleeperCellSchema>;

/** Why a crew may not plant a cell here. */
export const SLEEPER_REFUSALS = [
  /** Their own ground. A garrison is what units on ground you hold are called. */
  'already_yours',
  /** Only the Sleepers do this. Every other sheet has to be sent to a fight or a job. */
  'not_sleepers',
  'not_enough_units',
  /** Nothing was named, or every count was zero. */
  'nobody_sent',
  /** The map has no road between the crew and that ground. */
  'no_road',
  /** A raid on the crew's own district lands within the hour: nobody leaves home now. */
  'garrison_locked',
  /**
   * The district is held end to end by somebody else (maintainer, 2026-09-29). A shut district
   * has one way in, its gate, and a cell is not a fight: it cannot be planted behind the wall.
   * The same rule sends a cell home the moment the district it sits in closes.
   */
  'district_shut',
  /** The location is in a city that is not open yet (`cityIsOpen`). */
  'city_closed',
] as const;
export const SleeperRefusalSchema = z.enum(SLEEPER_REFUSALS);
export type SleeperRefusal = z.infer<typeof SleeperRefusalSchema>;

export const SLEEPER_REFUSAL_TEXT: Record<SleeperRefusal, string> = {
  already_yours: 'You hold that place. People you leave there are a garrison, not a cell.',
  not_sleepers: 'Only Sleepers go to ground like this. Everybody else has to be sent to a fight.',
  not_enough_units: 'You do not have that many to send.',
  nobody_sent: 'Name somebody to send.',
  no_road: 'There is no road to that.',
  garrison_locked: 'A raid lands on your district within the hour. Nobody leaves home now.',
  district_shut:
    'That district is held end to end. Nothing gets in past the gate: call a fight on it instead.',
  city_closed: 'That city is not open yet. Nobody gets in.',
};

/**
 * Whether this unit may be planted as a cell.
 *
 * A flag on the sheet rather than an id typed in here, so the rule is a fact about the unit and a
 * second infiltrating sheet needs no edit at the doors. See `UnitSpec.sleeper`.
 */
export function cellCanHold(unit: { sleeper?: boolean } | undefined): boolean {
  return unit?.sleeper === true;
}
