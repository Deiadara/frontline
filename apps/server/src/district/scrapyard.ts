import {
  ITEM_CATALOG,
  addItems,
  hasItems,
  itemCount,
  removeItems,
  MODIFICATIONS,
  TRAP_CATALOG,
  trapEffectLine,
  UNIT_MODIFICATIONS,
  blueprintForModification,
  blueprintForTrap,
  blueprintForUnitUpgrade,
  blueprintGateMet,
  buildingLevel,
  canAfford,
  describeAddonEffect,
  describeBlueprintGate,
  findModification,
  findTrap,
  findUnitModification,
  isAdvancedModification,
  isAdvancedUpgrade,
  boltInRefusal,
  boltOntoUnitRefusal,
  modificationRequirement,
  unitModificationRequirement,
  describeModificationRequirement,
  describeModificationRequirementRefusal,
  fitsIn,
  findBuilding,
  findUnit,
  modificationFitsUnit,
  slotsFor,
  unlockedUnits,
  withModificationFitted,
  BUILDING_KINDS,
  BUILDING_CATALOG,
  PLAYER_UNITS,
  OFFICER_ROLE_LABELS,
  modificationGateMet,
  modificationPrice,
  scrapyardBillCutPercent,
  scrapyardLevelForModification,
  scrapyardLevelForTrap,
  scrapyardLevelForUpgrade,
  scrapyardLevelRefusal,
  scrapyardPrice,
  chairPassivePercent,
  discounted,
  spendResources,
  upgradePrice,
  type AddonKind,
  type AddonRefusal,
  type Base,
  type BuildingKind,
  type OfficerMark,
  type OfficerRole,
  type UpgradeRefusal,
  type ItemId,
  type ModificationSpec,
  type PartialResources,
  type ScrapyardEntry,
  type ScrapyardResponse,
  type TrapSpec,
  type UnitLoadouts,
  type UnitModificationSpec,
  refitDiscountCut,
} from '@frontline/shared';
import { adminCost, adminWaives } from '../admin/mode.js';
import type { Repositories } from '../db/repos/index.js';
import { tallyAddonBuilt } from '../feats/tally.js';
import { officerFitReader } from '../crew/standing.js';
import { unlockContextFor } from '../units/muster.js';

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
 * The Salvager's passive: what they take off the scrap and HQ metal of every bill on this bench
 * (maintainer, 2026-10-04). It was the Fabricator's cut on every line until that chair left.
 *
 * Read off the **lifted** sheet through `officerFitReader`, so the ground, the teaching perks and
 * the Lab all count. Computed once per request at the two entry points and passed down, because
 * the reader walks the whole roster and the answer cannot change between two lines of one page.
 */
function yardCutFor(repos: Repositories, base: Base): number {
  // Working, not merely seated (maintainer, 2026-09-23): an injured Salvager cuts nothing. And
  // settled in (bug pass, 2026-10-05), like every chair's passive.
  const fit = officerFitReader(repos, base);
  const salvager = fit.workingIn('salvager');
  if (!salvager || !fit.chairSettled('salvager')) return 0;
  return chairPassivePercent('scrapyard_cost', fit.pointsFor(salvager, 'salvager'));
}

/**
 * Every price the yard quotes, in one place: the list price, then the ground's cut on a unit card,
 * then the yard's own level. Floored at one per line by `scrapyardPrice`, so nothing is free.
 */
