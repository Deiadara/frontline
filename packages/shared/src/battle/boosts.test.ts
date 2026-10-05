import { describe, expect, it } from 'vitest';
import { findUnit, type Army } from '../units/index.js';
import { unitSlotsUsed } from '../units/muster.js';
import { noTerritoryEffects } from '../city/index.js';
import { bareBattlefield } from './battlefield.js';
import { simulate } from './engine.js';
import {
  BATTLE_BOOSTS,
  boostAvailable,
  boostBundle,
  boostCoverage,
  describeBoostEffect,
  describeBoostUnlock,
  findBattleBoost,
  mergeAimed,
  type BoostEffect,
  type BoostUnlock,
} from './boosts.js';
import { blueprintForBattleBoost, blueprintGateMet } from '../blueprints/requirements.js';
import { infamyForKill } from '../economy/infamy.js';
import { notorietySpentTo } from '../economy/notoriety.js';

describe('what a name buys (§D7)', () => {
  it('offers something to anybody, and keeps the rest behind a reason', () => {
    const open = BATTLE_BOOSTS.filter((spec) => spec.unlock.kind === 'open');
    expect(open.length).toBeGreaterThanOrEqual(3);
    expect(BATTLE_BOOSTS.some((spec) => spec.unlock.kind === 'officer')).toBe(true);
  });

  it('points every gated boost at something that exists', () => {
    for (const spec of BATTLE_BOOSTS) {
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
    expect(describeBoostUnlock({ kind: 'open' })).toBe('');
    expect(describeBoostUnlock({ kind: 'officer', role: 'raid_boss' })).toBe(
      'Proposed by your Raid Boss',
    );
  });

  it('opens a boost only for the crew that has the officer who proposes it', () => {
    const bare = { roles: [] } as const;
    const kitted = { roles: ['raid_boss'] } as const;
    // Nothing behind a blueprint here: this case is about who proposed the boost.
    const drawn = () => true;
    const at = (unlock: BoostUnlock) => ({ id: 'b', unlock });
    expect(boostAvailable(at({ kind: 'open' }), bare, drawn)).toBe(true);
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
    const kitted = { roles: ['raid_boss'] } as const;
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
    // The real predicate against an empty inventory, not a stub that answers false to everything:
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

/**
 * The three boosts a Lab rung used to propose (maintainer, 2026-10-01: "have the traps just be
 * unlocked by blueprints", read for the boosts those rungs opened too). A crew with no research
 * and no chair buys each one the moment it holds the drawings, and not before.
 */
describe('the boosts the Lab used to propose', () => {
  const MADE = ['boost_plated_overnight', 'boost_shaped_for_this', 'boost_the_colossus_walks'];

  it.each(MADE)('opens %s on its blueprint alone', (id) => {
    const spec = findBattleBoost(id);
    if (!spec) throw new Error(`no ${id}`);
    const nobody = { roles: [] } as const;
    expect(spec.unlock.kind).toBe('blueprint');
    expect(blueprintForBattleBoost(id), `${id} has no drawings to open it`).toBeDefined();
    expect(boostAvailable(spec, nobody, () => true)).toBe(true);
    expect(boostAvailable(spec, nobody, () => false)).toBe(false);
    expect(describeBoostUnlock(spec.unlock)).toBe('');
  });
});

describe('how far a boost reaches', () => {
  it('covers everything for a whole-force boost, including an empty field', () => {
    expect(boostCoverage({ kind: 'force', stat: 'offense', percent: 10 }, { razors: 5 })).toBe(1);
    expect(boostCoverage({ kind: 'force', stat: 'offense', percent: 10 }, {})).toBe(0);
  });

  /**
   * Heads, not unit slots (maintainer, 2026-09-15).
   *
   * This was the one place inside the engine that read a slot cost, and it made a narrow boost on
   * the heavy end reach more of a line than the line actually contained. A unit slot prices what a
   * sheet costs to house, to carry and to kill; it says nothing about a battlefield, and combat
   * width, nerve, menace and targeting have always counted the things standing there.
   *
   * Four Razors beside one Juggernaut is one head in five, whatever the Juggernaut eats. The old
   * weighting is asserted as the control, so a reader that went back to it fails here rather than
   * landing on the same number by luck.
   */
  it('weighs a slice by head count and not by unit slots', () => {
    const razor = findUnit('razors')!;
    const juggernaut = findUnit('juggernauts')!;
    const force = { razors: 4, juggernauts: 1 };
    const covered = boostCoverage(
      { kind: 'tier', tier: 'heavy', stat: 'defense', percent: 30 },
      force,
    );
    expect(covered).toBeCloseTo(1 / 5, 6);

    // The control: the two arithmetics genuinely differ on this force, so the assertion above is
    // measuring the rule rather than agreeing with both at once.
    const bySlots = juggernaut.unitSlots / (4 * razor.unitSlots + juggernaut.unitSlots);
    expect(bySlots).toBeGreaterThan(1 / 5);
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

  /**
   * A porter is not standing anywhere a boost can reach.
   *
   * `standsInLine` keeps a support sheet out of the round loop entirely, and counting it here
   * divided every narrow boost by whoever was carrying the loot: ten Ironsides behind forty
   * Scavengers turned a bought "+35% defence for your heavy units" into +7% on the force, at full
   * price, for owning porters. The crew that fields its porters says so through `carriersFight`,
   * so the two readings of "who is on the field" stay one reading.
   */
  it('counts the line and not the people carrying the loot', () => {
    const effect = { kind: 'tier', tier: 'heavy', stat: 'defense', percent: 35 } as const;
    const withPorters = { ironsides: 10, scavengers: 40 };
    expect(findUnit('scavengers')!.combat, 'the premise: a porter does not fight').not.toBe(true);

    expect(boostCoverage(effect, withPorters)).toBeCloseTo(
      boostCoverage(effect, { ironsides: 10 }),
      6,
    );

    // ...and a crew whose porters do fight is counted the way its fight is: they dilute it again.
    const fighting = boostCoverage(effect, withPorters, { carriersFight: true, unitMarks: {} });
    expect(fighting).toBeCloseTo(10 / 50, 6);
    expect(fighting).toBeLessThan(boostCoverage(effect, withPorters));
  });

  it('ignores a unit id nothing answers to rather than counting it', () => {
    expect(
      boostCoverage({ kind: 'force', stat: 'offense', percent: 10 }, { a_retired_unit: 4 }),
    ).toBe(0);
  });
});

describe('what the engine is handed', () => {
  it('lands a narrow boost on the units it names, at its full percentage (P10-C)', () => {
    const force = { razors: 40, the_colossus: 1 };
    const colossus = boostBundle(
      { kind: 'unit', unitId: 'the_colossus', stat: 'offense', percent: 50 },
      force,
    );
    // It was +1.22% for all forty-one, by head count, most of it on the Razors.
    expect(colossus.offensePercent).toBe(0);
    expect(colossus.aimed.unitKindPercent).toEqual({ the_colossus: { offense: 50 } });
    const plated = boostBundle(
      { kind: 'tier', tier: 'heavy', stat: 'defense', percent: 35 },
      force,
    );
    expect(plated.defensePercent).toBe(0);
    expect(plated.aimed.unitTierPercent).toEqual({ heavy: { vitality: 35 } });
  });

  it('still folds a morale boost aimed at a slice, since nerve has no per-unit channel', () => {
    const force = { razors: 4, juggernauts: 1 };
    const effect = { kind: 'tier', tier: 'heavy', stat: 'morale', percent: 40 } as const;
    const bundle = boostBundle(effect, force);
    expect(bundle.moralePercent).toBeCloseTo(boostCoverage(effect, force) * 40, 6);
    expect(bundle.aimed).toEqual({ unitTierPercent: {}, unitKindPercent: {} });
  });

  it('puts a whole-force boost on its own channel at full strength', () => {
    expect(boostBundle({ kind: 'force', stat: 'defense', percent: 15 }, { razors: 3 })).toEqual({
      offensePercent: 0,
      defensePercent: 15,
      moralePercent: 0,
      aimed: { unitTierPercent: {}, unitKindPercent: {} },
    });
  });

  it('adds two aimed names the way two names always stack', () => {
    const a = boostBundle({ kind: 'tier', tier: 'heavy', stat: 'offense', percent: 32 }, {});
    const b = boostBundle({ kind: 'tier', tier: 'heavy', stat: 'defense', percent: 35 }, {});
    expect(mergeAimed(a.aimed, mergeAimed(a.aimed, b.aimed)).unitTierPercent).toEqual({
      heavy: { offense: 64, vitality: 35 },
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
   *
   * A career is the ladder: `infamy.ts` says most of a crew's earnings go on rank. Since the ladder
   * was repriced (2026-09-28) the rung a legend asks for is a few weeks of fighting, and a career
   * is the tenth rung, the one a fighting crew reaches around the late game.
   */
  const CAREER_RUNG = 10;
  it('prices the shelf on the scale a real fight earns', () => {
    const cheapest = Math.min(...BATTLE_BOOSTS.map((spec) => spec.cost));
    const dearest = Math.max(...BATTLE_BOOSTS.map((spec) => spec.cost));
    expect(cheapest).toBeGreaterThan(20 * infamyForKill('razors'));
    expect(dearest).toBeLessThan(notorietySpentTo(CAREER_RUNG));
  });
});

/**
 * The shop's rate, measured in the engine (maintainer ruling P10-C, 2026-10-02).
 *
 * A narrow boost lands on the units it names, so its label says nothing about how much fight it
 * buys: +32% attack on Ironsides, which barely shoot, is less than +12% on everything. Each narrow
 * name is measured on a line built around it (its slice half the line by unit slots, Razors or
 * Wardens for the rest), against Razor lines of 1.4, 1.8 and 2.4 times its slots, and compared
 * with what the open name of the same stat adds to the same fights.
 *
 * Measured on the share of the defenders killed rather than on the win rate. The first version
 * read the win rate, and a Colossus line won every fight boosted by anything from +25%, so the
 * measurement topped out at the open name's price and said nothing about the Colossus (review,
 * 2026-10-02). The share killed keeps moving when the fight is won or lost every time, and the
 * test refuses a line where half the percentage buys as much as the whole.
 */
describe('every boost is sold at about the same rate', () => {
  const SEEDS = 200;
  const BUILT_FOR: Record<string, Army> = {
    boost_paid_in_advance: { razors: 30, wardens: 15 },
    boost_drilled_all_week: { kite_crews: 15, razors: 30 },
    boost_the_right_doors: { snipers: 15, razors: 30 },
    boost_plated_overnight: { juggernauts: 3, ironsides: 4, razors: 30 },
    boost_shaped_for_this: { juggernauts: 3, ironsides: 4, razors: 30 },
    boost_they_came_for_this: { the_colossus: 1, razors: 12 },
    boost_the_colossus_walks: { the_colossus: 1, razors: 12 },
  };
  const ODDS = [1.4, 1.8, 2.4];

  /** The mean share of the defending Razors killed, summed over the three sizes of defence. */
  const killed = (force: Army, effect?: BoostEffect): number => {
    const bundle = effect ? boostBundle(effect, force) : undefined;
    const territory = {
      ...noTerritoryEffects(),
      unitOffensePercent: bundle?.offensePercent ?? 0,
      unitVitalityPercent: bundle?.defensePercent ?? 0,
      unitMoraleFlat: bundle?.moralePercent ?? 0,
      unitTierPercent: bundle?.aimed.unitTierPercent ?? {},
      unitKindPercent: bundle?.aimed.unitKindPercent ?? {},
    };
    let total = 0;
    for (const odds of ODDS) {
      const defenders = Math.round(unitSlotsUsed(force) * odds);
      for (let i = 0; i < SEEDS; i += 1) {
        const sim = simulate({
          seed: `price-${i}`,
          battlefield: bareBattlefield(),
          attacker: { name: 'A', army: force, defending: false, territory },
          defender: { name: 'D', army: { razors: defenders }, defending: true },
        });
        const dead = sim.defender.stacks.reduce(
          (sum, stack) => sum + stack.started - stack.alive,
          0,
        );
        total += dead / defenders / SEEDS;
      }
    }
    return total;
  };

  it('has a built-for line for every narrow name, so none is priced off its label', () => {
    const narrow = BATTLE_BOOSTS.filter((spec) => spec.effect.kind !== 'force');
    expect(narrow.map((spec) => spec.id).sort()).toEqual(Object.keys(BUILT_FOR).sort());
  });

  it('prices every narrow name within a band of the open name of its stat', () => {
    for (const spec of BATTLE_BOOSTS.filter((one) => one.effect.kind !== 'force')) {
      const force = BUILT_FOR[spec.id]!;
      const open = BATTLE_BOOSTS.find(
        (one) => one.effect.kind === 'force' && one.effect.stat === spec.effect.stat,
      )!;
      const base = killed(force);
      const lift = killed(force, spec.effect) - base;
      const halfLift = killed(force, { ...spec.effect, percent: spec.effect.percent / 2 }) - base;
      const fair = (open.cost * lift) / (killed(force, open.effect) - base);
      const reading = `${spec.id} costs ${spec.cost}, measured at ${Math.round(fair)}`;
      expect(halfLift, `${spec.id}: the measurement is saturated`).toBeLessThan(lift * 0.85);
      expect(spec.cost, reading).toBeGreaterThan(fair * 0.7);
      expect(spec.cost, reading).toBeLessThan(fair * 1.4);
    }
  });

  it('has enough spread of effect sizes for the shelf to be a choice', () => {
    const percents = BATTLE_BOOSTS.map((spec) => spec.effect.percent);
    expect(Math.max(...percents) / Math.min(...percents)).toBeGreaterThan(3);
  });
});
