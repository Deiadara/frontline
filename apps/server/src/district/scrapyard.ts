import {
  addItems,
  itemCount,
  removeItems,
  ITEM_CATALOG,
  MODIFICATIONS,
  TRAP_CATALOG,
  UNIT_MODIFICATIONS,
  addonsOf,
  blueprintForModification,
  blueprintForTrap,
  blueprintForUnitUpgrade,
  blueprintGateMet,
  buildingLevel,
  canAfford,
  describeAddonEffect,
  describeBlueprintGate,
  findModification,
  findTech,
  findTrap,
  findUnitModification,
  isAdvancedModification,
  isAdvancedUpgrade,
  modificationBuildRefusal,
  upgradeRefusal,
  modificationGateMet,
  modificationPrice,
  scrapyardDiscountPercent,
  scrapyardLevelForModification,
  scrapyardLevelForTrap,
  scrapyardLevelForUpgrade,
  scrapyardLevelRefusal,
  scrapyardPrice,
  discounted,
  spendResources,
  upgradePrice,
  type AddonKind,
  type Base,
  type ItemId,
  type ModificationSpec,
  type PartialResources,
  type ScrapyardEntry,
  type ScrapyardResponse,
  type TrapSpec,
  type UnitModificationSpec,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { tallyAddonBuilt } from '../feats/tally.js';

/**
 * The Scrapyard's own page (§B9).
 *
 * One list of everything the yard can turn out: the building modifications and the thirty unit
 * modification cards, side by side, because they are the same kind of object to a player. Both are
 * a permanent thing bolted to something they already own, both cost scrap and, past the cheap end,
 * high-quality metal, and both mostly want a blueprint first.
 *
 * **No other resource appears on those two**, which is the maintainer's rule and is enforced by
 * `modificationPrice` and `upgradePrice` rather than trusted: neither can return a caps line.
 *
 * The traps (§I4) are the third bench and the exception, deliberately. They are priced by
 * `TRAP_CATALOG` in planks, oil and caps as well as scrap, because a trap is a thing you make out
 * of what is lying around rather than a bracket cut out of stock, and re-pricing them into two
 * columns to satisfy a rule about brackets would have made a shell cost the same as a stairwell.
 *
 * What the yard does *not* do is fit anything. A built modification goes on the shelf
 * (`Base.addons.built`) and is put into a slot from the structure's own dialog, which is §E; a
 * built trap goes into the inventory and is set on a coming fight from the battle page.
 */

/** The Scrapyard has to be standing to build anything: this is its shop. */
export const SCRAPYARD_REQUIRED_LEVEL = 1;

/**
 * What the ground takes off a unit card, on top of the yard's own level (maintainer request,
 * 2026-09-10).
 *
 * The Armory's favour (`refitDiscountPercent`) used to be honoured by the Workshop's route and
 * nowhere else, so the same card had two prices depending on which door a player came through.
 * The Workshop is gone and this is the one door, so its standing rides in here: the route reads
 * it off `standingEffectsFor` and a caller with no crew to hand gets the bare bill.
 */
export interface YardStanding {
  refitDiscountPercent: number;
}
const NO_STANDING: YardStanding = { refitDiscountPercent: 0 };

/** The yard's own level, which every price and every gate on this page reads. */
const yardLevel = (base: Base): number => buildingLevel(base.buildings, 'scrapyard');

/**
 * Every price the yard quotes, in one place: the list price, then the ground's cut on a unit card,
 * then the yard's own level. Floored at one per line by `scrapyardPrice`, so nothing is free.
 */
function modificationBill(base: Base, spec: ModificationSpec): PartialResources {
  return scrapyardPrice(modificationPrice(spec), yardLevel(base));
}
function upgradeBill(
  base: Base,
  spec: UnitModificationSpec,
  standing: YardStanding,
): PartialResources {
  return scrapyardPrice(
    discounted(upgradePrice(spec), standing.refitDiscountPercent),
    yardLevel(base),
  );
}
function trapBill(base: Base, spec: TrapSpec): PartialResources {
  return scrapyardPrice(spec.cost, yardLevel(base));
}

/**
 * The document a Scrapyard entry is behind (§D12f, §D12g), named, or null when nothing gates it.
 *
 * One function for both halves of the board because a player reads one word: the drawings the
 * yard cannot cut metal without. Which document it is comes off `blueprints/catalog.ts`, so the
 * name here and the name on the Blueprints page are the same string.
 */
function documentFor(spec: ModificationSpec | UnitModificationSpec): string | null {
  const document =
    'magnitude' in spec ? blueprintForModification(spec) : blueprintForUnitUpgrade(spec.id);
  return document?.name ?? null;
}

/**
 * §I4: a trap, and why the yard will not cut one.
 *
 * Two gates, both of them [call, made], in the order the brief words them: the **document** first,
 * because it is the half a player collects page by page and the half they can act on today, then
 * the Lab rung from `TrapSpec.requiresTech`, then the bill. Same order the modifications use, and
 * for the same reason: sending somebody to the Lab for a rung when they are four pages short of
 * the drawings sends them to the wrong building.
 */
function trapBlockerFor(base: Base, spec: TrapSpec): string | null {
  const shut = scrapyardLevelRefusal(yardLevel(base), scrapyardLevelForTrap(spec));
  if (shut !== null) return shut;
  if (!blueprintGateMet(base.inventory, 'trap', spec.id)) {
    return describeBlueprintGate('trap', spec.id);
  }
  if (!base.research.technologies.includes(spec.requiresTech)) {
    return `Needs ${findTech(spec.requiresTech)?.name ?? spec.requiresTech} from the Lab`;
  }
  return canAfford(base.resources, trapBill(base, spec)) ? null : 'You cannot cover that';
}

/**
 * What one trap does, in the line the yard's rows print.
 *
 * Read off `killShare` and `maxKills` rather than written out per trap, so a tuning pass on the
 * catalogue cannot leave three sentences behind saying the old numbers.
 */
function describeTrap(spec: TrapSpec): string {
  return `Takes ${Math.round(spec.killShare * 100)}% off the attack, up to ${spec.maxKills} units`;
}

/**
 * The same rule as the modification door, and for the same reason it only words the answer.
 *
 * `upgradeRefusal` is where the ordering lives. This used to reimplement it, and the copy learned
 * about the yard's level while the original did not, so the two disagreed with nobody to tell:
 * the shared function's only caller was its own test file. The wording stays here, because the
 * sentences quote prices (`upgradeBill` applies the yard's and the Armory's cuts) and documents
 * (`documentFor`), neither of which `@frontline/shared` knows about.
 *
 * A card already in the stock answers `null` rather than a sentence: there is nothing left to do
 * about it and the page draws it as owned, which the client reads off `owned` instead.
 */
function upgradeBlockerFor(
  base: Base,
  spec: UnitModificationSpec,
  standing: YardStanding,
): string | null {
  const refusal = upgradeRefusal({
    id: spec.id,
    fitted: base.fittedUpgrades,
    yardLevel: yardLevel(base),
    requiredYardLevel: (one) => scrapyardLevelForUpgrade(one),
    blueprintUnlocked: (id) => blueprintGateMet(base.inventory, 'unit_upgrade', id),
    /*
     * The parts a card is authored with, required and consumed.
     *
     * The Workshop used to require `spec.parts` and this door asked for neither, so the cheaper
     * door bought the same thing with the parts still in the inventory and the Workshop's refusal
     * became advice. The Workshop is gone and this is the one door, so the parts are a rule here
     * or nowhere: they are a designed sink and cannot have a free door beside them.
     */
    hasParts: (parts) =>
      Object.entries(parts).every(
        ([item, count]) => (base.inventory[item as ItemId] ?? 0) >= count,
      ),
    affordable: (one) => canAfford(base.resources, upgradeBill(base, one, standing)),
  });

  switch (refusal) {
    case null:
    case 'already_fitted':
      return null;
    case 'unknown_upgrade':
      return 'No such add-on';
    case 'yard_too_low':
      return scrapyardLevelRefusal(yardLevel(base), scrapyardLevelForUpgrade(spec));
    case 'needs_blueprint':
      return `Needs the ${documentFor(spec)}`;
    case 'missing_parts': {
      const missing = Object.entries(spec.parts).find(
        ([item, count]) => (base.inventory[item as ItemId] ?? 0) < count,
      )!;
      const [item, count] = missing;
      return `Needs ${count} ${ITEM_CATALOG[item as ItemId]?.name ?? item}`;
    }
    default:
      return 'You cannot cover that';
  }
}

/**
 * Two drawings, and the advanced half of every structure wants both (§D12f).
 *
 * The yard's own level first, then the **document**: the structure's retrofit blueprint, collected
 * page by page, which gates all five of that structure's advanced modifications at once. A crew
 * short of pages gets nothing out of running the Lab project, so telling them about the project
 * first would send them to the wrong building. Money last, because it is the one gate that fixes
 * itself.
 *
 * ## Why this only words the answer
 *
 * The order above *is* `modificationBuildRefusal`, and this used to say so in a comment while
 * quietly implementing its own copy. The two then drifted: the shared rule never learned about the
 * yard's level, so it would pass a modification this door refuses. Nothing caught it, because
 * nothing in the running game called the shared rule at all: its tests were the only caller, so a
 * dozen green assertions were gating a function the Scrapyard did not use.
 *
 * So the rule is asked, and this only turns its answer into a sentence. The prices stay here
 * (`modificationBill` applies yard discounts) and so does the wording, which is what `@frontline/
 * shared` has no business knowing.
 */
function modificationBlockerFor(base: Base, id: string): string | null {
  const spec = findModification(id);
  if (!spec) return 'No such add-on';

  const refusal = modificationBuildRefusal({
    spec,
    yardLevel: yardLevel(base),
    blueprintUnlocked: (one) => modificationGateMet(base.inventory, one),
    affordable: (one) => canAfford(base.resources, modificationBill(base, one)),
  });

  switch (refusal) {
    case null:
      return null;
    case 'yard_too_low':
      return scrapyardLevelRefusal(yardLevel(base), scrapyardLevelForModification(spec));
    case 'needs_blueprint':
      return `Needs the ${documentFor(spec)}`;
    default:
      // The Lab project that used to sit between the drawings and the yard is gone with the desk:
      // a crew holding the structure's retrofit blueprint can cut any of its advanced add-ons.
      return 'You cannot cover that';
  }
}

export function projectScrapyard(
  base: Base,
  standing: YardStanding = NO_STANDING,
): ScrapyardResponse {
  const addons = addonsOf(base);
  const owned = (id: string): number => addons.built.filter((built) => built === id).length;

  const modifications: ScrapyardEntry[] = MODIFICATIONS.map((spec) => ({
    id: spec.id,
    kind: 'modification' as const,
    name: spec.name,
    description: spec.description,
    building: spec.building,
    effect: describeAddonEffect(spec),
    cost: modificationBill(base, spec),
    advanced: isAdvancedModification(spec),
    rarity: null,
    blueprint: documentFor(spec),
    owned: owned(spec.id),
    requiresLevel: scrapyardLevelForModification(spec),
    documentHeld: modificationGateMet(base.inventory, spec),
    blocker: modificationBlockerFor(base, spec.id),
  }));

  // The unit bench: thirty cards in catalogue order, which is rarity order. The page groups them
  // by the `rarity` on each row rather than by anything it knows about the catalogue.
  const upgrades: ScrapyardEntry[] = UNIT_MODIFICATIONS.map((spec) => ({
    id: spec.id,
    kind: 'upgrade' as const,
    name: spec.name,
    description: spec.description,
    building: null,
    effect: describeAddonEffect(spec),
    cost: upgradeBill(base, spec, standing),
    advanced: isAdvancedUpgrade(spec),
    rarity: spec.rarity,
    blueprint: documentFor(spec),
    owned: base.fittedUpgrades.includes(spec.id) ? 1 : 0,
    requiresLevel: scrapyardLevelForUpgrade(spec),
    documentHeld: blueprintGateMet(base.inventory, 'unit_upgrade', spec.id),
    blocker: base.fittedUpgrades.includes(spec.id) ? null : upgradeBlockerFor(base, spec, standing),
  }));

  /*
   * §I4: the traps.
   *
   * `building: null` like the unit cards, because a trap belongs to no structure: it goes into the
   * inventory and is set under one fight the crew is defending. `owned` is the count in the bag
   * rather than a 0/1, because unlike everything else on this page a trap is spent, so "you have
   * three" is the number a player is deciding on.
   *
   * `advanced` is read off the bill for the same reason it is on a modification: high-quality
   * metal is the line between a thing a district cuts and a thing it plans for.
   */
  const traps: ScrapyardEntry[] = TRAP_CATALOG.map((spec) => ({
    id: spec.id,
    kind: 'trap' as const,
    name: spec.name,
    description: spec.description,
    building: null,
    effect: describeTrap(spec),
    cost: trapBill(base, spec),
    advanced: (spec.cost.highQualityMetal ?? 0) > 0,
    rarity: null,
    blueprint: blueprintForTrap(spec.id)?.name ?? null,
    owned: itemCount(base.inventory, spec.id as ItemId),
    requiresLevel: scrapyardLevelForTrap(spec),
    documentHeld: blueprintGateMet(base.inventory, 'trap', spec.id),
    blocker: trapBlockerFor(base, spec),
  }));

  return {
    scrapyardLevel: yardLevel(base),
    discountPercent: scrapyardDiscountPercent(yardLevel(base)),
    resources: base.resources,
    entries: [...modifications, ...upgrades, ...traps],
  };
}

export type AddonBuildResult = { kind: 'refused'; reason: string } | { kind: 'built'; base: Base };

/**
 * Builds one add-on: takes the scrap, and puts the thing on the shelf.
 *
 * A modification goes into `addons.built` and waits for a slot; a unit card goes into
 * `fittedUpgrades`, the crew's stock, and waits for a bracket on the Units page (`/units/loadout`).
 */
export function buildAddon(
  repos: Repositories,
  base: Base,
  kind: AddonKind,
  id: string,
  standing: YardStanding = NO_STANDING,
): AddonBuildResult {
  if (buildingLevel(base.buildings, 'scrapyard') < SCRAPYARD_REQUIRED_LEVEL) {
    return { kind: 'refused', reason: 'Build the Scrapyard first' };
  }
  /*
   * §I4: one trap, into the inventory.
   *
   * The only thing this page builds that does not end up bolted to something. It is an item, so it
   * goes through `addItems` and `updateHoldings` rather than onto a shelf, and building a second
   * one is legal: a crew defending two fights on the same evening needs two.
   */
  if (kind === 'trap') {
    const spec = findTrap(id);
    if (!spec) return { kind: 'refused', reason: 'No such trap' };
    const blocker = trapBlockerFor(base, spec);
    if (blocker !== null) return { kind: 'refused', reason: blocker };

    const built: Base = {
      ...base,
      resources: spendResources(base.resources, trapBill(base, spec)),
      inventory: addItems(base.inventory, { [spec.id]: 1 }),
    };
    repos.bases.updateHoldings(built.id, built.resources, built.inventory);
    // Feats: a trap counts as a trap and as a fitting, because the two ladders are asking
    // different questions and a trap is an honest answer to both. See `tallyAddonBuilt`.
    tallyAddonBuilt(repos, built.id, true);
    return { kind: 'built', base: built };
  }

  if (kind === 'modification') {
    const spec = findModification(id);
    if (!spec) return { kind: 'refused', reason: 'No such add-on' };
    const blocker = modificationBlockerFor(base, id);
    if (blocker !== null) return { kind: 'refused', reason: blocker };

    const addons = addonsOf(base);
    const built: Base = {
      ...base,
      resources: spendResources(base.resources, modificationBill(base, spec)),
      addons: { ...addons, built: [...addons.built, spec.id] },
    };
    repos.bases.updateResources(built.id, built.resources);
    repos.bases.updateAddons(built.id, built.addons ?? addons);
    tallyAddonBuilt(repos, built.id, false);
    return { kind: 'built', base: built };
  }

  const spec = findUnitModification(id);
  if (!spec) return { kind: 'refused', reason: 'No such add-on' };
  if (base.fittedUpgrades.includes(spec.id)) return { kind: 'refused', reason: 'Already built' };
  const blocker = upgradeBlockerFor(base, spec, standing);
  if (blocker !== null) return { kind: 'refused', reason: blocker };

  const built: Base = {
    ...base,
    resources: spendResources(base.resources, upgradeBill(base, spec, standing)),
    // Spent, not merely checked. A requirement that is verified and never consumed is a one-off
    // toll that buys every card in the catalogue for ever.
    inventory: removeItems(base.inventory, spec.parts),
    fittedUpgrades: [...base.fittedUpgrades, spec.id],
  };
  repos.bases.updateHoldings(built.id, built.resources, built.inventory);
  repos.bases.updateUpgrades(built.id, built.fittedUpgrades);
  tallyAddonBuilt(repos, built.id, false);
  return { kind: 'built', base: built };
}
