import { z } from 'zod';
import { IdSchema } from '../primitives.js';
import {
  BUILDING_MAX_LEVEL,
  BuildingKindSchema,
  BUILDING_CATALOG,
  CENTRAL_BUILDING,
  levelCapForNexus,
  nexusLevelForUpgrade,
  type BuildingKind,
  type BuildingRequirement,
} from './kinds.js';
import {
  MAX_MODIFICATION_SLOTS,
  ModificationIdSchema,
  modificationSlotsAt,
} from './modifications.js';

/**
 * One structure standing in the district: how far up it is, and which of its five modifications
 * were fitted (§A1). Levels and modifications are deliberately separate fields because they are
 * separate currencies: one is bought with materials and a clock, the other is researched.
 */
export const BuildingSchema = z.object({
  id: IdSchema,
  kind: BuildingKindSchema,
  level: z.number().int().min(1).max(BUILDING_MAX_LEVEL),
  /**
   * Installed modification ids, at most one slot's worth each. Defaulted so a row written before
   * modifications existed still parses: the field is additive, unlike the kind rename beside it.
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

/**
 * The clauses this district does **not** yet satisfy (§A1, §I3): empty when the plot may be laid.
 *
 * Returns the unmet ones rather than a boolean, because every caller that wants the boolean also
 * wants the reason a moment later: the district's hover note, the plot dialog's refusal line and
 * the route's error message are all the same list rendered three ways. A predicate would mean
 * computing the answer twice and risking two different answers.
 */
export function unmetRequirements(
  kind: BuildingKind,
  buildings: readonly Building[],
  playerLevel: number,
): BuildingRequirement[] {
  return BUILDING_CATALOG[kind].requires.filter((clause) =>
    clause.kind === 'player_level'
      ? playerLevel < clause.level
      : buildingLevel(buildings, clause.building) < clause.level,
  );
}

/** Whether every clause holds and this plot may be laid at all (§A1, §I3). */
export function isBuildingUnlocked(
  kind: BuildingKind,
  buildings: readonly Building[],
  playerLevel: number,
): boolean {
  return unmetRequirements(kind, buildings, playerLevel).length === 0;
}

/**
 * The highest level `kind` may currently reach in this district (§B1).
 *
 * Read off the Nexus's per-building permission table rather than off its level directly, which is
 * the whole of the §B1 change: a Gate and a Lab standing beside each other under the same Nexus no
 * longer stop at the same rung. A district with no Nexus standing caps everything else at 0, which
 * is why a new district is minted with one.
 */
export function structureLevelCap(kind: BuildingKind, buildings: readonly Building[]): number {
  if (kind === CENTRAL_BUILDING) return BUILDING_MAX_LEVEL;
  return levelCapForNexus(kind, buildingLevel(buildings, CENTRAL_BUILDING));
}

/**
 * The Nexus level this district is short of, for the upgrade it cannot currently order.
 *
 * `null` when the Nexus is not what is standing in the way. The number a refusal is written out of:
 * §B1 says a refused upgrade must name the Nexus level it wants, on the building's own dialog,
 * before the player spends anything.
 */
export function nexusShortfall(
  kind: BuildingKind,
  buildings: readonly Building[],
): { needed: number; at: number } | null {
  if (kind === CENTRAL_BUILDING) return null;
  const next = buildingLevel(buildings, kind) + 1;
  if (next > BUILDING_MAX_LEVEL) return null;
  const needed = nexusLevelForUpgrade(kind, next);
  const at = buildingLevel(buildings, CENTRAL_BUILDING);
  return needed > at ? { needed, at } : null;
}

/**
 * The level a build or upgrade would produce, or `null` when the structure can go no higher.
 *
 * This reads the structures actually *standing*. What the queue has already paid for is the build
 * queue's business: see `nextQueuedLevel`, which stacks on top of this.
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
