import { z } from 'zod';
import { applyPlayerXp, playerXpToNextLevel, type PlayerLevelProgress } from './curve.js';
import { playerLevelGrants, type PlayerLevelGrants } from './grants.js';
import { playerUnlocksBetween, type PlayerLevelUnlock } from './unlocks.js';

/**
 * The stored half of player progression (GDD §I): progress towards the next level. The level
 * itself is `Base.level` and stays there (INTERFACES §2 R1) — this never restates it.
 */
export const ProgressionStateSchema = z.object({
  /** XP banked towards the next level. Always below `playerXpToNextLevel(base.level)`. */
  xpIntoLevel: z.number().int().min(0),
});
export type ProgressionState = z.infer<typeof ProgressionStateSchema>;

export function startingProgression(): ProgressionState {
  return { xpIntoLevel: 0 };
}

/**
 * §I1 — the four things that pay XP, and what each is worth.
 *
 * Placeholder tuning, in the same spirit as `INFAMY_PER_RAID_WON`: the GDD names the sources but
 * not the numbers. W6 owns these values outright (INTERFACES §2 R7) — no other workstream decides
 * what its own events are worth.
 *
 * `raidLost` exists because §I1 pays for *fighting* other players, not for winning; a lost raid
 * still taught you something, just less.
 */
export const PLAYER_XP_AWARDS = {
  missionCompleted: 120,
  buildingConstructed: 60,
  questCompleted: 200,
  raidWon: 80,
  raidLost: 25,
} as const;

export type PlayerXpSource = keyof typeof PLAYER_XP_AWARDS;

/** The outcome of one XP award: the new position on the curve, plus what a level-up handed over. */
export interface PlayerXpAward {
  source: PlayerXpSource;
  xpGained: number;
  /** `Base.level` after the award. */
  level: number;
  progression: ProgressionState;
  /** XP still needed to clear `level`. */
  xpToNextLevel: number;
  levelsGained: number;
  /** §I2 grants at the new level. Unchanged when no level was gained. */
  grants: PlayerLevelGrants;
  /** §I3 unlocks crossed by this award — empty until the board files the catalogue. */
  unlocks: PlayerLevelUnlock[];
}

/**
 * Resolves one XP award end to end. Pure: the caller decides whether to persist it.
 *
 * This is the only place that turns an XP *source* into a level change, so a caller never has to
 * know the curve — it names what happened and gets back the new state.
 */
export function resolvePlayerXpAward(
  current: PlayerLevelProgress,
  source: PlayerXpSource,
  catalogue?: readonly PlayerLevelUnlock[],
): PlayerXpAward {
  const xpGained = PLAYER_XP_AWARDS[source];
  const advance = applyPlayerXp(current, xpGained);
  return {
    source,
    xpGained,
    level: advance.level,
    progression: { xpIntoLevel: advance.xpIntoLevel },
    xpToNextLevel: playerXpToNextLevel(advance.level),
    levelsGained: advance.levelsGained,
    grants: playerLevelGrants(advance.level),
    unlocks: playerUnlocksBetween(current.level, advance.level, catalogue),
  };
}
