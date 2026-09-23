import {
  addToArmy,
  bareLineRules,
  findUnit,
  standsInLine,
  takeFromArmy,
  type Army,
  type LineRules,
} from '@frontline/shared';

/**
 * Moving units between the four locations they can stand.
 *
 * A crew's units live in exactly one of: the roster at home (`base.army`), a garrison on a location
 * (`location_control.garrison`), a deployment for a coming fight, or the ring outside it. Every move
 * between those is one of the four functions here, and they are shared rather than re-declared per
 * module because the city actions and the siege deployments were about to grow a private copy each,
 * and the copy that drifts is the one that lets a stack be in two locations at once.
 */

export const forceSize = (force: Army): number =>
  Object.values(force).reduce((total, count) => total + count, 0);

/**
 * Whether every unit in this force is one that can actually be put in a line (§A5).
 *
 * The support tier cannot: Scavengers and Haulers carry, they do not fight, and a fight is the
 * one place they may never be sent. Checked here rather than at each route because a force is a
 * force wherever it is going, and a door that forgot the rule would put a porter in a rank and
 * quietly kill them for a percentage of an exchange.
 *
 * `rules` is the crew's own, because the rule has an exception the crew can buy. `carriers_fight`
 * (the Chief Quartermaster's track, and the Scrap Cathedral) puts the porters in the line at half
 * strength, and the engine has honoured it since it was written: `standsInLine` is what every
 * round asks. The doors did not, so a crew that had paid for the programme still could not send a
 * porter anywhere a fight was going to happen, and the perk was unreachable outside a home
 * defence. Defaulted to the bare rules so a caller with no crew in hand gets the strict reading.
 */
export function isFightingForce(force: Army, rules: LineRules = bareLineRules()): boolean {
  return Object.entries(force).every(([unitId, count]) => {
    if (count <= 0) return true;
    const unit = findUnit(unitId);
    return unit !== undefined && standsInLine(unit, rules);
  });
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
