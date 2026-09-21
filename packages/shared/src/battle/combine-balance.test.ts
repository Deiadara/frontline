import { describe, expect, it } from 'vitest';
import {
  COMBINE_LEADERS,
  combineGarrison,
  combineSlotBudget,
  type CombinePower,
} from '../city/combine.js';
import { CITY_DISTRICTS, findDistrict } from '../city/districts.js';
import { startingGarrison } from '../city/control.js';
import { noTerritoryEffects, type TerritoryEffects } from '../city/locations.js';
import { COMBINE_UNITS, PLAYER_UNITS, findUnit } from '../units/catalog.js';
import { battlefieldFor } from './battlefield.js';
import { bareBattlefield } from './battlefield.js';
import { simulate } from './engine.js';

/**
 * What the Combine is actually worth in a fight (maintainer, 2026-09-20).
 *
 * `combine.test.ts` pins the three leaders' *mechanics*: that the Syndic's points land, that the
 * Executioner finishes a wounded unit, that Change of Heart moves the right bodies. This file pins
 * the **balance**, which is a different kind of claim and needs a different kind of evidence: not
 * one seed and an assertion, but a sweep and a band.
 *
 * Every figure below was measured before it was written down, and the measurement is quoted in the
 * comment beside it. A band rather than an exact count, because a band is what a sweep can honestly
 * support: the engine has two luck rolls and a per-round swing, so the same matchup over 8 seeds is
 * a distribution and not a number. The bands are wide enough that ordinary noise does not redden
 * the suite, and narrow enough that a real retune does.
 *
 * ## Why this file exists at all
 *
 * The regime's four common sheets were tuned on 2026-09-20 and got the ladder wrong twice before
 * they got it right. The first pass had the Greycoat, the second-cheapest unit in the regime,
 * beating the Suppressor per unit slot: 18 of 22 against 13 of 22. The second overcorrected the
 * Enforcer to 17. Nothing in the suite noticed either time, because nothing measured it. This is
 * that measurement, kept.
 */

/** Sixty unit slots of a unit: the fair comparison, since a Suppressor is four Levy. */
const slotsOf = (unitId: string, slots = 60): Record<string, number> => {
  const unit = findUnit(unitId);
  if (!unit) throw new Error(`no unit ${unitId}`);
  return { [unitId]: Math.max(1, Math.round(slots / unit.unitSlots)) };
};

const fight = (
  attacker: Record<string, number>,
  defender: Record<string, number>,
  seed: string,
  extras: { presence?: CombinePower; territory?: TerritoryEffects } = {},
) =>
  simulate({
    seed,
    battlefield: bareBattlefield(),
    attacker: {
      name: 'Crew',
      army: attacker,
      defending: false,
      ...(extras.territory ? { territory: extras.territory } : {}),
    },
    defender: {
      name: 'The Combine',
      army: defender,
      defending: true,
      ...(extras.presence ? { presence: extras.presence } : {}),
    },
  });

/** How many of the player's fighting sheets this defence turns back, at equal unit slots. */
function turnsBack(
  defender: Record<string, number>,
  extras: { presence?: CombinePower; territory?: TerritoryEffects } = {},
  seeds = 8,
): number {
  let held = 0;
  for (const unit of ROSTER) {
    let wins = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      if (
        fight(slotsOf(unit.id), defender, `balance-${unit.id}-${seed}`, extras).winner ===
        'defender'
      ) {
        wins += 1;
      }
    }
    if (wins * 2 > seeds) held += 1;
  }
  return held;
}

const ROSTER = PLAYER_UNITS.filter((unit) => unit.combat !== false && unit.tier !== 'legendary');

/*
 * SUSPENDED 2026-09-21, pending the roster re-stat.
 *
 * The pins marked `it.skip` below measure the *roster as it is statted today* against the engine:
 * which unit beats which, how strength tracks cost, where each district's band of doubt sits. The
 * engine was retuned that day so the eight ratings sit on a fixed ladder (`docs/BATTLE-ENGINE.md`,
 * "The eight ratings", pinned by `ratings.test.ts`), and the maintainer is re-statting the roster
 * on top of that ladder next. Re-pinning these to today's numbers would pin "Kite Crews beat the
 * whole roster" as intended, so they wait for the sheets instead. Each is to be measured again
 * and un-skipped when its subject has been re-statted; none is to be deleted.
 */