function modificationBill(base: Base, spec: ModificationSpec, cut: number): PartialResources {
  return scrapyardPrice(modificationPrice(spec), yardLevel(base), cut);
}
function upgradeBill(
  base: Base,
  spec: UnitModificationSpec,
  standing: YardStanding,
  cut: number,
): PartialResources {
  return scrapyardPrice(
    // Bent, not stopped (`refitDiscountCut`, maintainer 2026-10-05).
    discounted(upgradePrice(spec), refitDiscountCut(standing.refitDiscountPercent), 100),
    yardLevel(base),
    cut,
  );
}
function trapBill(base: Base, spec: TrapSpec, cut: number): PartialResources {
  return scrapyardPrice(spec.cost, yardLevel(base), cut);
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
 * The yard's own level, then the **document**, then the bill. The blueprint is the only thing that
 * opens a trap (maintainer, 2026-10-01: "have the traps just be unlocked by blueprints, and then
 * made in the scrapyard"); the Lab rung that was a second lock beside it is gone.
 */
function trapBlockerFor(base: Base, spec: TrapSpec, cut: number, admin = false): string | null {
  const shut = scrapyardLevelRefusal(yardLevel(base), scrapyardLevelForTrap(spec));
  if (shut !== null) return shut;
  if (!blueprintGateMet(base.inventory, 'trap', spec.id)) {
    return describeBlueprintGate('trap', spec.id);
  }
  if (adminWaives('cannot_afford', admin)) return null;
  return canAfford(base.resources, trapBill(base, spec, cut)) ? null : 'You cannot cover that';
}

/**
 * Every refusal `boltInRefusal` can answer with, in the player's words.
 *
 * One table, here, because the same sentence has to appear under a dead button on the bench and in
 * the 409 the route throws when somebody presses it anyway. The four requirement lines are written
 * by `building/requirements.ts` so the bench and the district window cannot word them differently.
 */
function boltInMessage(
  reason: AddonRefusal,
  base: Base,
  spec: ModificationSpec,
  kind: BuildingKind,
): string {
  const requirement = modificationRequirement(spec, kind);
  const named = {
    requirement,
    buildingName: BUILDING_CATALOG[kind].name,
    // A BASIC card names no chair (`building/requirements.ts`), so there is no label to look up.
    roleLabel: requirement.officer === null ? '' : OFFICER_ROLE_LABELS[requirement.officer.role],
  };
  switch (reason) {
    case 'yard_too_low':
      return (
        scrapyardLevelRefusal(yardLevel(base), scrapyardLevelForModification(spec)) ??
        'The yard cannot cut that yet'
      );
    case 'needs_blueprint':
      return `Needs the ${documentFor(spec) ?? 'drawings'}`;
    case 'building_too_low':
    case 'crew_too_low':
    case 'crew_unknown':
    case 'no_officer':
    case 'officer_too_green':
      return describeModificationRequirementRefusal(reason, named);
    case 'wrong_structure':
      return 'That does not fit here';
    case 'no_structure':
      return `Build the ${BUILDING_CATALOG[kind].name} first`;
    case 'slot_locked':
      return `Raise the ${BUILDING_CATALOG[kind].name} to open another bracket`;
    case 'slot_taken':
      return 'Every bracket here is full';
    case 'already_fitted':
      return 'Already bolted in here';
    case 'cannot_afford':
      return 'You cannot cover that';
    default:
      return 'You cannot cover that';
  }
}

/** The same, for the unit bench. */
function upgradeMessage(
  reason: UpgradeRefusal,
  base: Base,
  spec: UnitModificationSpec,
  unitId: string,
): string {
  const requirement = unitModificationRequirement(spec);
  const named = {
    requirement,
    buildingName: BUILDING_CATALOG.gauntlet.name,
    // A BASIC card names no chair (`building/requirements.ts`), so there is no label to look up.
    roleLabel: requirement.officer === null ? '' : OFFICER_ROLE_LABELS[requirement.officer.role],
  };
  switch (reason) {
    case 'yard_too_low':
      return (
        scrapyardLevelRefusal(yardLevel(base), scrapyardLevelForUpgrade(spec)) ??
        'The yard cannot cut that yet'
      );
    case 'needs_blueprint':
      return `Needs the ${documentFor(spec) ?? 'drawings'}`;
    case 'does_not_fit':
      return 'That does not fit this sheet';
    case 'cannot_muster':
      return `You cannot field ${findUnit(unitId)?.name ?? 'them'} yet`;
    case 'gauntlet_too_low':
      return describeModificationRequirementRefusal('building_too_low', named);
    case 'crew_too_low':
    case 'crew_unknown':
    case 'no_officer':
    case 'officer_too_green':
      return describeModificationRequirementRefusal(reason, named);
    case 'already_fitted':
      return 'Already bolted on here';
    case 'slot_taken':
      return 'Every bracket on this one is full';
    case 'missing_parts': {
      // Named, not counted: "you are short of the parts" sends a player to look up which.
      const missing = Object.entries(spec.parts).find(
        ([item, count]) => (base.inventory[item as ItemId] ?? 0) < count,
      );
      if (!missing) return 'You are short of the parts';
      const [item, count] = missing;
      return `Needs ${count} ${ITEM_CATALOG[item as ItemId]?.name ?? item}`;
    }
    case 'cannot_afford':
      return 'You cannot cover that';
    // No `default`: a catch-all here is how `crew_unknown` came to read as the money sentence, so a
    // refusal added to `UPGRADE_REFUSALS` without a line fails the typecheck instead.
    case 'unknown_upgrade':
      return 'No such add-on';
  }
}

/** Every structure this card fits, with the reason it cannot go into each one, or null. */
function modificationTargets(
  base: Base,
  spec: ModificationSpec,
  markFor: (role: OfficerRole) => OfficerMark | null,
  cut: number,
  admin: boolean,
): ScrapyardEntry['targets'] {
  return fitsIn(spec).map((kind) => {
    const standing = findBuilding(base.buildings, kind);
    const refusal = boltInRefusal({
      spec,
      kind,
      yardLevel: yardLevel(base),
      blueprintUnlocked: (one) => modificationGateMet(base.inventory, one),
      buildings: base.buildings,
      crewLevel: base.level,
      // §D7: the top two bands ask for a rank, which is the gate the ladder never had.
      notoriety: base.economy.notoriety,
      markFor,
      affordable: (one) =>
        adminWaives('cannot_afford', admin) ||
        canAfford(base.resources, modificationBill(base, one, cut)),
    });
    /*
     * A card already in a bracket is not blocked, it is done.
     *
     * `already_fitted` is a refusal to the rule and an action to the screen: the bench swaps Bolt
     * It In for Dismantle on exactly this row. Sending a refusal beside it would put a red sentence
     * under a live button, which is the page telling a player off for something they finished.
     */
    const fitted = standing?.modifications.includes(spec.id) ?? false;
    return {
      id: kind,
      name: BUILDING_CATALOG[kind].name,
      fitted,
      blocker: fitted || refusal === null ? null : boltInMessage(refusal, base, spec, kind),
    };
  });
}

/** Every unit this card fits, on the same terms. */
function upgradeTargets(
  base: Base,
  spec: UnitModificationSpec,
  standingYard: YardStanding,
  markFor: (role: OfficerRole) => OfficerMark | null,
  musterable: ReadonlySet<string>,
  cut: number,
  admin: boolean,
): ScrapyardEntry['targets'] {
  return PLAYER_UNITS.filter((unit) => modificationFitsUnit(spec, unit.id)).map((unit) => {
    const slots = slotsFor(base.unitLoadouts, unit.id);
    const refusal = boltOntoUnitRefusal({
      id: spec.id,
      unitId: unit.id,
      musterable: musterable.has(unit.id),
      fitsUnit: modificationFitsUnit,
      slots,
      yardLevel: yardLevel(base),
      requiredYardLevel: scrapyardLevelForUpgrade,
      blueprintUnlocked: (id) => blueprintGateMet(base.inventory, 'unit_upgrade', id),
      gauntletLevel: buildingLevel(base.buildings, 'gauntlet'),
      crewLevel: base.level,
      // §D7: the top two bands ask for a rank, which is the gate the ladder never had.
      notoriety: base.economy.notoriety,
      markFor,
      affordable: (one) =>
        adminWaives('cannot_afford', admin) ||
        canAfford(base.resources, upgradeBill(base, one, standingYard, cut)),
      hasParts: (parts) => adminWaives('missing_parts', admin) || hasItems(base.inventory, parts),
    });
    // Fitted is an action rather than a refusal here too: see `modificationTargets`.
    const fitted = slots.includes(spec.id);
    return {
      id: unit.id,
      name: unit.name,
      fitted,
      blocker: fitted || refusal === null ? null : upgradeMessage(refusal, base, spec, unit.id),
    };
  });
}

export function projectScrapyard(
  repos: Repositories,
  base: Base,
  standing: YardStanding = NO_STANDING,
  /**
   * Testing mode, so the page waives what the bench waives (bug pass, 2026-10-06): the build
   * charged nothing while every card said it could not be covered, and the button was dead.
   */
  admin = false,
): ScrapyardResponse {
  /*
   * The two reads every row needs, taken once for the page.
   *
   * `officerFitReader` walks the crew and the room that lifts it, and `unlockContextFor` walks the city's
   * control rows: doing either inside a row would repeat it ninety times for the structures and
   * thirty for the units, on a page that is opened constantly.
   */
  const markFor = officerFitReader(repos, base).markFor;
  // The Salvager's cut, once for the page, for the same reason: it walks the whole roster.
  const cut = yardCutFor(repos, base);
  const musterable = new Set(unlockedUnits(unlockContextFor(repos, base)).map((unit) => unit.id));

  const modifications: ScrapyardEntry[] = MODIFICATIONS.map((spec) => {
    const targets = modificationTargets(base, spec, markFor, cut, admin);
    const requirement = modificationRequirement(spec, spec.building);
    return {
      id: spec.id,
      kind: 'modification' as const,
      name: spec.name,
      description: spec.description,
      building: spec.building,
      effect: describeAddonEffect(spec),
      cost: modificationBill(base, spec, cut),
      advanced: isAdvancedModification(spec),
      rarity: findModification(spec.id)?.rarity ?? null,
      blueprint: documentFor(spec),
      // How many structures are wearing one. A card is one per structure now, so this is a count
      // of places rather than a count of copies on a shelf: the shelf is gone.
      owned: targets.filter((target) => target.fitted).length,
      requiresLevel: scrapyardLevelForModification(spec),
      documentHeld: modificationGateMet(base.inventory, spec),
      // The page is per structure, so the row's own blocker is the one for the structure the
      // player is looking at. Kept for the rows that belong to no structure, and left null here.
      blocker: null,
      targets,
      requirement: describeModificationRequirement(requirement, {
        buildingName: BUILDING_CATALOG[spec.building].name,
        // A BASIC card names no chair (`building/requirements.ts`), so there is no label to look up.
        roleLabel:
          requirement.officer === null ? '' : OFFICER_ROLE_LABELS[requirement.officer.role],
      }),
    };
  });

  // The unit bench: thirty cards in catalogue order, which is rarity order. The page groups them
  // by the `rarity` on each row rather than by anything it knows about the catalogue.
  const upgrades: ScrapyardEntry[] = UNIT_MODIFICATIONS.map((spec) => {
    const targets = upgradeTargets(base, spec, standing, markFor, musterable, cut, admin);
    const requirement = unitModificationRequirement(spec);
    return {
      id: spec.id,
      kind: 'upgrade' as const,
      name: spec.name,
      description: spec.description,
      building: null,
      effect: describeAddonEffect(spec),
      cost: upgradeBill(base, spec, standing, cut),
      advanced: isAdvancedUpgrade(spec),
      rarity: spec.rarity,
      blueprint: documentFor(spec),
      owned: targets.filter((target) => target.fitted).length,
      requiresLevel: scrapyardLevelForUpgrade(spec),
      documentHeld: blueprintGateMet(base.inventory, 'unit_upgrade', spec.id),
      blocker: null,
      targets,
      requirement: describeModificationRequirement(requirement, {
        buildingName: BUILDING_CATALOG.gauntlet.name,
        // A BASIC card names no chair (`building/requirements.ts`), so there is no label to look up.
        roleLabel:
          requirement.officer === null ? '' : OFFICER_ROLE_LABELS[requirement.officer.role],
      }),
    };
  });

  /*
   * §I4: the traps.
   *
   * `building: null` like the unit cards, because a trap belongs to no structure: it goes into the
   * inventory and is set under one fight the crew is defending. `owned` is the count in the bag
   * rather than a 0/1, because unlike everything else on this page a trap is spent, so "you have
   * three" is the number a player is deciding on.
   *
   * The one row that is still built rather than bolted, so it keeps the plain `blocker` and has no
   * targets: there is nothing to put it on.
   */
  const traps: ScrapyardEntry[] = TRAP_CATALOG.map((spec) => ({
    id: spec.id,
    kind: 'trap' as const,
    name: spec.name,
    description: spec.description,
    building: null,
    effect: trapEffectLine(spec),
    cost: trapBill(base, spec, cut),
    advanced: (spec.cost.highQualityMetal ?? 0) > 0,
    rarity: null,
    blueprint: blueprintForTrap(spec.id)?.name ?? null,
    owned: itemCount(base.inventory, spec.id as ItemId),
    requiresLevel: scrapyardLevelForTrap(spec),
    documentHeld: blueprintGateMet(base.inventory, 'trap', spec.id),
    blocker: trapBlockerFor(base, spec, cut, admin),
    targets: [],
    requirement: [],
  }));

  return {
    scrapyardLevel: yardLevel(base),
    // The yard's level on every line, and the Salvager on scrap and HQ metal (2026-10-04).
    discountPercent: scrapyardBillCutPercent(yardLevel(base)),
    salvagerCutPercent: Math.round(cut * 10) / 10,
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
  /** The structure or the unit it is being bolted to. A trap names nothing. */
  target?: string,
  /**
   * Testing mode: the bill is quoted and not taken, and neither are the parts (`admin/mode.ts`).
   * The yard was the one bench that still charged in admin mode (bug pass, 2026-09-29).
   */
  admin = false,
): AddonBuildResult {
  /*
   * The Salvager's cut, taken here as well as on the read.
   *
   * The two have to agree to the coin: a page that quotes a discounted bill and a write that
   * charges the list price is how a player gets refused for money the screen says they have.
   */
  const cut = yardCutFor(repos, base);
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
    const blocker = trapBlockerFor(base, spec, cut, admin);
    if (blocker !== null) return { kind: 'refused', reason: blocker };

    const built: Base = {
      ...base,
      resources: spendResources(base.resources, adminCost(trapBill(base, spec, cut), admin)),
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
    // Narrowed off the catalogue rather than asserted: the target arrives as a string off the wire.
    const into = BUILDING_KINDS.find((one) => one === target);
    if (into === undefined) {
      return { kind: 'refused', reason: 'Name a structure to bolt it to' };
    }

    const refusal = boltInRefusal({
      spec,
      kind: into,
      yardLevel: yardLevel(base),
      blueprintUnlocked: (one) => modificationGateMet(base.inventory, one),
      buildings: base.buildings,
      crewLevel: base.level,
      // §D7: the top two bands ask for a rank, which is the gate the ladder never had.
      notoriety: base.economy.notoriety,
      markFor: officerFitReader(repos, base).markFor,
      affordable: (one) =>
        adminWaives('cannot_afford', admin) ||
        canAfford(base.resources, modificationBill(base, one, cut)),
    });
    if (refusal !== null) {
      return { kind: 'refused', reason: boltInMessage(refusal, base, spec, into) };
    }

    /*
     * Cut and bolted in one write.
     *
     * There is no shelf any more (maintainer rule, 2026-09-16): a card is cut *for* a structure and
     * goes straight into its first open bracket. The two halves have to land together or a crash
     * between them leaves a crew charged for a card that is nowhere, so the resources and the
     * district move in the same transaction the route opens.
     */
    const buildings = withModificationFitted(base.buildings, into, spec.id);
    const built: Base = {
      ...base,
      resources: spendResources(
        base.resources,
        adminCost(modificationBill(base, spec, cut), admin),
      ),
      buildings,
    };
    repos.bases.updateResources(built.id, built.resources);
    repos.bases.updateDistrict(built.id, buildings, built.buildQueue);
    tallyAddonBuilt(repos, built.id, false);
    return { kind: 'built', base: built };
  }

  const spec = findUnitModification(id);
  if (!spec) return { kind: 'refused', reason: 'No such add-on' };
  if (target === undefined || !findUnit(target)) {
    return { kind: 'refused', reason: 'Name a unit to bolt it onto' };
  }

  const slots = slotsFor(base.unitLoadouts, target);
  const refusal = boltOntoUnitRefusal({
    id: spec.id,
    unitId: target,
    musterable: unlockedUnits(unlockContextFor(repos, base)).some((unit) => unit.id === target),
    fitsUnit: modificationFitsUnit,
    slots,
    yardLevel: yardLevel(base),
    requiredYardLevel: scrapyardLevelForUpgrade,
    blueprintUnlocked: (one) => blueprintGateMet(base.inventory, 'unit_upgrade', one),
    gauntletLevel: buildingLevel(base.buildings, 'gauntlet'),
    crewLevel: base.level,
    notoriety: base.economy.notoriety,
    markFor: officerFitReader(repos, base).markFor,
    affordable: (one) =>
      adminWaives('cannot_afford', admin) ||
      canAfford(base.resources, upgradeBill(base, one, standing, cut)),
    hasParts: (parts) => adminWaives('missing_parts', admin) || hasItems(base.inventory, parts),
  });
  if (refusal !== null) {
    return { kind: 'refused', reason: upgradeMessage(refusal, base, spec, target) };
  }

  const index = slots.findIndex((slot) => slot === null);
  const loadouts: UnitLoadouts = {
    ...base.unitLoadouts,
    [target]: slots.map((slot, at) => (at === index ? spec.id : slot)),
  };
  const built: Base = {
    ...base,
    resources: spendResources(
      base.resources,
      adminCost(upgradeBill(base, spec, standing, cut), admin),
    ),
    // Spent, not merely checked. A requirement that is verified and never consumed is a one-off
    // toll that buys every card in the catalogue for ever. Not in admin mode, which waived them.
    inventory: removeItems(base.inventory, admin ? {} : spec.parts),
    unitLoadouts: loadouts,
  };
  repos.bases.updateHoldings(built.id, built.resources, built.inventory);
  repos.bases.updateUnitLoadouts(built.id, loadouts);
  tallyAddonBuilt(repos, built.id, false);
  return { kind: 'built', base: built };
}
