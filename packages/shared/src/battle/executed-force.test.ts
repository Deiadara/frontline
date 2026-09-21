import { describe, expect, it } from 'vitest';
import { COMBINE_LEADERS } from '../city/combine.js';
import { simulate } from './engine.js';
import { defaultSkirmishEngine } from './skirmish.js';

/**
 * Who the Executioner finished, and not only how many.
 *
 * `Simulation.executed` was a bare count, which is enough for the sentence on the report and not
 * enough for the settle: an attacker who wins carries every executed body inside `winnerLosses`,
 * that list is the one an Infirmary recovers from, and a count cannot say which bodies to hold
 * back. Measured on 2026-09-21 over 400 winning attacks on the Blacksite, he finished 129 bodies
 * and all 129 were candidates for the ward. `apps/server/src/battle/resolve.ts` now takes
 * `executedForce` off that list, so this file pins the thing it takes off.
 */
const power = COMBINE_LEADERS.find((one) => one.unitId === 'executioner')?.power;

const sum = (force: Record<string, number>): number =>
  Object.values(force).reduce((total, count) => total + count, 0);

describe('the Executioner names the bodies he takes', () => {
  it('has a power to measure, so none of this is vacuous', () => {
    expect(power, 'the Executioner is not in the leader table').toBeDefined();
  });

  /**
   * Both ledgers off one fight, over enough seeds that his power has certainly fired.
   *
   * The fights are the ones the balance sweep found him in: around twenty attacking Razors against
   * the Blacksite garrison is where an exchange leaves somebody under his line most often.
   */
  it('reports a force that sums to the count, on every fight he is over', () => {
    let firedIn = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const sim = simulate({
        seed: `executed-force-${seed}`,
        attacker: { name: 'A', army: { razors: 20, scrapers: 6 }, defending: false },
        defender: {
          name: 'The Combine',
          army: { greycoat: 14, enforcer: 6 },
          defending: true,
          presence: power!,
        },
      });
      expect(sum(sim.executedForce), `seed ${seed} disagrees with itself`).toBe(sim.executed);
      for (const unitId of Object.keys(sim.executedForce)) {
        // He fires at the side opposite him, so every body has to be one of the attacker's.
        expect(['razors', 'scrapers'], `seed ${seed} finished ${unitId}`).toContain(unitId);
      }
      if (sim.executed > 0) firedIn += 1;
    }
    // Without this the loop above passes on an engine where he never fires at all.
    expect(firedIn, 'he never fired in 200 fights, so nothing above was tested').toBeGreaterThan(
      20,
    );
  });

  /** A fight he is not over has nobody in either ledger, rather than an empty-looking count. */
  it('names nobody when he is not there', () => {
    const sim = simulate({
      seed: 'executed-force-absent',
      attacker: { name: 'A', army: { razors: 20 }, defending: false },
      defender: { name: 'The Combine', army: { greycoat: 14 }, defending: true },
    });
    expect(sim.executed).toBe(0);
    expect(sim.executedForce).toEqual({});
  });

  /**
   * And the force survives the trip to the outcome the server settles from.
   *
   * `outcomeFrom` is one more copy of the field, and a copy that was forgotten would leave every
   * settle reading the schema's `.default({})`: the Infirmary would quietly go back to recovering
   * his dead and nothing in the engine's own tests would notice.
   */
  it('carries the force onto the outcome the settler reads', () => {
    let carried = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const out = defaultSkirmishEngine.resolve({
        seed: `executed-outcome-${seed}`,
        attackerName: 'A',
        defenderName: 'The Combine',
        locationName: 'the Blacksite',
        attacking: { razors: 20, scrapers: 6 },
        defending: { greycoat: 14, enforcer: 6 },
        defenderPresence: power!,
      });
      expect(sum(out.executedForce)).toBe(out.executed);
      if (out.executed > 0) carried += 1;
    }
    expect(carried, 'no fight in the sweep had him fire, so nothing was carried').toBeGreaterThan(
      5,
    );
  });
});
