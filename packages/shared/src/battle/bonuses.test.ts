/**
 * Every channel a bonus can arrive on, and whether it actually reaches the fight.
 *
 * The engine takes buffs from five different places: the ground a crew holds (`TerritoryEffects`),
 * a bought or looted boost (`boosts.ts`, folded onto the same three fields), the officer leading,
 * the labels on the battlefield, and the crew's own co-ordination. Each of those is a number
 * threaded through several files to reach `effects.ts`, and a channel that quietly stops arriving
 * breaks nothing: the fight still resolves, the report still reads, and the bonus is simply worth
 * zero. Nothing else in this directory would notice.
 *
 * ## Why these are small
 *
 * A win rate needs hundreds of seeds to settle and would make this file slow enough that nobody
 * runs it. **Surviving share** is the same question asked of a much tighter statistic: measured
 * over three disjoint blocks it wanders by about 0.01 at twelve seeds, against gaps of 0.09 to
 * 0.43 for the bonuses below. So sixteen seeds is enough to tell a live channel from a dead one,
 * and the thresholds are set well under the measured gap and well over the measured noise.
 *
 * ## The one that needs a different question
 *
 * Morale is asked on the **win rate**, because more of it legitimately *lowers* surviving share: a
 * steadier stack does not break, so it stays in the fight and keeps taking casualties instead of
 * routing early and being pursued once. Measured at +25 morale on open ground: the attacker's
 * survival falls by 0.05 and the attacker's win rate goes from 56% to 100%. Asked the wrong way
 * round, a working channel reads as a broken one.
 */
import { describe, expect, it } from 'vitest';
import { noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { makeAttributes } from '../attributes.js';
import { bareBattlefield } from './battlefield.js';
import { MAX_COHESION_WIDTH, effectiveFrontage, simulate, type SideSetup } from './engine.js';
import { boostBundle } from './boosts.js';
import { fleeChance, pursuitSpeed } from './rout.js';
import { moraleDelta } from './morale.js';
import { OFFICER_BASE_MORALE, officerBattleStats } from './officer.js';

/** Few enough to stay fast, enough to settle the statistic. See the note above. */
const SEEDS = 16;

const territory = (over: Partial<TerritoryEffects>): Partial<SideSetup> => ({
  territory: { ...noTerritoryEffects(), ...over },
});

function fights(over: Partial<SideSetup>, defender: Partial<SideSetup> = {}) {
  const runs = [];
  for (let seed = 0; seed < SEEDS; seed += 1) {
    runs.push(
      simulate({
        seed: `bonus:${seed}`,
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { razors: 40 }, defending: false, ...over },
        defender: { name: 'D', army: { razors: 40 }, defending: true, ...defender },
      }),
    );
  }
  return runs;
}

/** The attacker's share still standing, officers excluded: they are one body and not a roster. */
function survival(over: Partial<SideSetup>): number {
  const shares = fights(over).map((sim) => {
    const stacks = sim.attacker.stacks.filter((stack) => stack.officer === undefined);
    const started = stacks.reduce((n, stack) => n + stack.started, 0);
    return started === 0 ? 0 : stacks.reduce((n, stack) => n + stack.alive, 0) / started;
  });
  return shares.reduce((a, b) => a + b, 0) / shares.length;
}

function winRate(over: Partial<SideSetup>, defender: Partial<SideSetup> = {}): number {
  const runs = fights(over, defender);
  return runs.filter((sim) => sim.winner === 'attacker').length / runs.length;
}

describe('bonuses reach the fight', () => {
  const flat = survival({});

  it('has a baseline that is a real fight rather than a walkover either way', () => {
    // If the mirror were already lopsided, every gap below would be measured against a ceiling or
    // a floor and a dead channel could read as a live one.
    expect(flat).toBeGreaterThan(0.15);
    expect(flat).toBeLessThan(0.75);
  });

  // The gap each channel actually produced when measured, so a threshold under half of it catches
  // a channel going dead without going red on ordinary tuning.
  for (const [label, over, least] of [
    ['offense', territory({ unitOffensePercent: 20 }), 0.05], // measured 0.111
    ['vitality', territory({ unitVitalityPercent: 20 }), 0.06], // measured 0.145
    ['armour', territory({ unitArmorPercent: 20 }), 0.08], // measured 0.195
    ['intimidation', territory({ intimidationFlat: 40 }), 0.15], // measured 0.428
  ] as const) {
    it(`carries a ${label} bonus onto the field`, () => {
      expect(
        survival(over) - flat,
        `the ${label} channel is not reaching the engine`,
      ).toBeGreaterThan(least);
    });
  }

  it('carries a morale bonus, which is asked on the win and not on the body count', () => {
    // Both directions, because the surprising one is the point: this bonus wins fights and costs
    // bodies, and a test that only knew the second half would call it a regression.
    expect(winRate(territory({ unitMoraleFlat: 25 }))).toBeGreaterThan(winRate({}));
    expect(survival(territory({ unitMoraleFlat: 25 }))).toBeLessThan(flat);
  });

  it('folds a bought boost onto the same three channels the ground uses', () => {
    // The boost path's own arithmetic, which is what decides the number the engine then reads.
    const whole = boostBundle({ kind: 'force', stat: 'offense', percent: 20 }, { razors: 40 });
    expect(whole.offensePercent).toBe(20);
    expect(whole.defensePercent).toBe(0);
    expect(whole.moralePercent).toBe(0);
    // A boost scoped to a unit is worth what that unit is of the force, which is why a narrow
    // boost is cheap: half a force of Razors is half the effect.
    const narrow = boostBundle(
      { kind: 'unit', unitId: 'razors', stat: 'offense', percent: 20 },
      { razors: 20, wardens: 20 },
    );
    expect(narrow.offensePercent).toBeGreaterThan(0);
    expect(narrow.offensePercent).toBeLessThan(20);
  });
});

