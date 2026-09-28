import { z } from 'zod';
import { FleetSchema } from '../building/vehicles.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { cancelWindowMs, cancelWindowOpen, turnaroundMs } from '../time/cancel.js';
import { ArmySchema } from '../units/index.js';

/**
 * Moving units between the places a crew keeps them (maintainer ruling, 2026-09-22).
 *
 * A crew's army stands in three kinds of place: the **district** (home, where new units land),
 * the **gate** (the garrison that answers a call on the door), and **locations** it holds or
 * that a faction ally holds. Each defends its own place and nothing else: a gate fight is met by
 * the gate garrison, a raid inside a breach by the district army, a fight over a location by
 * whoever is standing on it. A move is a column walking from one of those to another, on the
 * clock, and it can be turned round in the first tenth of the way like everything else.
 *
 * Walking onto ground nobody holds claims it on arrival, with no fight. Walking onto a faction
 * ally's ground posts the units there: they stay the sender's, and they fight for the holder.
 *
 * **Nothing teleports** (maintainer, 2026-09-28: "Nothing sends units immediately, you need to
 * move them"). Every placement is a column on this clock, and so is every trip home the game makes
 * for a crew: units pulled out of a fight, a posting whose alliance ended, a column that reached
 * ground that would not have it, all walk home from where they were.
 */

export const MovePlaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('district') }),
  z.object({ kind: z.literal('gate') }),
  z.object({ kind: z.literal('location'), locationId: IdSchema }),
  /*
   * The open streets of somebody else's district: where a gate fight or a raid is fought from.
   *
   * Never a place a player picks. It exists so a column coming home from a fight at another crew's
   * gate or inside their breach has somewhere to have set out from, and so a column still walking
   * to such a fight when it ends has somewhere to arrive before it turns for home.
   */
  z.object({ kind: z.literal('street'), districtId: IdSchema }),
]);
export type MovePlace = z.infer<typeof MovePlaceSchema>;

/** District to gate or back, before speed and the crew's road bonuses. */
export const MOVE_GATE_MINUTES = 10;

export const MOVE_REFUSALS = [
  'same_place',
  'nobody_sent',
  'not_enough_units',
  'not_enough_vehicles',
  /** A garrison is a line: scavengers do not hold ground. */
  'not_a_fighting_force',
  'needs_infamy',
  /** The source is not a place this crew has units standing. */
  'not_yours',
  'unscouted',
  /** Somebody else holds the ground: call a fight instead. */
  'held_by_others',
  'no_road',
  /** A fight is called on this empty ground: nobody claims it until it is over. */
  'under_fire',
  /** A fight lands on the ground the column leaves within the hour: nothing leaves it now. */
  'garrison_locked',
] as const;
export type MoveRefusal = (typeof MOVE_REFUSALS)[number];

export const UnitMoveSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  from: MovePlaceSchema,
  to: MovePlaceSchema,
  army: ArmySchema,
  /** Machines carrying the column. Back in the yard the moment it lands. */
  vehicles: FleetSchema.default({}),
  departedAt: IsoDateTimeSchema,
  arrivesAt: IsoDateTimeSchema,
  /** The walk, frozen at the send: the leg a recall is measured against. */
  travelMinutes: z.number().int().nonnegative(),
  recalledAt: IsoDateTimeSchema.nullable().default(null),
});
export type UnitMove = z.infer<typeof UnitMoveSchema>;

export const UnitMoveViewSchema = z.object({
  id: IdSchema,
  from: MovePlaceSchema,
  to: MovePlaceSchema,
  fromName: z.string(),
  toName: z.string(),
  army: ArmySchema,
  vehicles: FleetSchema.default({}),
  size: z.number().int().nonnegative(),
  departedAt: IsoDateTimeSchema,
  arrivesAt: IsoDateTimeSchema,
  travelMinutes: z.number().int().nonnegative(),
  recalledAt: IsoDateTimeSchema.nullable(),
});
export type UnitMoveView = z.infer<typeof UnitMoveViewSchema>;

/** One entry in the Move dialog's list of places: yours first, then the faction's. */
export const MoveDestinationSchema = z.object({
  place: MovePlaceSchema,
  /** "Your District", "Your Gate", or the location's name. */
  label: z.string(),
  /** The district it is in, for a location, so two places with one name read apart. */
  districtName: z.string().nullable(),
  group: z.enum(['yours', 'faction']),
  /** Who holds it, for a faction ally's ground. */
  holderName: z.string().nullable(),
});
export type MoveDestination = z.infer<typeof MoveDestinationSchema>;

export function samePlace(a: MovePlace, b: MovePlace): boolean {
  if (a.kind === 'location' && b.kind === 'location') return a.locationId === b.locationId;
  if (a.kind === 'street' && b.kind === 'street') return a.districtId === b.districtId;
  return a.kind === b.kind;
}

type RecallableMove = Pick<UnitMove, 'departedAt' | 'travelMinutes' | 'recalledAt'>;

export function moveRecallable(move: RecallableMove, now: Date): boolean {
  if (move.recalledAt !== null) return false;
  return cancelWindowOpen(Date.parse(move.departedAt), move.travelMinutes * 60_000, now.getTime());
}

export function moveRecallWindowMs(move: RecallableMove, now: Date): number {
  if (move.recalledAt !== null) return 0;
  return cancelWindowMs(Date.parse(move.departedAt), move.travelMinutes * 60_000, now.getTime());
}

/** Turned round: home as far off as they had come, and never further than the way out. */
export function moveRecalledReturnsAt(
  move: Pick<UnitMove, 'departedAt' | 'travelMinutes'>,
  now: Date,
): Date {
  return new Date(now.getTime() + turnaroundMs(move, now));
}
