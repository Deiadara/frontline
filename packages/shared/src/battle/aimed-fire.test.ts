import { describe, expect, it } from 'vitest';
import { findUnit } from '../units/index.js';
import { noTerritoryEffects } from '../city/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { AIMED_FIRE_SHARE, allocate, tauntPull, type Stack } from './engine.js';

/**
 * Half the fire where it does the most harm, half at whoever is in front (maintainer,
 * 2026-10-13), and FOCUS sheets aiming all of it.
 *
 * The counter system used to decide the whole split: a stack that was a poor target by damage per
 * point of health was walked past however many of it stood there. Now the line sends half its fire
 * by bodies, so nothing is ignored for being hard to hurt, and the Snipers, the Scrapers and the
 * Loose End keep picking their targets.
 */

const field = bareBattlefield();
const side = { defending: false, outnumbered: 0 };

function stackOf(id: string, alive: number): Stack {
  const spec = findUnit(id)!;
  const effective = effectiveStats(spec, field, side, noTerritoryEffects());
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

const aimed = (stack: Stack): Stack => ({ ...stack, unit: { ...stack.unit, focus: true } });
const shareOn = (parts: { target: Stack; share: number }[], id: string): number =>
  parts.filter((part) => part.target.unit.id === id).reduce((sum, part) => sum + part.share, 0);

describe('where a stack sends its fire', () => {
  it('is one in two by threat and one in two by bodies', () => {
    expect(AIMED_FIRE_SHARE).toBe(0.5);
    expect(findUnit('snipers')!.focus).toBe(true);
    expect(findUnit('scrapers')!.focus).toBe(true);
    expect(findUnit('the_loose_end')!.focus).toBe(true);
    expect(findUnit('razors')!.focus).toBeUndefined();
  });

  it('is the focused split and the body split added, half each', () => {
    // Ten Razors beside ten Wardens (no TAUNT, so nothing is taken off the top): by threat
    // the two are not the same target, by bodies they are. A FOCUS shooter sends the whole of its
    // fire by threat; a plain shooter sends half of it that way and half by bodies.
    const shooter = stackOf('razors', 10);
    const line = [stackOf('razors', 10), stackOf('wardens', 10)];
    expect(line.some((stack) => stack.unit.taunts === true)).toBe(false);
    const focused = shareOn(allocate(aimed(shooter), line), 'wardens');
    const blended = shareOn(allocate(shooter, line), 'wardens');
    const bodyShare = 10 / 20;
    // A guard on the fixture: with equal threat the blend would equal both and prove nothing.
    expect(Math.abs(focused - bodyShare)).toBeGreaterThan(0.05);
    expect(blended).toBeCloseTo(AIMED_FIRE_SHARE * focused + (1 - AIMED_FIRE_SHARE) * bodyShare, 9);
  });

  it('weighs the body half by how many stand, not by how many stacks there are', () => {
    const shooter = stackOf('razors', 10);
    const many = stackOf('razors', 30);
    const few = stackOf('razors', 10);
    const parts = allocate(shooter, [many, few]);
    // Same sheet on both, so threat per body is equal and both halves say the same thing: three
    // to one, never one to one.
    expect(shareOn(parts, 'razors')).toBeCloseTo(1, 9);
    expect(parts.find((part) => part.target === many)!.share).toBeCloseTo(0.75, 9);
    expect(parts.find((part) => part.target === few)!.share).toBeCloseTo(0.25, 9);
  });

  it('always adds up to the whole of the fire', () => {
    const shooter = stackOf('razors', 10);
    const line = [stackOf('razors', 7), stackOf('ironsides', 3), stackOf('wardens', 5)];
    const total = allocate(shooter, line).reduce((sum, part) => sum + part.share, 0);
    expect(total).toBeCloseTo(1, 9);
    const focusedTotal = allocate(aimed(shooter), line).reduce((sum, part) => sum + part.share, 0);
    expect(focusedTotal).toBeCloseTo(1, 9);
  });

  it('takes the TAUNT pull off the top before either half is split', () => {
    const shooter = stackOf('razors', 10);
    const wall = stackOf('ironsides', 10);
    const behind = stackOf('snipers', 10);
    expect(wall.unit.taunts).toBe(true);
    const parts = allocate(shooter, [wall, behind]);
    expect(shareOn(parts, 'ironsides')).toBeCloseTo(tauntPull([wall, behind]), 9);
    expect(shareOn(allocate(aimed(shooter), [wall, behind]), 'ironsides')).toBeCloseTo(
      tauntPull([wall, behind]),
      9,
    );
  });
});
