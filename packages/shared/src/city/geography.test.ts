import { describe, expect, it } from 'vitest';
import { ALL_DISTRICTS, districtsOfCity, findDistrict } from './atlas.js';
import {
  INTER_CITY_MINUTES,
  MIN_TRAVEL_MINUTES,
  TRAVEL_MINUTES_PER_MAP_UNIT,
  mapDistance,
  rawMinutesBetween,
  travelMinutesBetween,
} from './geography.js';

/**
 * The map's own arithmetic, now that there is more than one map (2026-09-24, retuned 2026-10-07).
 *
 * A position is normalised 0 to 1 inside its own city, so the three cities are printed on top of
 * one another and the distance between two of them is not a distance. The maintainer's answer is
 * that there is no such distance to read: a crossing is a flat four hours whoever is crossing and
 * wherever the two ends sit, and geography is an inside-a-city idea. Pinned here as an equality
 * over every pair in the world, which also catches the opposite defect, a flat branch that
 * swallowed the roads inside a city too.
 */

const at = (id: string) => {
  const district = findDistrict(id);
  expect(district, id).toBeDefined();
  return district!;
};

describe('the road between two cities', () => {
  it('is a flat four hours, for any pair in the world', () => {
    expect(INTER_CITY_MINUTES).toBe(240);
    let pairs = 0;
    for (const from of ALL_DISTRICTS) {
      for (const to of ALL_DISTRICTS) {
        if (from.cityId === to.cityId) continue;
        expect(rawMinutesBetween(from, to), `${from.id} to ${to.id}`).toBe(INTER_CITY_MINUTES);
        pairs += 1;
      }
    }
    // The world has to have more than one city for the loop above to have measured anything.
    expect(pairs).toBeGreaterThan(0);
  });

  /**
   * The other half of the ruling: "relative geography only happens inside a city".
   *
   * A flat crossing is one `if` away from a flat everything, and a road of four hours between two
   * neighbouring districts would be the same bug as the two-minute crossing wearing a different
   * number. So the in-city road is still the straight line at the map's own rate, and it still
   * differs from pair to pair.
   */
  it('leaves the roads inside a city measured off the map', () => {
    const home = at('kettle-row');
    const near = at('neon-docks');
    expect(rawMinutesBetween(home, near)).toBeCloseTo(
      mapDistance(home.position, near.position) * TRAVEL_MINUTES_PER_MAP_UNIT,
      9,
    );

    const roads = new Set(
      districtsOfCity(home.cityId).map((district) => Math.round(rawMinutesBetween(home, district))),
    );
    expect(roads.size).toBeGreaterThan(3);
    expect(Math.max(...roads)).toBeLessThan(INTER_CITY_MINUTES);
  });

  it('spends the crew pace and its bonuses on the whole crossing, floor and all', () => {
    const home = at('kettle-row');
    const away = at('coldwater-halt');
    const plain = travelMinutesBetween(home, away);
    const quick = travelMinutesBetween(home, away, {
      speed: 100,
      reductionPercent: 60,
    });
    // A crew with nothing pays the figure itself, which is what "adding then the bonuses"
    // (maintainer, 2026-10-07) means: no floor under the crossing and no cap over it.
    expect(plain).toBe(INTER_CITY_MINUTES);
    // Halved by the pace, then the travel channel off that, then thirty whole minutes: a crossing
    // is a road and every channel a road reads is spent on the whole of it.
    expect(quick).toBeLessThan(plain / 2);
    expect(quick).toBeGreaterThanOrEqual(MIN_TRAVEL_MINUTES);
  });
});
