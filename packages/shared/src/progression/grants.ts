import { PLAYER_LEVEL_MIN } from './curve.js';

/**
 * What a player level is worth (GDD §I2) — the three standing grants other workstreams read.
 *
 * These are defined here, once, because §I2 makes them a consequence of levelling: W4 (§G) and W5
 * (§H) consume this, they do not restate the formulas. Every one is a pure function of level, so
 * there is nothing to store and nothing to keep in step with `Base.level`.
 */
export interface PlayerLevelGrants {
  /** §G8 — total assignees in the fungible pool. */
  assigneePool: number;
  /** §G3/§G3a — how many assignees may sit under any one officer. */
  assigneeCapPerOfficer: number;
  /** §H8 — how many recruits the player may hold at once. */
  recruitSlots: number;
}

/** §G8 — start with 2, +1 per level, +1 extra at every 5th level (5, 10, 15, …). */
function assigneePoolFor(level: number): number {
  return 2 + (level - PLAYER_LEVEL_MIN) + Math.floor(level / 5);
}

/**
 * §G3a — `max(1, floor(level / 2))`: 1 at the start, 2 from level 4.
 *
 * TODO-LATER — §G7's assignee bonus table stops at 12 ("12 assignees at 50% is the maximum"), which
 * this formula reaches at level 24 and then passes. Whether the cap should hold at 12 or the table
 * should extend is a tuning call for the board; §G3a states the formula with no ceiling, so that is
 * what ships. W4/MOU-163 owns the table and inherits the question.
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
