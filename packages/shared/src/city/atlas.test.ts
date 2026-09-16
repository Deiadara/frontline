import { describe, expect, it } from 'vitest';
import { CITIES, DEFAULT_CITY_ID, findCity } from './cities.js';
import {
  ALL_DISTRICTS,
  ATLAS_UNIFIED_BONUSES,
  cityCounts,
  cityOf,
  districtsOfCity,
} from './atlas.js';
import { CITY_DISTRICTS, DistrictSchema } from './districts.js';
import { LOCATION_CATALOG, LOCATION_KINDS } from './locations.js';

/**
 * The world, once there is more than one city in it.
 *
 * `city.test.ts` holds Ashfall to its shape and is deliberately left alone: that map is what every
 * screen in the game draws, and a test that also had to be true of two unplayable frontier towns
 * would be a weaker test of the only city anybody is standing in. This file is the layer above,
 * and the one thing it most has to catch is the atlas and `CITY_DISTRICTS` drifting apart.
 */

const OTHER_CITIES = CITIES.filter((city) => city.id !== DEFAULT_CITY_ID);

describe('the atlas', () => {
  it('leaves Ashfall exactly as it was', () => {
    // The load-bearing one. Eighty-one call sites read `CITY_DISTRICTS` meaning "the city I am in",
    // and the whole reason the atlas is a separate module is that appending to that array would
    // have silently doubled the map every one of them draws.
    expect(districtsOfCity(DEFAULT_CITY_ID)).toBe(CITY_DISTRICTS);
    expect(CITY_DISTRICTS).toHaveLength(12);
  });

  it('gives every city districts, and every district back to its city', () => {
    for (const city of CITIES) {
      const districts = districtsOfCity(city.id);
      expect(districts.length, city.id).toBeGreaterThan(0);
      for (const district of districts) {
        expect(district.cityId, district.id).toBe(city.id);
        // The edge the rest of the game walks. A district the atlas knows and `cityOf` does not is
        // a district that is nowhere as far as the standings are concerned.
        expect(cityOf(district.id), district.id).toBe(city.id);
      }
    }
  });

  it('builds each new city to the shape that was asked for: three contested, four plots', () => {
    expect(OTHER_CITIES.length).toBe(2);
    for (const city of OTHER_CITIES) {
      const counts = cityCounts(city.id);
      expect(counts, city.id).toEqual({ contested: 3, plots: 4 });
    }
    // The same number of homes as Ashfall, which is the half of the shape that matters: a city is
    // somewhere to live before it is somewhere to fight.
    expect(cityCounts(DEFAULT_CITY_ID).plots).toBe(cityCounts(OTHER_CITIES[0]!.id).plots);
  });

  it('has no id used twice anywhere in the world', () => {
    const districts = ALL_DISTRICTS.map((one) => one.id);
    expect(new Set(districts).size).toBe(districts.length);

    const locations = ALL_DISTRICTS.flatMap((one) => one.locations.map((place) => place.id));
    expect(new Set(locations).size).toBe(locations.length);

    const cities = CITIES.map((one) => one.id);
    expect(new Set(cities).size).toBe(cities.length);
  });

  it('parses every district against the schema the wire uses', () => {
    // Authored through `districtFrom` rather than as literals, so this is the check that the helper
    // fills in everything the schema demands. A missing default would reach a screen as a crash.
    for (const district of ALL_DISTRICTS) {
      expect(() => DistrictSchema.parse(district), district.id).not.toThrow();
    }
  });

  it('keeps every location pointed at the district it is in, on a kind the game has', () => {
    for (const district of ALL_DISTRICTS) {
      for (const place of district.locations) {
        expect(place.districtId, place.id).toBe(district.id);
        expect(LOCATION_KINDS, place.id).toContain(place.kind);
      }
    }
  });

  it('gives contested ground locations and leaves the plots bare', () => {
    for (const district of ALL_DISTRICTS) {
      if (district.kind === 'contested') {
        // A contested district with nothing in it is a district that can never be taken: the
        // district falls when every location in it is held, so zero locations is an unwinnable one.
        expect(district.locations.length, district.id).toBeGreaterThan(0);
      } else {
        expect(district.locations, district.id).toEqual([]);
      }
    }
  });

  it('describes every city, and says whether anybody can go there', () => {
    for (const city of CITIES) {
      expect(findCity(city.id)).toEqual(city);
      expect(city.blurb.length, city.id).toBeGreaterThan(40);
      expect(typeof city.open, city.id).toBe('boolean');
    }
    // Exactly one is playable today. The other two are authored ground with no server behind them,
    // and the cities screen draws them shut rather than hiding them.
    expect(CITIES.filter((city) => city.open).map((city) => city.id)).toEqual([DEFAULT_CITY_ID]);
  });

  /**
   * Finishing a district has to be worth something, and something *else*.
   *
   * The atlas shipped with none of these: all six new contested districts could be taken whole and
   * paid nothing. The second half of the rule is the one with teeth, and it is Ashfall's own
   * (`city.test.ts`): a unified bonus may not be a kind that already appears inside its district,
   * or the reward for completing the ground is indistinguishable from farming its best hold.
   */
  it('pays for finishing a new district, in a coin that district does not already mint', () => {
    const contested = ALL_DISTRICTS.filter(
      (one) => one.kind === 'contested' && one.cityId !== DEFAULT_CITY_ID,
    );
    expect(contested.length).toBe(6);

    for (const district of contested) {
      const unified = ATLAS_UNIFIED_BONUSES[district.id];
      expect(unified, district.id).toBeDefined();
      expect(unified!.title.length, district.id).toBeGreaterThan(5);
      /*
       * Read through the union rather than off `.percent`.
       *
       * `HoldBonus` is a discriminated union and most kinds carry a percentage, but not all:
       * `unit_morale` carries a flat figure and three others carry no number at all. The first cut
       * of this assertion read `.percent` and did not compile, which is the schema doing its job:
       * a bonus is not a number with a label on it.
       */
      const figure =
        'percent' in unified!.bonus
          ? unified!.bonus.percent
          : 'flat' in unified!.bonus
            ? unified!.bonus.flat
            : 1;
      expect(figure, district.id).toBeGreaterThan(0);

      const inside = new Set(
        district.locations.flatMap((place) =>
          LOCATION_CATALOG[place.kind].bonuses.map((bonus) => bonus.kind),
        ),
      );
      expect(
        inside.has(unified!.bonus.kind),
        `${district.id}'s unified bonus is more of the same`,
      ).toBe(false);
    }
    // No bonus for ground that does not exist, and none missing.
    expect(Object.keys(ATLAS_UNIFIED_BONUSES).sort()).toEqual(
      contested.map((one) => one.id).sort(),
    );
  });

  it('answers with nothing for a city the world does not have', () => {
    expect(districtsOfCity('nowhere')).toEqual([]);
    expect(cityCounts('nowhere')).toEqual({ contested: 0, plots: 0 });
    expect(findCity('nowhere')).toBeUndefined();
  });
});
