import {
  districtPopulationCapacity,
  movementForce,
  populationDraw,
  type Army,
  type Base,
  type PopulationDraw,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { mergeArmies } from '../battle/forces.js';
import { garrisonedUnits } from '../units/roster.js';

/**
 * Who the district is housing (GDD §A1 the Quarters, §G the assignee pool, §H the officers, §A5
 * the army).
 *
 * One definition of "used", read by every gate that enforces it: hiring an officer, placing an
 * assignee, and ordering a unit. Separate counts would drift, and the failure would be silent: a
 * district that let you hire past its beds and then refused to place anybody reads as a bug rather
 * than as a rule.
 *
 * The army is in the same pool as the people now. It used to have a Gauntlet-driven ceiling of its
 * own, which meant a crew could fill both to the brim without either counter noticing.
 *
 * Garrisons count. A unit standing on a rooftop three districts away is still somebody this crew
 * feeds, and leaving them out would make emptying the district into the city a way to house an
 * army for free. Callers that have already summed them pass them in rather than paying for the
 * walk twice.
 *
 * Units at a fight count too, for the same reason and by the same argument. A crew that sends
 * four Razors to a battle has four Razors fewer on the roster, and if that is the whole sum then
 * sending them out frees their beds: the freed beds take a training order, the fight ends, and the
 * survivors come home into a district that no longer has room for them. Population is what this
 * crew *feeds*, not what is standing in the yard, so a column on the road and a muster on the
 * ground are both in it.
 *
 * Unplaced assignees are deliberately not counted. §G2 hands them over on a level-up whether or not
 * there is anywhere to put them, so counting them would let a level-up retroactively overfill a
 * district the player had built correctly.
 */
export interface DistrictPopulation extends PopulationDraw {
  capacity: number;
  /** Beds left, floored at zero. The number every gate actually compares against. */
  spare: number;
}

/**
 * Everything this crew has committed to a fight and not got back: musters standing on the ground,
 * and columns still walking to one.
 *
 * `deploymentsFor` is already scoped to battles that have not resolved, and `settleMovements` and
 * `recallOvertaken` between them make sure a movement row outlives neither its arrival nor its
 * battle. So nothing here can be counted after the units are home again.
 */
export function unitsAbroad(repos: Repositories, base: Base): Army {
  let total: Army = {};
  for (const deployment of repos.sieges.deploymentsFor(base.id)) {
    total = mergeArmies(total, mergeArmies(deployment.army, deployment.perimeter));
  }
  for (const movement of repos.movements.forBase(base.id)) {
    total = mergeArmies(total, movementForce(movement));
  }
  return total;
}

export function districtPopulation(
  repos: Repositories,
  base: Base,
  garrison?: Army,
): DistrictPopulation {
  // The ground is part of the ceiling (§B5): every location a crew holds is somewhere its people
  // live, so this has to read the same fold the rest of the game reads rather than the buildings
  // alone.
  const capacity = districtPopulationCapacity(base.buildings, standingEffectsFor(repos, base));
  const draw = populationDraw({
    ...base,
    garrison: mergeArmies(garrison ?? garrisonedUnits(repos, base), unitsAbroad(repos, base)),
  });
  return { ...draw, capacity, spare: Math.max(0, capacity - draw.total) };
}
