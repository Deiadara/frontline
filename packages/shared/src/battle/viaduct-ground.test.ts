import { describe, expect, it } from 'vitest';
import {
  findLocation,
  missionSpeedPercentIn,
  noTerritoryEffects,
  levelTagGranted,
  levelTagsFor,
  type TerritoryEffects,
} from '../city/index.js';
import { applyHoldBonus, bonusesAt } from '../city/locations.js';
import {
  UNIT_MODIFIERS,
  findUnit,
  unitUnlockClauses,
  unitsUnlockedByLocation,
} from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { markedUnit } from './line.js';
import { targetBonusPercent } from './matchup.js';

/** The Viaduct's other four, batch 15 (maintainer, 2026-10-13). */

const field = bareBattlefield();
const side = { defending: false, outnumbered: 0 };
/** What holding a Viaduct location folds to, on the ground it stands on (its city matters). */
const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) =>
      applyHoldBonus(into, bonus, { districtId: 'viaduct', locationId: id, cityId: 'terminus' }),
    noTerritoryEffects(),
  );
const kindsAt = (id: string, level: number): string[] =>
  bonusesAt(findLocation(id)!, level).map((bonus) => bonus.kind);

describe('the Gantry Walk', () => {
  it('runs every job in Terminus 10% to 20% faster, the misc board at a Terminus home too', () => {
    expect(kindsAt('viaduct-gantry', 5)).toEqual(['mission_speed']);
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('viaduct-gantry', level).missionSpeedPercentByCity),
    ).toEqual([10, 12, 14, 16, 20].map((terminus) => ({ terminus })));
    const held = holding('viaduct-gantry', 1);
    expect(missionSpeedPercentIn(held, 'coldwater-halt', 'neon-docks')).toBe(10);
    expect(missionSpeedPercentIn(held, 'neon-docks', 'coldwater-halt')).toBe(0);
    expect(missionSpeedPercentIn(held, 'misc', 'coldwater-halt')).toBe(10);
    expect(missionSpeedPercentIn(held, 'misc', 'neon-docks')).toBe(0);
    // Nothing on the road: the travel channel is untouched.
    expect(held.missionTravelPercentByCity).toEqual({});
  });
});

describe('Arch Nineteen and the Hollow Men', () => {
  const hollow = findUnit('hollow_men')!;

  it('is where they are made, beside their structures and their blueprint', () => {
    expect(hollow.requires).toContainEqual({ kind: 'place', locationId: 'viaduct-archnineteen' });
    expect(hollow.requires.some((need) => need.kind === 'location')).toBe(false);
    // The document is read off the blueprint catalogue, not written on the sheet.
    expect(unitUnlockClauses(hollow)).toContainEqual({
      kind: 'blueprint',
      blueprintId: 'bp_hollow_men',
    });
    expect(unitsUnlockedByLocation('viaduct-archnineteen').map((unit) => unit.id)).toEqual([
      'hollow_men',
    ]);
  });

  it('holds the line on the sheet and carries no Terror of its own', () => {
    expect(hollow.stalwart).toBe(true);
    expect(hollow.modifiers).toEqual(['close_quarters']);
  });

  it('pays +50 vitality and +30 damage a level to 4, and golden Terror at 5 on top', () => {
    const bare = effectiveStats(hollow, field, side, noTerritoryEffects());
    const offense = bare.offense / hollow.stats.offense;
    const vitality = bare.vitality / hollow.stats.vitality;
    expect(
      [1, 2, 3, 4, 5].map((level) => {
        const held = effectiveStats(hollow, field, side, holding('viaduct-archnineteen', level));
        return [
          Math.round(held.vitality / vitality - hollow.stats.vitality),
          Math.round(held.offense / offense - hollow.stats.offense),
        ];
      }),
    ).toEqual([
      [50, 30],
      [100, 60],
      [150, 90],
      [200, 120],
      [200, 120],
    ]);
    expect(holding('viaduct-archnineteen', 4).unitModifiers).toEqual({});
    const five = markedUnit(hollow, holding('viaduct-archnineteen', 5));
    expect(five.modifiers).toEqual(['close_quarters', 'golden_terror']);
    expect(five.goldenModifiers).toEqual(['golden_terror']);
    // The kind's own research and damage are gone.
    expect(holding('viaduct-archnineteen', 5).researchSpeedPercent ?? 0).toBe(0);
  });

  it('makes their Terror a little stronger than anybody else’s, in the same two tiers', () => {
    expect(UNIT_MODIFIERS.golden_terror.label).toBe(UNIT_MODIFIERS.terror.label);
    expect(UNIT_MODIFIERS.golden_terror.percent).toBe(40);
    expect(UNIT_MODIFIERS.terror.percent).toBe(35);
    const target = effectiveStats(findUnit('razors')!, field, side, noTerritoryEffects());
    expect(targetBonusPercent(['golden_terror'], target, 20)).toBe(40);
    expect(targetBonusPercent(['terror'], target, 20)).toBe(35);
    expect(targetBonusPercent(['golden_terror'], target, 45)).toBeCloseTo(16, 9);
    expect(targetBonusPercent(['golden_terror'], target, 80)).toBe(0);
  });

  it('lists the golden Terror as a locked tag until the arch is at 5', () => {
    const [terror] = levelTagsFor('hollow_men');
    expect(terror).toMatchObject({
      label: 'Terror',
      golden: true,
      unlock: 'Hold Arch Nineteen at level 5',
    });
    expect(levelTagGranted(terror!, [], [{ label: 'Close Quarters' }])).toBe(false);
    expect(levelTagGranted(terror!, [], [{ label: 'Terror', golden: true }])).toBe(true);
    // An ordinary Terror is not the golden one.
    expect(levelTagGranted(terror!, [], [{ label: 'Terror' }])).toBe(false);
  });
});

describe('the Pier Works', () => {
  it('pays scrap 30 to 130 and HQ metal 15 to 65 an hour, and nothing else', () => {
    expect([1, 2, 3, 4, 5].map((level) => holding('viaduct-pierworks', level).perHour)).toEqual(
      [
        [30, 15],
        [50, 25],
        [70, 35],
        [90, 45],
        [130, 65],
      ].map(([scrap, highQualityMetal]) => ({ scrap, highQualityMetal })),
    );
  });
});

describe('the Sappers’ Store', () => {
  it('lends 1% to 5% vitality a fitted card, and nothing else', () => {
    expect(kindsAt('viaduct-sappers', 5)).toEqual(['modification_vitality']);
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('viaduct-sappers', level).modificationVitalityPercent),
    ).toEqual([1, 1.8, 2.6, 3.4, 5]);
    const razors = findUnit('razors')!;
    const held = holding('viaduct-sappers', 5);
    const at = (fittedCount: number, territory: TerritoryEffects) =>
      effectiveStats(razors, field, side, territory, [], { fittedCount }).vitality;
    // Three cards at level 5: 15% on the sheet, and nothing for a unit wearing none.
    expect(at(3, held) / at(3, noTerritoryEffects())).toBeCloseTo(1.15, 9);
    expect(at(0, held)).toBe(at(0, noTerritoryEffects()));
    expect(held.musterCostPercent).toBe(0);
  });
});
