import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { InventorySchema } from '../items/inventory.js';
import { PartialResourcesSchema } from '../resources.js';
import { cancelWindowMs, cancelWindowOpen } from '../time/cancel.js';
import {
  BUILDING_MAX_LEVEL,
  BuildingKindSchema,
  type BuildingKind,
  type BuildingRequirement,
} from './kinds.js';
import {
  buildingLevel,
  findBuilding,
  isBuildingUnlocked,
  structureLevelCap,
  unmetRequirements,
  type Building,
} from './state.js';

/**
 * The build queue (§A1): four orders to begin with and six once earned, worked one at a time in
 * the order they were placed.
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

/**
 * What a crew can queue before it has earned anything (maintainer, 2026-09-22).
 *
 * It was a flat six from the first minute of a run, which made the opening's real constraint
 * materials and nothing else: a new crew could line up every structure it could afford and then
 * stop thinking about the order. Four is still enough to plan with and few enough that *which*
 * four is a decision.
 */
export const BASE_BUILD_QUEUE = 4;

/** What Batch Runs adds. Two, so the earned queue is the six the game shipped with. */
export const BUILD_QUEUE_RESEARCH_BONUS = 2;

/**
 * The rung that buys the other two slots: the Fabricator track's third, `Batch Runs`.
 *
 * Declared here rather than in `research/tracks.ts`, which is the pattern the other earned
 * unlocks follow (`SCOUTING_RESEARCH_ID`, the five spy rungs): the id lives beside the rule that
 * reads it, so a rename has one place to fail rather than two places to drift.
 *
 * "Forty of them, then set up for the next thing. Never one at a time" is a line about running
 * work in parallel, which is what the slots are.
 */
export const BUILD_QUEUE_RESEARCH_ID = 'tech_batch_runs';

/** The most any crew can reach, which is what a screen prints as the denominator's ceiling. */
export const MAX_BUILD_QUEUE = BASE_BUILD_QUEUE + BUILD_QUEUE_RESEARCH_BONUS;

/** How many orders this crew may have standing, given what it has researched. */
export function buildQueueCapacity(technologies: readonly string[]): number {
  return technologies.includes(BUILD_QUEUE_RESEARCH_ID)
    ? BASE_BUILD_QUEUE + BUILD_QUEUE_RESEARCH_BONUS
    : BASE_BUILD_QUEUE;
}

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
  /**
   * What the order took out of the stockpile, so a cancel can hand ninety percent of it back
   * (`time/cancel.ts`). Defaulted empty: an order written before this field existed refunds
   * nothing, which is what it did.
   */
  paid: PartialResourcesSchema.default({}),
  /** The parts the level asked for, handed back whole on a cancel: half a servo is nothing. */
  parts: InventorySchema.default({}),
});
export type BuildQueueEntry = z.infer<typeof BuildQueueEntrySchema>;

/**
 * The queue as it is **stored**, with no length cap. See `TrainingQueueSchema` for the whole
 * argument: {@link MAX_BUILD_QUEUE} gates the order, and a cap on the read path can only turn a row
 * that was legal when written into a save nobody can load.
 */
export const BuildQueueSchema = z.array(BuildQueueEntrySchema).default([]);
export type BuildQueue = z.infer<typeof BuildQueueSchema>;

const SECOND_MS = 1000;

export function queueCompletesAt(entry: BuildQueueEntry): Date {
  return new Date(Date.parse(entry.startedAt) + entry.durationSeconds * SECOND_MS);
}

export function queueRemainingMs(entry: BuildQueueEntry, now: Date): number {
  return Math.max(0, queueCompletesAt(entry).getTime() - now.getTime());
}

/** Fraction complete, clamped to 0..1: the progress bar on a queue row. */
/** Whether the order can still be called off: not yet started, or inside its first tenth. */
export function queueCancellable(entry: BuildQueueEntry, now: Date): boolean {
  return cancelWindowOpen(
    Date.parse(entry.startedAt),
    entry.durationSeconds * SECOND_MS,
    now.getTime(),
  );
}

export function queueCancelWindowMs(entry: BuildQueueEntry, now: Date): number {
  return cancelWindowMs(
    Date.parse(entry.startedAt),
    entry.durationSeconds * SECOND_MS,
    now.getTime(),
  );
}

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

/**
 * The district as it will stand once the queue has drained.
 *
 * Everything that gates an order, the level cap, the Nexus unlock ladder, is judged against
 * *this* rather than against what is standing, so a player can queue the Nexus and the structure it
 * unlocks in the same breath. Refusing that would make the slots useful only for several copies
 * of the same decision.
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
      },
    ];
  }
  return buildings.map((building) =>
    building.kind === entry.kind
      ? { ...building, level: Math.max(building.level, entry.level) }
      : building,
  );
}
