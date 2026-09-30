import { findResearchItem, noCrewEffects, researchEffects, type Army } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { fightMissionBattle } from './battle.js';

/**
 * The syringes reach a battle job (bug pass, 2026-09-29).
 *
 * `battleStims` is paid by the Black Clinic and by two Lab rungs, the Chief Medic's Blood Bank and
 * the Wetware Chief's Salvage Grafts, each "+1 battle stim". The declared-battle settler spent
 * them and nothing else did, so a job, which is a fight on the same engine, was fought as though
 * the crew had none. Measured over a sweep of seeds rather than on one, since a single seed can
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
  it('are what the two Lab rungs pay', () => {
    const rungs = ['tech_blood_bank', 'tech_salvage_grafts'];
    for (const id of rungs)
      expect(findResearchItem(id)?.payout.bonus?.kind, id).toBe('battle_stims');
    expect(researchEffects(rungs).battleStims).toBe(2);
  });

  /*
   * Read off what the crew lost, which is where the syringes show. What it killed sits near the
   * whole enemy on a grade E job either way, so a kill count only moves on noise: since the pursuit
   * rolls each body on its own draw (2026-09-29) the 30 seeds read 296 killed bare and 292 dosed,
   * while the losses read 73 and 60. Over 200 seeds: 1,994 and 2,016 killed, 469 and 400 lost.
   */
  it('change the fight in the crew’s favour', () => {
    const bare = sweep(0);
    const dosed = sweep(10);
    expect(bare.killed, 'the fixture kills nobody, so it measures nothing').toBeGreaterThan(0);
    expect(dosed.lost, 'ten syringes did nothing to what the crew lost').toBeLessThan(
      bare.lost * 0.9,
    );
    expect(dosed.killed).toBeGreaterThanOrEqual(bare.killed * 0.97);
  });
});
