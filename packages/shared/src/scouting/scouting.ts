import { z } from 'zod';
import { cancelWindowMs, cancelWindowOpen } from '../time/cancel.js';
import { ATTRIBUTE_NAMES, type Attributes } from '../attributes.js';
import { IsoDateTimeSchema, IdSchema } from '../primitives.js';

/**
 * Scouting a district (§A4, maintainer rework).
 *
 * It used to be a button. `POST /city/scout` marked the ground seen and returned, instantly, free,
 * from anywhere on the map, which made the fog a formality: every district was one click from
 * being open and the officer whose entire job is this had nothing to do with it.
 *
 * Now it is a journey somebody makes. You send **one officer**, they walk there, they spend time
 * on the ground, and they walk back. Nothing else goes with them and nobody fights: a scout is not
 * a raid with the numbers turned down, it is a person looking at something and coming home to say
 * what they saw. That is also why it cannot fail. The cost is the clock and the officer, and a
 * scouting run that could come back empty would just mean doing it twice.
 *
 * ## What the scout is for
 *
 * The time on the ground is the half the officer changes, and it is the reason the Scout's chair
 * is worth filling: a good one is on and off the ground in under an hour, a poor one is most of a
 * shift. The walk is the same for anybody, because the map does not care who is crossing it.
 */

/**
 * The longest anybody spends looking, in minutes, before their own sheet is read.
 *
 * Four hours for somebody with nothing to recommend them. Long enough that the Scout's chair is a
 * real decision and short enough that a player who has not filled it is inconvenienced rather than
 * locked out: you can always send whoever you have.
 */
export const SCOUT_MINUTES_MAX = 240;

/**
 * And the floor, however good they are.
 *
 * Forty minutes, so the best scout in the game still costs a real slice of an evening. A ground
 * that can be read in five minutes is a fog nobody plans around, which is where this started.
 */
export const SCOUT_MINUTES_MIN = 40;

/**
 * The sheet total at which somebody is as fast as the floor allows.
 *
 * Read against the *whole* sheet rather than one attribute, which is the board's instruction and
 * also the honest reading: casing a district is walking, watching, counting, remembering and not
 * being noticed, and there is no single number for that. A recruit off the Bar sits around 15 an
 * attribute, so a fresh officer totals a few hundred; this is set well above that so scouting
 * speed is something a crew *develops* rather than something it rolls.
 */
export const SCOUT_PEAK_TOTAL = 1_400;

/** Every point on the sheet, added. The one figure the scouting clock is priced against. */
export function scoutRating(attributes: Attributes): number {
  return ATTRIBUTE_NAMES.reduce((total, name) => total + attributes[name], 0);
}

/**
 * How long this person spends on the ground, in minutes.
 *
 * Linear between the two bounds, because a curve here would be a balance decision nobody can read
 * off the screen: a player who doubles an officer's sheet should see the time roughly halve
 * towards the floor, and linear is the only shape that keeps that sentence true.
 */
export function scoutMinutesFor(attributes: Attributes): number {
  const share = Math.min(1, Math.max(0, scoutRating(attributes) / SCOUT_PEAK_TOTAL));
  const span = SCOUT_MINUTES_MAX - SCOUT_MINUTES_MIN;
  return Math.round(SCOUT_MINUTES_MAX - span * share);
}

/**
 * The whole run, in minutes: there, on the ground, and back.
 *
 * The walk is counted **twice** and that is the point of the geography. Scouting the district next
 * door is an errand; casing the far side of the city costs the crossing at both ends, which is
 * what makes a rail yard worth building and a distant district worth thinking about before
 * sending somebody.
 */
export function scoutRunMinutes(travelMinutes: number, attributes: Attributes): number {
  return travelMinutes * 2 + scoutMinutesFor(attributes);
}

/** Why a scouting run cannot go out. */
export const SCOUT_REFUSALS = [
  'already_scouted',
  'already_out',
  'no_officer',
  /** They are already leading a fight, out on a job, or out scouting. */
  'officer_busy',
  /** §D4: they came home hurt and their services are inactive until they are well. */
  'officer_injured',
  'own_district',
] as const;
export type ScoutRefusal = (typeof SCOUT_REFUSALS)[number];

export const ScoutingRunSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  districtId: IdSchema,
  /** The officer who went. They are out of the crew's reach until they are home. */
  officerId: IdSchema,
  departedAt: IsoDateTimeSchema,
  /** When they are back and the ground is open. One mark: there is no separate arrival. */
  returnsAt: IsoDateTimeSchema,
  /**
   * The walk out, frozen at the send, exactly as a mission freezes its own `travelMinutes`.
   *
   * Stored rather than derived, because it cannot be derived. The mark is the whole run, which is
   * the walk twice plus the looking, and the looking is anything from forty minutes to four hours
   * depending on whose sheet it was priced against: half the mark is not the walk out, and reading
   * it as if it were left the recall window open long after the scout had arrived. Working it back
   * off the officer's sheet would be worse again, since a retune or a levelled-up scout would move
   * the leg of a run already on the road.
   *
   * Defaulted for rows written before it existed; 0 shuts their window rather than guessing.
   */
  travelMinutes: z.number().int().nonnegative().default(0),
  /**
   * Set when the crew turned the scout round (maintainer request, 2026-09-12). `returnsAt` is then
   * the walk home, as long as the walk out had been, and the ground does **not** open when they
   * are back: they never got there.
   */
  recalledAt: IsoDateTimeSchema.nullable().default(null),
});
export type ScoutingRun = z.infer<typeof ScoutingRunSchema>;

/** The way out: the leg the send froze, and the only part of the run a recall can undo. */
function outboundMs(run: Pick<ScoutingRun, 'travelMinutes'>): number {
  return run.travelMinutes * 60_000;
}

/** What a recall needs to know: who is out, since when, and how long the walk out is. */
type RecallableRun = Pick<ScoutingRun, 'departedAt' | 'travelMinutes' | 'recalledAt'>;

/** Whether the scout can still be turned round: the first tenth of the way out. */
export function scoutRecallable(run: RecallableRun, now: Date): boolean {
  if (run.recalledAt !== null) return false;
  return cancelWindowOpen(Date.parse(run.departedAt), outboundMs(run), now.getTime());
}

export function scoutRecallWindowMs(run: RecallableRun, now: Date): number {
  if (run.recalledAt !== null) return 0;
  return cancelWindowMs(Date.parse(run.departedAt), outboundMs(run), now.getTime());
}

/** When a scout turned round at `now` is home: as far back as they have come. */
export function scoutRecalledReturnsAt(run: Pick<ScoutingRun, 'departedAt'>, now: Date): Date {
  return new Date(now.getTime() + Math.max(0, now.getTime() - Date.parse(run.departedAt)));
}

/** Whether this run is done, against a clock the server owns. */
export function scoutRunIsDue(run: ScoutingRun, now: Date): boolean {
  return Date.parse(run.returnsAt) <= now.getTime();
}
