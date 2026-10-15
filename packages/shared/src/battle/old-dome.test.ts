import { describe, expect, it } from 'vitest';
import {
  ATLAS_UNIFIED_BONUSES,
  findLocation,
  levelTagGranted,
  levelTagsFor,
  noTerritoryEffects,
  type TerritoryEffects,
} from '../city/index.js';
import { applyHoldBonus, bonusesAt } from '../city/locations.js';
import { drillBonusRoll, applyGain } from '../crew/training.js';
import { makeAttributes } from '../attributes.js';
import {
  SHORTCUT_SHARE,
  describeRequirement,
  findUnit,
  shortcutMinutes,
  travelsWithShortcut,
  withShortcut,
} from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { markedUnit } from './line.js';
import {
  PERCEPTION_STEALTH_SHARE,
  ambushShare,
  perceives,
  type SideState,
  type Stack,
} from './engine.js';
import { fleeChance } from './rout.js';

/** Telemetry Hill's remainder, batch 13 (maintainer, 2026-10-09). */

const field = bareBattlefield();
const side = { defending: false, outnumbered: 0 };
const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );
const kindsAt = (id: string, level: number): string[] =>
  bonusesAt(findLocation(id)!, level).map((bonus) => bonus.kind);

function stackOf(id: string, alive: number, territory = noTerritoryEffects()): Stack {
  const spec = markedUnit(findUnit(id)!, territory);
  const effective = effectiveStats(spec, field, side, territory);
  return {
    unit: spec,
    effective,
    alive,
    pool: alive * effective.vitality,
    bodies: new Array<number>(alive).fill(effective.vitality),
    morale: effective.morale,
    brokeAt: null,
    started: alive,
    charged: 0,
    suppressed: 0,
    dealt: 0,
    sheet: spec.stats,
    modGain: {},
    loudTier: 0,
  };
}
const sideOf = (stacks: Stack[]): SideState =>
  ({ stacks, luck: 0, swing: 1, name: 'side', defending: false }) as unknown as SideState;

describe('the Cartographer and the Old Dome', () => {
  const cartographer = findUnit('the_cartographer')!;

  it('is trained under the Old Dome, at speed 70, and carries SHORTCUT', () => {
    expect(cartographer.requires).toEqual([
      { kind: 'building', building: 'gauntlet', level: 15 },
      { kind: 'place', locationId: 'telemetry-hill-dome' },
    ]);
    expect(describeRequirement(cartographer.requires[1]!)).toBe(
      'Hold The Old Dome in Telemetry Hill',
    );
    expect(cartographer.stats.speed).toBe(70);
    expect(cartographer.shortcut).toBe(true);
  });

  it('pays her +5 to +30 speed and +100 to +600 vitality by level, and PERCEPTION at 5 alone', () => {
    const bare = effectiveStats(cartographer, field, side, noTerritoryEffects());
    const vitality = bare.vitality / cartographer.stats.vitality;
    expect(
      [1, 2, 3, 4, 5].map((level) => {
        const held = effectiveStats(
          cartographer,
          field,
          side,
          holding('telemetry-hill-dome', level),
        );
        return [
          held.speed - bare.speed,
          Math.round(held.vitality / vitality - cartographer.stats.vitality),
        ];
      }),
    ).toEqual([
      [5, 100],
      [10, 200],
      [15, 300],
      [20, 400],
      [30, 600],
    ]);
    expect(holding('telemetry-hill-dome', 4).unitMarks).toEqual({});
    expect(holding('telemetry-hill-dome', 5).unitMarks).toEqual({
      the_cartographer: ['perception'],
    });
  });
});

