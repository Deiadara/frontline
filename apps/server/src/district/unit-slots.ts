import {
  districtUnitSlotCapacity,
  mergeFleets,
  movementForce,
  unitSlotDraw,
  type Army,
  type Base,
  type Fleet,
  type UnitSlotDraw,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { mergeArmies } from '../battle/forces.js';
import { garrisonedUnits } from '../units/roster.js';

/**
 * Who the district is housing (GDD §A1 the Quarters, §H the officers, §A5 the army, §C the yard).
 *
 * One definition of "used", read by every gate that enforces it: ordering a unit and laying down a
 * machine. Separate counts would drift, and the failure would be silent: a district that let you
 * build past its beds and then refused to train anybody reads as a bug rather than as a rule.
 *
 * The army is in the same pool as the people now. It used to have a Gauntlet-driven ceiling of its
 * own, which meant a crew could fill both to the brim without either counter noticing.
 *
 * The officers and the yard joined them on 2026-09-15, at one bed each (`building/unit-slots.ts`
 * holds the rule and the argument). Until then the doc comment on this function claimed the
 * officers were counted and the arithmetic under it did not count them: `unitSlotDraw` reported
 * `officers` and left the figure out of `total`.
 *
 * Garrisons count. A unit standing on a rooftop three districts away is still somebody this crew
 * feeds, and leaving them out would make emptying the district into the city a way to house an
 * army for free. Callers that have already summed them pass them in rather than paying for the
 * walk twice.
 *
 * Units at a fight count too, for the same reason and by the same argument. A crew that sends
 * four Razors to a battle has four Razors fewer on the roster, and if that is the whole sum then
 * sending them out frees their beds: the freed beds take a training order, the fight ends, and the
 * survivors come home into a district that no longer has room for them. A slot is what this
 * crew *feeds*, not what is standing in the yard, so a column on the road and a muster on the
 * ground are both in it.
 *
 */
export interface DistrictUnitSlots extends UnitSlotDraw {
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
  /*
   * §E: and the crews out on missions, which were missing entirely.
   *
   * A launch takes the force out of `base.army` and parks it on the mission row, so until this
   * they were counted nowhere: not at home, not abroad, not against the ceiling. That made the
   * §A1 unit-slot cap dodgeable by anybody with a day-long job on the board. Send the army out,
   * watch `unitSlotsUsed` fall, train a second one into the gap, and be over the cap the moment the
   * first came home.
   *
   * They are still people this crew feeds, which is the same sentence that puts a garrison and a
   * marching column in this fold.
   */
  for (const stored of repos.missions.listActiveByBaseId(base.id)) {
    total = mergeArmies(total, stored.mission.force);
  }
  /*
   * §A4: and the Sleepers planted on somebody else's ground (`city/sleepers.ts`).
   *
   * The same sentence again, and the same hole it closes. A cell leaves `base.army` the moment it
   * is sent and does not come back until it is recalled or woken into a fight, so without this it
   * was counted nowhere at all: plant the army, watch `unitSlotsUsed` fall, train a second one
   * into the room, and be over the §A1 cap the day the first lot walks home.
   *
   * Every phase, not only `waiting`: a cell on the road out and a cell on the road home are both
   * people this crew feeds, exactly as a marching column is.
   */
  for (const cell of repos.sleepers.forBase(base.id)) {
    total = mergeArmies(total, cell.army);
  }
  // Columns between the crew's own places, and units posted on allies' ground (2026-09-22).
  for (const move of repos.moves.activeFor(base.id)) {
    total = mergeArmies(total, move.army);
  }
  for (const posted of repos.alliedGarrisons.forBase(base.id)) {
    total = mergeArmies(total, posted.army);
  }
  return total;
}

/**
 * Every machine of this crew's that has left the yard and is coming back.
 *
 * Committed to a fight (the deployment row holds it until the settle hands the survivors back) or
 * carrying a crew on a run. Both take it out of `base.fleet`, which is the same trick
 * {@link unitsAbroad} exists to close: if the yard were the whole sum, sending the machines out
 * would free their beds, the freed beds would take a training order, and the convoy would come home
 * into a district with no room for it.
 *
 * The Garage reads this too, against `MAX_PER_VEHICLE`, so what the ceiling counts and what the
 * beds count cannot disagree about where a machine is.
 */
export function vehiclesAbroad(repos: Repositories, base: Base): Fleet {
  const committed = repos.sieges
    .deploymentsFor(base.id)
    .map((deployment) => deployment.vehicles)
    .reduce(mergeFleets, {} as Fleet);
  const riding = repos.missions
    .listActiveByBaseId(base.id)
    .map((stored) => stored.mission.vehicles)
    .reduce(mergeFleets, {} as Fleet);
  const moving = repos.moves
    .activeFor(base.id)
    .map((move) => move.vehicles)
    .reduce(mergeFleets, {} as Fleet);
  return mergeFleets(mergeFleets(committed, riding), moving);
}

export function districtUnitSlots(
  repos: Repositories,
  base: Base,
  garrison?: Army,
): DistrictUnitSlots {
  // The ground is part of the ceiling (§B5): every location a crew holds is somewhere its people
  // live, so this has to read the same fold the rest of the game reads rather than the buildings
  // alone.
  const capacity = districtUnitSlotCapacity(base.buildings, standingEffectsFor(repos, base));
  const draw = unitSlotDraw({
    ...base,
    // The gate garrison draws beds like everybody else: it is the crew's army at the door.
    garrison: mergeArmies(
      mergeArmies(garrison ?? garrisonedUnits(repos, base), unitsAbroad(repos, base)),
      base.gateArmy ?? {},
    ),
    fleet: mergeFleets(base.fleet, vehiclesAbroad(repos, base)),
  });
  return { ...draw, capacity, spare: Math.max(0, capacity - draw.total) };
}
