import { describe, expect, it } from 'vitest';
import { findUnit } from '../units/index.js';
import {
  BATTLE_BOOSTS,
  boostAvailable,
  boostBundle,
  boostCoverage,
  describeBoostEffect,
  describeBoostUnlock,
  findBattleBoost,
} from './boosts.js';
import { findTech } from '../research/tech.js';
import { infamyForKill } from '../economy/infamy.js';

const techName = (id: string): string => findTech(id)?.name ?? id;

describe('what a name buys (§D7)', () => {
  it('offers something to anybody, and keeps the rest behind a reason', () => {
    const open = BATTLE_BOOSTS.filter((spec) => spec.unlock.kind === 'open');
    expect(open.length).toBeGreaterThanOrEqual(3);
    expect(BATTLE_BOOSTS.some((spec) => spec.unlock.kind === 'tech')).toBe(true);
    expect(BATTLE_BOOSTS.some((spec) => spec.unlock.kind === 'officer')).toBe(true);
  });

  it('points every gated boost at something that exists', () => {
    for (const spec of BATTLE_BOOSTS) {
      if (spec.unlock.kind === 'tech') {
        expect(findTech(spec.unlock.techId), spec.id).toBeDefined();
      }
      if (spec.effect.kind === 'unit') {
        expect(findUnit(spec.effect.unitId), spec.id).toBeDefined();
      }
      expect(findBattleBoost(spec.id)).toBe(spec);
    }
  });

  /**
   * The board's complaint about the old sinks, pinned: "+20 offense" says nothing a player can
   * check. Every line here has to name a percentage and who it lands on.
   */
  it('describes every effect as a percentage of something nameable', () => {
    for (const spec of BATTLE_BOOSTS) {
      const line = describeBoostEffect(spec.effect);
      expect(line, spec.id).toMatch(/^[+-]\d+% (attack|defence|morale) for /);
    }
  });

  it('says where a gated boost came from, and nothing at all for an open one', () => {
    expect(describeBoostUnlock({ kind: 'open' }, techName)).toBe('');
    expect(describeBoostUnlock({ kind: 'officer', role: 'raid_boss' }, techName)).toBe(
      'Proposed by your Raid Boss',
    );
    expect(describeBoostUnlock({ kind: 'tech', techId: 'tech_shaped_charges' }, techName)).toBe(
      'Proposed by the Lab: Shaped Charges',
    );
  });

  it('opens a boost only for the crew that has the technology or the officer', () => {
    const bare = { technologies: [], roles: [] } as const;
    const kitted = { technologies: ['tech_shaped_charges'], roles: ['raid_boss'] } as const;
    expect(boostAvailable({ kind: 'open' }, bare)).toBe(true);
    expect(boostAvailable({ kind: 'tech', techId: 'tech_shaped_charges' }, bare)).toBe(false);
    expect(boostAvailable({ kind: 'tech', techId: 'tech_shaped_charges' }, kitted)).toBe(true);
    expect(boostAvailable({ kind: 'officer', role: 'raid_boss' }, bare)).toBe(false);
    expect(boostAvailable({ kind: 'officer', role: 'raid_boss' }, kitted)).toBe(true);
  });
});

describe('how far a boost reaches', () => {
  it('covers everything for a whole-force boost, including an empty field', () => {
    expect(boostCoverage({ kind: 'force', stat: 'offense', percent: 10 }, { razors: 5 })).toBe(1);
    expect(boostCoverage({ kind: 'force', stat: 'offense', percent: 10 }, {})).toBe(0);
  });

  it('weighs a slice by supply rather than by headcount', () => {
    // Four Razors (supply 1 each) beside one Juggernaut. By bodies the heavy end is a fifth of the
    // force; by what it eats it is a good deal more, and that is what a battlefield notices.
    const razor = findUnit('razors')!;
    const juggernaut = findUnit('juggernauts')!;
    const force = { razors: 4, juggernauts: 1 };
    const covered = boostCoverage(
      { kind: 'tier', tier: 'heavy', stat: 'defense', percent: 30 },
      force,
    );
    expect(covered).toBeCloseTo(juggernaut.supply / (4 * razor.supply + juggernaut.supply), 6);
    expect(covered).toBeGreaterThan(1 / 5);
  });

  it('reaches nothing when the force has none of what it boosts', () => {
    expect(
      boostCoverage(
        { kind: 'tier', tier: 'legendary', stat: 'offense', percent: 25 },
        { razors: 9 },
      ),
    ).toBe(0);
    expect(
      boostCoverage({ kind: 'unit', unitId: 'the_colossus', stat: 'offense', percent: 50 }, {}),
    ).toBe(0);
  });

  it('ignores a unit id nothing answers to rather than counting it', () => {
    expect(
      boostCoverage({ kind: 'force', stat: 'offense', percent: 10 }, { a_retired_unit: 4 }),
    ).toBe(0);
  });
});

describe('what the engine is handed', () => {
  it('folds a narrow boost down to what it actually reaches', () => {
    const force = { razors: 4, juggernauts: 1 };
    const effect = { kind: 'tier', tier: 'heavy', stat: 'offense', percent: 40 } as const;
    const bundle = boostBundle(effect, force);
    expect(bundle.offensePercent).toBeCloseTo(boostCoverage(effect, force) * 40, 6);
    expect(bundle.defensePercent).toBe(0);
    expect(bundle.moralePercent).toBe(0);
  });

  it('puts a whole-force boost on its own channel at full strength', () => {
    expect(boostBundle({ kind: 'force', stat: 'defense', percent: 15 }, { razors: 3 })).toEqual({
      offensePercent: 0,
      defensePercent: 15,
      moralePercent: 0,
    });
  });

  /**
   * A narrow boost is worth more per point than a broad one, or the drop-down has one right answer.
   * Compared at the force each is aimed at, which is the only comparison a player would make.
   */
  it('pays a narrower boost a bigger percentage than a broader one', () => {
    const broad = BATTLE_BOOSTS.find((spec) => spec.effect.kind === 'force')!;
    const narrow = BATTLE_BOOSTS.find((spec) => spec.effect.kind === 'unit')!;
    expect(narrow.effect.percent).toBeGreaterThan(broad.effect.percent);
  });

  /**
   * Priced against the fights that pay for them. The cheapest boost has to be worth more than a
   * skirmish against rabble and less than a career, or the sink is either free or decorative.
   */
  it('prices the shelf on the scale a real fight earns', () => {
    const cheapest = Math.min(...BATTLE_BOOSTS.map((spec) => spec.cost));
    const dearest = Math.max(...BATTLE_BOOSTS.map((spec) => spec.cost));
    expect(cheapest).toBeGreaterThan(20 * infamyForKill('razors'));
    expect(dearest).toBeLessThan(20 * infamyForKill('the_colossus'));
  });
});
