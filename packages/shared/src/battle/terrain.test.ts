import { describe, expect, it } from 'vitest';
import { FORTIFY_MAX_LEVEL, noTerritoryEffects } from '../city/index.js';
import { findUnit, type CombatContext, type UnitSpec } from '../units/index.js';
import { LOCATION_KINDS, LOCATION_CATALOG, type LocationKind } from '../city/locations.js';
import {
  bareBattlefield,
  battlefieldFor,
  homeBattlefield,
  LOCATION_CONTEXTS,
} from './battlefield.js';
import { contextBonusPercent, effectiveStats, MAX_HELD_DEFENSE } from './effects.js';
import { simulate } from './engine.js';

/**
 * The ground, and what it is worth.
 *
 * "The ground where we are fighting adds or removes bonuses" is a promise a player plans a roster
 * around, so what these pin is that a sheet saying *below street level* actually fires below street
 * level, and that digging in is worth what the fortification tables say it is.
 */

const unit = (id: string): UnitSpec => {
  const found = findUnit(id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
};

const DAY = new Date('2026-08-14T13:00:00Z');
const NIGHT = new Date('2026-08-14T23:00:00Z');

describe('what each location fights like', () => {
  it('gives every kind of location at least one context', () => {
    for (const kind of LOCATION_KINDS) {
      expect(LOCATION_CONTEXTS[kind], kind).not.toHaveLength(0);
    }
  });

  it('covers the catalogue exactly: no location kind without ground rules', () => {
    expect(Object.keys(LOCATION_CONTEXTS).sort()).toEqual(Object.keys(LOCATION_CATALOG).sort());
  });

  it('fights a sewer junction underground and a rail yard in the open', () => {
    const sewer = battlefieldFor({
      locationName: 'The Junction',
      kind: 'sewer_junction',
      fortifyDifficulty: 'medium',
      fortifyLevel: 0,
      at: DAY,
    });
    expect(sewer.contexts).toContain('underground');
    expect(sewer.contexts).not.toContain('open_ground');

    const yard = battlefieldFor({
      locationName: 'The Yard',
      kind: 'rail_yard',
      fortifyDifficulty: 'medium',
      fortifyLevel: 0,
      at: DAY,
    });
    expect(yard.contexts).toContain('open_ground');
    expect(yard.contexts).not.toContain('underground');
  });

  it('only offers something to breach once somebody has dug in', () => {
    const base = {
      locationName: 'The Berm',
      kind: 'high_ground',
      fortifyDifficulty: 'easy',
      at: DAY,
    } as const;
    expect(battlefieldFor({ ...base, fortifyLevel: 0 }).contexts).not.toContain('vs_structure');
    expect(battlefieldFor({ ...base, fortifyLevel: 1 }).contexts).toContain('vs_structure');
  });

  /**
   * Darkness is a property of the place, not of the hour.
   *
   * The day/night cycle used to decide this: every fight after 21:00 UTC was a night fight,
   * wherever it was. Both halves are asserted because both were wrong under the old rule: an open
   * market is lit at every hour, and a sewer is dark at every hour.
   */
  it('reads darkness off the ground rather than off the clock', () => {
    const ground = (kind: LocationKind, at: Date): readonly CombatContext[] =>
      battlefieldFor({
        locationName: 'x',
        kind,
        fortifyDifficulty: 'easy',
        fortifyLevel: 0,
        at,
      }).contexts;

    for (const at of [DAY, NIGHT]) {
      expect(ground('market', at)).not.toContain('dark');
      expect(ground('sewer_junction', at)).toContain('dark');
    }
  });

  it('fights a home district in the streets, at every hour', () => {
    expect(homeBattlefield('Kettle Row', DAY).contexts).toEqual(['urban']);
    expect(homeBattlefield('Kettle Row', NIGHT).contexts).toEqual(['urban']);
  });

  /** Easy ground pays the most per level: the board's inversion, carried through to the fight. */
  it('carries the fortification tables into the battlefield', () => {
    const at = (difficulty: 'easy' | 'medium' | 'hard') =>
      battlefieldFor({
        locationName: 'x',
        kind: 'barricade',
        fortifyDifficulty: difficulty,
        fortifyLevel: FORTIFY_MAX_LEVEL,
        at: DAY,
      }).fortifyPercent;
    expect(at('easy')).toBe(12);
    expect(at('medium')).toBe(10);
    expect(at('hard')).toBe(8);
  });
});

describe('what the ground does to a unit', () => {
  it('fires a sheet only where it says it fires', () => {
    const tunnelRat = unit('ash_walkers');
    expect(contextBonusPercent(tunnelRat, ['underground']).percent).toBeGreaterThan(0);
    expect(contextBonusPercent(tunnelRat, ['open_ground']).percent).toBe(0);
  });

  it('sums stacked modifiers rather than multiplying them', () => {
    // Cyber Dogs are `ambush` (25) and `night_operations` (20). In a street, in the dark, that is
    // 45 percentage points and not 1.25 × 1.20.
    const both = contextBonusPercent(unit('cyber_dogs'), ['urban', 'dark']);
    expect(both.percent).toBe(45);
    expect(both.reasons).toHaveLength(2);
  });

  it('raises the holder rather than the attacker when the ground is dug in', () => {
    const field = battlefieldFor({
      locationName: 'x',
      kind: 'barricade',
      fortifyDifficulty: 'easy',
      fortifyLevel: 5,
      at: DAY,
    });
    const held = effectiveStats(
      unit('wardens'),
      field,
      { defending: true, outnumbered: false },
      noTerritoryEffects(),
    );
    const came = effectiveStats(
      unit('wardens'),
      field,
      { defending: false, outnumbered: false },
      noTerritoryEffects(),
    );
    // Toughness, not damage: a wall does not make a rifle shoot harder.
    expect(held.vitality).toBeGreaterThan(came.vitality);
    expect(held.armor).toBeGreaterThan(came.armor);
  });

  it('lets territory the crew holds reach the fight', () => {
    const boosted = effectiveStats(
      unit('razors'),
      bareBattlefield(),
      { defending: false, outnumbered: false },
      { ...noTerritoryEffects(), unitOffensePercent: 20, unitMoraleFlat: 10 },
    );
    const plain = effectiveStats(
      unit('razors'),
      bareBattlefield(),
      { defending: false, outnumbered: false },
      noTerritoryEffects(),
    );
    expect(boosted.offense).toBeCloseTo(plain.offense * 1.2, 5);
    expect(boosted.morale).toBe(plain.morale + 10);
  });
});

describe('the ground changes how the fight goes', () => {
  /**
   * Measured as *how much of the force walks away* rather than as a win count.
   *
   * A binary tally is a blunt instrument for this: the first draft of this test had Muckrakers
   * winning 24 out of 24 on both grounds, which said nothing about whether the ground had been
   * read at all. The survival fraction moves continuously and catches the contexts being computed
   * correctly and then never applied, which is the failure worth having a test for.
   */
  const survived = (side: { stacks: { started: number; alive: number }[] }): number => {
    const started = side.stacks.reduce((total, stack) => total + stack.started, 0);
    return started === 0
      ? 0
      : side.stacks.reduce((total, stack) => total + stack.alive, 0) / started;
  };

  it('is worth more to a roster the ground suits', () => {
    const run = (kind: 'sewer_junction' | 'rail_yard') => {
      let left = 0;
      const runs = 24;
      for (let seed = 0; seed < runs; seed += 1) {
        const simulation = simulate({
          seed: `ground-${seed}`,
          battlefield: battlefieldFor({
            locationName: kind,
            kind,
            fortifyDifficulty: 'medium',
            fortifyLevel: 0,
            at: NIGHT,
          }),
          attacker: { name: 'A', army: { ash_walkers: 22 }, defending: false },
          defender: { name: 'D', army: { wardens: 22 }, defending: true },
        });
        left += survived(simulation.attacker);
      }
      return left / runs;
    };
    // Ash Walkers are `tunnel_rat`, so they are worth more below street level than above it, and a
    // sewer junction is below it. The same fight in a rail yard must cost them more.
    //
    // An even fight against Wardens rather than a rout of Sparks, and that matters: a roster that
    // wins both grounds without losing anybody shows no difference between them, which is what
    // this measured when the attacker was strong enough to walk it either way.
    expect(run('sewer_junction')).toBeGreaterThan(run('rail_yard') * 1.3);
  });

  /**
   * Measured as **whether the location is held**, not as how many bodies walked away.
   *
   * Those two come apart, and the way they come apart is the design working: a stack that breaks
   * early loses fewer people and loses the ground, so an unfortified defender can finish a fight
   * with *more* survivors and no location. Fortification buys the objective. Measured at 30 v 26,
   * level 5 turns 3 holds in 24 into 24 in 24; by 32 v 26 it is nearly worthless, which is the
   * intended ceiling: a quarter more defence does not beat a quarter more bodies.
   */
  it('makes digging in decide who holds the location', () => {
    const held = (fortifyLevel: number) => {
      let holds = 0;
      const runs = 24;
      for (let seed = 0; seed < runs; seed += 1) {
        const simulation = simulate({
          seed: `fort-${seed}`,
          battlefield: battlefieldFor({
            locationName: 'The Barricade',
            kind: 'barricade',
            fortifyDifficulty: 'easy',
            fortifyLevel,
            at: DAY,
          }),
          attacker: { name: 'A', army: { razors: 30 }, defending: false },
          defender: { name: 'D', army: { razors: 26 }, defending: true },
        });
        if (simulation.winner === 'defender') holds += 1;
      }
      return holds;
    };
    // Stated as a ratio as well as a level, so a change that shifts every seeded fight by one: an
    // extra draw from the stream, say: moves the numbers without breaking the claim.
    // Measured 1/24 undug and 9/24 dug in fully. The thresholds sit either side of that with
    // room, because the claim is "digging in decides fights", not "digging in wins exactly nine".
    // The three-level curve is worth less at the top than the five-level one it replaced (12% on
    // easy ground rather than 25%), so these numbers moved with it and the ratio did not.
    // Measured 1/24 undug and 6/24 dug in fully. The thresholds sit either side of that with
    // room, because the claim is "digging in decides fights", not "digging in wins exactly six".
    //
    // It was 9/24 before penetration replaced the critical-hit chance: an attacker now cancels
    // part of what the defender is wearing, so the same works are worth a little less than they
    // were. The ratio is what the test is really about and it did not move.
    expect(held(0)).toBeLessThan(5);
    expect(held(FORTIFY_MAX_LEVEL)).toBeGreaterThan(4);
    expect(held(FORTIFY_MAX_LEVEL)).toBeGreaterThan(held(0) * 3);
  });

  /** ...and does not make a location unbreakable. Enough bodies still take it. */
  it('leaves a fortified location takeable by weight of numbers', () => {
    let taken = 0;
    for (let seed = 0; seed < 24; seed += 1) {
      const simulation = simulate({
        seed: `overrun-${seed}`,
        battlefield: battlefieldFor({
          locationName: 'The Barricade',
          kind: 'barricade',
          fortifyDifficulty: 'easy',
          fortifyLevel: 5,
          at: DAY,
        }),
        attacker: { name: 'A', army: { razors: 34 }, defending: false },
        defender: { name: 'D', army: { razors: 26 }, defending: true },
      });
      if (simulation.winner === 'attacker') taken += 1;
    }
    expect(taken).toBeGreaterThan(18);
  });
});

describe('what the defender built reaches the fight', () => {
  /**
   * The Gate (§A1) and the modifications that raise it.
   *
   * `districtDefense` existed, was correct, and was **read by nothing**: its own doc comment
   * claimed the battle engine added it, and the engine had never heard of it. So the one structure
   * whose entire job is raid protection did nothing to a raid. Found by grepping for consumers of a
   * function rather than by any test failing, which is why this one exists.
   */
  it('makes a defended district harder to raid than a bare one', () => {
    const raid = (defensePercent: number) => {
      let held = 0;
      const runs = 24;
      for (let seed = 0; seed < runs; seed += 1) {
        const simulation = simulate({
          seed: `gate-${seed}`,
          battlefield: homeBattlefield('Kettle Row', DAY),
          attacker: { name: 'A', army: { razors: 26 }, defending: false },
          defender: {
            name: 'D',
            army: { razors: 22 },
            defending: true,
            territory: { ...noTerritoryEffects(), defensePercent },
          },
        });
        if (simulation.winner === 'defender') held += 1;
      }
      return held;
    };
    expect(raid(40)).toBeGreaterThan(raid(0));
  });

  /** ...and never so much harder that no force could take it. */
  it('caps what holding built ground is worth', () => {
    const wardens = unit('wardens');
    const held = effectiveStats(
      wardens,
      { ...homeBattlefield('x', DAY), fortifyPercent: 25 },
      { defending: true, outnumbered: false },
      { ...noTerritoryEffects(), defensePercent: 500 },
    );
    expect(held.vitality).toBeLessThanOrEqual(
      wardens.stats.vitality * (1 + MAX_HELD_DEFENSE / 100),
    );
  });

  it('gives an attacker nothing for what the defender built', () => {
    const wardens = unit('wardens');
    const attacking = effectiveStats(
      wardens,
      homeBattlefield('x', DAY),
      { defending: false, outnumbered: false },
      { ...noTerritoryEffects(), defensePercent: 60 },
    );
    expect(attacking.vitality).toBe(wardens.stats.vitality);
  });
});
