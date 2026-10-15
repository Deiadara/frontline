import { describe, expect, it } from 'vitest';
import { noCrewEffects } from '../crew/effects.js';
import { findUnit } from '../units/catalog.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';

/**
 * The faction table's Ace and King in a fight (maintainer, 2026-10-15): the Ace's damage on the
 * attacking side only, the King's vitality on the defending side only.
 */

const razors = findUnit('razors')!;
const field = bareBattlefield();
const attacking = { defending: false, outnumbered: 0 };
const defending = { defending: true, outnumbered: 0 };

describe('the table in a fight', () => {
  it('lands the Ace on damage when attacking, and nowhere when defending', () => {
    const bare = noCrewEffects();
    const ace = { ...noCrewEffects(), tableAttackOffensePercent: 10 };
    expect(effectiveStats(razors, field, attacking, ace).offense).toBeCloseTo(
      effectiveStats(razors, field, attacking, bare).offense * 1.1,
      9,
    );
    expect(effectiveStats(razors, field, defending, ace).offense).toBe(
      effectiveStats(razors, field, defending, bare).offense,
    );
    expect(effectiveStats(razors, field, attacking, ace).vitality).toBe(
      effectiveStats(razors, field, attacking, bare).vitality,
    );
  });

  it('lands the King on vitality when defending, outside the held-ground curve', () => {
    const bare = noCrewEffects();
    const king = { ...noCrewEffects(), tableDefenceVitalityPercent: 10 };
    expect(effectiveStats(razors, field, defending, king).vitality).toBeCloseTo(
      effectiveStats(razors, field, defending, bare).vitality * 1.1,
      9,
    );
    expect(effectiveStats(razors, field, attacking, king).vitality).toBe(
      effectiveStats(razors, field, attacking, bare).vitality,
    );
  });
});
