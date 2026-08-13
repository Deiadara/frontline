import type { Commander } from '../commander.js';
import { RESKILLING_ROLE } from '../roles.js';
import {
  assigneeCapPerOfficer,
  assigneePool,
  type AssigneeState,
  type PlacementRefusal,
} from './placement.js';

/**
 * Reskilling — GDD §G4, and the Professor's job under §C4.
 *
 * §G4 is "a process run by the Professor that lets you reassign **every** assignee at once". So it
 * takes a whole new placement map and either applies all of it or none of it, rather than a
 * sequence of moves: a partial application would leave the crew in an arrangement the player never
 * asked for if the third move in a chain turned out to be over cap.
 *
 * This is the *only* way an assignee comes back off an officer. Plain §G2 placement adds and never
 * removes (`placeAssignees`), which is what makes the Professor worth hiring: without a Professor
 * on the books, a placement is permanent.
 */

/** §C4/§G4 — whether anybody on the books can run the process. Gated on `roles.ts`, not a literal. */
export function canReskill(officers: readonly Commander[]): boolean {
  return officers.some((officer) => officer.role === RESKILLING_ROLE);
}

export type ReskillRefusal =
  /** §C4 — nobody in the Professor's chair, so the process cannot be run at all. */
  | 'no_professor'
  /** The plan places assignees under somebody who is not on the books. */
  | Extract<PlacementRefusal, 'unknown_officer'>
  /** Some officer in the plan is over the §G3 cap. */
  | Extract<PlacementRefusal, 'at_cap'>
  /** The plan places more assignees than the §G8 pool holds. */
  | 'over_pool';

export type ReskillResult =
  { kind: 'reskilled'; state: AssigneeState } | { kind: 'refused'; reason: ReskillRefusal };

/**
 * Applies a complete new arrangement of the pool.
 *
 * `plan` is the whole map, not a delta: an officer left out of it ends with nobody. Zero and
 * negative counts are dropped rather than rejected, so a client that sends `{ "id": 0 }` to clear
 * an officer means the same thing as one that omits the key — `AssigneeStateSchema` stores only
 * positive counts, and there is one representation per arrangement.
 *
 * Note what is *not* an argument: the current state. §G4 reassigns everyone, so the previous
 * arrangement has no say in the next one, and taking it would only invite a caller to believe
 * this merges.
 */
export function reskillAssignees(args: {
  officers: readonly Commander[];
  plan: Readonly<Record<string, number>>;
  /** `Base.level` (INTERFACES R1). */
  level: number;
}): ReskillResult {
  const { officers, plan, level } = args;
  if (!canReskill(officers)) return { kind: 'refused', reason: 'no_professor' };

  const onBooks = new Set(officers.map((officer) => officer.id));
  const cap = assigneeCapPerOfficer(level);
  const placements: Record<string, number> = {};
  let total = 0;

  for (const [commanderId, requested] of Object.entries(plan)) {
    const count = Math.trunc(requested);
    if (count <= 0) continue;
    if (!onBooks.has(commanderId)) return { kind: 'refused', reason: 'unknown_officer' };
    if (count > cap) return { kind: 'refused', reason: 'at_cap' };
    placements[commanderId] = count;
    total += count;
  }
  if (total > assigneePool(level)) return { kind: 'refused', reason: 'over_pool' };

  return { kind: 'reskilled', state: { placements } };
}
