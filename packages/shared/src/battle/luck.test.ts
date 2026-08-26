import { describe, expect, it } from 'vitest';
import { noTerritoryEffects } from '../city/index.js';
import { findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { simulate } from './engine.js';
import {
  describeLuck,
  drawLuck,
  LUCK_LIMIT,
  LUCK_STEP,
  LUCK_VALUES,
  luckyPenetrationPoints,
  luckyFleeChance,
} from './luck.js';
import { exchange, armorMultiplier } from './matchup.js';
import { mulberry32 } from './rng.js';
import { fleeChance } from './rout.js';

/**
 * The day's luck.
 *
 * Small, drawn late, and touching exactly two things. Each of those three properties is a separate
 * test, because each is a promise: a player who could plan around luck would wait for a good roll,
 * one who could be beaten by it would stop planning at all, and one who found it in the damage
 * numbers would not be able to tell it from the counter system.
 */

const unit = (id: string) => {
  const found = findUnit(id);
  if (!found) throw new Error(id);
  return found;
};

const bare = (id: string) =>
  effectiveStats(
    unit(id),
    bareBattlefield(),
    { defending: false, outnumbered: false },
    noTerritoryEffects(),
  );

describe('the draw', () => {
  it('never leaves the declared range', () => {
    const next = mulberry32(1234);
    for (let i = 0; i < 4000; i += 1) {
      const luck = drawLuck(next);
      expect(luck).toBeGreaterThanOrEqual(-LUCK_LIMIT);
      expect(luck).toBeLessThanOrEqual(LUCK_LIMIT);
    }
  });

  it('lands on tenths, and only on tenths', () => {
    const next = mulberry32(99);
    for (let i = 0; i < 2000; i += 1) {
      const luck = drawLuck(next);
      // ×10 must be a whole number: the whole reason the draw rounds through integers.
      expect(Math.abs(luck * 10 - Math.round(luck * 10))).toBeLessThan(1e-9);
    }
  });

  it('can reach both ends and the middle', () => {
    const seen = new Set<number>();
    const next = mulberry32(7);
    for (let i = 0; i < 20000; i += 1) seen.add(drawLuck(next));
    expect(seen.has(LUCK_LIMIT)).toBe(true);
    expect(seen.has(-LUCK_LIMIT)).toBe(true);
    expect(seen.has(0)).toBe(true);
    // Every tenth in the range is reachable; none outside it is.
    expect(seen.size).toBe(LUCK_VALUES);
  });

  it('is even-handed over many draws', () => {
    const next = mulberry32(2026);
    let total = 0;
    const draws = 20000;
    for (let i = 0; i < draws; i += 1) total += drawLuck(next);
    expect(Math.abs(total / draws)).toBeLessThan(0.15);
  });

  it('survives a generator pinned at either extreme', () => {
    expect(drawLuck(() => 0)).toBe(-LUCK_LIMIT);
    // `Math.random` never returns 1, but a stub can, and it must not fall off the end.
    expect(drawLuck(() => 1)).toBe(LUCK_LIMIT);
    expect(drawLuck(() => 0.999999999)).toBe(LUCK_LIMIT);
  });

  it('reads back the way a player would say it', () => {
    expect(describeLuck(0)).toBe('even');
    expect(describeLuck(2.4)).toBe('+2.4%');
    expect(describeLuck(-0.7)).toBe('-0.7%');
    expect(LUCK_STEP).toBe(0.1);
  });
});

describe('luck moves how far a hit gets through armour', () => {
  /*
   * Measured against something *wearing* armour, which is the whole shape of the stat now. Luck
   * rides on penetration, penetration cancels armour, so a lucky day against a target in rags is
   * worth nothing at all: the first version of this test used a lightly-armoured target and could
   * not tell the new mechanic from a broken one.
   */
  const ARMOURED = 'juggernauts';

  it('pays a lucky unit more damage than an unlucky one, against armour', () => {
    const razors = bare('razors');
    const target = bare(ARMOURED);
    const at = (luck: number) =>
      exchange(razors, unit('razors').modifiers, target, target.morale, luck).perBody;

    expect(at(LUCK_LIMIT)).toBeGreaterThan(at(0));
    expect(at(0)).toBeGreaterThan(at(-LUCK_LIMIT));
  });

  it('is worth nothing at all against a target with no armour to get through', () => {
    const razors = bare('razors');
    const bare_target = { ...bare('sparks'), armor: 0 };
    const at = (luck: number) =>
      exchange(razors, unit('razors').modifiers, bare_target, bare_target.morale, luck).perBody;
    expect(at(LUCK_LIMIT)).toBeCloseTo(at(0), 10);
  });

  /**
   * Points, not a multiplier. A Razor gains meaningfully from a perfect roll; a Specter that
   * already cancels most of a target's plate barely notices. Multiplying would invert that and
   * hand the luck to the units that need it least.
   */
  it('is worth proportionally more to a unit with little penetration', () => {
    const gain = (id: string) => {
      const attacker = bare(id);
      const target = bare(ARMOURED);
      const modifiers = unit(id).modifiers;
      const lucky = exchange(attacker, modifiers, target, target.morale, LUCK_LIMIT).perBody;
      const plain = exchange(attacker, modifiers, target, target.morale, 0).perBody;
      return lucky / plain;
    };
    expect(gain('razors')).toBeGreaterThan(gain('the_specter'));
  });

  it('never lets penetration take armour below nothing', () => {
    // A unit that out-penetrates the plate entirely gets the unarmoured multiplier and no more:
    // armour cannot go negative and start *adding* damage.
    expect(armorMultiplier(10, 40)).toBe(armorMultiplier(0, 0));
    expect(armorMultiplier(10, 40)).toBe(1);
  });

  it('is worth its face value in points of penetration', () => {
    expect(luckyPenetrationPoints(3.2)).toBe(3.2);
    expect(luckyPenetrationPoints(-4.1)).toBe(-4.1);
    // ...and cannot be smuggled past the limit by a caller passing a bigger number.
    expect(luckyPenetrationPoints(50)).toBe(LUCK_LIMIT);
    expect(luckyPenetrationPoints(-50)).toBe(-LUCK_LIMIT);
  });
});

describe('luck makes a losing side likelier to get away', () => {
  const stack = (id: string) => {
    const spec = unit(id);
    return {
      unit: spec,
      effective: bare(id),
      alive: 10,
      pool: 10 * spec.stats.vitality,
      morale: spec.stats.morale,
      brokeAt: null,
      started: 10,
      dealt: 0,
    };
  };
  const context = { pursuit: 55, lastRound: 6, away: false };

  it('gets more of a lucky crew clear than an unlucky one', () => {
    const razors = stack('razors');
    expect(fleeChance(razors, { ...context, luck: LUCK_LIMIT })).toBeGreaterThan(
      fleeChance(razors, { ...context, luck: -LUCK_LIMIT }),
    );
  });

  it('is worth its face value as a fraction', () => {
    const razors = stack('razors');
    const even = fleeChance(razors, { ...context, luck: 0 });
    expect(fleeChance(razors, { ...context, luck: 2 })).toBeCloseTo(even + 0.02, 6);
    expect(luckyFleeChance(2.5)).toBeCloseTo(0.025, 9);
  });

  it('treats a missing roll as no luck at all', () => {
    const razors = stack('razors');
    expect(fleeChance(razors, context)).toBe(fleeChance(razors, { ...context, luck: 0 }));
  });

  it('still cannot make escape certain', () => {
    const reavers = stack('road_reavers');
    expect(
      fleeChance(reavers, { pursuit: 0, lastRound: 1, away: false, luck: LUCK_LIMIT }),
    ).toBeLessThan(1);
  });
});

describe('when the luck is drawn', () => {
  /**
   * After both forces are committed. Drawn any earlier and a player could wait for a good roll,
   * which is the failure mode this ordering exists to prevent.
   */
  it('reports a roll for both sides of every fight', () => {
    const simulation = simulate({
      seed: 'when',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: { razors: 20 }, defending: false },
      defender: { name: 'D', army: { razors: 20 }, defending: true },
    });
    for (const luck of [simulation.luck.attacker, simulation.luck.defender]) {
      expect(luck).toBeGreaterThanOrEqual(-LUCK_LIMIT);
      expect(luck).toBeLessThanOrEqual(LUCK_LIMIT);
    }
  });

  it('does not depend on what the other side brought', () => {
    const rollFor = (defending: Record<string, number>) =>
      simulate({
        seed: 'independent',
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { razors: 20 }, defending: false },
        defender: { name: 'D', army: defending, defending: true },
      }).luck.attacker;
    // The defender's roster changes; the attacker's luck is drawn from the same point in the
    // stream either way, so it must not move.
    expect(rollFor({ razors: 20 })).toBe(rollFor({ wardens: 8, snipers: 4 }));
  });

  it('gives the two sides independent rolls', () => {
    const pairs = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const simulation = simulate({
        seed: `pair-${seed}`,
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { razors: 12 }, defending: false },
        defender: { name: 'D', army: { razors: 12 }, defending: true },
      });
      pairs.add(`${simulation.luck.attacker}/${simulation.luck.defender}`);
      expect(simulation.luck.attacker).not.toBe(NaN);
    }
    // If both sides shared one roll every pair would read `x/x`.
    expect([...pairs].some((pair) => pair.split('/')[0] !== pair.split('/')[1])).toBe(true);
  });

  it('replays identically from the same seed', () => {
    const roll = () =>
      simulate({
        seed: 'replay-luck',
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { razors: 15 }, defending: false },
        defender: { name: 'D', army: { razors: 15 }, defending: true },
      }).luck;
    expect(roll()).toEqual(roll());
  });
});
