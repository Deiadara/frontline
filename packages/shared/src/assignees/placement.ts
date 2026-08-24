import { z } from 'zod';
import type { Commander } from '../commander.js';
import { IdSchema } from '../primitives.js';
import { playerLevelGrants } from '../progression/grants.js';
import { MAX_ASSIGNEES_PER_OFFICER } from './bonus.js';

/**
 * Where the fungible pool is standing (GDD §G1-§G3, §G8).
 *
 * §G1 makes assignees interchangeable with no individual identity, so there are no assignee
 * records anywhere: only a count under each officer. The pool *size* is not stored either: §G8
 * makes it a pure function of `Base.level`, which W6 already owns in `playerLevelGrants`. Storing
 * a second copy would let the two drift, and a level-up would need a migration to hand out its
 * own grant.
 */
export const AssigneeStateSchema = z.object({
  /**
   * Assignees standing under each officer, keyed by `Commander.id`. An officer with nobody under
   * them is absent from the map rather than present with a zero, so the stored shape has exactly
   * one representation per arrangement.
   */
  placements: z.record(IdSchema, z.number().int().positive()),
});
export type AssigneeState = z.infer<typeof AssigneeStateSchema>;

/** A crew that has never placed anybody. The pool itself is already 2 at level 1 (§G8). */
export function startingAssignees(): AssigneeState {
  return { placements: {} };
}

/**
 * §G3/§G3a: how many assignees may stand under any one officer, at `level`.
 *
 * This resolves the question W6 handed over in `progression/grants.ts`. §G3a states
 * `max(1, floor(level / 2))` with no ceiling and there is no maximum player level, so the formula
 * grows forever; the §G7 table is finite. Placement therefore stops where the table does.
 *
 * The rule is not "12". It is **whatever `ASSIGNEE_BONUS_PERCENT` has a row for**, which the board
 * has since extended to 24. The reason is unchanged and is what makes the cap correct at any table
 * length: the first assignee past the end is provably worth 0%, so letting a player park one there
 * would strand a pool grant behind an officer where it does nothing, with no feedback saying so.
 * Capping keeps every placed assignee load-bearing and pushes the surplus somewhere it still pays.
 *
 * Extending the table is therefore the only edit needed to raise this; nothing here hardcodes a
 * number. If §G3a's fully uncapped reading is ever wanted instead, this becomes
 * `playerLevelGrants(level).assigneeCapPerOfficer` and the bonus simply plateaus.
 */
export function assigneeCapPerOfficer(level: number): number {
  return Math.min(playerLevelGrants(level).assigneeCapPerOfficer, MAX_ASSIGNEES_PER_OFFICER);
}

/** §G8: the whole pool at `level`, placed or not. Read from W6; never restated here. */
export function assigneePool(level: number): number {
  return playerLevelGrants(level).assigneePool;
}

/** How many stand under one officer. Unknown officers have nobody, not an error. */
export function assigneesUnder(state: AssigneeState, commanderId: string): number {
  return state.placements[commanderId] ?? 0;
}

/** Everyone currently standing under somebody. */
export function placedAssignees(state: AssigneeState): number {
  return Object.values(state.placements).reduce((total, count) => total + count, 0);
}

/**
 * §G2: the ones a level-up handed over that the player has not placed yet.
 *
 * Floored at zero rather than allowed to go negative: a placement map that outgrew its pool is a
 * state a *shrinking* grant table could produce, and a read path must render it, not throw.
 */
export function unplacedAssignees(state: AssigneeState, level: number): number {
  return Math.max(0, assigneePool(level) - placedAssignees(state));
}

export type PlacementRefusal =
  /** No officer on the books by that id: §G1 places assignees *under officers*, not loose. */
  | 'unknown_officer'
  /** Asked for a non-positive number of assignees. */
  | 'not_positive'
  /** The pool has fewer unplaced assignees than the request wants. */
  | 'not_enough_unplaced'
  /** The officer is already at, or would pass, the §G3 cap. */
  | 'at_cap';

export type PlacementResult =
  { kind: 'placed'; state: AssigneeState } | { kind: 'refused'; reason: PlacementRefusal };

/**
 * §G2: place `count` of the unplaced pool under one officer.
 *
 * Placement only ever *adds*. Taking assignees back off an officer is §G4 reskilling, which is a
 * Professor-run process and costs the player something to reach: see `./reskilling.js`. Keeping
 * the two apart is what gives the Professor a job: if a plain placement call could also unplace,
 * reskilling would be a no-op wrapper around it.
 */
export function placeAssignees(
  state: AssigneeState,
  args: {
    officers: readonly Commander[];
    commanderId: string;
    count: number;
    /** `Base.level` (INTERFACES R1): the pool and the cap both hang off it. */
    level: number;
  },
): PlacementResult {
  const { officers, commanderId, count, level } = args;
  if (!Number.isInteger(count) || count < 1) return { kind: 'refused', reason: 'not_positive' };
  if (!officers.some((officer) => officer.id === commanderId)) {
    return { kind: 'refused', reason: 'unknown_officer' };
  }
  if (count > unplacedAssignees(state, level)) {
    return { kind: 'refused', reason: 'not_enough_unplaced' };
  }
  const placed = assigneesUnder(state, commanderId) + count;
  if (placed > assigneeCapPerOfficer(level)) return { kind: 'refused', reason: 'at_cap' };

  return {
    kind: 'placed',
    state: { placements: { ...state.placements, [commanderId]: placed } },
  };
}

/**
 * Drops officers who are no longer on the books, returning their assignees to the unplaced pool.
 *
 * Fired when an officer leaves (§H5 says a badly-aligned one threatens to). Without this their
 * count would sit in the map forever, counted against the pool by `placedAssignees` and reachable
 * by nobody: the player would silently lose grants every time somebody walked out.
 */
export function pruneAssignees(
  state: AssigneeState,
  officers: readonly Commander[],
): AssigneeState {
  const onBooks = new Set(officers.map((officer) => officer.id));
  const placements = Object.fromEntries(
    Object.entries(state.placements).filter(([commanderId]) => onBooks.has(commanderId)),
  );
  return { placements };
}
