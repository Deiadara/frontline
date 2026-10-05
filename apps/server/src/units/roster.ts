import {
  findUnit,
  fittedOn,
  EVERY_LOCATION,
  COMBAT_CONTEXT_LABELS,
  PLAYER_UNITS,
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
  type BonusLine,
  type UnitOption,
  type UnitsResponse,
  upgradedStats,
  type FittedSlot,
  type UnitModificationSpec,
  type UnitModifierSpec,
  fittedFor,
  findUnitModification,
  modificationsForUnit,
  homeMusterSource,
  theLocation,
  slotsFor,
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  type TerritoryEffects,
  type UnitSpec,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { benchFigure, homeOnTopOf, homeSuppliesLines, musterBreakdownFor } from './breakdown.js';
import { musterRatesFor, unlockContextFor } from './muster.js';
import { mergeArmies, removeForce } from '../battle/forces.js';
import { moveDestinationsFor, postedUnits } from '../moves/moves.js';
import { standingEffectsFor } from '../crew/standing.js';
import { districtUnitSlots, unitsAbroad } from '../district/unit-slots.js';

/**
 * The unit roster (GDD §A5).
 *
 * The whole catalogue every read, locked entries included. A player deciding what to build next
 * needs to see that the Colossus wants a Garage at 16 *and* a war machine graveyard: a list that
 * hid everything unavailable would hide exactly the thing that makes the campaign legible.
 */

/** The same, per location, with the crew's postings on allies' ground beside its own garrisons. */
function standingAtFor(repos: Repositories, base: Base): Record<string, Army> {
  const controls = repos.city.controls();
  const out: Record<string, Army> = {};
  for (const location of EVERY_LOCATION) {
    const control = controls.get(location.id);
    if (control && isHeldBy(control, base.id) && Object.keys(control.garrison).length > 0) {
      out[location.id] = control.garrison;
    }
  }
  for (const posted of repos.alliedGarrisons.forBase(base.id)) out[posted.locationId] = posted.army;
  return out;
}

/**
 * Units this crew has standing on captured locations, summed across the world.
 *
 * Across the world rather than across Ashfall (2026-09-24). `postedUnits` walks a table and so
 * always counted a posting wherever it was, while this walked one city's catalogue: a crew with
 * units garrisoned on its own Terminus ground drew no unit slots for them and paid no payroll on
 * them, and the census screen said they were nowhere.
 */
export function garrisonedUnits(repos: Repositories, base: Base): Army {
  const controls = repos.city.controls();
  let total: Army = {};
  for (const location of EVERY_LOCATION) {
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
    /*
     * Both halves, when a sheet carries both (bug pass, 2026-09-19).
     *
     * `UnitSpec.immuneTo` says in as many words that the two compose: "Labels whose baseline
     * simply does not apply. The affinity, if any, still does." This read them as alternatives,
     * so a sheet with an immunity *and* an affinity to the same label dropped the word "Immune"
     * and, worse, drew the row in the green reserved for something the unit is good at while the
     * figure in it was negative: a chip that says a unit likes ground it is measurably worse on.
     *
     * No sheet carries both today, which is exactly why it is worth fixing rather than noting: a
     * defect nothing in the catalogue can reach is one nobody finds when a sheet finally reaches
     * it. `groundAffinities.test.ts` puts a sheet in that state to prove the row.
     */
    const rate = `${per > 0 ? '+' : ''}${per}% per tier`;
    rows.push({
      id,
      label: ENV_LABEL_CATALOG[id].name,
      note: per === 0 ? 'Immune' : immune ? `Immune, ${rate}` : rate,
      // The affinity decides the colour whenever there is one: a unit that shrugs off the
      // baseline and is still worse for being there has not been handed a good place to stand.
      good: per === 0 ? immune : per > 0,
    });
  }
  return rows;
}

/**
 * The marks this crew's sheet actually carries: granted ones in, waived ones out.
 *
 * `markedUnit` only ever *adds* (`unit_mark`), which was the whole story until `any_ride`: that
 * holding takes a rule **off** a sheet, and there is no channel for a revoked mark because the
 * engine has no use for one. `no_ride` is a travel rule rather than a battle rule, so the two
 * readers that care take the flag as an argument (`ridingGroups`, `unitColumnSpeed`) and
 * `markedUnit` never sees it.
 *
 * The card did not, so a crew that had spent a location, a research rung or a perk on getting
 * the Colossus into a truck was still shown "Too big to ride: there is no seat in this city that
 * takes one" on the sheet of a unit that now rides. That is the defect this function's neighbour
 * already argues against in as many words: a card showing a rule the engine is not using is
 * worse than showing neither.
 */
function rulesThisCrewCarries(unit: UnitSpec, effects: TerritoryEffects): UnitOption['rules'] {
  const rules = unitRules(markedUnit(unit, effects));
  return effects.anyRide ? rules.filter((rule) => rule.id !== 'no_ride') : rules;
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

type HomeLines = Record<'cost' | 'speed', { percent: number; lines: BonusLine[] }>;

/**
 * A unit's own Bonuses lines: its ground on the cost cut and the clock, and, when that ground
 * moves its cost cut, what the move does to the supplies line beside it (`homeSuppliesLines`).
 */
function homeBonusLines(
  home: HomeLines,
  crewCost: number,
  supplies: number,
): NonNullable<UnitOption['homeBonus']> {
  const onSupplies = homeSuppliesLines(crewCost, home.cost.percent, supplies);
  return {
    cost: home.cost.lines,
    speed: home.speed.lines,
    ...(onSupplies.length === 0 ? {} : { supplies: onSupplies }),
  };
}

export function projectUnits(repos: Repositories, base: Base, now: Date): UnitsResponse {
  const context = unlockContextFor(repos, base);
  // The crew's own fold, for the marks its ground and its people have granted (`unit_mark`).
  const effects = standingEffectsFor(repos, base, now);
  // The instant the roster is being drawn at, so a disrupted crew's price and its breakdown
  // agree about whether the raid is still biting.
  const rates = musterRatesFor(repos, base, now);
  /*
   * Held ground: the crew's own garrisons and its postings on a faction ally's (2026-09-22).
   *
   * A posting is standing on ground, so it is reported as held, and it is taken back out of
   * `abroad`: `unitsAbroad` counts it because the *slot* draw has to count it exactly once, and
   * the census reads these two fields as separate places. Left in both, every posted unit was
   * drawn twice on the one screen whose whole job is counting.
   */
  const posted = postedUnits(repos, base);
  const held = garrisonedUnits(repos, base);
  const garrisoned = mergeArmies(held, posted);
  const abroad = removeForce(unitsAbroad(repos, base), posted);
  const slots = districtUnitSlots(repos, base, held);
  // The crew-wide cost cut as the bench charges it, which is what its chip prints and what a
  // unit's own ground is added to. The speed ships raw: `musterSecondsFor` tapers the crew's figure
  // and the ground's together, so the two halves have to reach it as sums (`benchFigure`).
  const crewCost = benchFigure('cost', rates.costPercent);
  const crewSpeed = rates.speedPercent;

  // The player's roster: the Combine's sheets are met, never offered (`UnitSpec.faction`).
  const units: UnitOption[] = PLAYER_UNITS.map((unit) => {
    // §A4: what the ground that musters this one takes off it, on top of the crew-wide figures.
    const source = homeMusterSource(unit, rates.locationLevels);
    const home =
      source === null
        ? null
        : {
            cost: homeOnTopOf('cost', crewCost, {
              source: theLocation(source.kind),
              note: `Level ${source.level}, its own ground`,
              percent: source.costPercent,
            }),
            speed: homeOnTopOf('speed', crewSpeed, {
              source: theLocation(source.kind),
              note: `Level ${source.level}, its own ground`,
              percent: source.speedPercent,
            }),
          };
    return {
      id: unit.id,
      name: unit.name,
      tier: unit.tier,
      blurb: unit.blurb,
      musteredAt: unit.musteredAt,
      unique: unit.unique,
      // The cards in this unit's brackets, folded in at read time.
      //
      // Not written into the roster when a card is built: folding here is what makes a card reach
      // the units mustered last week as well as the ones mustered tomorrow, which is what "the yard
      // refits everybody" has to mean for a player not to find it maddening.
      stats: upgradedStats(unit.stats, fittedFor(base.unitLoadouts, unit.id)),
      modifiers: unit.modifiers.map((id) => ({
        label: UNIT_MODIFIERS[id].label,
        description: UNIT_MODIFIERS[id].description,
        // The context's clause unless the entry overrides it: one modifier does two things and
        // the context only describes one of them. See `UnitModifierSpec.when`.
        when:
          (UNIT_MODIFIERS[id] as UnitModifierSpec).when ??
          COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context].when,
      })),
      /*
       * The marks this crew's sheet actually carries, granted ones included (`unit_mark`).
       *
       * Read through `markedUnit`, which is the same helper the engine builds a stack with, so the
       * card and the fight cannot disagree about whether these Ironsides hold the line. A card that
       * printed only the catalogue's marks would be showing a rule the engine is not using and
       * hiding one it is, which is worse than showing neither.
       */
      rules: rulesThisCrewCarries(unit, effects),
      affinities: groundAffinities(unit),
      cost: unit.cost,
      musterSeconds: unit.musterSeconds,
      unitSlots: unit.unitSlots,
      homeCostReduction: home?.cost.percent ?? 0,
      homeSpeedBonus: home?.speed.percent ?? 0,
      /*
       * The same two figures as named lines, for this unit's own Bonuses page.
       *
       * Spread rather than assigned, because `exactOptionalPropertyTypes` and because absent is
       * the ordinary case: a crew holding none of a unit's home ground, or holding it at level one,
       * has nothing to print and should not get an empty pair of lists to render.
       */
      ...(home === null
        ? {}
        : { homeBonus: homeBonusLines(home, crewCost, rates.suppliesPercent) }),
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
    gateArmy: base.gateArmy ?? {},
    moveDestinations: moveDestinationsFor(repos, base),
    standingAt: standingAtFor(repos, base),
    fleet: base.fleet,
    garrisoned,
    abroad,
    /*
     * The slice of `abroad` that is planted rather than committed.
     *
     * Read off the cells rather than subtracted from anything: the two are built from the same
     * repo call one line apart, and a subtraction would go wrong the first time a crew had the
     * same sheet both planted and at a fight.
     */
    sleeping: repos.sleepers
      .forBase(base.id)
      .reduce<Army>((total, cell) => mergeArmies(total, cell.army), {}),
    /*
     * The two figures behind the roster's unit-slot chip, and behind **Max**.
     *
     * `used` is the whole draw, not the army alone: the garrisons, the bench, the officers and the
     * yard are all somebody this crew houses. Leaving any of them out is a real defect rather than
     * a rounding one, because `unitSlotsCap - unitSlotsUsed` is exactly what Max offers and the muster
     * route subtracts the same figure before it decides: a difference is Max proposing a batch the
     * route then refuses. Sending it as `slots.total` against `slots.capacity` keeps the
     * two subtracting to `districtUnitSlots`'s own `spare` by construction rather than by
     * coincidence.
     */
    unitSlotsUsed: slots.total,
    unitSlotsCap: slots.capacity,
    queue: base.musterQueue,
    resources: base.resources,
    // §B5/§B6: the same three figures the route charges and clocks with, so the page's quoted
    // price and its **Max** button cannot offer a batch the route then refuses. The cost cut is
    // stopped at the floor price here; the supplies cut and the speed ship as sums, which
    // `musterCost` and `musterSecondsFor` taper, and the chips print the tapered figure.
    musterCostReduction: crewCost,
    musterSuppliesReduction: rates.suppliesPercent,
    musterVeteranReduction: rates.veteranPercent,
    built: base.fittedUpgrades
      .map((id) => findUnitModification(id))
      .filter((spec): spec is UnitModificationSpec => spec !== undefined)
      .map((spec) => {
        // §D5c: every sheet wearing it. The yard sells one card to several units and bills each.
        const wearing = fittedOn(base.unitLoadouts, spec.id);
        return {
          id: spec.id,
          name: spec.name,
          rarity: spec.rarity,
          description: spec.description,
          effect: spec.effect as Record<string, number>,
          fittedTo: wearing,
          fittedToName: wearing.map((id) => findUnit(id)?.name ?? id).join(', '),
        };
      }),
    musterSpeedBonus: crewSpeed,
    // §A5's one exception, so a screen can ask whether this crew's porters may be sent.
    carriersFight: effects.carriersFight,
    // ...and the other switch that lifts a rule off a unit sheet (`any_ride`). Both doors that
    // spend seats already read it; until now no screen that quotes seats could.
    anyRide: effects.anyRide,
    unitSpeedPercent: effects.unitSpeedPercent,
    // The same three figures again, as the lines that make them up, for the chips' hover pages.
    musterBreakdown: musterBreakdownFor(repos, base, now),
  };
}
