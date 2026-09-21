import { describe, expect, it } from 'vitest';
import { bareLineRules, fightingSlots } from './line.js';
import { UNIT_CATALOG, findUnit, isCombatUnit, unitSlotsUsed, type Army } from '../index.js';

/**
 * How big a force is, for anything that has to compare two of them.
 *
 * `unitSlotsUsed` answers a different question: how many beds this lot needs. That is the right
 * number for housing and the wrong one for odds, because a crew defends its home with its whole
 * roster and the porters in it never take a place in the line. The feats board asked the housing
 * question until 2026-09-18 and paid out accordingly.
 */

/** Every unit the game refuses to put in a line, off the catalogue rather than typed out. */
const PORTERS = UNIT_CATALOG.filter((unit) => !isCombatUnit(unit));

const slotsOf = (unitId: string): number => findUnit(unitId)?.unitSlots ?? 0;

describe('the size of a force, as the odds read it', () => {
  it('counts a fighter by its unit slots and not by its head', () => {
    // A Juggernaut is six beds and one body. Both readings are defensible and they are not the
    // same number, so the test names which one this is.
    const heavy = UNIT_CATALOG.find((unit) => unit.unitSlots > 1 && isCombatUnit(unit));
    if (!heavy) throw new Error('the roster has no multi-slot fighter');
    expect(fightingSlots({ [heavy.id]: 3 }, bareLineRules())).toBe(heavy.unitSlots * 3);
  });

  it('leaves every porter out, however many of them there are', () => {
    expect(PORTERS.length, 'nothing in the catalogue is a porter any more').toBeGreaterThan(0);
    for (const porter of PORTERS) {
      expect(fightingSlots({ [porter.id]: 99 }, bareLineRules()), porter.id).toBe(0);
      // ...and beside a real line, only the line is counted.
      expect(fightingSlots({ razors: 5, [porter.id]: 99 }, bareLineRules()), porter.id).toBe(
        slotsOf('razors') * 5,
      );
    }
  });

  /**
   * The case the change was made for, in the two numbers that make it a case.
   *
   * Identical raw slot totals, and the whole difference is who can fight. `unitSlotsUsed` cannot
   * tell them apart, which is exactly how a warehouse came to read as a defence.
   */
  it('separates a real line from a padded one that houses the same number', () => {
    const padded: Army = { razors: 4, scavengers: 40, haulers: 20 };
    const real: Army = { razors: 84 };

    expect(unitSlotsUsed(padded)).toBe(unitSlotsUsed(real));
    expect(fightingSlots(padded, bareLineRules())).toBe(4);
    expect(fightingSlots(real, bareLineRules())).toBe(84);
  });

  /**
   * `carriers_fight` puts them back, because it is the one thing that lifts the rule.
   *
   * Counted whole rather than at `CARRIER_STRENGTH`: that constant is how hard a porter hits once
   * it is standing there, and this function answers whether it is standing there at all. The
   * engine's own outnumbered flag reads it the same way.
   */
  it('counts the porters for a crew that has bought them a place in the line', () => {
    const rules = { carriersFight: true, unitMarks: {} };
    for (const porter of PORTERS) {
      expect(fightingSlots({ [porter.id]: 10 }, rules), porter.id).toBe(porter.unitSlots * 10);
    }
  });

  it('ignores a key that names no unit, and a count of zero or less', () => {
    // The same lock every other reader of a raw army map carries: a stored row of a retired unit,
    // or a `constructor` key off a plain object, must not become a force.
    expect(fightingSlots({ not_a_unit: 40 }, bareLineRules())).toBe(0);
    expect(fightingSlots({ constructor: 40 }, bareLineRules())).toBe(0);
    expect(fightingSlots({ razors: 0, snipers: -3 }, bareLineRules())).toBe(0);
  });
});
