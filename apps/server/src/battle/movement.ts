import { randomUUID } from 'node:crypto';
import {
  CITY_DISTRICTS,
  emptyDeployment,
  movementArrived,
  movementCancellable,
  movementForce,
  travelMinutesBetween,
  type Base,
  type BattleSide,
  type Movement,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { mergeArmies } from './forces.js';

/**
 * Columns on the road, and what happens when they stop walking (§A4).
 *
 * Three ends, and every one of them is a settle rather than a scheduler, the same as every other
 * clock in this game:
 *
 *   * **Arrived.** The column folds into the side's deployment and the row goes.
 *   * **Turned around.** Inside the first tenth of the walk, the units go straight back onto the
 *     roster: they have not reached anybody's ring, so nothing is owed.
 *   * **Overtaken.** The fight resolved while they were still walking, so they turn around too. A
 *     column that arrives at a finished battle is not a state the game should be able to reach.
 */

const MINUTE_MS = 60_000;

/** How long it takes this crew to reach the fight, in milliseconds. */
export function travelMsTo(repos: Repositories, base: Base, districtId: string): number {
  const from = CITY_DISTRICTS.find((district) => district.id === base.districtId);
  const to = CITY_DISTRICTS.find((district) => district.id === districtId);
  if (!from || !to) return 0;
  const speed = standingEffectsFor(repos, base).travelSpeedPercent;
  return travelMinutesBetween(from, to, speed) * MINUTE_MS;
}

/** Puts a column on the road. Callers have already taken the units off the roster. */
export function sendColumn(
  repos: Repositories,
  input: {
    base: Base;
    battleId: string;
    side: BattleSide;
    toDistrictId: string;
    army: Record<string, number>;
    perimeter: Record<string, number>;
    now: Date;
  },
): Movement {
  const travel = travelMsTo(repos, input.base, input.toDistrictId);
  const movement: Movement = {
    id: randomUUID(),
    baseId: input.base.id,
    battleId: input.battleId,
    side: input.side,
    fromDistrictId: input.base.districtId,
    toDistrictId: input.toDistrictId,
    army: input.army,
    perimeter: input.perimeter,
    departedAt: input.now.toISOString(),
    arrivesAt: new Date(input.now.getTime() + travel).toISOString(),
  };
  repos.movements.put(movement);
  return movement;
}

/**
 * Every column that has landed, folded into the deployment it was walking to.
 *
 * Runs on the read path in front of anything that reads a deployment, which is the same contract
 * the fortification and battle settlers have: a column that arrived while nobody was looking is on
 * the ground by the time the next request reads the row.
 */
export function settleMovements(repos: Repositories, now: Date): void {
  for (const movement of repos.movements.arrivedBy(now.toISOString())) {
    if (!movementArrived(movement, now)) continue;
    const battle = repos.sieges.find(movement.battleId);
    // Overtaken: the fight is over, or the row is gone. Send them home rather than onto a
    // battlefield that no longer exists.
    if (!battle || battle.resolvedAt !== null) {
      returnHome(repos, movement);
      continue;
    }
    // This crew's own row on that side, not the side as a whole: an ally's column arriving at your
    // battle joins *their* deployment, which is what sends their survivors back to them.
    const existing =
      repos.sieges.deployment(movement.battleId, movement.side, movement.baseId) ??
      emptyDeployment(movement.battleId, movement.baseId, movement.side, movement.arrivesAt);
    repos.sieges.putDeployment({
      ...existing,
      baseId: movement.baseId,
      army: mergeArmies(existing.army, movement.army),
      perimeter: mergeArmies(existing.perimeter, movement.perimeter),
      updatedAt: movement.arrivesAt,
    });
    repos.movements.remove(movement.id);
  }
}

/** Turn a column around: the units go back onto the roster and the row goes. */
export function returnHome(repos: Repositories, movement: Movement): void {
  const base = repos.bases.findById(movement.baseId);
  if (base) {
    const army = mergeArmies(base.army, movementForce(movement));
    repos.bases.updateArmy(base.id, army, base.trainingQueue);
  }
  repos.movements.remove(movement.id);
}

export type RecallRefusal = 'unknown_movement' | 'not_yours' | 'window_closed';

export type RecallResult =
  { kind: 'refused'; reason: RecallRefusal } | { kind: 'recalled'; movement: Movement };

/** §A4: call a column back, inside the first tenth of its walk. */
export function recallColumn(
  repos: Repositories,
  base: Base,
  movementId: string,
  now: Date,
): RecallResult {
  const movement = repos.movements.find(movementId);
  if (!movement) return { kind: 'refused', reason: 'unknown_movement' };
  if (movement.baseId !== base.id) return { kind: 'refused', reason: 'not_yours' };
  if (!movementCancellable(movement, now)) return { kind: 'refused', reason: 'window_closed' };
  returnHome(repos, movement);
  return { kind: 'recalled', movement };
}

/** Anything still walking to a fight that has just been decided comes home. */
export function recallOvertaken(repos: Repositories, battleId: string): void {
  for (const movement of repos.movements.forBattle(battleId)) returnHome(repos, movement);
}
