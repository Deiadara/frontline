import { describe, expect, it } from 'vitest';
import { findBattleBoost } from '../battle/boosts.js';
import { TacticalSkirmishEngine } from '../battle/skirmish.js';
import { noCrewEffects } from '../crew/effects.js';
import type { Army } from '../units/index.js';
import { findBlackMarketGood, type BattleBoost } from './blackmarket.js';

/**
 * What a morale point is worth against its price, measured in the real engine (maintainer,
 * 2026-09-29: "weaken morale boosts").
 *
 * A boost's percent lands on the engine one for one (`boosted` in the server's battle settle):
 * attack on `unitOffensePercent`, defence on `unitVitalityPercent`, morale on `unitMoraleFlat`. A
 * morale point turned out to be worth about two of either of the others, so the one morale name
 * sold about twice the force per infamy of the two 200-infamy names beside it.
 *
 * The measure is the bug pass's: how much bigger an attack has to be to win half its fights against
 * a defender carrying the boost (40 Razors and 10 Breakers a side, the attack scaled in steps of
 * 0.02 and interpolated), less the same figure against the bare defender, per 100 infamy. Measured
 * on 2026-09-29 at 400 seeds a step, before and after the cut:
 *
 * | Boost                               | Needs  | Per 100 infamy |
 * | ----------------------------------- | ------ | -------------- |
 * | bare defender                       | 1.004x |                |
 * | Call In The Name, +12% attack, 200  | 1.045x | 0.021          |
 * | Stand Your Ground, +15% defence, 200| 1.053x | 0.024          |
 * | Make An Example, +20% morale, 320   | 1.155x | 0.047          |
 * | Make An Example, +10% morale, 320   | 1.083x | 0.025          |
 * | Biochemical Infusers, 180           | 1.118x | 0.064          |
 * | Combat Stims, +16 morale +8 def, 140| 1.172x | 0.120          |
 * | Combat Stims, +8 morale +8 def, 140 | 1.107x | 0.073          |
 * | Nerve Gas, +26 attack -8 morale, 320| 1.021x | 0.005          |
 * | Nerve Gas, +26 attack -4 morale, 320| 1.070x | 0.021          |
 *
 * A second line-up (20 Wardens, 10 Snipers and 20 Razors a side) put Make An Example at 0.052 before
 * and 0.026 after against 0.035 and 0.040 for the names. +8, the figure the ruling named, measured
 * 0.017 on the first line-up, under both names, so the cut is to half rather than to two fifths.
 *
 * The contraband's own rates still spread (Adrenaline's +18% attack at 120 is the shelf's keenest
 * buy with or without its morale), and that spread is the shelf's pricing rather than morale's. What
 * this holds is the morale half: a morale-carrying good at about the rate of its neighbour without.
 */

const SEEDS = 200;
const LINE: Army = { razors: 40, breakers: 10 };
const engine = new TacticalSkirmishEngine();

function scaled(army: Army, by: number): Army {
  return Object.fromEntries(
    Object.entries(army).map(([unit, count]) => [unit, Math.round(count * by)]),
  );
}

function attackerWins(attacking: Army, boost: BattleBoost): number {
  let wins = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const defenderTerritory = noCrewEffects();
    defenderTerritory.unitOffensePercent += boost.offensePercent;
    defenderTerritory.unitVitalityPercent += boost.defensePercent;
    defenderTerritory.unitMoraleFlat += boost.moralePercent;
    const outcome = engine.resolve({
      seed: `s${String(seed)}`,
      attackerName: 'A',
      defenderName: 'D',
      locationName: 'x',
      attacking,
      defending: LINE,
      attackerTerritory: noCrewEffects(),
      defenderTerritory,
      attackerCohesionPercent: 0,
      defenderCohesionPercent: 0,
    });
    if (outcome.winner === 'attacker') wins += 1;
  }
  return wins / SEEDS;
}

/** The attack, as a multiple of the defender, that wins half its fights against this boost. */
function forceToBeat(boost: BattleBoost): number {
  let previous = { by: 0.9, won: attackerWins(scaled(LINE, 0.9), boost) };
  for (let by = 0.92; by <= 1.8; by += 0.02) {
    const won = attackerWins(scaled(LINE, by), boost);
    if (won >= 0.5) {
      return previous.won >= 0.5
        ? by
        : previous.by + ((0.5 - previous.won) / (won - previous.won)) * (by - previous.by);
    }
    previous = { by, won };
  }
  throw new Error('no attack up to 1.8x beats that boost');
}

const NONE: BattleBoost = { offensePercent: 0, defensePercent: 0, moralePercent: 0 };

/** A named boost's effect as a bundle. The three open names are all whole-force. */
function nameBundle(id: string): { boost: BattleBoost; cost: number } {
  const spec = findBattleBoost(id)!;
  const { stat, percent } = spec.effect;
  return {
    cost: spec.cost,
    boost: {
      offensePercent: stat === 'offense' ? percent : 0,
      defensePercent: stat === 'defense' ? percent : 0,
      moralePercent: stat === 'morale' ? percent : 0,
    },
  };
}

function crateBundle(id: string): { boost: BattleBoost; cost: number } {
  const good = findBlackMarketGood(id)!;
  return { boost: good.boost!, cost: good.infamy };
}

describe('a morale point, priced against the engine', () => {
  const bare = forceToBeat(NONE);
  const rate = ({ boost, cost }: { boost: BattleBoost; cost: number }): number =>
    ((forceToBeat(boost) - bare) / cost) * 100;

  it('buys Make An Example at about the rate of the two open names beside it', () => {
    const names =
      (rate(nameBundle('boost_call_in_the_name')) + rate(nameBundle('boost_stand_your_ground'))) /
      2;
    const example = nameBundle('boost_make_an_example');

    expect(rate(example) / names).toBeGreaterThan(0.6);
    expect(rate(example) / names).toBeLessThan(1.6);
    // The control: the old +20 sat well outside the same band, so the band can tell them apart.
    const old = { ...example, boost: { ...example.boost, moralePercent: 20 } };
    expect(rate(old) / names).toBeGreaterThan(1.6);
  });

  it('sells Combat Stims at about the rate of the Infusers, the crate with no morale in it', () => {
    const infusers = rate(crateBundle('biochemical_infusers'));
    const stims = crateBundle('combat_stims');

    expect(rate(stims) / infusers).toBeGreaterThan(0.6);
    expect(rate(stims) / infusers).toBeLessThan(1.6);
    const old = { ...stims, boost: { ...stims.boost, moralePercent: 16 } };
    expect(rate(old) / infusers).toBeGreaterThan(1.6);
  });
});
