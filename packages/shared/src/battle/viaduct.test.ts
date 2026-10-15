import { describe, expect, it } from 'vitest';
import { findLocation, noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { UNIT_RULES, findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';

/** The Viaduct's two fighting grounds, batch 14 (maintainer, 2026-10-13). */

const field = bareBattlefield();
const side = { defending: true, outnumbered: 0 };
const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );
/** The percentage a holding adds to one stat of one unit, read back off its sheet. */
const lift = (unitId: string, stat: 'offense' | 'vitality', territory: TerritoryEffects) => {
  const unit = findUnit(unitId)!;
  const bare = effectiveStats(unit, field, side, noTerritoryEffects())[stat];
  const held = effectiveStats(unit, field, side, territory)[stat];
  return Math.round(((held - bare) / unit.stats[stat]) * 100);
};

describe('the Arch Battery', () => {
  it('makes TAUNT units 10% to 20% tougher, and does nothing else', () => {
    expect(findUnit('ironsides')!.taunts).toBe(true);
    expect(
      [1, 2, 3, 4, 5].map((level) =>
        lift('ironsides', 'vitality', holding('viaduct-battery', level)),
      ),
    ).toEqual([10, 12, 14, 16, 20]);
    expect(lift('wardens', 'vitality', holding('viaduct-battery', 5))).toBe(0);
    const five = holding('viaduct-battery', 5);
    expect(five.defensePercent).toBe(0);
    expect(five.unitMarks).toEqual({});
    expect(describeHoldBonus(bonusesAt(findLocation('viaduct-battery')!, 1)[0]!)).toBe(
      '+10% vitality for units with Taunt',
    );
  });
});

describe('the Parapet', () => {
  it('lifts the damage of units with range above 50, 10% to 20%, and nobody else', () => {
    expect(findUnit('snipers')!.stats.range).toBeGreaterThan(50);
    expect(
      [1, 2, 3, 4, 5].map((level) => lift('snipers', 'offense', holding('viaduct-parapet', level))),
    ).toEqual([10, 12, 14, 16, 20]);
    expect(findUnit('razors')!.stats.range).toBeLessThanOrEqual(50);
    expect(lift('razors', 'offense', holding('viaduct-parapet', 5))).toBe(0);
    expect(holding('viaduct-parapet', 5).defensePercent).toBe(0);
  });
});

describe('the renamed and reworked rules', () => {
  it('calls the shield wall TAUNT and Holds the Line what it now does', () => {
    expect(UNIT_RULES.taunts.label).toBe('Taunt');
    expect(UNIT_RULES.stalwart.description).toBe(
      "This unit's morale does not drop during the fight.",
    );
  });
});
