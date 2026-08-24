import { describe, expect, it } from 'vitest';
import { bareBattlefield } from './battlefield.js';
import { describeCost, describeOdds, forecast } from './forecast.js';
import { simulate } from './engine.js';

/**
 * The forecast, and the one property that makes it worth having: it is the **same engine**, so it
 * cannot drift from the result. A simulator built as a second model is worse than none, because a
 * player plans against it.
 */

const plan = (attacking: Record<string, number>, defending: Record<string, number>, runs = 40) =>
  forecast({
    seed: 'plan',
    runs,
    battlefield: bareBattlefield(),
    attacker: { name: 'A', army: attacking, defending: false },
    defender: { name: 'D', army: defending, defending: true },
  });

describe('the pre-battle forecast', () => {
  it('is confident about a walkover and grim about a hopeless push', () => {
    expect(plan({ razors: 40 }, { razors: 5 }).winChance).toBeGreaterThan(0.9);
    expect(plan({ razors: 5 }, { razors: 40 }).winChance).toBeLessThan(0.1);
  });

  it('is uncertain about a fight that is genuinely uncertain', () => {
    const even = plan({ razors: 24 }, { razors: 24 }).winChance;
    expect(even).toBeGreaterThan(0.2);
    expect(even).toBeLessThan(0.8);
  });

  it('costs more to win a close fight than a lopsided one', () => {
    expect(plan({ razors: 40 }, { razors: 34 }).attackerSurvival).toBeLessThan(
      plan({ razors: 40 }, { razors: 8 }).attackerSurvival,
    );
  });

  /**
   * The same plan forecasts the same way twice. A number that flickers while a player reads it is a
   * number they stop trusting, and it would also make the screen impossible to test.
   */
  it('is stable for the same plan', () => {
    expect(plan({ razors: 20, snipers: 4 }, { wardens: 10 })).toEqual(
      plan({ razors: 20, snipers: 4 }, { wardens: 10 }),
    );
  });

  /**
   * The claim that matters: a forecast run is *literally* a fight. If the two ever diverge, the
   * screen is lying, so this pins one run against `simulate` on the same seed.
   */
  it('agrees with the engine it forecasts, run for run', () => {
    const single = forecast({
      seed: 'agree',
      runs: 1,
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: { razors: 20 }, defending: false },
      defender: { name: 'D', army: { wardens: 9 }, defending: true },
    });
    const actual = simulate({
      seed: 'agree:0',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: { razors: 20 }, defending: false },
      defender: { name: 'D', army: { wardens: 9 }, defending: true },
    });
    expect(single.winChance).toBe(actual.winner === 'attacker' ? 1 : 0);
    expect(single.rounds).toBe(actual.rounds.length);
  });

  it('never reports a share outside nothing-to-everything', () => {
    for (const plans of [
      plan({}, { razors: 5 }),
      plan({ razors: 5 }, {}),
      plan({ razors: 1 }, { the_colossus: 1 }),
    ]) {
      for (const share of [plans.winChance, plans.attackerSurvival, plans.defenderSurvival]) {
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
      }
    }
  });

  it('bands the odds rather than printing a false precision', () => {
    expect(describeOdds(0.95)).not.toBe(describeOdds(0.5));
    expect(describeOdds(0.5)).toBe(describeOdds(0.48));
    expect(describeCost(0.95)).not.toBe(describeCost(0.05));
  });
});
