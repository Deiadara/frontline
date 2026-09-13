import { describe, expect, it } from 'vitest';
import { TRAP_CATALOG } from '../battle/traps.js';
import { UNIT_UPGRADES, UPGRADE_MAX_TIER } from '../units/upgrades.js';
import { isAdvancedModification, modificationPrice } from './addons.js';
import { MODIFICATIONS } from './modifications.js';
import {
  MAX_SCRAPYARD_DISCOUNT,
  SCRAPYARD_DISCOUNT_PER_LEVEL,
  SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION,
  SCRAPYARD_LEVEL_FOR_TRAP,
  SCRAPYARD_LEVEL_FOR_UPGRADE_TIER,
  nextScrapyardUnlock,
  scrapyardDiscountPercent,
  scrapyardLevelForModification,
  scrapyardLevelForTrap,
  scrapyardLevelForUpgrade,
  scrapyardLevelRefusal,
  scrapyardPrice,
  scrapyardUnlockLadder,
} from './scrapyard.js';

/**
 * What the yard's level is worth (maintainer request, 2026-09-10). Two channels, each pinned at both
 * ends: the discount grows and stops, and every gate names a level a plain level-one yard is below.
 */
describe('the Scrapyard discount', () => {
  it('is nothing at level one and grows by the step per level until the cap', () => {
    expect(scrapyardDiscountPercent(0)).toBe(0);
    expect(scrapyardDiscountPercent(1)).toBe(0);
    expect(scrapyardDiscountPercent(2)).toBe(SCRAPYARD_DISCOUNT_PER_LEVEL);
    expect(scrapyardDiscountPercent(6)).toBe(5 * SCRAPYARD_DISCOUNT_PER_LEVEL);
    expect(scrapyardDiscountPercent(20)).toBe(MAX_SCRAPYARD_DISCOUNT);
    expect(scrapyardDiscountPercent(200)).toBe(MAX_SCRAPYARD_DISCOUNT);
  });

  it('takes the discount off every line, keeps every line, and never reaches zero', () => {
    expect(scrapyardPrice({ scrap: 1000, highQualityMetal: 100 }, 6)).toEqual({
      scrap: 900,
      highQualityMetal: 90,
    });
    // The keys are the bill's own: a discount adds nothing and drops nothing.
    expect(Object.keys(scrapyardPrice({ scrap: 500 }, 20))).toEqual(['scrap']);
    expect(scrapyardPrice({ scrap: 1 }, 20)).toEqual({ scrap: 1 });
    // At level one the bill is the list price to the unit.
    for (const spec of MODIFICATIONS) {
      expect(scrapyardPrice(modificationPrice(spec), 1)).toEqual(modificationPrice(spec));
    }
  });
});

describe('what each yard level opens', () => {
  it('opens the plain bolt-ons at once and holds the advanced ones for a grown yard', () => {
    for (const spec of MODIFICATIONS) {
      expect(scrapyardLevelForModification(spec)).toBe(
        isAdvancedModification(spec) ? SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION : 1,
      );
    }
    expect(SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION).toBeGreaterThan(1);
  });

  it('gives every refit tier a level, climbing with the tier', () => {
    expect(SCRAPYARD_LEVEL_FOR_UPGRADE_TIER).toHaveLength(UPGRADE_MAX_TIER);
    for (let tier = 2; tier <= UPGRADE_MAX_TIER; tier++) {
      expect(SCRAPYARD_LEVEL_FOR_UPGRADE_TIER[tier - 1]!).toBeGreaterThan(
        SCRAPYARD_LEVEL_FOR_UPGRADE_TIER[tier - 2]!,
      );
    }
    for (const spec of UNIT_UPGRADES) {
      expect(scrapyardLevelForUpgrade(spec)).toBe(SCRAPYARD_LEVEL_FOR_UPGRADE_TIER[spec.tier - 1]);
    }
  });

  /**
   * A rung a player worked for opens something better than the rung below it.
   *
   * It did not: the three traps added on 2026-09-11 took the even rungs beside the three that were
   * already on the odd ones, which put Razor Wire (4% of an attack) at level 2 above Pressure
   * Plates (6%) at level 1. Ordered by what the trap is worth rather than by when it was written.
   */
  it('opens the traps in the order they are worth having', () => {
    const ladder = [...TRAP_CATALOG].sort(
      (a, b) => scrapyardLevelForTrap(a) - scrapyardLevelForTrap(b),
    );
    for (let step = 1; step < ladder.length; step += 1) {
      const below = ladder[step - 1]!;
      const above = ladder[step]!;
      expect(above.killShare, `${above.id} opens above ${below.id}`).toBeGreaterThan(
        below.killShare,
      );
      expect(above.maxKills, `${above.id} opens above ${below.id}`).toBeGreaterThan(below.maxKills);
    }
    // Every trap on its own rung, so the ladder is a ladder rather than a pile.
    const levels = TRAP_CATALOG.map(scrapyardLevelForTrap);
    expect(new Set(levels).size).toBe(levels.length);
  });

  it('names a level for every trap in the catalogue, and no trap the catalogue lacks', () => {
    expect(Object.keys(SCRAPYARD_LEVEL_FOR_TRAP).sort()).toEqual(
      TRAP_CATALOG.map((spec) => spec.id).sort(),
    );
    for (const spec of TRAP_CATALOG) {
      expect(scrapyardLevelForTrap(spec)).toBe(SCRAPYARD_LEVEL_FOR_TRAP[spec.id]);
    }
  });

  it('words the refusal with the level, and says nothing once it is reached', () => {
    expect(scrapyardLevelRefusal(3, 4)).toBe('Needs the Scrapyard at level 4');
    expect(scrapyardLevelRefusal(4, 4)).toBeNull();
    expect(scrapyardLevelRefusal(9, 4)).toBeNull();
  });
});

describe('the yard ladder', () => {
  const ladder = scrapyardUnlockLadder({
    modifications: MODIFICATIONS,
    upgrades: UNIT_UPGRADES,
    traps: TRAP_CATALOG,
  });

  it('accounts for every entry once, lowest level first', () => {
    const levels = ladder.map((rung) => rung.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(levels.length);
    expect(ladder.reduce((sum, rung) => sum + rung.modifications, 0)).toBe(MODIFICATIONS.length);
    expect(ladder.reduce((sum, rung) => sum + rung.upgrades, 0)).toBe(UNIT_UPGRADES.length);
    expect(ladder.reduce((sum, rung) => sum + rung.traps, 0)).toBe(TRAP_CATALOG.length);
    expect(levels[0]).toBe(1);
  });

  it('points at the next rung above the yard, and at nothing from the top', () => {
    expect(nextScrapyardUnlock(1, ladder)?.level).toBe(ladder[1]?.level);
    const top = ladder[ladder.length - 1]!;
    expect(nextScrapyardUnlock(top.level, ladder)).toBeNull();
    expect(nextScrapyardUnlock(top.level - 1, ladder)?.level).toBe(top.level);
  });
});
