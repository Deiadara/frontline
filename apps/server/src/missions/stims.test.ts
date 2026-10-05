import {
  RESEARCH_ITEMS,
  bonusesAt,
  noCrewEffects,
  researchEffects,
  type Army,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { fightMissionBattle } from './battle.js';

/**
 * The syringes reach a battle job (bug pass, 2026-09-29).
 *
 * `battleStims` is paid by the Black Clinic (the two Lab rungs that paid one each went with the
 * Chief Medic's and the Wetware Chief's chairs, 2026-10-04). The declared-battle settler spent them
 * and nothing else did, so a job, which is a fight on the same engine, was fought as though the
 * crew had none. Measured over a sweep of seeds rather than on one, since a single seed can
 * land on either side of a close fight.
 */

const SEEDS = Array.from({ length: 30 }, (_, index) => index + 1);
const FORCE: Army = { razors: 40 };
const total = (army: Army): number => Object.values(army).reduce((sum, count) => sum + count, 0);

function sweep(stims: number): { killed: number; lost: number } {
  const territory = { ...noCrewEffects(), battleStims: stims };
  let killed = 0;
  let lost = 0;
  for (const seed of SEEDS) {
    const fought = fightMissionBattle({
      seed,
      jobName: 'The stim sweep',
      force: FORCE,
      vehicles: {},
      grade: 'E',
      anyRide: false,
      territory,
    });
    killed += total(fought.killed);
    lost += total(fought.lost);
  }
  return { killed, lost };
}

describe('stims on a battle job', () => {
  it('are what the Black Clinic pays, and no Lab rung any more', () => {
    expect(bonusesAt('black_clinic', 1)).toContainEqual({ kind: 'battle_stims', flat: 2 });
    expect(researchEffects(RESEARCH_ITEMS.map((spec) => spec.id)).battleStims).toBe(0);
  });

  /*
   * Read off what the crew kills, where the syringes show since morale reads wounds (2026-10-05).
   * The enemy breaks on its wounds now, so a dosed crew runs more of it down; what the crew loses
   * barely moves. 30 seeds: 264 killed bare and 292 dosed, 60 lost both. 200 seeds: 1,784 and 2,011
   * killed, 396 and 398 lost. (Before the morale change it was the losses that moved: 469 and 400.)
   */
  it('change the fight in the crew’s favour', () => {
    const bare = sweep(0);
    const dosed = sweep(10);
    expect(bare.killed, 'the fixture kills nobody, so it measures nothing').toBeGreaterThan(0);
    expect(dosed.killed, 'ten syringes did nothing to what the crew killed').toBeGreaterThan(
      bare.killed * 1.05,
    );
    expect(dosed.lost).toBeLessThanOrEqual(bare.lost * 1.05);
  });
});