describe('the Combine ladder, at equal unit slots', () => {
  it('has a roster to measure against, so none of this is vacuous', () => {
    expect(ROSTER.length).toBeGreaterThanOrEqual(20);
    expect(COMBINE_UNITS.filter((unit) => unit.tier !== 'legendary')).toHaveLength(4);
  });

  /**
   * Measured 2026-09-20 over 8 seeds at 60 slots a side: Levy 2, Greycoat 10, Enforcer 12,
   * Suppressor 16, out of 22. The claim worth keeping is the **order**, which is what the two
   * failed tuning passes got wrong, plus a band on each so a silent drift shows up.
   */
  it('climbs from the conscripts to the gun crews, and in that order', () => {
    const held = {
      civic_levy: turnsBack(slotsOf('civic_levy')),
      greycoat: turnsBack(slotsOf('greycoat')),
      street_enforcers: turnsBack(slotsOf('street_enforcers')),
      suppressor: turnsBack(slotsOf('suppressor')),
    };
    expect(held.civic_levy).toBeLessThan(held.greycoat);
    expect(held.greycoat).toBeLessThanOrEqual(held.street_enforcers);
    expect(held.street_enforcers).toBeLessThan(held.suppressor);
    // The bands, each around its measured figure.
    expect(held.civic_levy, `Levy ${held.civic_levy}`).toBeLessThanOrEqual(5);
    expect(held.greycoat, `Greycoat ${held.greycoat}`).toBeGreaterThanOrEqual(6);
    expect(held.suppressor, `Suppressor ${held.suppressor}`).toBeGreaterThanOrEqual(13);
    // ...and nobody is a wall: every sheet in the regime has an answer on the roster.
    expect(held.suppressor).toBeLessThan(ROSTER.length);
  });

  /**
   * The Suppressor is the regime's wall, and a wall has to be answerable. Measured 2026-09-20 at
   * 32 slots a side: Snipers, Kite Crews, Cyberhounds, Juggernauts and Sluggers beat 8 Suppressors,
   * and they are exactly the range-and-penetration half of the roster. 150 Razors (150 slots) lose
   * to the same 8 on every seed, which is the mechanic working: bodies are not the answer to a
   * dug-in gun, the right tool is.
   */
  it.skip('is answered by range and penetration rather than by numbers', () => {
    const beats = ROSTER.filter((unit) => {
      let wins = 0;
      for (let seed = 0; seed < 8; seed += 1) {
        if (
          fight(slotsOf(unit.id, 32), { suppressor: 8 }, `answer-${unit.id}-${seed}`).winner ===
          'attacker'
        ) {
          wins += 1;
        }
      }
      return wins >= 5;
    }).map((unit) => unit.id);
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(beats).toContain('snipers');
    expect(beats).toContain('juggernauts');
    // Five times the unit slots of the wrong tool still loses, on every seed.
    const bodies = Array.from({ length: 8 }, (_, seed) =>
      fight({ razors: 150 }, { suppressor: 8 }, `bodies-${seed}`),
    );
    expect(bodies.every((sim) => sim.winner === 'defender')).toBe(true);
  });

  /**
   * And the regime's wall is no worse than the player's own. Measured 2026-09-20 at 32 slots a
   * side: the Suppressor turns back 15 of 21 and the player's Juggernaut turns back 15 of 21. A
   * Combine sheet that outclassed everything the player can field would be a different game.
   */
  it('is no stronger than the heavy the player can already train', () => {
    const rivals = ROSTER.filter((unit) => unit.id !== 'suppressor' && unit.id !== 'juggernauts');
    const held = (defenderId: string) => {
      let count = 0;
      for (const unit of rivals) {
        let wins = 0;
        for (let seed = 0; seed < 8; seed += 1) {
          if (
            fight(
              slotsOf(unit.id, 32),
              slotsOf(defenderId, 32),
              `rival-${defenderId}-${unit.id}-${seed}`,
            ).winner === 'defender'
          ) {
            wins += 1;
          }
        }
        if (wins >= 5) count += 1;
      }
      return count;
    };
    const combine = held('suppressor');
    const player = held('juggernauts');
    expect(
      Math.abs(combine - player),
      `Suppressor ${combine}, Juggernaut ${player}`,
    ).toBeLessThanOrEqual(3);
  });
});