describe('SHORTCUT', () => {
  it('halves the final clock of any journey she is part of, and nobody else’s', () => {
    expect(SHORTCUT_SHARE).toBe(0.5);
    expect(travelsWithShortcut({ razors: 10, the_cartographer: 1 })).toBe(true);
    expect(travelsWithShortcut({ razors: 10, the_cartographer: 0 })).toBe(false);
    expect(withShortcut(90_000, { the_cartographer: 1 })).toBe(45_000);
    expect(withShortcut(90_000, { razors: 1 })).toBe(90_000);
    expect(shortcutMinutes(31, { the_cartographer: 1 })).toBe(16);
    expect(shortcutMinutes(1, { the_cartographer: 1 })).toBe(1);
    expect(shortcutMinutes(0, { the_cartographer: 1 })).toBe(0);
  });
});

describe('PERCEPTION', () => {
  const sharp = holding('telemetry-hill-dome', 5);

  it('halves the stealth the other side ambushes with, while she is alive', () => {
    const ghosts = sideOf([stackOf('ghosts', 20)]);
    // The same line with her unmarked, so the only difference is PERCEPTION itself.
    const watchers = sideOf([stackOf('razors', 20), stackOf('the_cartographer', 1)]);
    const seen = sideOf([stackOf('razors', 20), stackOf('the_cartographer', 1, sharp)]);
    expect(perceives(seen)).toBe(true);
    expect(ambushShare(ghosts, seen)).toBeLessThan(ambushShare(ghosts, watchers));
    // Dead, she sees nothing.
    seen.stacks[1]!.alive = 0;
    expect(perceives(seen)).toBe(false);
    // Without the level-5 mark she does not perceive at all.
    expect(perceives(sideOf([stackOf('the_cartographer', 1)]))).toBe(false);
  });

  it('halves a runner’s stealth on the way out when the winner has her standing', () => {
    const runner = stackOf('ghosts', 5);
    const base = { pursuit: 40, lastRound: 6, away: true };
    const plain = fleeChance(runner, base);
    const watched = fleeChance(runner, { ...base, perceived: true });
    expect(watched).toBeLessThan(plain);
    expect(PERCEPTION_STEALTH_SHARE).toBe(0.5);
  });
});

describe('the Ground Array', () => {
  it('lifts the damage of Energy units 10% to 20%, and nobody else', () => {
    expect(kindsAt('telemetry-hill-array', 5)).toEqual(['damage_type_offense']);
    const kites = findUnit('kite_crews')!;
    expect(kites.stats.damageType).toBe('energy');
    const bare = effectiveStats(kites, field, side, noTerritoryEffects());
    expect(
      [1, 2, 3, 4, 5].map((level) =>
        Math.round(
          ((effectiveStats(kites, field, side, holding('telemetry-hill-array', level)).offense -
            bare.offense) /
            kites.stats.offense) *
            100,
        ),
      ),
    ).toEqual([10, 12, 14, 16, 20]);
    const razors = findUnit('razors')!;
    expect(effectiveStats(razors, field, side, holding('telemetry-hill-array', 5)).offense).toBe(
      effectiveStats(razors, field, side, noTerritoryEffects()).offense,
    );
  });
});

describe('the Technicians’ Bunkroom', () => {
  it('pays a drill bonus 10% to 50% and a session a day at level 5 alone', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('telemetry-hill-bunkroom', level).drillBonusPercent),
    ).toEqual([10, 20, 30, 40, 50]);
    expect(
      [1, 2, 3, 4, 5].map(
        (level) => holding('telemetry-hill-bunkroom', level).extraTrainingSessions,
      ),
    ).toEqual([0, 0, 0, 0, 1]);
  });

  it('rolls once per session, the same every time, at about the chance it says', () => {
    expect(drillBonusRoll('session-a', 50)).toBe(drillBonusRoll('session-a', 50));
    expect(drillBonusRoll('session-a', 0)).toBe(false);
    expect(drillBonusRoll('session-a', 100)).toBe(true);
    const hits = Array.from({ length: 2000 }, (_, at) => drillBonusRoll(`s-${at}`, 30)).filter(
      Boolean,
    ).length;
    expect(hits / 2000).toBeGreaterThan(0.26);
    expect(hits / 2000).toBeLessThan(0.34);
  });

  it('adds the extra point on top of the session’s own', () => {
    const gain = { subjectId: 'o', attribute: 'logic' as const };
    expect(applyGain(makeAttributes(20), { ...gain, extra: 1 }).logic).toBe(
      applyGain(makeAttributes(20), gain).logic + 1,
    );
  });
});

