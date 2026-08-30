import { z } from 'zod';
import { PLAYER_LEVEL_MIN } from './curve.js';

/**
 * What a player level is worth (GDD §I2): the three standing grants other workstreams read.
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
  /** §H8: how many recruits the player may hold at once. */
  recruitSlots: z.number().int().positive(),
});
export type PlayerLevelGrants = z.infer<typeof PlayerLevelGrantsSchema>;

/** §H8: hold 2 recruits at the start, +1 per level. */
function recruitSlotsFor(level: number): number {
  return 2 + (level - PLAYER_LEVEL_MIN);
}

/**
 * Everything level `level` entitles a player to. Levels below the minimum are clamped rather than
 * rejected: a grant lookup is a read path and must never throw on a malformed row.
 */
export function playerLevelGrants(level: number): PlayerLevelGrants {
  const at = Math.max(PLAYER_LEVEL_MIN, Math.trunc(level));
  return {
    recruitSlots: recruitSlotsFor(at),
  };
}