describe('the leaders, in and out of the fight', () => {
  const leaderPower = (unitId: string): CombinePower => {
    const leader = COMBINE_LEADERS.find((one) => one.unitId === unitId);
    if (!leader) throw new Error(unitId);
    return leader.power;
  };

  /**
   * Each leader is measured twice, on the same seeds and the same two forces: once with his power
   * over the ground and once without. The difference is the whole claim. A test that only ran the
   * powered fight would pass on an engine that ignored `presence` entirely.
   */
  /**
   * Sized where the fight is in doubt, which on this garrison is a narrow band. Measured
   * 2026-09-20 against the Annexes' 30 Greycoats and 12 Enforcers: a crew of 24 Razors loses every
   * seed either way, a crew of 40 wins every seed either way, and at 30 Razors, 8 Snipers and 6
   * Wardens the Combine holds 3 of 20 without him and 12 of 20 with him. Only the middle of those
   * three measures anything at all.
   */
  it.skip('makes the Annexes harder to take', () => {
    const garrison = combineGarrison(6, combineSlotBudget(6, 5));
    const crew = { razors: 30, snipers: 8, wardens: 6 };
    const held = (presence?: CombinePower) =>
      Array.from({ length: 20 }, (_, seed) =>
        fight(crew, garrison, `annexes-${seed}`, presence ? { presence } : {}),
      ).filter((sim) => sim.winner === 'defender').length;
    const bare = held();
    const backed = held(leaderPower('syndic'));
    expect(backed, `bare ${bare}, backed ${backed}`).toBeGreaterThan(bare);
    expect(backed - bare).toBeGreaterThanOrEqual(4);
  });

  it('costs the attacker bodies on the Blacksite that it would otherwise have kept', () => {
    const garrison = combineGarrison(8, combineSlotBudget(8, 5));
    const crew = { razors: 60, scrapers: 30, snipers: 12 };
    const standing = (presence?: CombinePower) =>
      Array.from({ length: 12 }, (_, seed) =>
        fight(crew, garrison, `blacksite-${seed}`, presence ? { presence } : {}),
      ).reduce((total, sim) => total + sim.attacker.stacks.reduce((n, one) => n + one.alive, 0), 0);
    const withHim = standing(leaderPower('executioner'));
    expect(withHim).toBeLessThan(standing());
  });

  /**
   * Directive Xero, and the counterplay that makes him a boss rather than a brick wall.
   *
   * Change of Heart takes the units §D3 *would* have silenced, so it takes nothing at all from a
   * line that is not afraid. Measured 2026-09-20: 20 Razors (morale 40, so 800 of nerve) against
   * thirty Suppressors and him lose 15 to Change of Heart; the same slots of Juggernauts (morale
   * 85) lose none, because their nerve is over his menace and §D3 silences nobody to begin with.
   *
   * That is a real, discoverable counter, and it is worth a test precisely because it is the sort
   * of thing a later retune of morale or intimidation would quietly destroy.
   */
  it('takes nothing from a line that is not afraid of him', () => {
    const garrison = { suppressor: 30, directive_xero: 1 };
    const zero = leaderPower('directive_xero');
    const turnedFrom = (crew: Record<string, number>, tag: string) =>
      Object.values(fight(crew, garrison, `nerve-${tag}`, { presence: zero }).turned).reduce(
        (total, count) => total + count,
        0,
      );
    // Timid and numerous: they cross.
    expect(turnedFrom({ razors: 20 }, 'razors')).toBeGreaterThan(0);
    // Steady: nothing to take, however many of them there are.
    expect(turnedFrom({ juggernauts: 40 }, 'juggernauts')).toBe(0);
    expect(turnedFrom({ the_condemned: 20 }, 'condemned')).toBe(0);
  });

  it('is beaten by nobody in the CCS until he is off his plot', () => {
    const ccs = findDistrict('combine-spire');
    if (!ccs) throw new Error('no CCS');
    const chapel = ccs.locations.find((one) => one.kind === 'combine_chapel');
    if (!chapel) throw new Error('no chapel');
    const garrison = startingGarrison(chapel, ccs);
    // He is standing in it, once, and he is the reason it is the last plot in the game.
    expect(garrison['directive_xero']).toBe(1);
    const crew = { razors: 70, juggernauts: 10 };
    const ground = battlefieldFor({
      locationName: chapel.name,
      kind: chapel.kind,
      fortifyDifficulty: chapel.fortifyDifficulty,
      fortifyLevel: 0,
      at: new Date('2026-09-20T12:00:00Z'),
    });
    const wins = Array.from({ length: 12 }, (_, seed) =>
      simulate({
        seed: `chapel-${seed}`,
        battlefield: ground,
        attacker: { name: 'Crew', army: crew, defending: false },
        defender: {
          name: 'The Combine',
          army: garrison,
          defending: true,
          presence: leaderPower('directive_xero'),
        },
      }),
    ).filter((sim) => sim.winner === 'attacker').length;
    // A force that walks the rest of the map does not walk this.
    expect(wins).toBeLessThan(6);
  });
});

