import {
  BUILDING_MAX_LEVEL,
  buildingCost,
  canAfford,
  nextStructureLevel,
  spendResources,
  structureLevelCap,
  type Base,
  type Building,
  type BuildingKind,
  type PlayerXpAward,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { awardPlayerXp } from '../progression/award.js';

/**
 * Raising one structure in the hideout (GDD §A1 the village, §D3 oil is what building consumes).
 *
 * Construction and upgrading are the same move — a plot with nothing on it goes to level 1, a plot
 * with something on it goes up one — so there is one gate list and one spend, not two of each.
 */

export const BUILD_REFUSALS = ['at_max_level', 'command_center_cap', 'cannot_afford'] as const;
export type BuildRefusal = (typeof BUILD_REFUSALS)[number];

export type BuildResult =
  | { kind: 'refused'; reason: BuildRefusal }
  | { kind: 'built'; base: Base; building: Building; award: PlayerXpAward };

export interface BuildInput {
  base: Base;
  structure: BuildingKind;
  /** Id minted for a *new* structure; ignored when this is an upgrade. */
  id: string;
}

/**
 * The first reason this structure cannot go up, or `null` if it can.
 *
 * The two ceilings are told apart on purpose: hitting {@link BUILDING_MAX_LEVEL} is the end of the
 * content, while hitting the Command Center's level is an instruction — raise the Command Center
 * first — and a player who cannot tell them apart cannot act on either.
 */
function refusalFor({ base, structure }: BuildInput): BuildRefusal | null {
  const level = nextStructureLevel(structure, base.buildings);
  if (level === null) {
    return structureLevelCap(structure, base.buildings) === BUILDING_MAX_LEVEL
      ? 'at_max_level'
      : 'command_center_cap';
  }
  return canAfford(base.resources, buildingCost(structure, level)) ? null : 'cannot_afford';
}

/**
 * Charges for the level and stands it up, banking the §I1 XP that building things is worth.
 *
 * `awardPlayerXp` is the only XP write path (INTERFACES §2 R7), so this names its source and takes
 * the base back carrying whatever level it ended on rather than deciding an amount here.
 */
export function buildStructure(repos: Repositories, input: BuildInput): BuildResult {
  const refusal = refusalFor(input);
  if (refusal) return { kind: 'refused', reason: refusal };

  const { base, structure, id } = input;
  const standing = base.buildings.find((building) => building.kind === structure);
  const level = (standing?.level ?? 0) + 1;
  const raised: Building = standing ? { ...standing, level } : { id, kind: structure, level: 1 };
  const buildings = standing
    ? base.buildings.map((building) => (building.kind === structure ? raised : building))
    : [...base.buildings, raised];

  const built: Base = {
    ...base,
    resources: spendResources(base.resources, buildingCost(structure, level)),
    buildings,
  };
  repos.bases.updateResources(built.id, built.resources);
  repos.bases.updateBuildings(built.id, built.buildings);

  const { base: progressed, award } = awardPlayerXp(repos, built, 'buildingConstructed');
  return { kind: 'built', base: progressed, building: raised, award };
}
