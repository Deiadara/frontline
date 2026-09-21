import { describe, expect, it } from 'vitest';
import { LEGENDARY_CAP, capLegendaries } from './training.js';
import { UNIT_CATALOG } from './catalog.js';

/**
 * §A5: one of each legendary, as a rule of the game rather than of one door (2026-09-19).
 *
 * "Add a general rule in the game that you can have up to 1 of each legendary unit, no more, and
 * remove any excess that the console / admin version currently gives you. If you have it already
 * for the same legendary unit you cannot train another one."
 *
 * The training door has always refused the second one: `trainUnits` checks `alreadyHolds` against
 * the queue as well as the roster, and `maxTrainable` offers at most one. What had no rule at all
 * was **granting**, and the console granted twelve of every sheet in the catalogue.
 */

const UNIQUES = UNIT_CATALOG.filter((unit) => unit.unique);
const ORDINARY = UNIT_CATALOG.filter((unit) => !unit.unique);

describe('the cap on a legendary', () => {
  it('is one, and there are legendaries for it to apply to', () => {
    expect(LEGENDARY_CAP).toBe(1);
    // A guard on the fixture: a catalogue with no uniques in it would pass everything below
    // while testing nothing.
    expect(UNIQUES.length).toBeGreaterThan(0);
    expect(ORDINARY.length).toBeGreaterThan(0);
  });

  it('brings every legendary back to one and leaves everybody else alone', () => {
    const over = Object.fromEntries(UNIT_CATALOG.map((unit) => [unit.id, 12]));
    const capped = capLegendaries(over);
    for (const unit of UNIQUES) {
      expect(capped[unit.id], `${unit.id} is over the cap`).toBe(LEGENDARY_CAP);
    }
    for (const unit of ORDINARY) {
      expect(capped[unit.id], `${unit.id} was trimmed and should not have been`).toBe(12);
    }
  });

  it('leaves a roster that is already legal exactly as it is', () => {
    const legal = { razors: 40, the_colossus: 1, scavengers: 7 };
    expect(capLegendaries(legal)).toEqual(legal);
  });

  it('drops the zeros and the sheets the catalogue has forgotten', () => {
    // A zero is not a holding, and a stored army carrying one would otherwise survive the trim
    // and keep showing up as a key in every reader that walks the record.
    expect(capLegendaries({ razors: 0, the_saint: 3 })).toEqual({ the_saint: 1 });
  });

  it('is idempotent, so a boot sweep can run on every start', () => {
    const once = capLegendaries({ the_specter: 9, razors: 5 });
    expect(capLegendaries(once)).toEqual(once);
  });
});
