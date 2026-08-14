import { z } from 'zod';
import { PLAYER_LEVEL_MIN } from './curve.js';

/**
 * What a player level is worth (GDD §I2) — the three standing grants other workstreams read.
 *
 * These are defined here, once, because §I2 makes them a consequence of levelling: W4 (§G) and W5
 * (§H) consume this, they do not restate the formulas. Every one is a pure function of level, so
 * there is nothing to store and nothing to keep in step with `Base.level`.
 *
 * Schema-first, like `ProgressionStateSchema`: the grants ship inside a response (`LevelUpSchema`),
 * so the client parses them, and deriving the type means there is no second declaration to drift.
 * Every figure is a count of something a player holds, so all three are positive integers.
 */
export const PlayerLevelGrantsSchema = z.object({
  /** §G8 — total assignees in the fungible pool. */
  assigneePool: z.number().int().positive(),
  /** §G3/§G3a — how many assignees may sit under any one officer. */
  assigneeCapPerOfficer: z.number().int().positive(),
  /** §H8 — how many recruits the player may hold at once. */
  recruitSlots: z.number().int().positive(),
});
export type PlayerLevelGrants = z.infer<typeof PlayerLevelGrantsSchema>;

/** §G8 — start with 2, +1 per level, +1 extra at every 5th level (5, 10, 15, …). */
function assigneePoolFor(level: number): number {
  return 2 + (level - PLAYER_LEVEL_MIN) + Math.floor(level / 5);
}

/**
 * §G3a — `max(1, floor(level / 2))`: 1 at the start, 2 from level 4.
 *
 * Stated here with no ceiling, exactly as §G3a writes it. The ceiling is applied where it belongs,
 * in `assignees/placement.js`, which clamps this to the length of the §G7 bonus table — the board
 * answered the open question by extending that table to 24 rather than by capping the formula.
 * This grant is still the uncapped entitlement, so the two readings stay separable.
 */
function assigneeCapPerOfficerFor(level: number): number {
  return Math.max(1, Math.floor(level / 2));
}

/** §H8 — hold 2 recruits at the start, +1 per level. */
function recruitSlotsFor(level: number): number {
  return 2 + (level - PLAYER_LEVEL_MIN);
}

/**
 * Everything level `level` entitles a player to. Levels below the minimum are clamped rather than
 * rejected — a grant lookup is a read path and must never throw on a malformed row.
 */
export function playerLevelGrants(level: number): PlayerLevelGrants {
  const at = Math.max(PLAYER_LEVEL_MIN, Math.trunc(level));
  return {
    assigneePool: assigneePoolFor(at),
    assigneeCapPerOfficer: assigneeCapPerOfficerFor(at),
    recruitSlots: recruitSlotsFor(at),
  };
}
