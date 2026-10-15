import { describe, expect, it } from 'vitest';
import {
  ATLAS_UNIFIED_BONUSES,
  envLabel,
  findLocation,
  noTerritoryEffects,
  type TerritoryEffects,
} from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { UNIT_CATALOG } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';

/** The Iron Footbridge, the Last Platform held whole, the Panel and the Frontier Chapel (2026-10-14). */

const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus, { locationId: id }),
    noTerritoryEffects(),
  );
const kindsAt = (id: string, level: number): string[] =>
  bonusesAt(findLocation(id)!, level).map((bonus) => bonus.kind);

describe('the Iron Footbridge', () => {
  it('runs every job anywhere 15% to 25% faster, on the whole clock, and nothing else', () => {
    expect(kindsAt('last-platform-footbridge', 5)).toEqual(['mission_speed']);
    expect(
      [1, 2, 3, 4, 5].map(
        (level) => holding('last-platform-footbridge', level).missionSpeedPercent,
      ),
    ).toEqual([15, 17, 19, 21, 25]);
    const top = holding('last-platform-footbridge', 5);
    expect(top.missionSpeedPercentByCity).toEqual({});
    expect(top.missionTravelPercentByCity).toEqual({});
  });
});

describe('the Last Platform held whole', () => {
  it('pays 25% more infamy off fights, and nothing else', () => {
    const unified = ATLAS_UNIFIED_BONUSES['last-platform']!;
    expect(unified.title).toBe('Talked About Down the Line');
    expect(unified.bonus).toEqual({ kind: 'battle_infamy', percent: 25 });
    const whole = applyHoldBonus(noTerritoryEffects(), unified.bonus);
    expect(whole.battleInfamyPercent).toBe(25);
    expect(whole.infamyGainPercent).toBe(0);
    expect(whole.unitOffensePercent).toBe(0);
  });
});

describe('the Panel', () => {
  it('lifts four skills 5 to 10 on every officer', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('blockhouse-panel', level).officerSkillFlat),
    ).toEqual(
      [5, 6, 7, 8, 10].map((n) => ({ engineering: n, signals: n, cybernetics: n, chemistry: n })),
    );
  });

  it('owes 1, 1, 1, 2, 2 pages a day at odds rows 1, 2, 3, 3, 5', () => {
    expect([1, 2, 3, 4, 5].map((level) => holding('blockhouse-panel', level).dailyPages)).toEqual(
      [
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 3],
        [2, 5],
      ].map(([count, row]) =>
        Array.from({ length: count! }, () => ({ level: row, locationId: 'blockhouse-panel' })),
      ),
    );
    expect(new Set(kindsAt('blockhouse-panel', 5))).toEqual(
      new Set(['officer_skill', 'daily_page']),
    );
  });
});

describe('the Frontier Chapel', () => {
  it('makes your units immune to Eerie ground, and lifts morale 5 to 10', () => {
    expect(new Set(kindsAt('blockhouse-chapel', 5))).toEqual(
      new Set(['ignore_label', 'unit_morale']),
    );
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('blockhouse-chapel', level).unitMoraleFlat),
    ).toEqual([5, 6, 7, 8, 10]);
    expect(holding('blockhouse-chapel', 1).labelImmunities).toEqual(['eerie']);
    expect(describeHoldBonus(bonusesAt(findLocation('blockhouse-chapel')!, 1)[0]!)).toBe(
      'your units are immune to Eerie ground in a fight',
    );
  });

  it('takes the Eerie off a unit that suffers it, once the standing fold lists it', () => {
    const fearful = UNIT_CATALOG.find((unit) => (unit.affinities?.eerie ?? 0) < 0)!;
    const eerie = { ...bareBattlefield(), labels: [envLabel('eerie', 3)] };
    const side = { defending: false, outnumbered: 0 };
    const bare = effectiveStats(fearful, eerie, side, noTerritoryEffects());
    const calm = effectiveStats(fearful, bareBattlefield(), side, noTerritoryEffects());
    const immune = effectiveStats(fearful, eerie, side, {
      ...noTerritoryEffects(),
      ignoredLabels: ['eerie'],
    } as TerritoryEffects);
    expect(bare.offense).toBeLessThan(calm.offense);
    expect(immune.offense).toBe(calm.offense);
  });
});
