import {
  applyCharacterXp,
  characterXpBonus,
  characterXpForActivity,
  type Base,
  type Commander,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/** One officer's share of a settled run: who was out, and for how long. */
export interface CharacterActivity {
  /** The officer who led it, or `null` for a §G6 delegation with nobody to pay. */
  officerId: string | null;
  /** Minutes the run kept them engaged: travel out, the job, and travel back (§E2). */
  minutesEngaged: number;
}

/**
 * Pays every officer for the runs they led, and applies any level-up it bought (GDD §H6).
 *
 * **This is the only function in the server that writes character XP**: the mirror of
 * `awardPlayerXp` for INTERFACES §2 R2. A system that keeps a character busy calls this and names
 * the activity; how much a minute is worth lives in `characterXpForActivity`, so a board correction
 * to the CTO's reading stays the one-line change that module promises.
 *
 * Several runs can come home on one settle, and two of them can be led by the same officer, so the
 * awards are folded per officer before anything is written: paying them separately would bank the
 * second award against a pre-level-up sheet and lose a level the first one had already paid for.
 *
 * An `officerId` that no longer resolves: dismissed mid-flight, or a row written before the
 * officer was recorded: is skipped rather than failing the settle. The crew still came home and
 * the player still gets paid; there is simply nobody left to credit.
 */
export function awardCharacterXp(
  repos: Repositories,
  base: Base,
  activities: readonly CharacterActivity[],
): Base {
  // What the crew built raises what its officers learn: the Gauntlet's training bonus and any
  // modification on it. `characterXpBonus` was computed and read by nothing until now.
  const bonus = 1 + characterXpBonus(base.buildings) / 100;
  const earned = new Map<string, number>();
  for (const { officerId, minutesEngaged } of activities) {
    if (officerId === null) continue;
    const xp = Math.round(characterXpForActivity(minutesEngaged) * bonus);
    if (xp > 0) earned.set(officerId, (earned.get(officerId) ?? 0) + xp);
  }
  if (earned.size === 0) return base;

  let touched = false;
  const commanders = base.commanders.map((officer): Commander => {
    const xp = earned.get(officer.id);
    if (xp === undefined) return officer;
    touched = true;
    const advanced = applyCharacterXp(officer, xp);
    return {
      ...officer,
      level: advanced.level,
      xpIntoLevel: advanced.xpIntoLevel,
      unspentPoints: advanced.unspentPoints,
      attributes: advanced.attributes,
    };
  });
  if (!touched) return base;

  repos.bases.updateCommanders(base.id, commanders);
  return { ...base, commanders };
}
