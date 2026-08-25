import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { ArmySchema } from '../units/training.js';
import { BattleSideSchema } from './scheduled.js';

/**
 * Units on the road (GDD §A4).
 *
 * A crew's army stands in its own district. A fight happens somewhere else. Between the two there
 * is a city, and crossing it takes as long as crossing it takes: the same
 * `travelMinutesBetween` every other distance in the game is measured with.
 *
 * Before this, committing to a fight was instantaneous, which quietly removed the only decision
 * declaring a battle eight hours out was supposed to create. If a force can be on the ground the
 * moment you press a button, then holding it back costs nothing and a defender can wait to see
 * what turns up. Making the column *travel* is what puts the cost back: send early and you are
 * committed, send late and you may not arrive.
 *
 * ## What is where, while a column is walking
 *
 * The units have **left the roster** the moment they set out. That is the same rule deployment has
 * always had and it is what keeps a crew honest: the same twenty Razors cannot be promised to
 * three fights. They are not on the ground yet either. They are here, in a movement, which is a
 * third place, and the Actions screen is the window onto it.
 *
 * ## Coming back is not this
 *
 * Withdrawing is still immediate, and deliberately: a column that has *arrived* is standing on the
 * ground with the enemy's ring around it, and the price of leaving is the ring's toll rather than
 * a second walk. Travel is the price of getting there.
 */

export const MovementSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  battleId: IdSchema,
  side: BattleSideSchema,
  /** Where they set out from: the crew's own district. */
  fromDistrictId: IdSchema,
  /** Where the fight is. */
  toDistrictId: IdSchema,
  /** Into the line. */
  army: ArmySchema.default({}),
  /** Into the ring outside it. */
  perimeter: ArmySchema.default({}),
  departedAt: IsoDateTimeSchema,
  arrivesAt: IsoDateTimeSchema,
});
export type Movement = z.infer<typeof MovementSchema>;

/**
 * How long a column may be turned around, as a share of its own walk.
 *
 * The same tenth the training bench uses, and for the same reason: long enough to undo a misclick,
 * short enough that it is not a way to keep an army in superposition while you wait to see what
 * the other side does.
 */
export const MOVEMENT_CANCEL_WINDOW = 0.1;

const SECOND_MS = 1000;

export function movementTotalMs(movement: Movement): number {
  return Math.max(SECOND_MS, Date.parse(movement.arrivesAt) - Date.parse(movement.departedAt));
}

export function movementRemainingMs(movement: Movement, now: Date): number {
  return Math.max(0, Date.parse(movement.arrivesAt) - now.getTime());
}

export function movementProgressAt(movement: Movement, now: Date): number {
  const elapsed = now.getTime() - Date.parse(movement.departedAt);
  return Math.min(1, Math.max(0, elapsed / movementTotalMs(movement)));
}

export function movementArrived(movement: Movement, now: Date): boolean {
  return movementRemainingMs(movement, now) === 0;
}

/** Whether this column can still be turned around, which is the first tenth of its walk. */
export function movementCancellable(movement: Movement, now: Date): boolean {
  return movementProgressAt(movement, now) < MOVEMENT_CANCEL_WINDOW;
}

/** How long is left to change your mind, in milliseconds. Zero once the window has shut. */
export function movementCancelWindowMs(movement: Movement, now: Date): number {
  const shutsAt =
    Date.parse(movement.departedAt) + movementTotalMs(movement) * MOVEMENT_CANCEL_WINDOW;
  return Math.max(0, shutsAt - now.getTime());
}

/** Everything in the column, line and ring together. What goes back if it is turned around. */
export function movementForce(movement: Movement): Record<string, number> {
  const total: Record<string, number> = { ...movement.army };
  for (const [unitId, count] of Object.entries(movement.perimeter)) {
    total[unitId] = (total[unitId] ?? 0) + count;
  }
  return total;
}

/** Bodies on the road. */
export function movementSize(movement: Movement): number {
  return Object.values(movementForce(movement)).reduce((total, count) => total + count, 0);
}
