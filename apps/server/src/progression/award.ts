import {
  resolvePlayerXpAward,
  type Base,
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
 * Awards player XP for one thing that happened, and applies any level-up it paid for (GDD §I1–I2).
 *
 * **This is the only function in the server that writes player XP or `Base.level`** — INTERFACES §2
 * R7 gives W6 the whole XP side, so a system that makes XP happen calls this and names its source
 * rather than deciding an amount or touching the level itself. Call sites stay one line long.
 */
export function awardPlayerXp(repos: Repositories, base: Base, source: PlayerXpSource): AwardedXp {
  const award = resolvePlayerXpAward(
    { level: base.level, xpIntoLevel: base.progression.xpIntoLevel },
    source,
  );
  repos.bases.updateProgression(base.id, award.level, award.progression);
  return { base: { ...base, level: award.level, progression: award.progression }, award };
}
