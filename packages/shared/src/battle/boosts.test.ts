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
  type BattleBoostSpec,
  type BoostEffect,
  type BoostUnlock,
} from './boosts.js';
import { blueprintForBattleBoost, blueprintGateMet } from '../blueprints/requirements.js';
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
    // Nothing behind a blueprint here: this case is about who proposed the boost.
    const drawn = () => true;
    const at = (unlock: BoostUnlock) => ({ id: 'b', unlock });
    expect(boostAvailable(at({ kind: 'open' }), bare, drawn)).toBe(true);
    expect(boostAvailable(at({ kind: 'tech', techId: 'tech_shaped_charges' }), bare, drawn)).toBe(
      false,
    );
    expect(boostAvailable(at({ kind: 'tech', techId: 'tech_shaped_charges' }), kitted, drawn)).toBe(
      true,
    );
    expect(boostAvailable(at({ kind: 'officer', role: 'raid_boss' }), bare, drawn)).toBe(false);
    expect(boostAvailable(at({ kind: 'officer', role: 'raid_boss' }), kitted, drawn)).toBe(true);
  });

  /**
   * §D12e: and the four that are manufactured are behind their drawings too.
   *
   * Checked before the proposer, because a crew that has the Lab project and the chair still cannot
   * make a thing nobody has the plans for. The three boosts open to anybody are unaffected, which
   * the second half asserts: a blueprint gate that answered false for everything would pass the
   * first half on its own.
   */
  it('keeps a manufactured boost shut until its blueprint is drawn', () => {
    const kitted = { technologies: ['tech_shaped_charges'], roles: ['raid_boss'] } as const;
    const gated = BATTLE_BOOSTS.filter((spec) => blueprintForBattleBoost(spec.id) !== undefined);
    const open = BATTLE_BOOSTS.filter((spec) => blueprintForBattleBoost(spec.id) === undefined);
    expect(gated.length, 'no boost is behind a blueprint at all').toBeGreaterThan(0);
    expect(open.length, 'every boost is behind a blueprint').toBeGreaterThan(0);

    /*
     * The property is that the drawings **change the answer**, and only for the four that are made.
     *
     * Asserting availability outright does not work and is how the first version of this was wrong:
     * a boost is also behind whoever proposed it, so an ungated boost the fixture crew has no chair
     * for reads false for a reason that has nothing to do with blueprints.
     */
    // The real predicate against an empty satchel, not a stub that answers false to everything:
    // `blueprintGateMet` answers **true** for anything nothing gates, and a stub that did not would
    // have made the second loop below assert the opposite of the rule.
    const nothingHeld = (boostId: string) => blueprintGateMet({}, 'battle_boost', boostId);

    for (const spec of gated) {
      expect(
        boostAvailable(spec, kitted, nothingHeld),
        `${spec.id} is bought without its blueprint`,
      ).toBe(false);
    }
    for (const spec of open) {
      expect(
        boostAvailable(spec, kitted, nothingHeld),
        `${spec.id} is gated on a blueprint it does not need`,
      ).toBe(boostAvailable(spec, kitted, () => true));
    }
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

/**
 * The shop's rate, which is the only thing separating one boost from another at the point of use.
 *
 * `boostBundle` folds every effect down to one whole-force percentage, so a player choosing between
 * two boosts is choosing between two rates. When those rates differ by a factor of seven, as they
 * did (6.5 infamy per point against 44), the shop is a right answer and nine traps.
 */
describe('every boost is sold at about the same rate', () => {
  /** Infamy per point of whole-force percentage, at the coverage the boost is built for. */
  const ratePerPoint = (spec: BattleBoostSpec): number => spec.cost / spec.effect.percent;

  const LOW = 12;
  const HIGH = 30;

  it('prices the whole shop inside one band', () => {
    for (const spec of BATTLE_BOOSTS) {
      expect(
        ratePerPoint(spec),
        `${spec.id} at ${ratePerPoint(spec).toFixed(1)}/point`,
      ).toBeGreaterThanOrEqual(LOW);
      expect(
        ratePerPoint(spec),
        `${spec.id} at ${ratePerPoint(spec).toFixed(1)}/point`,
      ).toBeLessThanOrEqual(HIGH);
    }
  });

  it('has enough spread of effect sizes for that band to mean something', () => {
    const percents = BATTLE_BOOSTS.map((spec) => spec.effect.percent);
    expect(Math.max(...percents) / Math.min(...percents)).toBeGreaterThan(3);
  });

  /**
   * The one spread inside the band that is deliberate: a boost you can only land on part of a force
   * is worth less per point than one that lands on all of it, because covering it costs you the
   * shape of your roster.
   */
  it('sells the boosts that cover everything at the keenest rate', () => {
    const meanRate = (kind: BoostEffect['kind']) => {
      const of = BATTLE_BOOSTS.filter((spec) => spec.effect.kind === kind);
      return of.reduce((total, spec) => total + ratePerPoint(spec), 0) / of.length;
    };
    expect(meanRate('force')).toBeLessThan(meanRate('tier'));
    expect(meanRate('tier')).toBeLessThan(meanRate('unit'));
  });
});