describe('the officer leading', () => {
  const flat = survival({});
  const led = (value: number): Partial<SideSetup> => ({
    officer: { officerId: 'o', name: 'O', attributes: makeAttributes(value) },
  });

  it('is worth more the better they are, which is the whole point of the sheet', () => {
    const average = survival(led(15));
    const strong = survival(led(45));
    expect(average).toBeGreaterThan(flat);
    expect(strong, 'a strong officer is worth no more than an average one').toBeGreaterThan(
      average,
    );
  });

  /**
   * The officer walks on at a morale the roster would recognise.
   *
   * `OFFICER_STAT_FORMULAS.morale` is a 0..100 rating off attributes recruited around a mean of 15,
   * and the roster's morale runs 30..100. Spent raw, an ordinary officer started at 15, below
   * `MORALE_THRESHOLDS.wavering`, and broke almost at once; a broken ally is `ROUT_CASCADE` off
   * every stack beside it, so attaching an average officer to a 40-v-40 mirror took the side that
   * had them from winning half its fights to winning none of them.
   */
  it('starts steady rather than one round from breaking', () => {
    expect(officerBattleStats(makeAttributes(0)).morale).toBe(OFFICER_BASE_MORALE);
    expect(officerBattleStats(makeAttributes(15)).morale).toBeGreaterThan(OFFICER_BASE_MORALE);
    expect(officerBattleStats(makeAttributes(100)).morale).toBe(100);
  });
});

describe('the ground and the crew', () => {
  it('widens the fighting front with cohesion, up to the cap and no further', () => {
    const side = { stacks: [], cohesionPercent: 0 } as never;
    const at = (cohesionPercent: number) =>
      effectiveFrontage({ ...(side as object), cohesionPercent } as never, 10);
    expect(at(0)).toBe(10);
    expect(at(20)).toBeCloseTo(12, 6);
    // Capped, so 50 and 100 buy the same ground: a corridor is a corridor.
    expect(at(50)).toBeCloseTo(10 * MAX_COHESION_WIDTH, 6);
    expect(at(100)).toBeCloseTo(10 * MAX_COHESION_WIDTH, 6);
  });

  it('steadies a dug-in defender against the same shock', () => {
    const shock = {
      casualtyFraction: 0.3,
      enemyCasualtyFraction: 0,
      enemyIntimidation: 40,
      outnumberedRatio: 1.5,
      alliesBroken: 1,
      resolvePercent: 0,
    };
    const bare = moraleDelta(shock, 70);
    const dug = moraleDelta({ ...shock, resolvePercent: 50 }, 70);
    expect(dug).toBeGreaterThan(bare);
  });

  /**
   * Speed is not a combat stat, and this is where it is spent.
   *
   * Nothing in the round loop reads it: measured on a 40-v-40 mirror, `unitSpeedPercent` at +20
   * moves the surviving share by 0.000. That is correct rather than broken, and it is worth a test
   * saying so, because "the speed bonus does nothing" is otherwise a true sentence that reads like
   * a bug report. What speed buys is getting away from a fight that was lost.
   */
  it('spends speed on the withdrawal rather than on the fight', () => {
    const quick = { effective: { speed: 80, stealth: 0 }, brokeAt: null } as never;
    const slow = { effective: { speed: 20, stealth: 0 }, brokeAt: null } as never;
    const context = { pursuit: 50, lastRound: 4, away: true };
    expect(fleeChance(quick, context)).toBeGreaterThan(fleeChance(slow, context));
    // And the pursuit it is measured against is the fastest thing still standing opposite.
    expect(pursuitSpeed({ stacks: [{ alive: 3, effective: { speed: 65 } }] } as never)).toBe(65);
  });
});
