import { addToArmy, takeFromArmy, type Army } from '@frontline/shared';

/**
 * Moving bodies between the four locations they can stand.
 *
 * A crew's units live in exactly one of: the roster at home (`base.army`), a garrison on a location
 * (`location_control.garrison`), a deployment for a coming fight, or the ring outside it. Every move
 * between those is one of the four functions here, and they are shared rather than re-declared per
 * module because the city actions and the siege deployments were about to grow a private copy each,
 * and the copy that drifts is the one that lets a stack be in two locations at once.
 */

export const forceSize = (force: Army): number =>
  Object.values(force).reduce((total, count) => total + count, 0);

/** Whether `army` really contains everything `force` claims to be taking. */
export function hasForce(army: Army, force: Army): boolean {
  return Object.entries(force).every(([unitId, count]) => (army[unitId] ?? 0) >= count);
}

export function removeForce(army: Army, force: Army): Army {
  return Object.entries(force).reduce(
    (left, [unitId, count]) => takeFromArmy(left, unitId, count),
    army,
  );
}

export function mergeArmies(into: Army, extra: Army): Army {
  return Object.entries(extra).reduce(
    (army, [unitId, count]) => addToArmy(army, unitId, count),
    into,
  );
}
