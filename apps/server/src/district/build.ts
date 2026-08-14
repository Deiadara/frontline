import {
  BUILDING_CATALOG,
  BUILDING_MAX_LEVEL,
  CENTRAL_BUILDING,
  MAX_BUILD_QUEUE,
  buildingBuildSeconds,
  buildingCost,
  buildingLevel,
  canAfford,
  isUnlockedForQueue,
  nextQueuedLevel,
  projectedBuildings,
  queueStartsAt,
  spendResources,
  structureLevelCap,
  type Base,
  type BuildQueueEntry,
  type BuildingKind,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Placing one build order (GDD §A1, §D3 — oil is what building consumes).
 *
 * Construction and upgrading are the same move — a plot with nothing on it is ordered to level 1, a
 * plot with something on it goes up one — so there is one gate list and one spend, not two of each.
 * What this does *not* do is raise anything: the order goes into the queue and `settleDistrict`
 * stands it up when its clock runs out.
 */

export const BUILD_REFUSALS = [
  'locked',
  'at_max_level',
  'nexus_cap',
  'queue_full',
  'cannot_afford',
] as const;
export type BuildRefusal = (typeof BUILD_REFUSALS)[number];

export type BuildResult =
  | { kind: 'refused'; reason: BuildRefusal }
  | { kind: 'queued'; base: Base; entry: BuildQueueEntry };

export interface BuildInput {
  base: Base;
  structure: BuildingKind;
  /** Id minted for this order. It becomes the structure's own id if the order creates one. */
  id: string;
  now: Date;
}

/**
 * The first reason this order cannot be placed, or `null` if it can.
 *
 * The ceilings are told apart on purpose. Hitting {@link BUILDING_MAX_LEVEL} is the end of the
 * content; hitting the Nexus's level is an instruction — raise the Nexus first — and being locked
 * is a third thing again, a structure the Nexus is not yet senior enough to authorise at all. A
 * player who cannot tell the three apart cannot act on any of them.
 */
function refusalFor({ base, structure }: Omit<BuildInput, 'id' | 'now'>): BuildRefusal | null {
  const { buildings, buildQueue } = base;

  if (!isUnlockedForQueue(structure, buildings, buildQueue)) return 'locked';

  const level = nextQueuedLevel(structure, buildings, buildQueue);
  if (level === null) {
    const projected = projectedBuildings(buildings, buildQueue);
    return structureLevelCap(structure, projected) === BUILDING_MAX_LEVEL
      ? 'at_max_level'
      : 'nexus_cap';
  }

  if (buildQueue.length >= MAX_BUILD_QUEUE) return 'queue_full';
  return canAfford(base.resources, buildingCost(structure, level, buildings))
    ? null
    : 'cannot_afford';
}

/**
 * Charges for the order and puts it at the back of the queue.
 *
 * Price and clock are read off the district **as it stands**, not as the queue projects it: the
 * discount a build gets is the Nexus the crew actually has while they do the work. Only the
 * *level* comes from the projection, because that is a question about what has already been paid
 * for rather than about how fast anyone is working. Both are frozen onto the entry, so raising the
 * Nexus never retimes or re-prices work already under way — the same rule a mission's clock follows.
 */
export function queueBuild(repos: Repositories, input: BuildInput): BuildResult {
  const refusal = refusalFor(input);
  if (refusal) return { kind: 'refused', reason: refusal };

  const { base, structure, id, now } = input;
  // `refusalFor` already proved this is not null; re-deriving beats threading it out of a guard.
  const level = nextQueuedLevel(structure, base.buildings, base.buildQueue) ?? 1;
  const cost = buildingCost(structure, level, base.buildings);

  const entry: BuildQueueEntry = {
    id,
    kind: structure,
    level,
    startedAt: queueStartsAt(base.buildQueue, now).toISOString(),
    durationSeconds: buildingBuildSeconds(structure, level, base.buildings),
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, cost),
    buildQueue: [...base.buildQueue, entry],
  };
  repos.bases.updateResources(queued.id, queued.resources);
  repos.bases.updateDistrict(queued.id, queued.buildings, queued.buildQueue);

  return { kind: 'queued', base: queued, entry };
}

/**
 * The two numbers a `locked` or `nexus_cap` refusal needs to say something useful: what the Nexus
 * is at, and what it would have to reach.
 */
export function nexusGate(structure: BuildingKind, base: Base): { at: number; needs: number } {
  return {
    at: buildingLevel(base.buildings, CENTRAL_BUILDING),
    needs: BUILDING_CATALOG[structure].requiresNexusLevel,
  };
}
