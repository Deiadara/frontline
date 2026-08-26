import {
  factionXpBonus,
  resolvePlayerXpAward,
  type Base,
  type LevelUp,
  type PlayerXpAward,
  type PlayerXpSource,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

export interface AwardedXp {
  /** The base with its new level and banked XP already applied. */
  base: Base;
  award: PlayerXpAward;
}

/**
 * Awards player XP for one thing that happened, and applies any level-up it paid for (GDD §I1-I2).
 *
 * **This is the only function in the server that writes player XP or `Base.level`**: INTERFACES §2
 * R7 gives W6 the whole XP side, so a system that makes XP happen calls this and names its source
 * rather than deciding an amount or touching the level itself. Call sites stay one line long.
 */
export function awardPlayerXp(
  repos: Repositories,
  base: Base,
  source: PlayerXpSource,
  /** Percentage points on top of the district's own, e.g. the lead's charisma on a project. */
  extraPercent = 0,
  /** The figure to pay instead of the source's table entry, for sources that price themselves. */
  amount?: number,
): AwardedXp {
  const award = resolvePlayerXpAward(
    { level: base.level, xpIntoLevel: base.progression.xpIntoLevel },
    source,
    undefined,
    // §I1: the district's own contribution, plus whatever the caller is adding on this event.
    factionXpBonus(base.buildings) + extraPercent,
    amount,
  );
  repos.bases.updateProgression(base.id, award.level, award.progression);
  return { base: { ...base, level: award.level, progression: award.progression }, award };
}

/**
 * The `levelUp` a response announces for the awards one request banked, or `undefined` when none of
 * them crossed a level (MOU-227: presence is the signal, so no client compares two numbers).
 *
 * Takes the whole run of awards because a single call can bank several: a settlement that brings two
 * crews home over two thresholds is *one* level-up to announce, so the levels **add up** while the
 * level and grants are the ones the player ended on. Passing `[award]` is the one-award case.
 */
export function levelUpFrom(awards: readonly PlayerXpAward[]): LevelUp | undefined {
  const levelsGained = awards.reduce((total, award) => total + award.levelsGained, 0);
  const last = awards.at(-1);
  if (levelsGained === 0 || !last) return undefined;
  // §I3: every unlock the whole run crossed, not just the last award's. A settlement that banked
  // two missions across three levels can open two doors, and announcing one of them would leave a
  // player to discover the other by walking into it.
  const unlocks = awards.flatMap((award) => award.unlocks);
  return { level: last.level, levelsGained, grants: last.grants, unlocks };
}
