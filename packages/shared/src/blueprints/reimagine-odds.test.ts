/**
 * The Reimagining payout ladder (maintainer, 2026-09-18).
 *
 * Three claims are worth a test each, and only the first is obvious.
 *
 * 1. The two ends are the numbers the brief named, exactly, not nearly. A normalisation that
 *    divides by 0.9999999999999999 would leave an 80% that prints as 80% and fails `toBe`.
 * 2. Every one of the twenty input multisets is a distribution. Enumerated rather than sampled,
 *    because there are twenty of them and the interesting one is always the one nobody picked.
 * 3. Raising one input page by one tier improves the payout by first-order stochastic dominance.
 *    That is the claim the geometric blend actually supports, and the per-tier version of it is
 *    false: Intricate peaks in the middle and comes back down, which it has to, since the far end
 *    of the ladder is 80% Masterpiece.
 *
 * The pinned table at the top is deliberately a copy of the numbers rather than a second
 * implementation of the formula. A test that recomputes `base^(1-q) * reversed^q` would agree with
 * a rewrite of the curve into anything at all, including the straight line the module rejects.
 */
import { describe, expect, it } from 'vitest';
import { ITEM_RARITIES, RARITY_ORDER, type ItemRarity } from '../items/rarity.js';
import {
  REIMAGINING_BASE_ODDS,
  reimaginingOdds,
  reimaginingOddsAt,
  reimaginingQuality,
} from './reimagine-odds.js';
import { REIMAGINING_PAGES_SPENT } from './state.js';

/** Every multiset of three tiers from four, in quality order. Twenty of them. */
function everyInput(): ItemRarity[][] {
  const sets: ItemRarity[][] = [];
  for (let a = 0; a < ITEM_RARITIES.length; a += 1) {
    for (let b = a; b < ITEM_RARITIES.length; b += 1) {
      for (let c = b; c < ITEM_RARITIES.length; c += 1) {
        sets.push([ITEM_RARITIES[a]!, ITEM_RARITIES[b]!, ITEM_RARITIES[c]!]);
      }
    }
  }
  return sets;
}

const ladder = (odds: Readonly<Record<ItemRarity, number>>) => ITEM_RARITIES.map((r) => odds[r]);

/** The chance of tier `at` or better. The quantity first-order dominance is a statement about. */
function orBetter(odds: Readonly<Record<ItemRarity, number>>, at: number): number {
  return ITEM_RARITIES.filter((rarity) => RARITY_ORDER[rarity] >= at).reduce(
    (sum, rarity) => sum + odds[rarity],
    0,
  );
}

/**
 * Measured off the shipped module and written down, to six places.
 *
 * Read the rows as the brief reads: all Basic is the stated 80/15/4.5/0.5, all Masterpiece is that
 * backwards, and one Masterpiece among two Basics is already a one-in-twelve shot at the top tier.
 * The ladder is its own mirror, which is why row 3 and row 4 are the same numbers: `q` is the mean,
 * so two Basic and one Masterpiece is three Intricate.
 */
const PINNED: { input: ItemRarity[]; odds: [number, number, number, number] }[] = [
  { input: ['basic', 'basic', 'basic'], odds: [0.8, 0.15, 0.045, 0.005] },
  { input: ['basic', 'basic', 'intricate'], odds: [0.703932, 0.202926, 0.079552, 0.01359] },
  { input: ['basic', 'basic', 'masterpiece'], odds: [0.430703, 0.29349, 0.196472, 0.079336] },
  { input: ['intricate', 'intricate', 'intricate'], odds: [0.430703, 0.29349, 0.196472, 0.079336] },
  { input: ['intricate', 'advanced', 'advanced'], odds: [0.161042, 0.259396, 0.296525, 0.283036] },
  { input: ['advanced', 'advanced', 'advanced'], odds: [0.079336, 0.196472, 0.29349, 0.430703] },
  {
    input: ['advanced', 'masterpiece', 'masterpiece'],
    odds: [0.01359, 0.079552, 0.202926, 0.703932],
  },
  { input: ['masterpiece', 'masterpiece', 'masterpiece'], odds: [0.005, 0.045, 0.15, 0.8] },
];

