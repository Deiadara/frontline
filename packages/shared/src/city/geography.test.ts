import { describe, expect, it } from 'vitest';
import { ALL_DISTRICTS, findDistrict } from './atlas.js';
import {
  INTER_CITY_MINUTES,
  MIN_TRAVEL_MINUTES,
  TRAVEL_MINUTES_PER_MAP_UNIT,
  mapDistance,
  rawMinutesBetween,
  travelMinutesBetween,
} from './geography.js';

/**
 * The map's own arithmetic, now that there is more than one map (2026-09-24).
 *
 * A position is normalised 0 to 1 inside its own city, so the three cities are printed on top of
 * one another and the distance between two of them is not a distance. `rawMinutesBetween` answers
 * that with a frontier term; what is pinned here is that the term is the whole of the difference,
 * and that it is the same in both directions.
 */

const at = (id: string) => {
  const district = findDistrict(id);
  expect(district, id).toBeDefined();
  return district!;
};

const CITY_MIDDLE = { x: 0.5, y: 0.5 };

describe('the road between two cities', () => {
  it('is the way out, the frontier and the way in, and nothing else', () => {
    const home = at('kettle-row');
    const away = at('blockhouse');
    expect(home.cityId).not.toBe(away.cityId);

    /*
     * Worked out here from the rule rather than called: the road out to the middle of your own
     * city at the map's own rate, the frontier, and the road in from the middle of theirs. A
     * second copy of the sum is the point, because the defect this replaced was the sum having
     * no frontier term in it at all and nothing noticing.
     */
    const out = mapDistance(home.position, CITY_MIDDLE) * TRAVEL_MINUTES_PER_MAP_UNIT;
    const back = mapDistance(CITY_MIDDLE, away.position) * TRAVEL_MINUTES_PER_MAP_UNIT;
    expect(rawMinutesBetween(home, away)).toBeCloseTo(out + INTER_CITY_MINUTES + back, 9);
  });

  it('reads the same in both directions', () => {
    for (const [a, b] of [
      ['kettle-row', 'coldwater-halt'],
      ['ashen-terraces', 'last-platform'],
      ['neon-docks', 'carriage'],
    ] as const) {
      expect(rawMinutesBetween(at(a), at(b))).toBeCloseTo(rawMinutesBetween(at(b), at(a)), 9);
    }
  });

  /**
   * The shape of the defect, stated as a property rather than as the one pair that showed it.
   *
   * Nothing about two normalised positions can make a crossing cheap: whatever the two ends are,
   * the frontier is already on the clock before the roads either side of it are.
   */
  it('is never shorter than the frontier itself, for any pair in the world', () => {
    for (const from of ALL_DISTRICTS) {
      for (const to of ALL_DISTRICTS) {
        if (from.cityId === to.cityId) continue;
        expect(rawMinutesBetween(from, to), `${from.id} to ${to.id}`).toBeGreaterThanOrEqual(
          INTER_CITY_MINUTES,
        );
      }
    }
  });

  it('spends the crew pace and its bonuses on the whole crossing, floor and all', () => {
    const home = at('kettle-row');
    const away = at('coldwater-halt');
    const plain = travelMinutesBetween(home, away);
    const quick = travelMinutesBetween(home, away, {
      speed: 100,
      reductionPercent: 60,
      flatMinutesOff: 30,
    });
    // Halved by the pace, then six tenths off that, then thirty minutes: a crossing is a road and
    // every channel a road reads is spent on it, the frontier term included.
    expect(quick).toBeLessThan(plain / 2);
    expect(quick).toBeGreaterThanOrEqual(MIN_TRAVEL_MINUTES);
  });
});
