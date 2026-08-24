import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import {
  BUILDING_MAX_LEVEL,
  BuildingKindSchema,
  type BuildingKind,
  type BuildingRequirement,
} from './kinds.js';
import { repairedByBuilding } from './damage.js';
import {
  buildingLevel,
  findBuilding,
  isBuildingUnlocked,
  structureLevelCap,
  unmetRequirements,
  type Building,
} from './state.js';

/**
 * The build queue (§A1): up to six orders, worked one at a time in the order they were placed.
 *
 * Like every other clock in this game it is settled **lazily**: entries carry absolute start and
 * duration, and whatever has come due is applied the next time the district is read. Nothing wakes
 * up to finish a building.
 *
 * Materials are taken when the order is *placed*, not when it completes. That is the genre's
 * convention and it is also the only version that cannot be gamed: charging on completion would
 * let a player queue six upgrades they cannot afford and spend the materials elsewhere while the
 * clock ran.
 */

export const MAX_BUILD_QUEUE = 6;

export const BuildQueueEntrySchema = z.object({
  id: IdSchema,
  kind: BuildingKindSchema,
  /** The level this order produces, not the current one. */
  level: z.number().int().min(1).max(BUILDING_MAX_LEVEL),
  /**
   * When this entry's own clock started: the moment it was ordered for the head of the queue, and
   * the previous entry's completion for everything behind it. Absolute, so a settle that lands
   * three entries at once gets each one's timing right without re-deriving the chain.
   */
  startedAt: IsoDateTimeSchema,
  /**
   * Frozen at order time, exactly as a mission freezes its own. Raising the Nexus must not retime
   * work already under way: in either direction.
   */
  durationSeconds: z.number().int().positive(),
});
export type BuildQueueEntry = z.infer<typeof BuildQueueEntrySchema>;

export const BuildQueueSchema = z.array(BuildQueueEntrySchema).max(MAX_BUILD_QUEUE).default([]);
export type BuildQueue = z.infer<typeof BuildQueueSchema>;

const SECOND_MS = 1000;

export function queueCompletesAt(entry: BuildQueueEntry): Date {
  return new Date(Date.parse(entry.startedAt) + entry.durationSeconds * SECOND_MS);
}

export function queueRemainingMs(entry: BuildQueueEntry, now: Date): number {
  return Math.max(0, queueCompletesAt(entry).getTime() - now.getTime());
}

/** Fraction complete, clamped to 0..1: the progress bar on a queue row. */
export function queueProgressAt(entry: BuildQueueEntry, now: Date): number {
  const elapsedMs = now.getTime() - Date.parse(entry.startedAt);
  return Math.min(1, Math.max(0, elapsedMs / (entry.durationSeconds * SECOND_MS)));
}

/** When an order placed right now would actually begin: after everything already in the queue. */
export function queueStartsAt(queue: BuildQueue, now: Date): Date {
  const last = queue.at(-1);
  if (!last) return now;
  const after = queueCompletesAt(last);
  return after > now ? after : now;
}

/** When the whole queue drains. `now` when it is empty. */
export function queueDrainsAt(queue: BuildQueue, now: Date): Date {
  return queueStartsAt(queue, now);
}

/**
 * The district as it will stand once the queue has drained.
 *
 * Everything that gates an order, the level cap, the Nexus unlock ladder, is judged against
 * *this* rather than against what is standing, so a player can queue the Nexus and the structure it
 * unlocks in the same breath. Refusing that would make the six slots useful only for six copies of
 * the same decision.
 */
export function projectedBuildings(buildings: readonly Building[], queue: BuildQueue): Building[] {
  const projected = buildings.map((building) => ({ ...building }));
  for (const entry of queue) {
    const standing = projected.find((building) => building.kind === entry.kind);
    if (standing) {
      standing.level = Math.max(standing.level, entry.level);
    } else {
      projected.push({
        id: entry.id,
        kind: entry.kind,
        level: entry.level,
        modifications: [],
        damage: 0,
        garrisons: 0,
      });
    }
  }
  return projected;
}

/** The level `kind` would reach if one more order were placed for it, or `null` at the ceiling. */
export function nextQueuedLevel(
  kind: BuildingKind,
  buildings: readonly Building[],
  queue: BuildQueue,
): number | null {
  const projected = projectedBuildings(buildings, queue);
  const next = buildingLevel(projected, kind) + 1;
  return next > structureLevelCap(kind, projected) ? null : next;
}

/**
 * The same question as {@link isBuildingUnlocked}, asked of the district the queue will produce.
 *
 * A player who has already paid for the Scrapyard level that opens the Gate should be offered the
 * Gate, not told to go and do the thing they have just done. Everything queued counts as standing.
 */
export function isUnlockedForQueue(
  kind: BuildingKind,
  buildings: readonly Building[],
  queue: BuildQueue,
  playerLevel: number,
): boolean {
  return isBuildingUnlocked(kind, projectedBuildings(buildings, queue), playerLevel);
}

/** The clauses the queued district still would not satisfy: the wording for a dead build button. */
export function unmetForQueue(
  kind: BuildingKind,
  buildings: readonly Building[],
  queue: BuildQueue,
  playerLevel: number,
): BuildingRequirement[] {
  return unmetRequirements(kind, projectedBuildings(buildings, queue), playerLevel);
}

/**
 * The leading run of entries whose clocks are up, and the rest.
 *
 * A prefix rather than a filter: the queue is sequential, so an entry cannot have finished while
 * one in front of it has not. Splitting it this way means a settle can apply the completed run in
 * order and leave the tail untouched.
 */
export function splitDueQueue(
  queue: BuildQueue,
  now: Date,
): { due: BuildQueueEntry[]; pending: BuildQueueEntry[] } {
  let count = 0;
  while (count < queue.length) {
    const entry = queue[count];
    if (!entry || queueRemainingMs(entry, now) > 0) break;
    count += 1;
  }
  return { due: queue.slice(0, count), pending: queue.slice(count) };
}

/** `buildings` with one completed order applied: a new plot, or one level on an existing one. */
export function applyQueueEntry(
  buildings: readonly Building[],
  entry: BuildQueueEntry,
): Building[] {
  const standing = findBuilding(buildings, entry.kind);
  if (!standing) {
    return [
      ...buildings,
      {
        id: entry.id,
        kind: entry.kind,
        level: entry.level,
        modifications: [],
        damage: 0,
        garrisons: 0,
      },
    ];
  }
  // Building a level up is also how a wrecked structure gets put right (§A4). There is no repair
  // button and there is not going to be one: making the recovery a side effect of the thing a
  // player was going to do anyway keeps a siege's cost measured in tempo rather than in a second
  // economy nobody asked for.
  return buildings.map((building) =>
    building.kind === entry.kind
      ? repairedByBuilding({ ...building, level: Math.max(building.level, entry.level) })
      : building,
  );
}