describe('the Reimagining payout ladder', () => {
  it('pays the stated ladder for three Basic sheets, to the digit', () => {
    const odds = reimaginingOdds(['basic', 'basic', 'basic']);
    for (const rarity of ITEM_RARITIES) {
      expect(odds[rarity], `${rarity} is not exactly its base odds`).toBe(
        REIMAGINING_BASE_ODDS[rarity],
      );
    }
    expect(ladder(odds)).toEqual([0.8, 0.15, 0.045, 0.005]);
  });

  it('pays the ladder backwards for three Masterpiece sheets, to the digit', () => {
    const odds = reimaginingOdds(['masterpiece', 'masterpiece', 'masterpiece']);
    expect(ladder(odds)).toEqual([0.005, 0.045, 0.15, 0.8]);
  });

  it('matches the written-down ladder at every representative input', () => {
    for (const row of PINNED) {
      const odds = ladder(reimaginingOdds(row.input));
      for (const [index, expected] of row.odds.entries()) {
        expect(odds[index], `${row.input.join('+')} ${ITEM_RARITIES[index]}`).toBeCloseTo(
          expected,
          6,
        );
      }
    }
  });

  it('is a distribution for every one of the twenty possible inputs', () => {
    const inputs = everyInput();
    expect(inputs).toHaveLength(20);
    for (const input of inputs) {
      expect(input).toHaveLength(REIMAGINING_PAGES_SPENT);
      const odds = reimaginingOdds(input);
      const total = ITEM_RARITIES.reduce((sum, rarity) => sum + odds[rarity], 0);
      expect(total, `${input.join('+')} does not sum to one`).toBeCloseTo(1, 12);
      for (const rarity of ITEM_RARITIES) {
        expect(
          odds[rarity],
          `${input.join('+')} pays ${rarity} an impossible share`,
        ).toBeGreaterThan(0);
        expect(odds[rarity]).toBeLessThan(1);
      }
    }
  });

  it('scales quality from all Basic at zero to all Masterpiece at one', () => {
    expect(reimaginingQuality(['basic', 'basic', 'basic'])).toBe(0);
    expect(reimaginingQuality(['masterpiece', 'masterpiece', 'masterpiece'])).toBe(1);
    // The mean, so the sum of the tier indices is all that survives: 0 + 0 + 3 is 1 + 1 + 1.
    expect(reimaginingQuality(['basic', 'basic', 'masterpiece'])).toBeCloseTo(1 / 3, 12);
    expect(reimaginingQuality(['intricate', 'intricate', 'intricate'])).toBeCloseTo(1 / 3, 12);
  });

  /**
   * Swap one sheet for a better one and the payout dominates the one it replaced.
   *
   * Walked over every (input, one page raised) pair there is, which is every multiset paired with
   * every single-step lift out of it, and checked on all four tails. Stated in both of the
   * maintainer's directions because they are the same fact and a half-implementation could satisfy
   * one of them: the chance of tier k or better never falls, and the chance of tier k or worse
   * never rises.
   */
  it('never pays worse when one input page is raised a tier', () => {
    let pairs = 0;
    for (const input of everyInput()) {
      for (const [slot, rarity] of input.entries()) {
        const up = RARITY_ORDER[rarity] + 1;
        if (up >= ITEM_RARITIES.length) continue;
        const raised = input.map((held, index) => (index === slot ? ITEM_RARITIES[up]! : held));
        const before = reimaginingOdds(input);
        const after = reimaginingOdds(raised);
        const where = `${input.join('+')} -> ${raised.join('+')}`;
        for (let tier = 0; tier < ITEM_RARITIES.length; tier += 1) {
          expect(
            orBetter(after, tier),
            `${where}: ${tier} or better got less likely`,
          ).toBeGreaterThan(orBetter(before, tier) - 1e-12);
          // The mirror: tier or worse never gets more likely.
          expect(
            1 - orBetter(after, tier + 1),
            `${where}: ${tier} or worse got more likely`,
          ).toBeLessThan(1 - orBetter(before, tier + 1) + 1e-12);
        }
        // And the two ends move strictly, which is what stops a flat curve passing the above.
        expect(after.basic, `${where}: Basic did not fall`).toBeLessThan(before.basic);
        expect(after.masterpiece, `${where}: Masterpiece did not rise`).toBeGreaterThan(
          before.masterpiece,
        );
        pairs += 1;
      }
    }
    // Sixty sheets across the twenty multisets, a quarter of them already Masterpiece and so
    // unraisable. Pinned so a loop that quietly stops enumerating still fails.
    expect(pairs).toBe(45);
  });

  /**
   * The same dominance on a fine grid, because the twenty multisets only sample ten qualities.
   *
   * A curve could pass through all ten of them in order and still sag between two of them, which
   * is exactly what a blend that is linear in the odds rather than in their logarithms does to the
   * middle tiers.
   */
  it('dominates all the way along the curve, not just at the ten inputs', () => {
    const STEPS = 2000;
    let previous = reimaginingOddsAt(0);
    for (let step = 1; step <= STEPS; step += 1) {
      const next = reimaginingOddsAt(step / STEPS);
      for (let tier = 0; tier < ITEM_RARITIES.length; tier += 1) {
        expect(orBetter(next, tier), `q=${step / STEPS} dipped at tier ${tier}`).toBeGreaterThan(
          orBetter(previous, tier) - 1e-12,
        );
      }
      previous = next;
    }
  });

  /**
   * The middle tiers are humps, and that is the design rather than a bug to be tested away.
   *
   * Pinned so that a future change flattening the curve, or one turning it into a straight line
   * where Intricate falls from its opening 15% the moment a better sheet goes in, has to come
   * through here first.
   */
  it('lifts the middle tiers above their base odds before letting them fall again', () => {
    const peak = (rarity: ItemRarity) =>
      Math.max(
        ...Array.from({ length: 1001 }, (_, step) => reimaginingOddsAt(step / 1000)[rarity]),
      );
    expect(peak('intricate')).toBeGreaterThan(0.29);
    expect(peak('advanced')).toBeGreaterThan(0.29);
    // One Intricate sheet among two Basic lifts Intricate rather than cutting it.
    const one = reimaginingOdds(['basic', 'basic', 'intricate']);
    expect(one.intricate).toBeGreaterThan(REIMAGINING_BASE_ODDS.intricate);
    expect(one.advanced).toBeGreaterThan(REIMAGINING_BASE_ODDS.advanced);
    // ...and moves the top tier by under a factor of three, where a straight line moves it by
    // eighteen (0.5% to 9.3%), which is the reason the blend is geometric.
    expect(one.masterpiece / REIMAGINING_BASE_ODDS.masterpiece).toBeLessThan(3);
  });
});
