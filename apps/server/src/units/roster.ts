import {
  CITY_PLACES,
  COMBAT_CONTEXT_LABELS,
  UNIT_CATALOG,
  UNIT_MODIFIERS,
  addToArmy,
  armyCapacity,
  describeRequirement,
  isHeldBy,
  isUnitUnlocked,
  missingRequirements,
  supplyUsed,
  territoryEffectsFor,
  type Army,
  type Base,
  type UnitOption,
  type UnitsResponse,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { unlockContextFor } from './training.js';

/**
 * The unit roster (GDD §A5).
 *
 * The whole catalogue every read, locked entries included. A player deciding what to build next
 * needs to see that the Colossus wants a Garage at 16 *and* a war machine graveyard — a list that
 * hid everything unavailable would hide exactly the thing that makes the campaign legible.
 */

/** Units this crew has standing on captured places, summed across the city. */
export function garrisonedUnits(repos: Repositories, base: Base): Army {
  const controls = repos.city.controls();
  let total: Army = {};
  for (const place of CITY_PLACES) {
    const control = controls.get(place.id);
    if (!control || !isHeldBy(control, base.id)) continue;
    for (const [unitId, count] of Object.entries(control.garrison)) {
      total = addToArmy(total, unitId, count);
    }
  }
  return total;
}

export function projectUnits(repos: Repositories, base: Base, now: Date): UnitsResponse {
  const context = unlockContextFor(repos, base);
  const effects = territoryEffectsFor(base.id, CITY_PLACES, repos.city.controls());
  const garrisoned = garrisonedUnits(repos, base);

  const units: UnitOption[] = UNIT_CATALOG.map((unit) => ({
    id: unit.id,
    name: unit.name,
    tier: unit.tier,
    blurb: unit.blurb,
    trainedAt: unit.trainedAt,
    unique: unit.unique,
    stats: unit.stats,
    modifiers: unit.modifiers.map((id) => ({
      label: UNIT_MODIFIERS[id].label,
      description: UNIT_MODIFIERS[id].description,
      when: COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context],
    })),
    cost: unit.cost,
    trainSeconds: unit.trainSeconds,
    supply: unit.supply,
    unlocked: isUnitUnlocked(unit, context),
    missing: missingRequirements(unit, context).map(describeRequirement),
    owned: base.army[unit.id] ?? 0,
  }));

  return {
    serverNow: now.toISOString(),
    units,
    army: base.army,
    garrisoned,
    // Garrisons count against the cap: a unit standing on a rooftop three districts away is still
    // a unit this crew is feeding.
    supplyUsed: supplyUsed(base.army) + supplyUsed(garrisoned),
    supplyCap: armyCapacity(base.buildings),
    queue: base.trainingQueue,
    resources: base.resources,
    trainingCostReduction: effects.trainingCostPercent,
    trainingSpeedBonus: effects.trainingSpeedPercent,
  };
}
