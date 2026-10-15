import { ITEM_CATALOG } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { withTableInfamy } from './resolve.js';
import { drawDailyComponent, drawRarity } from '../city/daily.js';

/**
 * The Jack of clubs and the Joker where they are spent (maintainer, 2026-10-15): the Jack
 * multiplies a fight's final infamy tally, rounded down, and the Joker's luck moves the odds of
 * every page and component draw toward the rarer end.
 */
describe('the Jack on a fight`s infamy', () => {
  it('multiplies the final tally and rounds it down', () => {
    expect(withTableInfamy(100, 25)).toBe(125);
    expect(withTableInfamy(7, 25)).toBe(8);
    expect(withTableInfamy(3, 16)).toBe(3);
    expect(withTableInfamy(100, 0)).toBe(100);
    // A loss of infamy is not grown.
    expect(withTableInfamy(-10, 25)).toBe(-10);
  });
});

describe('the Joker on a daily draw', () => {
  const tally = (luck: number, draw: (seed: string) => string) => {
    const counts: Record<string, number> = {};
    for (let index = 0; index < 4000; index += 1) {
      const rarity = draw(`luck-${luck}-${index}`);
      counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    return counts;
  };

  it('draws rarer at luck 10 than at luck 0, off the same seeds', () => {
    const plain = tally(0, (seed) => drawRarity(1, seed, 0));
    const lucky = tally(10, (seed) => drawRarity(1, seed, 10));
    expect(lucky.basic ?? 0).toBeLessThan(plain.basic ?? 0);
    expect((lucky.advanced ?? 0) + (lucky.masterpiece ?? 0)).toBeGreaterThan(
      (plain.advanced ?? 0) + (plain.masterpiece ?? 0),
    );
    // Level 1 pays no masterpiece without luck; at 10 it does.
    expect(plain.masterpiece ?? 0).toBe(0);
    expect(lucky.masterpiece ?? 0).toBeGreaterThan(0);
  });

  it('can lift a fixed rarity a step, and leaves it fixed without luck', () => {
    const rarities = (luck: number) =>
      Array.from({ length: 400 }, (_, index) => {
        const id = drawDailyComponent(1, `fixed-${index}`, 'basic', luck);
        return id === null ? null : ITEM_CATALOG[id].rarity;
      });
    expect(new Set(rarities(0))).toEqual(new Set(['basic']));
    const lifted = rarities(10);
    expect(lifted.filter((rarity) => rarity === 'intricate').length).toBeGreaterThan(0);
    expect(lifted.filter((rarity) => rarity === 'basic').length).toBeGreaterThan(200);
  });
});
