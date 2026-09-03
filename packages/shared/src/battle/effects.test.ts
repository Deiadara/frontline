/**
 * §A4: holding intimidating ground makes your line harder to cow.
 *
 * `intimidationFlat` was summed out of the hold bonuses and read by nothing for the whole life of
 * the channel, which made the Broadcast Tower, whose only bonus is intimidation, worth nothing to
 * hold. `cow` in the engine is its consumer now, so this pins the wiring: the number has to reach
 * the sheet, and it has to stop at the sheet's ceiling like every other bonus.
 */
import { describe, expect, it } from 'vitest';
import { noTerritoryEffects } from '../city/index.js';
import { findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';

const CONTEXT = { defending: false, outnumbered: false } as const;

describe('the ground you hold lends its menace', () => {
  const razors = findUnit('razors');
  if (!razors) throw new Error('fixture: no razors in the catalogue');

  it('adds the held ground intimidation to the body', () => {
    const bare = effectiveStats(razors, bareBattlefield(), CONTEXT, noTerritoryEffects());
    const held = effectiveStats(razors, bareBattlefield(), CONTEXT, {
      ...noTerritoryEffects(),
      intimidationFlat: 20,
    });
    expect(held.intimidation).toBe(bare.intimidation + 20);
  });

  it('stops at the sheet ceiling rather than running past it', () => {
    const held = effectiveStats(razors, bareBattlefield(), CONTEXT, {
      ...noTerritoryEffects(),
      intimidationFlat: 500,
    });
    expect(held.intimidation).toBe(100);
  });
});