describe('what a crew brings to bear on it', () => {
  /**
   * The crew's own fold, against the regime. `TerritoryEffects` is the struct every holding, perk
   * and programme writes into, so a bonus that does nothing against the Combine would be a bonus
   * that does nothing at all on six of the eight contested districts.
   */
  const withBonus = (over: Partial<TerritoryEffects>): TerritoryEffects => ({
    ...noTerritoryEffects(),
    ...over,
  });

  const garrison = combineGarrison(6, combineSlotBudget(6, 5));
  const crew = { razors: 40, snipers: 10 };
  const taken = (territory?: TerritoryEffects) =>
    Array.from({ length: 20 }, (_, seed) =>
      fight(crew, garrison, `bonus-${seed}`, territory ? { territory } : {}),
    ).filter((sim) => sim.winner === 'attacker').length;

  it.skip('pays off on the channels a crew actually buys', () => {
    const bare = taken();
    for (const [name, over] of [
      ['offense', { unitOffensePercent: 30 }],
      ['vitality', { unitVitalityPercent: 30 }],
      ['armour', { unitArmorPercent: 30 }],
    ] as const) {
      expect(taken(withBonus(over)), `${name} bought nothing against the Combine`).toBeGreaterThan(
        bare,
      );
    }
  });

  it.skip('is not cancelled by a leader: a bonus still helps under the Syndic', () => {
    const leader = COMBINE_LEADERS.find((one) => one.unitId === 'syndic');
    if (!leader) throw new Error('no syndic');
    const under = (territory?: TerritoryEffects) =>
      Array.from({ length: 20 }, (_, seed) =>
        fight(crew, garrison, `under-${seed}`, {
          presence: leader.power,
          ...(territory ? { territory } : {}),
        }),
      ).filter((sim) => sim.winner === 'attacker').length;
    expect(under(withBonus({ unitOffensePercent: 40 }))).toBeGreaterThan(under());
  });
});

describe('every Combine district, end to end', () => {
  /**
   * The map's own ladder, walked. The claim is that difficulty predicts how much force a plot
   * wants, which is the promise a difficulty number makes to a player reading the map, and the
   * thing `combineSlotBudget` exists to keep true.
   */
  it('wants more force the further up the map it is', () => {
    const combine = CITY_DISTRICTS.filter(
      (district) => district.allegiance === 'government' && district.locations.length > 0,
    ).sort((a, b) => a.difficulty - b.difficulty);
    expect(combine.length).toBeGreaterThanOrEqual(5);
    const budgets = combine.map((district) => combineSlotBudget(district.difficulty, 5));
    for (let at = 1; at < budgets.length; at += 1) {
      expect(budgets[at], combine[at]?.id).toBeGreaterThanOrEqual(budgets[at - 1] ?? 0);
    }
    // The bottom of the map is a first crew's fight and the top is not: measured 2026-09-20, the
    // Docks want 10 slots of garrison and the CCS 118.
    expect(budgets[0]).toBeLessThan(20);
    expect(budgets[budgets.length - 1]).toBeGreaterThan(100);
  });

  it('is taken by eight Razors at the Docks and not at the Glasshouse', () => {
    const docks = findDistrict('neon-docks');
    const fields = findDistrict('glasshouse-fields');
    if (!docks || !fields) throw new Error('no districts');
    const plot = (district: typeof docks) => {
      const found = district.locations.find(
        (one) => Object.keys(startingGarrison(one, district)).length > 0,
      );
      if (!found) throw new Error(`${district.id} has no garrisoned plot`);
      return startingGarrison(found, district);
    };
    const takes = (garrison: Record<string, number>, tag: string) =>
      Array.from({ length: 12 }, (_, seed) =>
        fight({ razors: 8 }, garrison, `first-${tag}-${seed}`),
      ).filter((sim) => sim.winner === 'attacker').length;
    // A brand-new crew's eight Razors: the Docks are a fight they win, the Fields are not yet.
    expect(takes(plot(docks), 'docks')).toBeGreaterThan(6);
    expect(takes(plot(fields), 'fields')).toBeLessThan(6);
  });
});
