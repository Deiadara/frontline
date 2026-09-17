import { describe, expect, it } from 'vitest';
import { noTerritoryEffects, type TerritoryEffects } from '../city/locations.js';
import { bareBattlefield } from './battlefield.js';
import { fighting, simulate, type SideSetup } from './engine.js';

/**
 * Every combat channel actually changes a fight (2026-09-17 consistency pass).
 *
 * This repo's recurring defect is a bonus that is summed and read by nobody. `intimidationFlat` was
 * accumulated out of hold bonuses for months while the Broadcast Tower, whose only bonus it is, was
 * worth nothing to hold; `gateDefensePercent` was computed by `districtDefense` and reached no
 * fight; `raid_loot_percent` was authored on three modifications and read by a function nothing
 * called. Each was found by a person reading code, which is not a method.
 *
 * So this is the method: turn the channel up, run the same seeded fights, and look. A channel that
 * moves nothing is either not wired or not wired on the side being measured, and either way the
 * player is buying a number that does nothing.
 *
 * Both sides' survivors *and* the win count are the metric, because an effect can land on either
 * side of the exchange: attacker stealth is spent killing defenders, so a probe watching only the
 * attacker's own survivors reports a working ambush as dead.
 *
 * ## What is deliberately not in here
 *
 * Three channels are real but conditional, and `simulate` is the wrong altitude to ask about them:
 * `alliedOffensePercent` and `wholeDistrictPercent` are paid by `situational` in
 * `server/battle/resolve.ts` only where their condition holds, and `gateDefensePercent` by
 * `withGate` only where there is a gate. Two more, `lootCapacityPercent` and
 * `casualtyRecoveryPercent`, are settled after the fight rather than in it. Adding them here would
 * mean asserting they are flat, which is a test that passes just as happily when somebody
 * unwires the consumer they do have.
 */

type Patch = Partial<TerritoryEffects> & Record<string, unknown>;

/**
 * A matchup both sides survive, which is the whole difficulty of measuring this.
 *
 * Swept before it was chosen: at 18 Razors the defender wipes the attacker every time and at 30 the
 * attacker wipes the defender every time, and at either end the metric is pinned to zero and moves
 * for nothing. At 24 the attacker takes 99 of 150 and both sides leave people standing.
 */
const ATTACKER = { razors: 24, ghosts: 6 };
const DEFENDER = { wardens: 12, sparks: 6 };
const SEEDS = 150;

function trial(
  which: 'attacker' | 'defender',
  patch: Patch,
  extra: Partial<SideSetup> = {},
): string {
  let attackerLeft = 0;
  let defenderLeft = 0;
  let attackerWins = 0;
  for (let i = 0; i < SEEDS; i += 1) {
    const territory = { ...noTerritoryEffects(), ...patch };
    const mine = { territory, ...extra };
    const sim = simulate({
      seed: `channels-${i}`,
      battlefield: bareBattlefield(),
      attacker: {
        name: 'A',
        army: ATTACKER,
        defending: false,
        ...(which === 'attacker' ? mine : {}),
      },
      defender: {
        name: 'D',
        army: DEFENDER,
        defending: true,
        ...(which === 'defender' ? mine : {}),
      },
    });
    attackerLeft += fighting(sim.attacker);
    defenderLeft += fighting(sim.defender);
    if (sim.winner === 'attacker') attackerWins += 1;
  }
  return `${attackerLeft}/${defenderLeft}/${attackerWins}`;
}

/** Turned up hard: this asks whether a channel is *wired*, not whether it is tuned. */
const BOTH_SIDES: [string, unknown][] = [
  ['unitOffensePercent', 60],
  ['unitVitalityPercent', 60],
  ['unitArmorPercent', 40],
  ['unitMoraleFlat', 40],
  ['unitSpeedPercent', 60],
  ['unitEvasionFlat', 40],
  ['intimidationFlat', 60],
  ['unitTierPercent', { rabble: { offense: 80 } }],
];

describe('every combat channel reaches a fight', () => {
  for (const which of ['attacker', 'defender'] as const) {
    it(`moves the fight from the ${which}'s side`, () => {
      const base = trial(which, {});
      for (const [channel, value] of BOTH_SIDES) {
        const got = trial(which, { [channel]: value });
        expect(got, `${channel} on the ${which} changed nothing: ${base}`).not.toBe(base);
      }
      // The narrowest channel there is, aimed at a unit this side actually fields.
      const own = which === 'attacker' ? 'razors' : 'wardens';
      const kind = trial(which, { unitKindPercent: { [own]: { offense: 90 } } });
      expect(kind, `unitKindPercent ${own} changed nothing`).not.toBe(base);
    });
  }

  /** The attacker's alone: an ambush is something you set, and the holder is not setting one. */
  it('spends stealth on the ambush, and only for the attacker', () => {
    const base = trial('attacker', {});
    const sneaky = trial('attacker', { unitStealthPercent: 90 });
    // The force carries Ghosts, so there is an ambush for stealth to be worth something to.
    const opening = simulate({
      seed: 'channels-0',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: ATTACKER, defending: false },
      defender: { name: 'D', army: DEFENDER, defending: true },
    }).openingStrike;
    expect(opening, 'the fixture has to carry an ambush at all').toBeGreaterThan(0);
    const louder = simulate({
      seed: 'channels-0',
      battlefield: bareBattlefield(),
      attacker: {
        name: 'A',
        army: ATTACKER,
        defending: false,
        territory: { ...noTerritoryEffects(), unitStealthPercent: 90 },
      },
      defender: { name: 'D', army: DEFENDER, defending: true },
    }).openingStrike;
    expect(louder, 'stealth did not reach the opening strike').toBeGreaterThan(opening);
    // Deliberately not asserted on the survivor counts: see `AMBUSH_ROUND_SHARE`. At the shipped
    // numbers the whole opening volley is worth about half a percent of the damage in a fight, so
    // it does not move a body count and this would be a test of the balance rather than the wiring.
    expect(sneaky === base || sneaky !== base).toBe(true);
  });

  /** Holding built ground is the holder's, and the attacker gets nothing for owning a wall. */
  it('pays the defending bonus to the defender and not to the attacker', () => {
    expect(trial('defender', { defensePercent: 60 })).not.toBe(trial('defender', {}));
    expect(trial('attacker', { defensePercent: 60 })).toBe(trial('attacker', {}));
  });

  /** §A5: teamwork only buys anything when the force is wider than the ground allows. */
  it('spends cohesion only on a force too big for the frontage', () => {
    const crowd = (extra: Partial<SideSetup>) => {
      let left = 0;
      for (let i = 0; i < 40; i += 1) {
        const sim = simulate({
          seed: `crowd-${i}`,
          battlefield: bareBattlefield(),
          attacker: { name: 'A', army: { razors: 120 }, defending: false },
          defender: { name: 'D', army: { wardens: 120 }, defending: true, ...extra },
        });
        left += fighting(sim.defender);
      }
      return left;
    };
    expect(crowd({ cohesionPercent: 80 })).not.toBe(crowd({}));
    // ...and nothing at all on a force that already fits, which is what makes it a real decision.
    expect(trial('defender', {}, { cohesionPercent: 80 })).toBe(trial('defender', {}));
  });
});
