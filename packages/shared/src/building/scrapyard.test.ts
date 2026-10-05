import { describe, expect, it } from 'vitest';
import { TRAP_CATALOG } from '../battle/traps.js';
import { MODIFICATION_RARITIES } from '../modification-rarity.js';
import { UNIT_MODIFICATIONS, unitModificationsOfRarity } from '../units/modifications.js';
import { modificationPrice } from './addons.js';
import { MODIFICATIONS } from './modifications.js';
import { levelCeilingFor } from './kinds.js';
import {
  MAX_SCRAPYARD_DISCOUNT,
  SCRAPYARD_DISCOUNT_PER_LEVEL,
  SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION,
  SCRAPYARD_LEVEL_FOR_BASIC,
  SCRAPYARD_LEVEL_FOR_RARITY,
  SCRAPYARD_LEVEL_FOR_TRAP,
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
  /*
   * "Even the yard ladder" (maintainer, 2026-09-29): a structure card waits on the same bands as a
   * unit card of its grade. Since 2026-10-02 (P13-A) a band is a run of levels and each card opens
   * somewhere inside it, cheapest first. Literals, so the anchor does not move with the table.
   */
  it("opens every card inside its grade's band, structure and unit alike", () => {
    const bands = { basic: [1, 3], intricate: [4, 8], advanced: [9, 13], masterpiece: [14, 20] };
    // The one exception is written on the card: a card cut below its old band keeps the rung it
    // opened at (`yardLevel`, the four supplies cards of 2026-10-01).
    for (const spec of MODIFICATIONS) {
      const level = scrapyardLevelForModification(spec);
      if (spec.yardLevel !== undefined) {
        expect(level, spec.id).toBe(spec.yardLevel);
        continue;
      }
      const [from, to] = bands[spec.rarity];
      expect(level, spec.id).toBeGreaterThanOrEqual(from!);
      expect(level, spec.id).toBeLessThanOrEqual(to!);
    }
    expect(MODIFICATIONS.filter((spec) => spec.yardLevel !== undefined).length).toBe(4);
    for (const spec of UNIT_MODIFICATIONS) {
      const [from, to] = bands[spec.rarity];
      expect(scrapyardLevelForUpgrade(spec), spec.id).toBeGreaterThanOrEqual(from!);
      expect(scrapyardLevelForUpgrade(spec), spec.id).toBeLessThanOrEqual(to!);
    }
    expect(SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION).toBe(bands.advanced[0]);
  });

  /**
   * Every level of the yard opens something (maintainer ruling P13-A, 2026-10-02). The catalogue
   * was fully open at level 7, so levels 8 to 20 bought scrap and nothing else.
   */
  it('opens something at every one of its twenty levels, and the top traps at the top', () => {
    const ladder = scrapyardUnlockLadder({
      modifications: MODIFICATIONS,
      upgrades: UNIT_MODIFICATIONS,
      traps: TRAP_CATALOG,
    });
    expect(ladder.map((rung) => rung.level)).toEqual(
      Array.from({ length: levelCeilingFor('scrapyard') }, (_, index) => index + 1),
    );
    // Both benches climb the whole way: the dearest unit and structure cards need the top level.
    const top = levelCeilingFor('scrapyard');
    expect(Math.max(...UNIT_MODIFICATIONS.map(scrapyardLevelForUpgrade))).toBe(top);
    expect(Math.max(...MODIFICATIONS.map(scrapyardLevelForModification))).toBe(top);
    expect(SCRAPYARD_LEVEL_FOR_TRAP.trap_flooded_cellar).toBe(top);
  });

  /**
   * The unit bench's ladder reads the card's rarity and its price, nothing else.
   *
   * Band starts strictly climbing in the order the four words are listed, so BASIC opens first and
   * MASTERPIECE last, and the bottom rung is the yard standing at all: a BASIC card a level-one
   * yard could not cut would hide the mechanic on the day a crew takes its first plot.
   */
  it('opens each rarity of unit card at a level that climbs with the rarity', () => {
    expect(SCRAPYARD_LEVEL_FOR_RARITY.basic).toBe(SCRAPYARD_LEVEL_FOR_BASIC);
    for (let index = 1; index < MODIFICATION_RARITIES.length; index += 1) {
      const below = MODIFICATION_RARITIES[index - 1]!;
      const above = MODIFICATION_RARITIES[index]!;
      expect(SCRAPYARD_LEVEL_FOR_RARITY[above], `${above} above ${below}`).toBeGreaterThan(
        SCRAPYARD_LEVEL_FOR_RARITY[below],
      );
      // ...and every card of the higher grade opens above every card of the lower one.
      const highestBelow = Math.max(
        ...unitModificationsOfRarity(below).map(scrapyardLevelForUpgrade),
      );
      const lowestAbove = Math.min(
        ...unitModificationsOfRarity(above).map(scrapyardLevelForUpgrade),
      );
      expect(lowestAbove, `${above} above ${below}`).toBeGreaterThan(highestBelow);
    }
    // Every rung has cards on it, or a level on the ladder opens nothing.
    for (const rarity of MODIFICATION_RARITIES) {
      expect(unitModificationsOfRarity(rarity).length, rarity).toBeGreaterThan(0);
    }
  });

  /**
   * A rung a player worked for opens something better than the rung below it.
   *
   * It did not: the three traps added on 2026-09-11 took the even rungs beside the three that were
   * already on the odd ones, which put Razor Wire (then 4% of an attack) at level 2 above Pressure
   * Plates (then 6%) at level 1. Ordered by what the trap is worth rather than by when it was
   * written.
   */
  it('opens the traps in the order they are worth having', () => {
    const ladder = [...TRAP_CATALOG].sort(
      (a, b) => scrapyardLevelForTrap(a) - scrapyardLevelForTrap(b),
    );
    // Razor Wire, the cheapest, kills nobody and opens first (maintainer, 2026-09-29); every trap
    // that bites opens above it, each biting harder than the one below.
    expect(ladder[0]!.effect.kind).toBe('wire');
    const biting = ladder.slice(1);
    for (const [step, above] of biting.entries()) {
      if (above.effect.kind !== 'bite')
        throw new Error(`${above.id} opens above the wire and bites nothing`);
      const below = biting[step - 1];
      if (below?.effect.kind !== 'bite') continue;
      expect(above.effect.bite, `${above.id} opens above ${below.id}`).toBeGreaterThan(
        below.effect.bite,
      );
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
    upgrades: UNIT_MODIFICATIONS,
    traps: TRAP_CATALOG,
  });

  it('accounts for every entry once, lowest level first', () => {
    const levels = ladder.map((rung) => rung.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(levels.length);
    expect(ladder.reduce((sum, rung) => sum + rung.modifications, 0)).toBe(MODIFICATIONS.length);
    expect(ladder.reduce((sum, rung) => sum + rung.upgrades, 0)).toBe(UNIT_MODIFICATIONS.length);
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
