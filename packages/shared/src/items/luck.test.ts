import { describe, expect, it } from 'vitest';
import { luckyPages, pagesIn } from '../blueprints/prize.js';
import { rarityOfPage } from '../blueprints/state.js';
import { ITEM_CATALOG } from './catalog.js';
import { LUCK_SHIFT_PER_POINT, luckyPool, luckyRarityWeights } from './luck.js';
import { rollSalvage } from './salvage.js';

const ROW = { basic: 70, intricate: 25, advanced: 5, masterpiece: 0 };
const round = (weights: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, Math.round(value * 100) / 100]),
  );

describe('luck on a drop', () => {
  it('leaves the odds alone at luck 0', () => {
    expect(luckyRarityWeights(ROW, 0)).toEqual(ROW);
  });

  it('moves each rarity up a step, rarest first, keeping the total', () => {
    expect(LUCK_SHIFT_PER_POINT).toBe(0.03);
    expect(round(luckyRarityWeights(ROW, 5))).toEqual({
      basic: 59.5,
      intricate: 31.75,
      advanced: 8,
      masterpiece: 0.75,
    });
    expect(round(luckyRarityWeights(ROW, 10))).toEqual({
      basic: 49,
      intricate: 38.5,
      advanced: 11,
      masterpiece: 1.5,
    });
    const total = Object.values(luckyRarityWeights(ROW, 10)).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(100, 10);
  });

  it('only hands weight to a rarity the draw can give', () => {
    const shifted = luckyRarityWeights(ROW, 10, (rarity) => rarity !== 'advanced');
    // Advanced takes nothing in: intricate's 7.5 skips it to masterpiece, beside its own 1.5.
    expect(shifted.advanced).toBeCloseTo(3.5, 10);
    expect(shifted.masterpiece).toBeCloseTo(9, 10);
  });

  it('scales a pool by rarity and keeps the odds inside a rarity', () => {
    const pool = [
      { id: 'a', rarity: 'basic' as const, weight: 6 },
      { id: 'b', rarity: 'basic' as const, weight: 6 },
      { id: 'c', rarity: 'masterpiece' as const, weight: 3 },
    ];
    const lucky = luckyPool(pool, (entry) => entry.rarity, 10);
    expect(lucky[0]!.weight).toBe(lucky[1]!.weight);
    // Basic hands 30% of its 12 to the next rarity the pool holds, masterpiece.
    expect(lucky[0]!.weight + lucky[1]!.weight).toBeCloseTo(8.4, 10);
    expect(lucky[2]!.weight).toBeCloseTo(6.6, 10);
  });
});

describe('luck on the page and salvage draws', () => {
  it('moves a category of pages toward its rarer sheets, and salvage toward rarer parts', () => {
    const share = (luck: number) => {
      const pool = luckyPages(pagesIn('unit'), luck);
      const total = pool.reduce((sum, page) => sum + page.weight, 0);
      const rare = pool
        .filter((page) => rarityOf(page.id) === 'masterpiece')
        .reduce((sum, page) => sum + page.weight, 0);
      return rare / total;
    };
    const rarityOf = (id: string) => rarityOfPage(id);
    expect(share(10)).toBeGreaterThan(share(0));
    const rareFinds = (luck: number) => {
      let rare = 0;
      for (let run = 0; run < 400; run += 1) {
        let state = run + 1;
        const random = () => {
          state = (state * 48271) % 2147483647;
          return state / 2147483647;
        };
        for (const id of Object.keys(rollSalvage(300, true, random, luck))) {
          const rarity = ITEM_CATALOG[id as keyof typeof ITEM_CATALOG].rarity;
          if (rarity === 'advanced' || rarity === 'masterpiece') rare += 1;
        }
      }
      return rare;
    };
    expect(rareFinds(10)).toBeGreaterThan(rareFinds(0));
  });
});
