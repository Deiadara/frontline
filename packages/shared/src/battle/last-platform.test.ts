import { describe, expect, it } from 'vitest';
import {
  ATLAS_UNIFIED_BONUSES,
  findLocation,
  noTerritoryEffects,
  type TerritoryEffects,
} from '../city/index.js';
import { applyHoldBonus, bonusesAt } from '../city/locations.js';
import { bareBattlefield } from './battlefield.js';
import { simulate } from './engine.js';
import { unitsUnlockedByLocation } from '../units/index.js';

/** The Viaduct's last two and the Last Platform's first two, batch 16 (maintainer, 2026-10-13). */

const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );
const kindsAt = (id: string, level: number): string[] =>
  bonusesAt(findLocation(id)!, level).map((bonus) => bonus.kind);

describe("Refugee's Camp", () => {
  it('is the old Undercroft by a new name and id, and pays beds alone: 70 to 195', () => {
    const camp = findLocation('viaduct-camp')!;
    expect(camp.name).toBe("Refugee's Camp");
    expect(findLocation('viaduct-undercroft')).toBeUndefined();
    expect(kindsAt('viaduct-camp', 5)).toEqual(['unit_slots']);
    expect([1, 2, 3, 4, 5].map((level) => holding('viaduct-camp', level).unitSlotBonus)).toEqual([
      70, 95, 120, 145, 195,
    ]);
    expect(unitsUnlockedByLocation('viaduct-camp')).toEqual([]);
  });
});

describe('the Viaduct held whole', () => {
  it('pays 10% more on every job in every city, and nothing else', () => {
    const unified = ATLAS_UNIFIED_BONUSES.viaduct!;
    expect(unified.title).toBe('Everything Crosses the Arches');
    expect(unified.bonus).toEqual({ kind: 'mission_spoils', percent: 10 });
    const whole = applyHoldBonus(noTerritoryEffects(), unified.bonus, { cityId: 'terminus' });
    expect(whole.missionSpoilsPercent).toBe(10);
    expect(whole.missionSpoilsPercentByCity).toEqual({});
    expect(whole.infamyGainPercent).toBe(0);
  });
});

describe('the Customs Hall', () => {
  it('pays planks, scrap, supplies and HQ metal by the hour, and nothing else', () => {
    expect([1, 2, 3, 4, 5].map((level) => holding('last-platform-customs', level).perHour)).toEqual(
      [
        [40, 20, 20, 10],
        [60, 30, 30, 15],
        [80, 40, 40, 20],
        [100, 50, 50, 25],
        [140, 70, 70, 35],
      ].map(([planks, scrap, supplies, highQualityMetal]) => ({
        planks,
        scrap,
        supplies,
        highQualityMetal,
      })),
    );
    expect(holding('last-platform-customs', 5).marketDiscountPercent).toBe(0);
  });
});

describe('the Holding Pens', () => {
  it('lifts your damage against Rabble 10% to 20%, and does nothing else', () => {
    expect(kindsAt('last-platform-holding', 5)).toEqual(['offense_vs_tier']);
    expect(
      [1, 2, 3, 4, 5].map(
        (level) => holding('last-platform-holding', level).offenseVsTierPercent.rabble,
      ),
    ).toEqual([10, 12, 14, 16, 20]);
    const five = holding('last-platform-holding', 5);
    expect(five.defensePercent).toBe(0);
    expect(five.unitMarks).toEqual({});
  });

  const firstRound = (defender: Record<string, number>, territory?: TerritoryEffects) =>
    simulate({
      seed: 'pens',
      battlefield: bareBattlefield(),
      attacker: {
        name: 'A',
        army: { wardens: 20 },
        defending: false,
        ...(territory ? { territory } : {}),
      },
      defender: { name: 'D', army: defender, defending: true },
    }).rounds[0]!.defenderLost;

  it('hits Rabble harder in the fight, and leaves every other tier exactly as it was', () => {
    const pens = holding('last-platform-holding', 5);
    expect(firstRound({ razors: 40 }, pens)).toBeGreaterThan(firstRound({ razors: 40 }));
    expect(firstRound({ ironsides: 10 }, pens)).toBe(firstRound({ ironsides: 10 }));
  });
});
