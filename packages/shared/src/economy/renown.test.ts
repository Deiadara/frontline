import { describe, expect, it } from 'vitest';
import { MAX_NOTORIETY, NOTORIETY_TIERS, notorietyUpgradeCost } from './notoriety.js';
import {
  NOTORIETY_GRANTS,
  describeNotorietyGrant,
  notorietyEffects,
  notorietyGrant,
} from './renown.js';
import { NOTORIETY_TO_FIELD } from './infamy.js';
import { UNIT_TIERS } from '../units/index.js';

/**
 * §D7: every rung of the ladder changes a number.
 *
 * The ladder ran to fourteen words and stopped *gating* anything at the fifth: every unit tier is
 * fieldable at `Marked` and the Bar's ordinary room asks for nothing above it. So the eight rungs
 * over that were a different word on a chip, bought with a cumulative 239 million infamy. The rule
 * this file holds is the one that fixes it: past `Nobody`, buying a rank buys something.
 */
describe('what a rank is worth', () => {
  it('pays something at every rung above the first', () => {
    for (let rank = 1; rank <= MAX_NOTORIETY; rank += 1) {
      const grant = notorietyGrant(rank);
      expect(grant.length, `${NOTORIETY_TIERS[rank]} (rank ${rank}) pays nothing`).toBeGreaterThan(
        0,
      );
    }
    // And the rung nobody buys pays nothing, which is what makes the line above a real assertion.
    expect(notorietyGrant(0)).toEqual([]);
  });

  it('covers every rung of the ladder and no word that is not on it', () => {
    expect(Object.keys(NOTORIETY_GRANTS).sort()).toEqual([...NOTORIETY_TIERS].sort());
  });

  /**
   * A rank is kept, so what it pays is kept: `notoriety` is the one number in the economy that
   * never falls, and a ladder that replaced the rung below it would make buying one a sidegrade.
   */
  it('accumulates, so a higher rank is never worth less than a lower one', () => {
    const menace = (rank: number): number => notorietyEffects(rank).intimidationFlat;
    for (let rank = 1; rank <= MAX_NOTORIETY; rank += 1) {
      expect(menace(rank), `rank ${rank}`).toBeGreaterThanOrEqual(menace(rank - 1));
    }
    // Strictly more by the top, or "accumulates" would be satisfied by a ladder of zeroes.
    expect(menace(MAX_NOTORIETY)).toBeGreaterThan(menace(1));
  });

  /**
   * The late rungs are where the ladder used to go quiet, so they are where the widest grants are.
   *
   * Measured on the tiers that cost a fortune to field: a crew buying `Scourge` is a crew with
   * legendaries on the roster, and a grant that arrived before there was anything to spend it on
   * would be the same dead rung wearing a number.
   */
  it('puts the dear tiers behind the dear ranks', () => {
    const atMarked = notorietyEffects(5).unitTierPercent;
    const atTop = notorietyEffects(MAX_NOTORIETY).unitTierPercent;

    expect(atMarked['legendary'] ?? {}, 'a legendary grant arrived too early').toEqual({});
    expect(atTop['legendary']?.offense ?? 0).toBeGreaterThan(0);
    // ...and the cheap tiers are paid early, where a small crew can feel them.
    expect(atMarked['rabble']?.offense ?? 0).toBeGreaterThan(0);
  });

  it('only ever names tiers the game has', () => {
    const tiers = Object.keys(notorietyEffects(MAX_NOTORIETY).unitTierPercent);
    for (const tier of tiers) expect(UNIT_TIERS as readonly string[]).toContain(tier);
  });

  /**
   * The gate the ladder used to be, still standing.
   *
   * `NOTORIETY_TO_FIELD` tops out at rank 5, which was the whole problem: this asserts the grants
   * carry on past the point the gates stop, because that is the gap they were written to fill.
   */
  it('keeps paying past the last rank that gates a unit tier', () => {
    const lastGate = Math.max(...UNIT_TIERS.map((tier) => NOTORIETY_TO_FIELD[tier]));
    for (let rank = lastGate + 1; rank <= MAX_NOTORIETY; rank += 1) {
      expect(
        notorietyGrant(rank).length,
        `rank ${rank} is past every gate and pays nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it('says what each rung buys, in words a screen can print', () => {
    for (let rank = 1; rank <= MAX_NOTORIETY; rank += 1) {
      const lines = describeNotorietyGrant(rank);
      expect(lines.length, `rank ${rank}`).toBeGreaterThan(0);
      for (const line of lines) expect(line.length, `rank ${rank}`).toBeGreaterThan(3);
    }
  });

  /** A rank still costs what it costs: the grants are a reason to climb, not a discount. */
  it('leaves the price of a rung alone', () => {
    for (let rank = 0; rank < MAX_NOTORIETY; rank += 1) {
      expect(notorietyUpgradeCost(rank)).toBeGreaterThan(0);
    }
  });
});
