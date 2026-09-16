import {
  findUnit,
  fittedOn,
  CITY_LOCATIONS,
  COMBAT_CONTEXT_LABELS,
  UNIT_CATALOG,
  UNIT_MODIFIERS,
  unitRules,
  markedUnit,
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
  type UnitModificationSpec,
  fittedFor,
  findUnitModification,
  modificationsForUnit,
  homeTrainingBonus,
  slotsFor,
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  type UnitSpec,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { trainingRatesFor, unlockContextFor } from './training.js';
import { standingEffectsFor } from '../crew/standing.js';
import { districtUnitSlots, unitsAbroad } from '../district/unit-slots.js';

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
  const spec = upgradeId === null ? undefined : findUnitModification(upgradeId);
  if (!spec) return { upgradeId: null, name: '', rarity: null, effect: {} };
  return {
    upgradeId: spec.id,
    name: spec.name,
    rarity: spec.rarity,
    effect: spec.effect as Record<string, number>,
  };
}

export function projectUnits(repos: Repositories, base: Base, now: Date): UnitsResponse {
  const context = unlockContextFor(repos, base);
  // The crew's own fold, for the marks its ground and its people have granted (`unit_mark`).
  const effects = standingEffectsFor(repos, base, now);
  const rates = trainingRatesFor(repos, base);
  const garrisoned = garrisonedUnits(repos, base);
  const abroad = unitsAbroad(repos, base);
  const slots = districtUnitSlots(repos, base, garrisoned);

  const units: UnitOption[] = UNIT_CATALOG.map((unit) => {
    // §A4: what the ground that trains this one takes off it, on top of the crew-wide figures.
    const home = homeTrainingBonus(unit, rates.locationLevels);
    return {
      id: unit.id,
      name: unit.name,
      tier: unit.tier,
      blurb: unit.blurb,
      trainedAt: unit.trainedAt,
      unique: unit.unique,
      // The cards in this unit's brackets, folded in at read time.
      //
      // Not written into the roster when a card is built: folding here is what makes a card reach
      // the units trained last week as well as the ones trained tomorrow, which is what "the yard
      // refits everybody" has to mean for a player not to find it maddening.
      stats: upgradedStats(unit.stats, fittedFor(base.unitLoadouts, unit.id)),
      modifiers: unit.modifiers.map((id) => ({
        label: UNIT_MODIFIERS[id].label,
        description: UNIT_MODIFIERS[id].description,
        when: COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context],
      })),
      /*
       * The marks this crew's sheet actually carries, granted ones included (`unit_mark`).
       *
       * Read through `markedUnit`, which is the same helper the engine builds a stack with, so the
       * card and the fight cannot disagree about whether these Ironsides hold the line. A card that
       * printed only the catalogue's marks would be showing a rule the engine is not using and
       * hiding one it is, which is worse than showing neither.
       */
      rules: unitRules(markedUnit(unit, effects)),
      affinities: groundAffinities(unit),
      cost: unit.cost,
      trainSeconds: unit.trainSeconds,
      unitSlots: unit.unitSlots,
      homeCostReduction: home.costPercent,
      homeSpeedBonus: home.speedPercent,
      unlocked: isUnitUnlocked(unit, context),
      missing: missingRequirements(unit, context).map(describeRequirement),
      owned: base.army[unit.id] ?? 0,
      slots: slotsFor(base.unitLoadouts, unit.id).map(describeSlot),
      // Off the same rule `slotRefusal` reads, so a greyed card and a `does_not_fit` agree.
      eligible: modificationsForUnit(unit.id).map((spec) => spec.id),
    };
  });

  return {
    serverNow: now.toISOString(),
    units,
    army: base.army,
    garrisoned,
    abroad,
    /*
     * The two figures behind the roster's unit-slot chip, and behind **Max**.
     *
     * `used` is the whole draw, not the army alone: the garrisons, the bench, the officers and the
     * yard are all somebody this crew houses. Leaving any of them out is a real defect rather than
     * a rounding one, because `unitSlotsCap - unitSlotsUsed` is exactly what Max offers and the training
     * route subtracts the same figure before it decides: a difference is Max proposing a batch the
     * route then refuses. Sending it as `slots.total` against `slots.capacity` keeps the
     * two subtracting to `districtUnitSlots`'s own `spare` by construction rather than by
     * coincidence.
     */
    unitSlotsUsed: slots.total,
    unitSlotsCap: slots.capacity,
    queue: base.trainingQueue,
    resources: base.resources,
    // §B5/§B6: the same three figures the route charges and clocks with, so the page's quoted
    // price and its **Max** button cannot offer a batch the route then refuses.
    trainingCostReduction: rates.costPercent,
    trainingSuppliesReduction: rates.suppliesPercent,
    built: base.fittedUpgrades
      .map((id) => findUnitModification(id))
      .filter((spec): spec is UnitModificationSpec => spec !== undefined)
      .map((spec) => {
        // §D5c: one of a thing is one of a thing, so this is a unit id or nothing.
        const [wearing] = fittedOn(base.unitLoadouts, spec.id);
        return {
          id: spec.id,
          name: spec.name,
          rarity: spec.rarity,
          description: spec.description,
          effect: spec.effect as Record<string, number>,
          fittedTo: wearing ?? null,
          fittedToName: wearing ? (findUnit(wearing)?.name ?? wearing) : '',
        };
      }),
    trainingSpeedBonus: rates.speedPercent,
  };
}