describe('Telemetry Hill held whole', () => {
  it('musters Wonders of Engineering 10% faster and 10% cheaper, and nothing else', () => {
    const unified = ATLAS_UNIFIED_BONUSES['telemetry-hill']!;
    expect(unified.title).toBe('Engineered on the Hill');
    expect(unified.bonus).toEqual({ kind: 'tier_muster', tier: 'wonder', percent: 10 });
    const whole = applyHoldBonus(noTerritoryEffects(), unified.bonus);
    expect(whole.musterCostByTier).toEqual({ wonder: 10 });
    expect(whole.musterSpeedByTier).toEqual({ wonder: 10 });
    expect(whole.unitStealthPercent).toBe(0);
  });
});

describe('level tags', () => {
  it('lists every tag a location level grants, with how to get it', () => {
    expect(levelTagsFor('snipers').map((tag) => [tag.label, tag.unlock])).toEqual([
      ['Safe Distance', 'Hold Box Nine at level 5'],
    ]);
    expect(levelTagsFor('the_cartographer').map((tag) => tag.label)).toEqual(['Perception']);
    expect(levelTagsFor('kite_crews').map((tag) => tag.label)).toEqual(['Rooftop']);
    expect(levelTagsFor('razors')).toEqual([]);
    const [second] = levelTagsFor('the_geppetto');
    expect(second?.label).toBe('Ad Hoc Army II');
    expect(levelTagGranted(second!, [{ id: 'ad_hoc_army', level: 4 }])).toBe(false);
    expect(levelTagGranted(second!, [{ id: 'ad_hoc_army', level: 5 }])).toBe(true);
  });

  /**
   * Every source that hands a unit a rule is on the card (2026-10-14): the door ladders, a
   * location leaning on its kind's list, and the perk book. The Dancer's PAPERCUT was on none of
   * them, so her card had no chip for a rule her fights ran.
   */
  it('lists the rules a door pays, by the level that pays them', () => {
    const tags = (id: string) => levelTagsFor(id).map((tag) => [tag.label, tag.unlock]);
    expect(tags('the_crimson_dancer')).toEqual([
      ['Spectacle', 'Hold The Crimson Stage at level 3'],
      ['Papercut', 'Hold The Crimson Stage at level 5'],
    ]);
    expect(tags('the_saint').map(([label]) => label)).toEqual(['Holds the Line', 'Inspiration']);
    expect(tags('juggernauts').map(([label]) => label)).toEqual(['Taunt', 'Blowout']);
    expect(tags('the_condemned')).toEqual([['Last Chance', 'Hold The Watch Cell at level 5']]);
    const [papercut] = levelTagsFor('the_crimson_dancer').filter(
      (tag) => tag.ruleId === 'papercut',
    );
    expect(levelTagGranted(papercut!, [{ id: 'spectacle' }])).toBe(false);
    expect(levelTagGranted(papercut!, [{ id: 'spectacle' }, { id: 'papercut' }])).toBe(true);
  });

  it('lists a mark off a kind list or a perk, one chip naming every way to it', () => {
    // The Barricade's Holds the Line is on the kind's list, and two placed barricades lean on it.
    const [wall, ...rest] = levelTagsFor('ironsides');
    expect(rest).toEqual([]);
    expect(wall).toMatchObject({ ruleId: 'stalwart', level: 1 });
    expect(wall?.unlock).toMatch(/^Hold .+, or hold .+$/);
    // The Kennel Master brings the Cyberhounds their Opening Volley.
    expect(levelTagsFor('cyber_dogs').map((tag) => [tag.label, tag.unlock])).toEqual([
      ['Good Boy', 'Hold The Kennels at level 5'],
      ['Opening Volley', 'An officer with the Kennel Master perk'],
    ]);
  });
});
