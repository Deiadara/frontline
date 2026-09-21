import { describe, expect, it } from 'vitest';
import { MAX_PACK_BONUS, PACK_HALF, packBonusPercent } from './collective.js';
import { UNIT_CATALOG, findUnit, isCombatUnit } from './catalog.js';
import { lootCapacityOf } from '../raid.js';
import { bareBattlefield } from '../battle/battlefield.js';
import { simulate } from '../battle/engine.js';
import { noTerritoryEffects } from '../city/index.js';

/**
 * §A5: Collective, and the two readings of it (maintainer, 2026-09-19).
 *
 * "Add to Haulers the Collective tag, but make it work different for carriers: instead of their
 * combat stats, their loot increases again with diminishing returns, and it only matters in
 * integers (round it up)."
 *
 * One curve, two currencies. A fighter that masses gets offense; a carrier that masses gets
 * carry. The card says one sentence and it is true of both, which is the whole point of not
 * giving the carriers their own constants.
 */

const HAULERS = findUnit('haulers');
const SCAVENGERS = findUnit('scavengers');

describe('who carries the tag', () => {
  it('is on the Haulers, and they are a carrier', () => {
    expect(HAULERS?.pack).toBe(true);
    expect(isCombatUnit('haulers')).toBe(false);
  });

  it('is on at least one sheet that actually fights, or the other half is untested content', () => {
    const fighters = UNIT_CATALOG.filter((unit) => unit.pack === true && isCombatUnit(unit));
    expect(fighters.length).toBeGreaterThan(0);
  });

  it('is not on the Scavengers, who are the control in the carry tests below', () => {
    expect(SCAVENGERS?.pack).not.toBe(true);
  });
});

describe('what massing a carrier is worth', () => {
  const sheet = HAULERS?.stats.lootCapacity ?? 0;

  it('pays nothing at all for one of them', () => {
    expect(lootCapacityOf({ haulers: 1 })).toBe(sheet);
  });

  it('carries more per body the more of them there are', () => {
    const per = (n: number) => lootCapacityOf({ haulers: n }) / n;
    expect(per(10)).toBeGreaterThan(per(1));
    expect(per(50)).toBeGreaterThan(per(10));
  });

  /**
   * Whole kilograms, rounded up, which is what "it only matters in integers" asks for.
   *
   * Loot is floored at every line downstream (`plunder`), so a fractional bag is a bag that
   * quietly rounds away. Asserted on the per-unit figure because that is where the rounding is
   * done: the group is then a count of whole bags rather than a total rounded a second time.
   */
  it('gives every body a whole number of kilograms', () => {
    for (const count of [1, 2, 3, 5, 9, 17, 40, 100]) {
      const total = lootCapacityOf({ haulers: count });
      expect(
        Number.isInteger(total / count),
        `${count} haulers carried ${total / count} each`,
      ).toBe(true);
      expect(Number.isInteger(total)).toBe(true);
    }
  });

  it('rounds up rather than to nearest, so the bonus is never rounded away', () => {
    for (const count of [2, 3, 4, 5, 8, 13, 30]) {
      const per = lootCapacityOf({ haulers: count }) / count;
      expect(per, `${count} haulers`).toBeGreaterThanOrEqual(
        sheet * (1 + packBonusPercent(count) / 100),
      );
      expect(per, `${count} haulers overshot a whole kilogram`).toBeLessThan(
        sheet * (1 + packBonusPercent(count) / 100) + 1,
      );
    }
  });

  it('diminishes, so the fifth body is worth more than the fiftieth', () => {
    const gain = (n: number) =>
      lootCapacityOf({ haulers: n }) / n - lootCapacityOf({ haulers: n - 1 }) / (n - 1);
    // Compared on the per-body figure, because the total climbs with the count either way.
    expect(packBonusPercent(5) - packBonusPercent(4)).toBeGreaterThan(
      (packBonusPercent(50) - packBonusPercent(49)) * 5,
    );
    expect(gain(5)).toBeGreaterThanOrEqual(0);
  });

  it('leaves a carrier without the tag on its printed sheet', () => {
    const printed = SCAVENGERS?.stats.lootCapacity ?? 0;
    for (const count of [1, 10, 60]) {
      expect(lootCapacityOf({ scavengers: count })).toBe(printed * count);
    }
  });
});

/**
 * ...and the half a carrier must **not** collect.
 *
 * "Instead of their combat stats, their loot increases." A crew holding `carriers_fight` puts
 * its porters in the line, and without the `isCombatUnit` clause in `buildStacks` those porters
 * would draw the offense bonus as well as the carry one: one tag, two payouts, and a card that
 * reads as neither.
 */
describe('what massing a carrier is not worth', () => {
  const lineOf = (count: number) => {
    const sim = simulate({
      seed: 'collective-carrier',
      battlefield: bareBattlefield(),
      attacker: {
        name: 'A',
        army: { haulers: count },
        defending: false,
        // The programme, so the porters are actually standing in the line to be measured.
        territory: { ...noTerritoryEffects(), carriersFight: true },
      },
      defender: { name: 'D', army: { razors: 20 }, defending: true },
    });
    const stack = sim.attacker.stacks.find((one) => one.unit.id === 'haulers');
    if (!stack) throw new Error('the porters did not reach the line: check carriers_fight');
    return stack;
  };

  it('puts the porters in the line at all, which is the premise', () => {
    expect(lineOf(30).started).toBe(30);
  });

  it('gives them no more damage for being forty than for being one', () => {
    // Per body, because the stack's own `effective.offense` is per unit already.
    expect(lineOf(40).effective.offense).toBeCloseTo(lineOf(1).effective.offense, 6);
  });

  it('...while a fighter with the same tag does get it', () => {
    const fighter = (count: number) => {
      const sim = simulate({
        seed: 'collective-fighter',
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { sparks: count }, defending: false },
        defender: { name: 'D', army: { razors: 20 }, defending: true },
      });
      const stack = sim.attacker.stacks.find((one) => one.unit.id === 'sparks');
      if (!stack) throw new Error('no sparks in the line');
      return stack.effective.offense;
    };
    expect(findUnit('sparks')?.pack).toBe(true);
    expect(fighter(40)).toBeGreaterThan(fighter(1));
  });
});

describe('the curve itself', () => {
  it('is half the asymptote at its half-point and never reaches the top', () => {
    expect(packBonusPercent(1)).toBe(0);
    expect(packBonusPercent(PACK_HALF + 1)).toBeCloseTo(MAX_PACK_BONUS / 2, 6);
    expect(packBonusPercent(1_000_000)).toBeLessThan(MAX_PACK_BONUS);
    expect(packBonusPercent(1001)).toBeGreaterThan(packBonusPercent(1000));
  });
});
