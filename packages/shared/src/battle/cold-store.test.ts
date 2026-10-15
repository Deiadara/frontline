import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { COLD_STORE_UNIT, simulate, type Stack } from './engine.js';
import {
  ATLAS_UNIFIED_BONUSES,
  findLocation,
  noTerritoryEffects,
  type TerritoryEffects,
} from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { findUnit } from '../units/index.js';

/**
 * Bonded Row, batch 10 (maintainer, 2026-10-09): the Cold Store's Stitchers lend vitality to
 * everybody beside them, and the district held whole makes Wonders of Engineering stronger.
 */

const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );

describe('the Cold Store', () => {
  it('pays one vitality per Stitcher a level, 1 to 5 with the top not doubled, and nothing else', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('bonded-row-coldstore', level).stitcherVitality),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(bonusesAt(findLocation('bonded-row-coldstore')!, 4).map((bonus) => bonus.kind)).toEqual([
      'stitcher_vitality',
    ]);
    // And at level 5 the Stitchers work from a SAFE DISTANCE (batch 11, 2026-10-09).
    const bonuses = bonusesAt(findLocation('bonded-row-coldstore')!, 5);
    expect(bonuses.map((bonus) => bonus.kind)).toEqual(['stitcher_vitality', 'unit_mark']);
    expect(holding('bonded-row-coldstore', 5).unitMarks).toEqual({ stitchers: ['safe_distance'] });
    expect(holding('bonded-row-coldstore', 5).battleStims).toBe(0);
    expect(describeHoldBonus(bonuses[0]!)).toBe(
      '+5 vitality on every other unit in the fight for each of your Stitchers',
    );
  });

  /** The stacks a side starts with. `effective.vitality` is not touched once the fight starts. */
  const line = (army: Record<string, number>, level: number, officer = false): readonly Stack[] =>
    simulate({
      seed: 'cold-store',
      battlefield: bareBattlefield(),
      attacker: {
        name: 'A',
        army,
        defending: false,
        ...(level > 0 ? { territory: holding('bonded-row-coldstore', level) } : {}),
        ...(officer
          ? { officer: { officerId: 'o', name: 'O', attributes: makeAttributes(40) } }
          : {}),
      },
      defender: { name: 'D', army: { razors: 1 }, defending: true },
    }).attacker.stacks;
  const vitalityOf = (stacks: readonly Stack[], id: string): number =>
    stacks.find((stack) => stack.unit.id === id && stack.officer === undefined)!.effective.vitality;

  it('gives every other unit +6 for three Stitchers at level 2, and the Stitchers nothing', () => {
    const army = { stitchers: 3, razors: 10, wardens: 4 };
    const plain = line(army, 0);
    const held = line(army, 2);
    expect(vitalityOf(held, 'razors')).toBeCloseTo(vitalityOf(plain, 'razors') + 6, 9);
    expect(vitalityOf(held, 'wardens')).toBeCloseTo(vitalityOf(plain, 'wardens') + 6, 9);
    expect(vitalityOf(held, COLD_STORE_UNIT)).toBe(vitalityOf(plain, COLD_STORE_UNIT));
    const razors = held.find((stack) => stack.unit.id === 'razors')!;
    expect(razors.effective.reasons).toContain('Cold Store');
  });

  it('starts every body at the lifted figure', () => {
    const stacks = simulate({
      seed: 'cold-store-bodies',
      battlefield: bareBattlefield(),
      attacker: {
        name: 'A',
        army: { stitchers: 5, razors: 10 },
        defending: false,
        territory: holding('bonded-row-coldstore', 5),
      },
      // Nobody to fight, so nobody is scratched and the pool is what formation left.
      defender: { name: 'D', army: {}, defending: true },
    }).attacker.stacks;
    const razors = stacks.find((stack) => stack.unit.id === 'razors')!;
    const plain = vitalityOf(line({ razors: 10 }, 0), 'razors');
    expect(razors.effective.vitality).toBeCloseTo(plain + 25, 9);
    expect(razors.pool).toBeCloseTo(10 * (plain + 25), 9);
    expect(razors.bodies.every((hp) => Math.abs(hp - (plain + 25)) < 1e-9)).toBe(true);
  });

  it('pays nothing without Stitchers, nothing without the store, and nothing to the officer', () => {
    expect(vitalityOf(line({ razors: 10 }, 5), 'razors')).toBe(
      vitalityOf(line({ razors: 10 }, 0), 'razors'),
    );
    expect(vitalityOf(line({ stitchers: 3, razors: 10 }, 0), 'razors')).toBe(
      vitalityOf(line({ razors: 10 }, 0), 'razors'),
    );
    const officerOf = (stacks: readonly Stack[]) =>
      stacks.find((stack) => stack.officer !== undefined)!.effective.vitality;
    expect(officerOf(line({ stitchers: 3, razors: 1 }, 5, true))).toBe(
      officerOf(line({ stitchers: 3, razors: 1 }, 0, true)),
    );
  });
});

describe('Bonded Row held whole', () => {
  it('makes Wonders of Engineering 10% stronger and nothing else', () => {
    const unified = ATLAS_UNIFIED_BONUSES['bonded-row']!;
    expect(unified.title).toBe('Out of Bond');
    expect(unified.bonus).toEqual({ kind: 'tier_strength', tier: 'wonder', percent: 10 });
    const territory = applyHoldBonus(noTerritoryEffects(), unified.bonus);
    expect(territory.blackMarketDiscountPercent).toBe(0);

    const field = bareBattlefield();
    const side = { defending: false, outnumbered: 0 };
    const reavers = findUnit('road_reavers')!;
    expect(reavers.tier).toBe('wonder');
    const bare = effectiveStats(reavers, field, side, noTerritoryEffects());
    const held = effectiveStats(reavers, field, side, territory);
    // Ten points on the sheet's percentages, which add with whatever else the unit carries.
    expect(held.vitality - bare.vitality).toBeCloseTo(reavers.stats.vitality * 0.1, 9);
    expect(held.offense - bare.offense).toBeCloseTo(reavers.stats.offense * 0.1, 9);
    // A Razor is Rabble and gets none of it.
    const razors = findUnit('razors')!;
    expect(effectiveStats(razors, field, side, territory).offense).toBe(
      effectiveStats(razors, field, side, noTerritoryEffects()).offense,
    );
  });
});
