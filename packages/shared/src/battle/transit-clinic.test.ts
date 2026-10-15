import { describe, expect, it } from 'vitest';
import { findLocation, noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { applyHoldBonus, bonusesAt } from '../city/locations.js';
import { findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { deathSalvageFor, describeSalvage } from './death-salvage.js';
import { effectiveStats } from './effects.js';
import { simulate, transitClinic, type SideState, type Stack } from './engine.js';

/** The Last Platform's other four, batch 17 (maintainer, 2026-10-14). */

const field = bareBattlefield();
const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );
const kindsAt = (id: string, level: number): string[] =>
  bonusesAt(findLocation(id)!, level).map((bonus) => bonus.kind);

function stackOf(id: string, bodies: number[], vitality: number): Stack {
  const spec = findUnit(id)!;
  const effective = {
    ...effectiveStats(spec, field, { defending: false, outnumbered: 0 }, noTerritoryEffects()),
    vitality,
  };
  return {
    unit: spec,
    effective,
    alive: bodies.length,
    pool: bodies.reduce((a, b) => a + b, 0),
    bodies: [...bodies],
    morale: effective.morale,
    brokeAt: null,
    started: bodies.length,
    charged: 0,
    suppressed: 0,
    dealt: 0,
    sheet: spec.stats,
    modGain: {},
    loudTier: 0,
  };
}
const sideOf = (stacks: Stack[], deathHealPercent: number): SideState =>
  ({
    stacks,
    luck: 0,
    swing: 1,
    name: 'side',
    defending: false,
    deathHealPercent,
  }) as unknown as SideState;

describe('the Transit Clinic', () => {
  it('pays 10% to 20% of a dead body’s vitality to the most hurt living one, and nothing else', () => {
    expect(kindsAt('last-platform-transit', 5)).toEqual(['death_heal']);
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('last-platform-transit', level).deathHealPercent),
    ).toEqual([10, 12, 14, 16, 20]);
  });

  it('heals the body with the most missing, once per death, never past its full vitality', () => {
    // Ten Razors at 100 a body, two of them dead this round; Wardens with one body at 40 of 100.
    const razors = stackOf('razors', [90, 100, 100], 100);
    const wardens = stackOf('wardens', [40, 100], 100);
    const side = sideOf([razors, wardens], 20);
    const before = new Map([
      [razors, 5],
      [wardens, 2],
    ]);
    // Two Razors died (5 -> 3): each pays 20 to the most hurt body, the Warden at 40.
    expect(transitClinic(side, before)).toBe(40);
    expect(wardens.bodies[0]).toBe(80);
    expect(wardens.pool).toBe(180);
    expect(razors.bodies).toEqual([90, 100, 100]);
  });

  it('moves to the next most hurt body once one is full, and stops when nobody is hurt', () => {
    const razors = stackOf('razors', [95, 100], 100);
    const wardens = stackOf('wardens', [90], 100);
    const side = sideOf([razors, wardens], 20);
    // Three deaths: the Warden takes 10 (full), the Razor 5 (full), then nobody needs it.
    expect(transitClinic(side, new Map([[razors, 5]]))).toBe(15);
    expect(wardens.bodies).toEqual([100]);
    expect(razors.bodies).toEqual([100, 100]);
  });

  it('does nothing without the clinic', () => {
    const razors = stackOf('razors', [50], 100);
    expect(transitClinic(sideOf([razors], 0), new Map([[razors, 3]]))).toBe(0);
    expect(razors.bodies).toEqual([50]);
  });

  it('keeps more of a line standing in a real fight', () => {
    let held = 0;
    let bare = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const standing = (territory?: TerritoryEffects) =>
        simulate({
          seed: `clinic-${seed}`,
          battlefield: field,
          attacker: { name: 'A', army: { razors: 30 }, defending: false },
          defender: {
            name: 'D',
            army: { wardens: 12, razors: 6 },
            defending: true,
            ...(territory ? { territory } : {}),
          },
        }).defender.stacks.reduce((total, stack) => total + stack.pool, 0);
      held += standing(holding('last-platform-transit', 5));
      bare += standing();
    }
    expect(held).toBeGreaterThan(bare);
  });
});

describe('the Platform Armoury', () => {
  it('plates legendaries +25 to +50 armour, and nobody else', () => {
    const side = { defending: false, outnumbered: 0 };
    const armour = (id: string, territory: TerritoryEffects) =>
      effectiveStats(findUnit(id)!, field, side, territory).armor;
    expect(
      [1, 2, 3, 4, 5].map(
        (level) =>
          armour('the_saint', holding('last-platform-armoury', level)) -
          armour('the_saint', noTerritoryEffects()),
      ),
    ).toEqual([25, 30, 35, 40, 50]);
    expect(armour('razors', holding('last-platform-armoury', 5))).toBe(
      armour('razors', noTerritoryEffects()),
    );
  });
});

describe('the Stationmaster’s Office', () => {
  it('lifts five skills on every officer, 5 to 10, and does nothing else', () => {
    expect(
      [1, 2, 3, 4, 5].map(
        (level) => holding('last-platform-stationmaster', level).officerSkillFlat,
      ),
    ).toEqual(
      [5, 6, 7, 8, 10].map((n) => ({
        organization: n,
        analysis: n,
        logic: n,
        diplomacy: n,
        authority: n,
      })),
    );
  });
});

describe('the Cold Sidings', () => {
  it('pays 5 to 25 scrap and 1 to 5 HQ metal a dead body, and nothing else', () => {
    expect(new Set(kindsAt('last-platform-sidings', 5))).toEqual(new Set(['death_salvage']));
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('last-platform-sidings', level).deathSalvagePerBody),
    ).toEqual(
      [
        [5, 1],
        [9, 1.8],
        [13, 2.6],
        [17, 3.4],
        [25, 5],
      ].map(([scrap, highQualityMetal]) => ({ scrap, highQualityMetal })),
    );
    const five = holding('last-platform-sidings', 5);
    expect(five.unitVitalityPercent).toBe(0);
  });

  it('sums over the dead and rounds the totals down once', () => {
    const level2 = holding('last-platform-sidings', 2).deathSalvagePerBody;
    // Three dead at 9 scrap and 1.8 HQ metal: 27 scrap and 5 HQ metal (5.4 down), not 3.
    expect(deathSalvageFor(3, level2)).toEqual({ scrap: 27, highQualityMetal: 5 });
    expect(deathSalvageFor(0, level2)).toEqual({});
    expect(describeSalvage({ scrap: 27, highQualityMetal: 5 })).toBe('27 Scrap and 5 HQ metal');
  });
});
