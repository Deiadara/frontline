import { describe, expect, it } from 'vitest';
import { noTerritoryEffects } from '../city/index.js';
import { findUnit, UNIT_MODIFIERS, type CombatContext, type UnitSpec } from '../units/index.js';
import { LOCATION_KINDS, LOCATION_CATALOG, type LocationKind } from '../city/locations.js';
import {
  bareBattlefield,
  battlefieldFor,
  homeBattlefield,
  LOCATION_CONTEXTS,
} from './battlefield.js';
import { contextBonusPercent, effectiveStats, HELD_DEFENSE_CEILING } from './effects.js';
import { simulate } from './engine.js';

/**
 * The ground, and what it is worth.
 *
 * "The ground where we are fighting adds or removes bonuses" is a promise a player plans a roster
 * around, so what these pin is that a sheet saying *below street level* actually fires below street
 * level, and that a gate is worth something to the people behind it and nothing to the people
 * walking at it.
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
      at: DAY,
    });
    expect(sewer.contexts).toContain('underground');
    expect(sewer.contexts).not.toContain('open_ground');

    const yard = battlefieldFor({
      locationName: 'The Yard',
      kind: 'rail_yard',
      at: DAY,
    });
    expect(yard.contexts).toContain('open_ground');
    expect(yard.contexts).not.toContain('underground');
  });

  /*
   * The ground never offers a wall of its own (maintainer, 2026-09-26). Dug-in fortification left
   * the game, and a gate is the holder's rather than the ground's, so it reaches a fight through
   * their territory (`gatePercent`) and not through the battlefield.
   */
  it('never makes a wall out of the ground itself', () => {
    for (const kind of LOCATION_KINDS) {
      const ground = battlefieldFor({ locationName: 'x', kind, at: DAY });
      expect(ground.contexts, kind).not.toContain('vs_structure');
    }
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
});

describe('what the ground does to a unit', () => {
  it('fires a sheet only where it says it fires', () => {
    const tunnelRat = unit('ash_walkers');
    expect(contextBonusPercent(tunnelRat, ['underground']).percent).toBeGreaterThan(0);
    expect(contextBonusPercent(tunnelRat, ['open_ground']).percent).toBe(0);
  });

  it('sums stacked modifiers rather than multiplying them', () => {
    // Cyberhounds are `ambush` (25) and `night_operations` (20). In a street, in the dark, that is
    // 45 percentage points and not 1.25 × 1.20.
    const both = contextBonusPercent(unit('cyber_dogs'), ['urban', 'dark']);
    expect(both.percent).toBe(45);
    expect(both.reasons).toHaveLength(2);
  });

  it('raises the holder rather than the attacker behind a gate', () => {
    const field = battlefieldFor({
      locationName: 'x',
      kind: 'barricade',
      at: DAY,
    });
    const gated = { ...noTerritoryEffects(), gatePercent: 20 };
    const held = effectiveStats(unit('wardens'), field, { defending: true, outnumbered: 0 }, gated);
    const came = effectiveStats(
      unit('wardens'),
      field,
      { defending: false, outnumbered: 0 },
      gated,
    );
    // Toughness, not damage: a wall does not make a rifle shoot harder.
    expect(held.vitality).toBeGreaterThan(came.vitality);
    expect(held.armor).toBeGreaterThan(came.armor);
  });

  it('lets territory the crew holds reach the fight', () => {
    const boosted = effectiveStats(
      unit('razors'),
      bareBattlefield(),
      { defending: false, outnumbered: 0 },
      { ...noTerritoryEffects(), unitOffensePercent: 20, unitMoraleFlat: 10 },
    );
    const plain = effectiveStats(
      unit('razors'),
      bareBattlefield(),
      { defending: false, outnumbered: 0 },
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

  /** A held location is never unbreakable. Enough units still take it. */
  it('leaves a held location takeable by weight of numbers', () => {
    let taken = 0;
    for (let seed = 0; seed < 24; seed += 1) {
      const simulation = simulate({
        seed: `overrun-${seed}`,
        battlefield: battlefieldFor({
          locationName: 'The Barricade',
          kind: 'barricade',
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
    const raid = (gatePercent: number) => {
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
            territory: { ...noTerritoryEffects(), gatePercent },
          },
        });
        if (simulation.winner === 'defender') held += 1;
      }
      return held;
    };
    expect(raid(40)).toBeGreaterThan(raid(0));
  });

  /**
   * ...and never so much harder that no force could take it.
   *
   * Measured on Razors, a sheet with nothing that fires when defending, so the only thing between
   * their 75 and the figure read back is the held-ground curve: 500 points of defence come out as
   * 138.75, which is 75 at the 85 ceiling. It was measured on Wardens until Reliquary gave them
   * GUARD (2026-10-07), whose quarter of toughness is the unit's own and sits outside the curve
   * on purpose (`effectiveStats`, `ownToughness`): 168 held at 500 reads 352.8, which is the
   * ceiling and GUARD's 25 together, and the second block pins that the two add up that way.
   */
  it('caps what holding built ground is worth', () => {
    const razors = unit('razors');
    expect(razors.modifiers.map((id) => UNIT_MODIFIERS[id].context)).not.toContain('defending');
    const held = effectiveStats(
      razors,
      { ...homeBattlefield('x', DAY) },
      { defending: true, outnumbered: 0 },
      { ...noTerritoryEffects(), defensePercent: 500 },
    );
    expect(held.vitality).toBeLessThanOrEqual(
      razors.stats.vitality * (1 + HELD_DEFENSE_CEILING / 100),
    );

    // GUARD's share is bought one unit at a time and lands outside the cap: capped ground plus
    // the sheet's own quarter, and not a point more than the two together.
    const wardens = unit('wardens');
    expect(wardens.modifiers).toContain('guard');
    const guarded = effectiveStats(
      wardens,
      { ...homeBattlefield('x', DAY) },
      { defending: true, outnumbered: 0 },
      { ...noTerritoryEffects(), defensePercent: 500 },
    );
    const capped = wardens.stats.vitality * (1 + HELD_DEFENSE_CEILING / 100);
    expect(guarded.vitality).toBeGreaterThan(capped);
    expect(guarded.vitality).toBeLessThanOrEqual(
      wardens.stats.vitality * (1 + (HELD_DEFENSE_CEILING + UNIT_MODIFIERS.guard.percent) / 100),
    );
  });

  it('gives an attacker nothing for what the defender built', () => {
    const wardens = unit('wardens');
    const attacking = effectiveStats(
      wardens,
      homeBattlefield('x', DAY),
      { defending: false, outnumbered: 0 },
      { ...noTerritoryEffects(), defensePercent: 60 },
    );
    expect(attacking.vitality).toBe(wardens.stats.vitality);
  });
});
