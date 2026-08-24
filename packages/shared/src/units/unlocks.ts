import {
  BUILDING_CATALOG,
  buildingLevel,
  findModification,
  type Building,
} from '../building/index.js';
import { LOCATION_CATALOG, type LocationKind } from '../city/locations.js';
import { UNIT_CATALOG, type UnitRequirement, type UnitSpec } from './catalog.js';

/**
 * Whether a crew can field a unit (GDD §A5).
 *
 * Every clause is evaluated against the same context object, and **all** of them must hold. That
 * is the design: the interesting units are the ones that need two different kinds of progress at
 * once — a structure at the top of its tree *and* a location you had to take off somebody.
 */

export interface UnlockContext {
  /** The crew's own structures. */
  buildings: readonly Building[];
  /** Location kinds this crew currently holds, anywhere in the city. */
  heldPlaceKinds: ReadonlySet<LocationKind>;
}

export function requirementMet(need: UnitRequirement, context: UnlockContext): boolean {
  switch (need.kind) {
    case 'building':
      return buildingLevel(context.buildings, need.building) >= need.level;
    case 'modification':
      return context.buildings.some((building) =>
        building.modifications.includes(need.modificationId),
      );
    case 'location':
      return context.heldPlaceKinds.has(need.locationKind);
  }
}

/**
 * Which clauses are *not* met, in catalogue order.
 *
 * The whole list rather than the first one: a player looking at a locked Colossus wants to know
 * they need a Garage at 16 **and** a Generator at 14 **and** a war machine graveyard, so they can
 * decide whether the campaign is worth starting. Telling them one thing at a time is how a unit
 * stays locked for a month by accident.
 */
export function missingRequirements(unit: UnitSpec, context: UnlockContext): UnitRequirement[] {
  return unit.requires.filter((need) => !requirementMet(need, context));
}

export function isUnitUnlocked(unit: UnitSpec, context: UnlockContext): boolean {
  return unit.requires.every((need) => requirementMet(need, context));
}

export function unlockedUnits(context: UnlockContext): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) => isUnitUnlocked(unit, context));
}

/** One clause in the player's words. */
export function describeRequirement(need: UnitRequirement): string {
  switch (need.kind) {
    case 'building':
      return `${BUILDING_CATALOG[need.building].name} at level ${need.level}`;
    case 'modification':
      return findModification(need.modificationId)?.name ?? need.modificationId;
    case 'location':
      return `hold a ${LOCATION_CATALOG[need.locationKind].label}`;
  }
}

/** The location kinds a crew holds, from its control rows — the other half of {@link UnlockContext}. */
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
