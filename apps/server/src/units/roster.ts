import {
  CITY_LOCATIONS,
  COMBAT_CONTEXT_LABELS,
  UNIT_CATALOG,
  UNIT_MODIFIERS,
  unitRules,
  addToArmy,
  describeRequirement,
  isHeldBy,
  isUnitUnlocked,
  missingRequirements,
  type Army,
  type Base,
  type UnitOption,
  type UnitsResponse,
  upgradedStats,
  type FittedSlot,
  type UpgradeSpec,
  fittedFor,
  findUpgrade,
  slotsFor,
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  type UnitSpec,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { trainingRatesFor, unlockContextFor } from './training.js';
import { districtPopulation, unitsAbroad } from '../district/population.js';

/**
 * The unit roster (GDD §A5).
 *
 * The whole catalogue every read, locked entries included. A player deciding what to build next
 * needs to see that the Colossus wants a Garage at 16 *and* a war machine graveyard: a list that
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
 * §A4: the labels this unit reacts to unusually, in the player's words.
 *
 * Read off `affinities` and `immuneTo` only, never off the stat-driven baseline. That is the whole
 * editorial decision here: every unit in the game has an opinion about every label, and printing
 * thirteen rows of them would make the one line that matters unfindable. What a card shows is what
 * its *sheet does not already say*, and the sheet is right there under it.
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

/** One bracket, as the card draws it: what is in it, or the fact that nothing is. */
function describeSlot(upgradeId: string | null): FittedSlot {
  const spec = upgradeId === null ? undefined : findUpgrade(upgradeId);
  if (!spec) return { upgradeId: null, name: '', line: null, tier: 0, effect: {} };
  return {
    upgradeId: spec.id,
    name: spec.name,
    line: spec.line,
    tier: spec.tier,
    effect: spec.effect as Record<string, number>,
  };
}

export function projectUnits(repos: Repositories, base: Base, now: Date): UnitsResponse {
  const context = unlockContextFor(repos, base);
  const rates = trainingRatesFor(repos, base);
  const garrisoned = garrisonedUnits(repos, base);
  const abroad = unitsAbroad(repos, base);
  const population = districtPopulation(repos, base, garrisoned);

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
    stats: upgradedStats(unit.stats, fittedFor(base.unitLoadouts, unit.id)),
    modifiers: unit.modifiers.map((id) => ({
      label: UNIT_MODIFIERS[id].label,
      description: UNIT_MODIFIERS[id].description,
      when: COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context],
    })),
    rules: unitRules(unit),
    affinities: groundAffinities(unit),
    cost: unit.cost,
    trainSeconds: unit.trainSeconds,
    supply: unit.supply,
    unlocked: isUnitUnlocked(unit, context),
    missing: missingRequirements(unit, context).map(describeRequirement),
    owned: base.army[unit.id] ?? 0,
    slots: slotsFor(base.unitLoadouts, unit.id).map(describeSlot),
  }));

  return {
    serverNow: now.toISOString(),
    units,
    army: base.army,
    garrisoned,
    abroad,
    /*
     * The two figures behind the roster's population chip, and behind **Max**.
     *
     * `used` counts the garrisons and the bench as well as the army at home: a unit standing on a
     * rooftop three districts away is still a unit this crew is feeding, and a batch already
     * ordered has already claimed its beds. Leaving the bench out was a real defect rather than a
     * rounding one: `supplyCap - supplyUsed` is exactly what Max offers, the training route
     * subtracts the bench before it decides, and the difference was Max proposing a batch the route
     * then refused.
     *
     * `cap` is what is left for soldiers once the officers have taken
     * theirs, so the two subtract to `districtPopulation`'s own `spare` and nothing has to agree by
     * coincidence.
     */
    supplyUsed: population.army + population.training,
    // The whole ceiling: officers are not charged against it (`building/population.ts`).
    supplyCap: population.capacity,
    queue: base.trainingQueue,
    resources: base.resources,
    // §B5/§B6: the same three figures the route charges and clocks with, so the page's quoted
    // price and its **Max** button cannot offer a batch the route then refuses.
    trainingCostReduction: rates.costPercent,
    trainingSuppliesReduction: rates.suppliesPercent,
    built: base.fittedUpgrades
      .map((id) => findUpgrade(id))
      .filter((spec): spec is UpgradeSpec => spec !== undefined)
      .map((spec) => ({
        id: spec.id,
        name: spec.name,
        line: spec.line,
        tier: spec.tier,
        description: spec.description,
        effect: spec.effect as Record<string, number>,
      })),
    trainingSpeedBonus: rates.speedPercent,
  };
}
