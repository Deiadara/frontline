import { blueprintForUnit } from '../blueprints/requirements.js';
import { findBlueprint } from '../blueprints/catalog.js';
import { isBlueprintUnlocked } from '../blueprints/state.js';
import {
  BUILDING_CATALOG,
  buildingLevel,
  findModification,
  findVehicle,
  type Building,
} from '../building/index.js';
import { LOCATION_CATALOG, type LocationKind } from '../city/locations.js';
import type { Inventory } from '../items/inventory.js';
import { UNIT_CATALOG, type UnitRequirement, type UnitSpec } from './catalog.js';

/**
 * Whether a crew can field a unit (GDD §A5, §D12a).
 *
 * Every clause is evaluated against the same context object, and **all** of them must hold. That
 * is the design: the interesting units are the ones that need two different kinds of progress at
 * once: a structure at the top of its tree *and* a location you had to take off somebody.
 *
 * ## The blueprint clause is synthesised, not written on the unit
 *
 * §D12a puts thirteen units behind a blueprint document, and none of them carry a clause saying
 * so. The mapping lives on the document (`blueprints/catalog.ts`) because one document gates more
 * than one thing: §D12b's motorbike blueprint is the Road Reavers' gate as well as the machine's.
 * Copying it onto `UnitSpec.requires` would have written that fact down twice and left the two
 * copies free to disagree, so {@link unitUnlockClauses} reads it back out of the catalogue and
 * hands it to the same filter every other clause goes through. The screens get the missing
 * blueprint on the same list as the missing Garage level, for free.
 */

/**
 * §D12a: the document a unit is behind, as a clause.
 *
 * Not a member of `UnitRequirement`, which is what a *catalogue entry* may declare. This one is
 * derived, and keeping it out of that union is what stops somebody typing a blueprint clause onto
 * a unit and creating the second copy the doc above exists to prevent.
 */
export interface BlueprintRequirement {
  kind: 'blueprint';
  blueprintId: string;
}

/** Everything that has to hold before a unit can be trained: what a screen lists. */
export type UnitUnlockClause = UnitRequirement | BlueprintRequirement;

export interface UnlockContext {
  /** The crew's own structures. */
  buildings: readonly Building[];
  /** Location kinds this crew currently holds, anywhere in the city. */
  heldPlaceKinds: ReadonlySet<LocationKind>;
  /**
   * §B6: machines the Garage could turn out today, by vehicle id.
   *
   * What the Garage *can build*, not what is parked in it. Required rather than optional, and that
   * is deliberate: a default of "nothing" would leave a caller who forgot to fill it in with a
   * permanently locked Road Reaver and no error anywhere, which is the exact failure mode this
   * whole module's guards exist to prevent.
   */
  buildableVehicles: ReadonlySet<string>;
  /** The satchel, which is where a finished blueprint document lives (§D10). */
  inventory: Inventory;
}

export function requirementMet(need: UnitUnlockClause, context: UnlockContext): boolean {
  switch (need.kind) {
    case 'building':
      return buildingLevel(context.buildings, need.building) >= need.level;
    case 'modification':
      return context.buildings.some((building) =>
        building.modifications.includes(need.modificationId),
      );
    case 'location':
      return context.heldPlaceKinds.has(need.locationKind);
    case 'vehicle':
      return context.buildableVehicles.has(need.vehicleId);
    case 'blueprint':
      return isBlueprintUnlocked(context.inventory, need.blueprintId);
  }
}

/**
 * Every clause this unit answers to, blueprint first.
 *
 * First because it is the coarsest of them: a Garage level arrives on its own and a document does
 * not, so a player reading a locked Colossus wants the eight pages at the top of the list rather
 * than under three structure levels.
 */
export function unitUnlockClauses(unit: UnitSpec): UnitUnlockClause[] {
  const document = blueprintForUnit(unit.id);
  const clauses: UnitUnlockClause[] = [...unit.requires];
  if (document) clauses.unshift({ kind: 'blueprint', blueprintId: document.id });
  return clauses;
}

/**
 * Which clauses are *not* met, in catalogue order.
 *
 * The whole list rather than the first one: a player looking at a locked Colossus wants to know
 * they need a Garage at 16 **and** a Generator at 14 **and** a war machine graveyard, so they can
 * decide whether the campaign is worth starting. Telling them one thing at a time is how a unit
 * stays locked for a month by accident.
 */
export function missingRequirements(unit: UnitSpec, context: UnlockContext): UnitUnlockClause[] {
  return unitUnlockClauses(unit).filter((need) => !requirementMet(need, context));
}

export function isUnitUnlocked(unit: UnitSpec, context: UnlockContext): boolean {
  return unitUnlockClauses(unit).every((need) => requirementMet(need, context));
}

export function unlockedUnits(context: UnlockContext): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) => isUnitUnlocked(unit, context));
}

/** One clause in the player's words. */
export function describeRequirement(need: UnitUnlockClause): string {
  switch (need.kind) {
    case 'building':
      return `${BUILDING_CATALOG[need.building].name} at level ${need.level}`;
    case 'modification':
      return findModification(need.modificationId)?.name ?? need.modificationId;
    case 'location':
      return `Hold ${theLocation(need.locationKind)}`;
    case 'vehicle':
      return `${findVehicle(need.vehicleId)?.name ?? need.vehicleId}s buildable in the Garage`;
    case 'blueprint':
      return `The ${findBlueprint(need.blueprintId)?.name ?? need.blueprintId}`;
  }
}

/**
 * A location, with its article, for a sentence that names one.
 *
 * Always **The**, never "a", and that is a decision about what these places are rather than a
 * grammar preference. Five of the labels carry the article already ("The Doghouse", "The Bone
 * Market") and the rest do not, so a template that prepended one produced "hold a The Doghouse".
 * Prepending nothing would have produced "hold Doghouse".
 *
 * "The" for all of them, including the kinds a city has several of: a clause that says *hold a*
 * Mad Scientist's Lair reads as a shopping list, and what a crew is actually being told is to go
 * and take **the** one on the map in front of them. The definite article is the one that says a
 * place rather than a category.
 */
export function theLocation(kind: LocationKind): string {
  const label = LOCATION_CATALOG[kind].label;
  return /^The /.test(label) ? label : `The ${label}`;
}

/** The location kinds a crew holds, from its control rows: the other half of {@link UnlockContext}. */
export function heldPlaceKindsOf(
  locations: readonly { id: string; kind: LocationKind }[],
  isHeld: (locationId: string) => boolean,
): Set<LocationKind> {
  const kinds = new Set<LocationKind>();
  for (const location of locations) {
    if (isHeld(location.id)) kinds.add(location.kind);
  }
  return kinds;
}
