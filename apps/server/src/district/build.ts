import { adminWaives } from '../admin/mode.js';
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
  discounted,
  speedMultiplier,
  buildingParts,
  hasItems,
  removeItems,
} from '@frontline/shared';
import { adminCost, adminSeconds } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
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
  'missing_parts',
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
  /**
   * Testing mode: five seconds, no materials (`admin/mode.ts`).
   *
   * Carried on the input rather than read off a module-level flag so the override is visible in
   * every call and a test can have both modes in the same file.
   *
   * It waives the price, the clock, and every gate in {@link adminWaives} — which now includes the
   * Nexus's authorisation and its level cap, because a reviewer who wants to look at the Garage
   * should not have to spend the afternoon buying twelve Nexus levels first. What it cannot waive
   * is {@link BUILDING_MAX_LEVEL}: there is no twenty-first level to queue.
   */
  admin?: boolean;
}

/**
 * The first reason this order cannot be placed, or `null` if it can.
 *
 * The ceilings are told apart on purpose. Hitting {@link BUILDING_MAX_LEVEL} is the end of the
 * content; hitting the Nexus's level is an instruction — raise the Nexus first — and being locked
 * is a third thing again, a structure the Nexus is not yet senior enough to authorise at all. A
 * player who cannot tell the three apart cannot act on any of them.
 */
function refusalFor({
  base,
  structure,
  admin,
}: Omit<BuildInput, 'id' | 'now'>): BuildRefusal | null {
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
  // The part gate before the price: "you need a Coolant Cell" is a thing a player can go and do
  // something about today, and "you are short of scrap" fixes itself while they read the message.
  if (!hasItems(base.inventory, buildingParts(structure, level))) return 'missing_parts';
  if (admin) return null;
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
  const { base, structure, id, now, admin = false } = input;
  const refusal = refusalFor(input);
  if (refusal && !adminWaives(refusal, admin)) return { kind: 'refused', reason: refusal };

  // The level the order is for.
  //
  // Normally `nextQueuedLevel`, which is null exactly when the Nexus caps it — and admin mode has
  // just waived that cap, so the level has to be worked out without it. Falling back to `1` here
  // (which is what the null case used to do) would queue a *first* level for a structure that
  // already has six, and the district would come back wrong on the next read.
  const projected = projectedBuildings(base.buildings, base.buildQueue);
  const level =
    nextQueuedLevel(structure, base.buildings, base.buildQueue) ??
    buildingLevel(projected, structure) + 1;
  // §F2 — the crew is half of how fast and how cheaply a thing goes up. Organization keeps a long
  // job moving and Dexterity finishes the fiddly end of it; Fabrication makes the part rather than
  // buying it. Frozen onto the entry with the rest, so hiring an engineer mid-build does not
  // retime work already under way.
  const effects = standingEffectsFor(repos, base);
  const cost = discounted(buildingCost(structure, level, base.buildings), effects.buildCostPercent);
  // §A1 — the handful of levels that ask for a part as well as a price. Taken at the moment the
  // order is placed, like the materials: a queued build has already been paid for.
  const parts = buildingParts(structure, level);

  const entry: BuildQueueEntry = {
    id,
    kind: structure,
    level,
    startedAt: queueStartsAt(base.buildQueue, now).toISOString(),
    durationSeconds: adminSeconds(
      Math.max(
        1,
        Math.round(
          buildingBuildSeconds(structure, level, base.buildings) /
            speedMultiplier(effects.buildSpeedPercent),
        ),
      ),
      admin,
    ),
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, adminCost(cost, admin)),
    inventory: removeItems(base.inventory, parts),
    buildQueue: [...base.buildQueue, entry],
  };
  repos.bases.updateHoldings(queued.id, queued.resources, queued.inventory);
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
