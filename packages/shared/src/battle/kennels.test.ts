import { describe, expect, it } from 'vitest';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { GOOD_BOY_MORALE, simulate, type Stack } from './engine.js';
import { findLocation, noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { findUnit, unitsUnlockedByLocation } from '../units/index.js';
import { describeRequirement } from '../units/unlocks.js';

/**
 * Bonded Row, batch 9 (maintainer, 2026-10-09): ground that stopped opening a unit's gate, the Crated Yard's planks and supplies, and the Kennels' Cyberhounds with GOOD BOY.
 */

const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );

describe('ground that stopped opening what others like it open', () => {
  it('opens only what is named on it, and the ground that still opens a unit is unchanged', () => {
    // Was `KIND_GATES_DROPPED` (2026-10-09): the unit lists that replaced kinds leave these out.
    const opens = (id: string) => unitsUnlockedByLocation(id).map((unit) => unit.id);
    expect(opens('bonded-row-crated')).toEqual([]);
    expect(opens('bonded-row-ring')).toEqual(['the_geppetto']);
    expect(opens('marshalling-yards-hump')).toEqual([]);
    expect(opens('marshalling-yards-messroom')).toEqual(['breakers']);
    expect(opens('telemetry-hill-uplink')).toEqual([]);
    expect(opens('viaduct-archnineteen')).toEqual(['hollow_men']);
    expect(opens('viaduct-camp')).toEqual([]);
    // Ashfall's yard, scaffolds, uplinks and lair still open theirs.
    expect(opens('glasshouse-fields-haulers')).toEqual(['the_loose_end']);
    expect(opens('annexes-scaffold')).toEqual(['the_colossus']);
    expect(opens('ccs-uplink')).toEqual(['the_specter']);
    expect(opens('undergrid-lair').sort()).toEqual(['the_abomination', 'the_twins']);
  });
});

describe('the Crated Yard', () => {
  it('pays planks 30 to 155 and supplies 20 to 95, and nothing else', () => {
    const at = (level: number) => holding('bonded-row-crated', level);
    expect([1, 2, 3, 4, 5].map((level) => at(level).perHour)).toEqual(
      [
        [30, 20],
        [55, 35],
        [80, 50],
        [105, 65],
        [155, 95],
      ].map(([planks, supplies]) => ({ planks, supplies })),
    );
    expect(at(5).buildSpeedPercent).toBe(0);
  });
});

describe('the Kennels', () => {
  const dogs = findUnit('cyber_dogs')!;

  it('names itself as the Cyberhounds` door, with the Steelbelt`s Doghouse as the alternative', () => {
    const door = dogs.requires.find((need) => need.kind === 'location');
    expect(door).toEqual({
      kind: 'location',
      locationIds: ['bonded-row-kennels', 'steelbelt-kennels'],
    });
    expect(describeRequirement(door!)).toBe(
      'Hold The Kennels in Bonded Row, or The Doghouse in Steelbelt',
    );
    expect(dogs.requires).toContainEqual({ kind: 'building', building: 'infirmary', level: 6 });
  });

  it('lends the Cyberhounds armour, vitality and damage by level, and drops the intimidation', () => {
    const field = bareBattlefield();
    const side = { defending: false, outnumbered: 0 };
    const bare = effectiveStats(dogs, field, side, noTerritoryEffects());
    const offense = bare.offense / dogs.stats.offense;
    const vitality = bare.vitality / dogs.stats.vitality;
    expect(
      [1, 2, 3, 4, 5].map((level) => {
        const held = effectiveStats(dogs, field, side, holding('bonded-row-kennels', level));
        return [
          held.armor - bare.armor,
          Math.round(held.vitality / vitality - dogs.stats.vitality),
          Math.round(held.offense / offense - dogs.stats.offense),
        ];
      }),
    ).toEqual([
      [5, 30, 30],
      [10, 60, 60],
      [15, 90, 90],
      [20, 120, 120],
      [30, 180, 180],
    ]);
    expect(holding('bonded-row-kennels', 5).intimidationFlat).toBe(0);
    expect(holding('bonded-row-kennels', 4).unitMarks).toEqual({});
    expect(holding('bonded-row-kennels', 5).unitMarks).toEqual({ cyber_dogs: ['good_boy'] });
    expect(describeHoldBonus(bonusesAt(findLocation('bonded-row-kennels')!, 5).at(-1)!)).toBe(
      'Good Boy for Cyber Dogs',
    );
  });
});

describe('GOOD BOY', () => {
  const marked = { ...noTerritoryEffects(), unitMarks: { cyber_dogs: ['good_boy' as const] } };

  /** The stacks a side starts with, read before a round is fought. */
  const line = (army: Record<string, number>, good = true): Stack[] =>
    simulate({
      seed: 'kennels',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army, defending: false, ...(good ? { territory: marked } : {}) },
      defender: { name: 'D', army: { razors: 1 }, defending: true },
    }).attacker.stacks;
  const startingMorale = (army: Record<string, number>, id: string, good = true) =>
    line(army, good).find((stack) => stack.unit.id === id)!.effective.morale;

  it('lifts two one-slot Rabble a dog: ten dogs cover twenty Razors', () => {
    const plain = startingMorale({ cyber_dogs: 10, razors: 20 }, 'razors', false);
    expect(startingMorale({ cyber_dogs: 10, razors: 20 }, 'razors')).toBe(plain + GOOD_BOY_MORALE);
    // Thirty Razors and the same ten dogs: twenty covered, so the stack takes two thirds of it.
    expect(startingMorale({ cyber_dogs: 10, razors: 30 }, 'razors')).toBeCloseTo(
      plain + (GOOD_BOY_MORALE * 20) / 30,
      9,
    );
  });

  it('covers one two-slot unit a dog, never a unit bigger than a dog, and pools nothing', () => {
    const anodics = startingMorale({ cyber_dogs: 3, anodics: 3 }, 'anodics', false);
    expect(startingMorale({ cyber_dogs: 3, anodics: 3 }, 'anodics')).toBe(
      anodics + GOOD_BOY_MORALE,
    );
    // Three slots against a dog's two: nobody covers a Condemned, however many dogs there are.
    const condemned = startingMorale({ cyber_dogs: 10, the_condemned: 1 }, 'the_condemned', false);
    expect(startingMorale({ cyber_dogs: 10, the_condemned: 1 }, 'the_condemned')).toBe(condemned);
    // Largest first: one dog, one Anodic and two Razors. The Anodic takes the dog.
    const army = { cyber_dogs: 1, anodics: 1, razors: 2 };
    expect(startingMorale(army, 'anodics')).toBe(startingMorale(army, 'anodics', false) + 10);
    expect(startingMorale(army, 'razors')).toBe(startingMorale(army, 'razors', false));
  });

  it('does nothing for a crew whose dogs are not GOOD BOYs, and nothing to non-Rabble', () => {
    expect(startingMorale({ cyber_dogs: 10, razors: 20 }, 'razors', false)).toBe(
      startingMorale({ razors: 20 }, 'razors', false),
    );
    expect(startingMorale({ cyber_dogs: 10, wardens: 4 }, 'wardens')).toBe(
      startingMorale({ cyber_dogs: 10, wardens: 4 }, 'wardens', false),
    );
  });
});
