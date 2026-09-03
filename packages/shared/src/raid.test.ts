/**
 * What a raid carries out.
 *
 * `plunder` had no test of its own until this file, and the gap showed: `planks` is priced in
 * `RESOURCE_KG` and stocked by every base, and it was missing from `PLUNDER_PRIORITY`, so no raid
 * in the game had ever taken one. A defender could bank thirty thousand planks behind a broken gate
 * and lose nothing.
 *
 * So the first test here is deliberately not "planks are lootable". It is "every resource the game
 * prices is lootable", derived from the resource list, because the specific omission is the cheap
 * half of the bug and the shape of it is the expensive half: the same hole opens again the day a
 * seventh resource is authored.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_RAID_SHARE,
  PLUNDER_PRIORITY,
  RESOURCE_KEYS,
  RESOURCE_KG,
  plunder,
  type Resources,
} from './index.js';

/** A full stockpile, so nothing is empty for a reason other than the code under test. */
const stocked = (each = 10_000): Resources =>
  Object.fromEntries(RESOURCE_KEYS.map((key) => [key, each])) as unknown as Resources;

describe('what a raid can take', () => {
  it('can carry out every resource the game prices', () => {
    expect([...PLUNDER_PRIORITY].sort()).toEqual([...RESOURCE_KEYS].sort());
  });

  it('actually takes each one, given a hold big enough for everything', () => {
    // Twice the weight of a quarter of everything: enough that nothing is left behind for capacity.
    const capacity = RESOURCE_KEYS.reduce(
      (total, key) => total + 10_000 * MAX_RAID_SHARE * RESOURCE_KG[key],
      0,
    );
    const haul = plunder(stocked(), capacity * 2);
    for (const key of RESOURCE_KEYS) {
      expect(haul[key], `${key} was left behind by a raid with room for it`).toBe(
        10_000 * MAX_RAID_SHARE,
      );
    }
  });

  it('never takes more than a quarter of any one pile, however big the hold', () => {
    const haul = plunder(stocked(), Number.MAX_SAFE_INTEGER);
    for (const key of RESOURCE_KEYS) {
      expect(haul[key] ?? 0, key).toBeLessThanOrEqual(10_000 * MAX_RAID_SHARE);
    }
  });

  it('fills the hold in priority order and stops when it is full', () => {
    // Room for 100kg. Caps are 1kg and first in the order, and a quarter of the pile is 2,500.
    const haul = plunder(stocked(), 100);
    expect(haul.caps).toBe(100);
    for (const key of RESOURCE_KEYS.filter((k) => k !== 'caps')) {
      expect(haul[key] ?? 0, `${key} loaded while the hold was already full of caps`).toBe(0);
    }
  });

  it('carries nothing out of an empty district, and nothing with no hold', () => {
    expect(plunder(stocked(0), 1_000)).toEqual({});
    expect(plunder(stocked(), 0)).toEqual({});
    expect(plunder(stocked(), -50)).toEqual({});
  });

  /** A pile too small for a quarter to round to a whole unit is not a fractional haul. */
  it('never takes a fraction of a unit', () => {
    const haul = plunder(stocked(3), 1_000);
    for (const amount of Object.values(haul)) expect(Number.isInteger(amount)).toBe(true);
  });
});
