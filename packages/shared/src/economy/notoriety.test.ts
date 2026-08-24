import { describe, expect, it } from 'vitest';
import {
  MAX_NOTORIETY,
  NOTORIETY_BLURBS,
  NOTORIETY_COST_GROWTH,
  NOTORIETY_FIRST_COST,
  NOTORIETY_TIERS,
  NotorietySchema,
  STARTING_NOTORIETY,
  clampNotoriety,
  meetsNotoriety,
  nextNotorietyTier,
  notorietySpentTo,
  notorietyTier,
  notorietyUpgradeCost,
} from './notoriety.js';
import { startingEconomy } from './state.js';

describe('the ladder (§D7)', () => {
  it('starts everybody at Nobody, and that rung is not for sale', () => {
    expect(STARTING_NOTORIETY).toBe(0);
    expect(notorietyTier(STARTING_NOTORIETY)).toBe('Nobody');
    expect(startingEconomy('2026-08-16T12:00:00.000Z').notoriety).toBe(0);
  });

  it("runs the board's fourteen names in the board's order", () => {
    expect(NOTORIETY_TIERS).toHaveLength(14);
    expect(NOTORIETY_TIERS[0]).toBe('Nobody');
    expect(NOTORIETY_TIERS[MAX_NOTORIETY]).toBe('Nameless');
    expect(new Set(NOTORIETY_TIERS).size).toBe(NOTORIETY_TIERS.length);
  });

  it("prices the board's curve: 300, then 900, then 2700", () => {
    expect(notorietyUpgradeCost(0)).toBe(300);
    expect(notorietyUpgradeCost(1)).toBe(900);
    expect(notorietyUpgradeCost(2)).toBe(2700);
    expect(NOTORIETY_FIRST_COST).toBe(300);
    expect(NOTORIETY_COST_GROWTH).toBe(3);
  });

  it('gets dearer at every single rung, and stops selling at the top', () => {
    for (let tier = 1; tier < MAX_NOTORIETY; tier += 1) {
      expect(notorietyUpgradeCost(tier)!, NOTORIETY_TIERS[tier]).toBeGreaterThan(
        notorietyUpgradeCost(tier - 1)!,
      );
    }
    expect(notorietyUpgradeCost(MAX_NOTORIETY)).toBeNull();
    expect(nextNotorietyTier(MAX_NOTORIETY)).toBeNull();
  });

  it('adds up what a rank cost to reach', () => {
    expect(notorietySpentTo(0)).toBe(0);
    expect(notorietySpentTo(1)).toBe(300);
    expect(notorietySpentTo(3)).toBe(300 + 900 + 2700);
  });

  it('names the rung above, until there is not one', () => {
    expect(nextNotorietyTier(0)).toBe('Unknown');
    expect(nextNotorietyTier(MAX_NOTORIETY - 1)).toBe('Nameless');
  });

  /** Every gate in the game reads this, so a fractional or wild index must not open one. */
  it('clamps anything a caller could hand it, in both directions', () => {
    expect(clampNotoriety(-4)).toBe(0);
    expect(clampNotoriety(99)).toBe(MAX_NOTORIETY);
    expect(clampNotoriety(2.9)).toBe(2);
    expect(notorietyTier(99)).toBe('Nameless');
  });

  it('opens a gate at the rung it asks for and not one below it', () => {
    expect(meetsNotoriety(4, 5)).toBe(false);
    expect(meetsNotoriety(5, 5)).toBe(true);
    expect(meetsNotoriety(6, 5)).toBe(true);
  });

  it('refuses a rank the schema has no word for', () => {
    expect(NotorietySchema.safeParse(MAX_NOTORIETY + 1).success).toBe(false);
    expect(NotorietySchema.safeParse(-1).success).toBe(false);
    expect(NotorietySchema.parse(undefined)).toBe(0);
  });

  it('has a line to print for every rung', () => {
    for (const tier of NOTORIETY_TIERS) {
      expect(NOTORIETY_BLURBS[tier], tier).toBeTruthy();
    }
  });
});
