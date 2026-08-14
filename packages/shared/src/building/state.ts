import { z } from 'zod';
import { IdSchema } from '../primitives.js';
import {
  BUILDING_MAX_LEVEL,
  BuildingKindSchema,
  BUILDING_CATALOG,
  CENTRAL_BUILDING,
  type BuildingKind,
} from './kinds.js';
import {
  MAX_MODIFICATION_SLOTS,
  ModificationIdSchema,
  modificationSlotsAt,
} from './modifications.js';

/**
 * One structure standing in the district: how far up it is, and which of its five modifications
 * were fitted (§A1). Levels and modifications are deliberately separate fields because they are
 * separate currencies — one is bought with materials and a clock, the other is researched.
 */
export const BuildingSchema = z.object({
  id: IdSchema,
  kind: BuildingKindSchema,
  level: z.number().int().min(1).max(BUILDING_MAX_LEVEL),
  /**
   * Installed modification ids, at most one slot's worth each. Defaulted so a row written before
   * modifications existed still parses — the field is additive, unlike the kind rename beside it.
   */
  modifications: z.array(ModificationIdSchema).max(MAX_MODIFICATION_SLOTS).default([]),
});
export type Building = z.infer<typeof BuildingSchema>;

export function findBuilding(
  buildings: readonly Building[],
  kind: BuildingKind,
): Building | undefined {
  return buildings.find((building) => building.kind === kind);
}

/** A structure's level, or 0 when the plot is still empty. The reading every formula wants. */
export function buildingLevel(buildings: readonly Building[], kind: BuildingKind): number {
  return findBuilding(buildings, kind)?.level ?? 0;
}

/** Whether the Nexus is far enough along for this plot to be laid at all (§A1). */
export function isBuildingUnlocked(kind: BuildingKind, buildings: readonly Building[]): boolean {
  return buildingLevel(buildings, CENTRAL_BUILDING) >= BUILDING_CATALOG[kind].requiresNexusLevel;
}

/**
 * The highest level `kind` may currently reach in this district.
 *
 * The Nexus's own catalogue copy is the rule, so it is enforced rather than left as flavour: every
 * other structure stops at the Nexus's level, and the Nexus itself stops at
 * {@link BUILDING_MAX_LEVEL}. A district with no Nexus standing caps everything else at 0, which is
 * why a new district is minted with one.
 */
export function structureLevelCap(kind: BuildingKind, buildings: readonly Building[]): number {
  if (kind === CENTRAL_BUILDING) return BUILDING_MAX_LEVEL;
  return Math.min(BUILDING_MAX_LEVEL, buildingLevel(buildings, CENTRAL_BUILDING));
}

/**
 * The level a build or upgrade would produce, or `null` when the structure can go no higher.
 *
 * This reads the structures actually *standing*. What the queue has already paid for is the build
 * queue's business — see `nextQueuedLevel`, which stacks on top of this.
 */
export function nextStructureLevel(
  kind: BuildingKind,
  buildings: readonly Building[],
): number | null {
  const next = buildingLevel(buildings, kind) + 1;
  return next > structureLevelCap(kind, buildings) ? null : next;
}

/** Modification slots this structure has opened, and how many are still empty. */
export function modificationCapacity(building: Building | undefined): {
  slots: number;
  used: number;
  free: number;
} {
  const slots = modificationSlotsAt(building?.level ?? 0);
  const used = building?.modifications.length ?? 0;
  return { slots, used, free: Math.max(0, slots - used) };
}
