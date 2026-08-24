import {
  CITY_LOCATIONS,
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
  type Army,
  type Base,
  type UnitOption,
  type UnitsResponse,
  upgradedStats,
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  type UnitSpec,
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { unlockContextFor } from './training.js';

/**
 * The unit roster (GDD §A5).
 *
 * The whole catalogue every read, locked entries included. A player deciding what to build next
 * needs to see that the Colossus wants a Garage at 16 *and* a war machine graveyard — a list that
 * hid everything unavailable would hide exactly the thing that makes the campaign legible.
 */

/** Units this crew has standing on captured locations, summed across the city. */
export function garrisonedUnits(repos: Repositories, base: Base): Army {
  const controls = repos.city.controls();
  let total: Army = {};
  for (const location of CITY_LOCATIONS) {
    const control = controls.get(location.id);
    if (!control || !isHeldBy(control, base.id)) continue;
    for (const [unitId, count] of Object.entries(control.garrison)) {
      total = addToArmy(total, unitId, count);
    }
  }
  return total;
}

/**
 * §A4 — the labels this unit reacts to unusually, in the player's words.
 *
 * Read off `affinities` and `immuneTo` only, never off the stat-driven baseline. That is the whole
 * editorial decision here: every unit in the game has an opinion about every label, and printing
 * thirteen rows of them would make the one line that matters unfindable. What a card shows is what
 * its *sheet does not already say* — and the sheet is right there under it.
 */
function groundAffinities(unit: UnitSpec): UnitOption['affinities'] {
  const rows: UnitOption['affinities'] = [];
  for (const id of ENV_LABEL_IDS) {
    const immune = unit.immuneTo?.includes(id) ?? false;
    const per = unit.affinities?.[id] ?? 0;
    if (!immune && per === 0) continue;
    rows.push({
      id,
      label: ENV_LABEL_CATALOG[id].name,
      note: immune && per === 0 ? 'Immune' : `${per > 0 ? '+' : ''}${per}% per tier`,
      good: immune || per > 0,
    });
  }
  return rows;
}

export function projectUnits(repos: Repositories, base: Base, now: Date): UnitsResponse {
  const context = unlockContextFor(repos, base);
  const effects = standingEffectsFor(repos, base);
  const garrisoned = garrisonedUnits(repos, base);

  const units: UnitOption[] = UNIT_CATALOG.map((unit) => ({
    id: unit.id,
    name: unit.name,
    tier: unit.tier,
    blurb: unit.blurb,
    trainedAt: unit.trainedAt,
    unique: unit.unique,
    // The workshop's fitted upgrades, folded in at read time.
    //
    // Not written into the roster when an upgrade is bought: folding here is what makes a refit
    // reach the units trained last week as well as the ones trained tomorrow, which is what
    // "the workshop refits everybody" has to mean for a player not to find it maddening.
    stats: upgradedStats(unit.stats, base.fittedUpgrades),
    modifiers: unit.modifiers.map((id) => ({
      label: UNIT_MODIFIERS[id].label,
      description: UNIT_MODIFIERS[id].description,
      when: COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context],
    })),
    affinities: groundAffinities(unit),
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
