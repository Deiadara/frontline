import { describe, expect, it } from 'vitest';
import {
  MUSTER_COST_PER_LOCATION_LEVEL,
  bonusesAt,
  findPerk,
  findResearchItem,
  unifiedBonusFor,
  type HoldBonus,
} from '../index.js';

/**
 * The general muster cuts, cut (maintainer, 2026-10-01): "nerf the general sources so a very
 * good advanced mid game crew that has played for low supplies gets about 30%".
 *
 * The general cut comes off every line of a muster bill, caps, scrap and metal included, and a
 * strong mid-game crew was at the 50% floor price with an Armory alone. Each source is pinned at
 * its new figure, in the order it had, and every one of them still pays something.
 */

const costOf = (bonuses: readonly HoldBonus[]): number =>
  bonuses.reduce((total, bonus) => total + (bonus.kind === 'muster_cost' ? bonus.percent : 0), 0);

describe('the general muster cuts', () => {
  // Jigs and Fixtures went with the Fabricator's chair and Batch Runs moved to the Engineer as build
  // speed (2026-10-04); the two left still pay in the order they did.
  it('pays the two Lab rungs 3 and 5, in the order they paid 8 and 12', () => {
    const rung = (id: string): number => {
      const bonus = findResearchItem(id)?.payout.bonus;
      return bonus?.kind === 'muster_cost' ? bonus.percent : Number.NaN;
    };
    expect(['tech_unit_costing', 'tech_standard_syllabus'].map(rung)).toEqual([3, 5]);
  });

  it('pays the four perks 1, 2, 2 and 6, in the order they paid 5, 8, 8 and 28', () => {
    const perk = (id: string): number => {
      const bonus = findPerk(id)?.bonus;
      return bonus?.kind === 'muster_cost' ? bonus.percent : Number.NaN;
    };
    expect(['range_master', 'surplus_dealer', 'bar_regular', 'sig_headhunter'].map(perk)).toEqual([
      1, 2, 2, 6,
    ]);
  });

  it('works an Armory up from 1 to 5, where it was 12 to 66', () => {
    // One a level over the five-level ladder (2026-10-06); the old ten reached 6.
    const ladder = Array.from({ length: 5 }, (_, index) => costOf(bonusesAt('armory', index + 1)));
    expect(ladder).toEqual([1, 2, 3, 4, 5]);
    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index]!, `level ${index + 1}`).toBeGreaterThanOrEqual(ladder[index - 1]!);
    }
  });

  it('pays 2 for holding the Steelbelt whole, and 2 a level for a unit on its own ground', () => {
    const steelbelt = unifiedBonusFor('steelbelt')?.bonus;
    expect(steelbelt?.kind === 'muster_cost' ? steelbelt.percent : Number.NaN).toBe(2);
    // Two a level since the ladder went to five (2026-10-06): 8 at the top, where 9 stood.
    expect(MUSTER_COST_PER_LOCATION_LEVEL).toBe(2);
  });
});
