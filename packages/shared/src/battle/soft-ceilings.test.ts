import { describe, expect, it } from 'vitest';
import { noTerritoryEffects } from '../city/index.js';
import { findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { HELD_DEFENSE_CEILING, HELD_DEFENSE_KNEE, effectiveStats, heldDefense } from './effects.js';
import { COHESION_CEILING, COHESION_KNEE, cohesionWidening, effectiveFrontage } from './engine.js';

/**
 * Held-ground toughness and cohesion bend instead of stopping (maintainer, 2026-10-01).
 *
 * Both were a `min`: 65 points of toughness and +50% frontage. A level 20 Gate filled 50 of the
 * first alone and two officers with the Organiser signature passed the second, so Strategy, every
 * defence and Gate perk and every cohesion perk past the line bought nothing. The rule now is the
 * medics' rule: every point adds something, less than the one before, and nothing reaches the
 * ceiling. The anchors below are written out so a retune has to be made here as well.
 */
const SWEEP = Array.from({ length: 301 }, (_, i) => i);

describe('held-ground toughness', () => {
  it('pays in full up to the knee, where every ordinary defender sits', () => {
    for (const x of [0, 10, 25, 50, HELD_DEFENSE_KNEE]) expect(heldDefense(x)).toBe(x);
  });

  it('barely moves the old ceiling, and keeps paying past it', () => {
    expect(heldDefense(65)).toBeCloseTo(63.5, 1);
    expect(heldDefense(100)).toBeCloseTo(78.3, 1);
    expect(heldDefense(150)).toBeLessThan(HELD_DEFENSE_CEILING);
  });

  it('is strictly increasing over the whole reachable range', () => {
    for (const x of SWEEP.slice(1)) expect(heldDefense(x)).toBeGreaterThan(heldDefense(x - 1));
  });

  it('reaches the engine: a defender with more held ground is tougher, however much it has', () => {
    // Razors rather than Wardens since 2026-10-07: the Wardens carry GUARD now, which is +25
    // toughness on the defence *outside* the held-ground curve, and this test is about the curve.
    const unit = findUnit('razors')!;
    const vitality = (defensePercent: number) =>
      effectiveStats(
        unit,
        bareBattlefield(),
        { defending: true, outnumbered: 0 },
        { ...noTerritoryEffects(), defensePercent },
      ).vitality;
    for (const x of [60, 80, 120, 200, 300]) expect(vitality(x)).toBeGreaterThan(vitality(x - 5));
    expect(vitality(300)).toBeLessThan(unit.stats.vitality * (1 + HELD_DEFENSE_CEILING / 100));
  });
});

describe('cohesion', () => {
  it('pays in full up to the knee', () => {
    for (const x of [0, 20, COHESION_KNEE]) expect(cohesionWidening(x)).toBe(x);
  });

  it('barely moves the old ceiling, and keeps paying past it', () => {
    expect(cohesionWidening(50)).toBeCloseTo(49.4, 1);
    expect(cohesionWidening(100)).toBeCloseTo(63.7, 1);
    expect(cohesionWidening(300)).toBeLessThan(COHESION_CEILING);
  });

  it('is strictly increasing, and so is the front it buys', () => {
    for (const x of SWEEP.slice(1)) {
      expect(cohesionWidening(x)).toBeGreaterThan(cohesionWidening(x - 1));
    }
    const front = (cohesionPercent: number) =>
      effectiveFrontage({ stacks: [], cohesionPercent } as never, 20);
    for (const x of [50, 75, 100, 200]) expect(front(x)).toBeGreaterThan(front(x - 5));
  });
});
