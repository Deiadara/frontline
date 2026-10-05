import {
  estimatedForce,
  forecast,
  type Battlefield,
  type CombinePower,
  type UnitLoadouts,
} from '@frontline/shared';

/** The reader's own chance on a fight, from their side of it, and how many of theirs come home. */
export interface YourOdds {
  chance: number;
  kept: number;
  runs: number;
}

/**
 * The forecast of a fight from the reader's side: taking it when they called it, holding it when it
 * was called on them.
 *
 * The sides go the right way round (bug pass, 2026-10-02). The engine treats the attacker's slot as
 * the attacker, not the `defending` flag: only that slot gets the ambush and the walk through a
 * wire. The defender's reading used to put the player in that slot, so 20 Ghosts holding against
 * 20 Wardens read 56% where they hold 3%.
 */
export function yourOdds(plan: {
  seed: string;
  ground: Battlefield;
  sending: Record<string, number>;
  fitted: UnitLoadouts;
  /** The enemy's size off the reader's own spy report. */
  size: number;
  /** The units that report named (`BattleView.enemyArmy`), when it named any. */
  army?: Record<string, number> | null;
  /** Whether the reader is the one holding the ground. */
  holding: boolean;
  /** The Combine's legendary standing behind its own ground, which only ever defends. */
  shadow: CombinePower | null;
}): YourOdds {
  const ours = { name: 'you', army: plan.sending, upgrades: plan.fitted };
  // Wardens stand in only for a make-up nobody has seen (`estimatedForce`).
  const theirs = { name: 'them', army: plan.army ?? estimatedForce(plan.size) };
  if (plan.holding) {
    const read = forecast({
      seed: plan.seed,
      battlefield: plan.ground,
      attacker: { ...theirs, defending: false },
      defender: { ...ours, defending: true },
    });
    return { chance: 1 - read.winChance, kept: read.defenderSurvival, runs: read.runs };
  }
  const read = forecast({
    seed: plan.seed,
    battlefield: plan.ground,
    attacker: { ...ours, defending: false },
    defender: {
      ...theirs,
      defending: true,
      // Defender-only by construction: the one side a Combine legendary ever stands behind is the
      // Combine's, which is the same reading `battle/resolve.ts` takes at the settle.
      ...(plan.shadow === null ? {} : { presence: plan.shadow }),
    },
  });
  return { chance: read.winChance, kept: read.attackerSurvival, runs: read.runs };
}

/**
 * Everybody on the reader's side at the mark: the rows, and the ones standing there with no row
 * (postings, waiting cells, a defender's garrison or home army), who fight as surely (bug pass,
 * 2026-10-02). The odds read the rows alone, so a defence held by its own garrison forecast empty.
 */
export function sideAtTheMark(
  muster:
    | { army: Record<string, number>; standing?: Record<string, number> | undefined }
    | null
    | undefined,
): Record<string, number> {
  const all: Record<string, number> = { ...(muster?.army ?? {}) };
  for (const [unitId, count] of Object.entries(muster?.standing ?? {})) {
    all[unitId] = (all[unitId] ?? 0) + count;
  }
  return all;
}
