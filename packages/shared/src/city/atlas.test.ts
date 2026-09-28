import { describe, expect, it } from 'vitest';
import { CITIES, DEFAULT_CITY_ID, findCity } from './cities.js';
import {
  ALL_DISTRICTS,
  ATLAS_UNIFIED_BONUSES,
  SALTMARCH_CITY_ID,
  TERMINUS_CITY_ID,
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

/**
 * The cities the atlas has actually drawn ground for.
 *
 * Not every row in `CITIES` has a map behind it: a city can be a name and a blurb on the world
 * screen for a while before anybody authors its districts, and Redline and Deepcut are that today.
 * The rules below that are about *ground* are held against this set, and the one rule that keeps
 * the gap honest is the last test in this block: a city with no ground may not be open.
 */
const SETTLED = CITIES.filter((city) => districtsOfCity(city.id).length > 0);

/**
 * How many of each kind a city holds.
 *
 * This was an export on the atlas and was drawn on the cities screen. That screen stopped showing
 * the numbers on 2026-09-24, which left a shared export whose only reader was this file, so the
 * counting came here rather than staying on the wire as a thing nothing asks for.
 */
const countsOf = (cityId: string) => {
  const districts = districtsOfCity(cityId);
  return {
    contested: districts.filter((one) => one.kind === 'contested').length,
    plots: districts.filter((one) => one.kind === 'residential').length,
  };
};

describe('the atlas', () => {
  it('leaves Ashfall exactly as it was', () => {
    // The load-bearing one. Eighty-one call sites read `CITY_DISTRICTS` meaning "the city I am in",
    // and the whole reason the atlas is a separate module is that appending to that array would
    // have silently doubled the map every one of them draws.
    expect(districtsOfCity(DEFAULT_CITY_ID)).toBe(CITY_DISTRICTS);
    expect(CITY_DISTRICTS).toHaveLength(12);
  });

  it('gives every settled city districts, and every district back to its city', () => {
    // A guard on the fixture: with nothing settled this loop asserts nothing at all.
    expect(SETTLED.length).toBeGreaterThan(1);
    for (const city of SETTLED) {
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

  it('builds each settled city to the shape that was asked for', () => {
    /*
     * Two shapes, and the difference between them is the difference between a city and a sketch.
     *
     * Terminus was grown to Ashfall's size when it opened (maintainer, 2026-09-24): eight contested
     * districts and four plots, the same as the city a player starts in, because a second playable
     * city that was a third of the size would read as a side area rather than as somewhere to
     * live. Saltmarch is still the three-district sketch it was authored as, and is shut.
     */
    expect(countsOf(DEFAULT_CITY_ID)).toEqual({ contested: 8, plots: 4 });
    expect(countsOf(TERMINUS_CITY_ID)).toEqual({ contested: 8, plots: 4 });
    expect(countsOf(SALTMARCH_CITY_ID)).toEqual({ contested: 3, plots: 4 });

    // Four plots everywhere, which is the half of the shape that matters most: a city is somewhere
    // to live before it is somewhere to fight, and a crew has to be able to get an address.
    for (const city of SETTLED) expect(countsOf(city.id).plots, city.id).toBe(4);
  });

  it('puts a platform in every Terminus district the line actually reaches', () => {
    /*
     * The city's one trait, held to its own rule (`docs/DISTRICTS.md`).
     *
     * Seven of the eight contested districts hold exactly one Station. Telemetry Hill holds none:
     * the line runs past the foot of the ridge and does not climb it. Exactly one, not at least
     * one, because two platforms in a district would make the second one free: the link is a
     * property of the district pair, so the same journey would already be linked.
     */
    const contested = districtsOfCity(TERMINUS_CITY_ID).filter((one) => one.kind === 'contested');
    const stations = new Map(
      contested.map((district) => [
        district.id,
        district.locations.filter((one) => one.kind === 'rail_station').length,
      ]),
    );
    expect(stations.get('telemetry-hill')).toBe(0);
    for (const [districtId, count] of stations) {
      if (districtId === 'telemetry-hill') continue;
      expect(count, districtId).toBe(1);
    }

    // And nowhere else in the world: the railway is what Terminus is, and a platform in Ashfall
    // would be a second city's mechanic paying out in the first one.
    for (const district of ALL_DISTRICTS) {
      if (district.cityId === TERMINUS_CITY_ID) continue;
      expect(
        district.locations.some((one) => one.kind === 'rail_station'),
        district.id,
      ).toBe(false);
    }
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
    // Two are playable, and Terminus is second in the list because that is the order the world
    // screen draws them in. The other three are drawn shut rather than hidden.
    expect(CITIES.filter((city) => city.open).map((city) => city.id)).toEqual([
      DEFAULT_CITY_ID,
      TERMINUS_CITY_ID,
    ]);
    expect(CITIES.map((city) => city.id)[1]).toBe(TERMINUS_CITY_ID);
  });

  it('never opens a city the atlas has no ground for', () => {
    /*
     * The rule that makes "a city can be a name before it is a map" safe to keep doing.
     *
     * An open city is one a crew can walk into, and walking in means districts to stand in,
     * locations to take and a mission board built out of them. Opening a row with nothing behind
     * it in the atlas would be a door onto an empty map, and every symptom of it would show up
     * somewhere else: an empty picker, a standings scope that counts nothing, a Bar with no
     * calibre. Caught here instead, on the one line that would have to change to cause it.
     */
    const groundless = CITIES.filter((city) => districtsOfCity(city.id).length === 0);
    // A guard on the fixture: once every city is drawn this test would otherwise pass vacuously,
    // and it should be deleted rather than left green.
    expect(groundless.length).toBeGreaterThan(0);
    for (const city of groundless) expect(city.open, city.id).toBe(false);
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
    expect(contested.length).toBe(11);

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
    expect(countsOf('nowhere')).toEqual({ contested: 0, plots: 0 });
    expect(findCity('nowhere')).toBeUndefined();
  });
});

/**
 * §A4: an id is the name on the tag (maintainer, 2026-09-25).
 *
 * The rule is about the URL a player can read and repeat: the Steelbelt's page is
 * `/game/city/steelbelt`, not `/game/city/rustyard`. It held for the districts drawn first and
 * then stopped holding four separate ways at once, because an id gets typed once and a name gets
 * revised: `blacksite-7` kept a number the tag never showed, `datavault-sigma` and `combine-spire`
 * were authoring notes for districts since renamed, and every district outside Ashfall carried a
 * two-letter city prefix that appears nowhere on screen.
 *
 * A guard rather than a generator: the ids are typed out in `atlas.ts` and `districts.ts` where a
 * reader can see them, and this is what refuses the next one that drifts.
 */
describe('an id is the name on the tag', () => {
  /** Lowercased, hyphenated, and a leading "The" dropped: `The Last Platform` is `last-platform`. */
  const slug = (name: string): string =>
    name
      .toLowerCase()
      .replace(/^the /, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  it('gives every contested district the slug of its own name', () => {
    const contested = ALL_DISTRICTS.filter((district) => district.kind === 'contested');
    // A guard on the guard: an empty list would make every assertion below vacuous.
    expect(contested.length).toBeGreaterThan(15);
    for (const district of contested) {
      expect(district.id, `${district.name} in ${district.cityId}`).toBe(slug(district.name));
    }
  });

  it('gives every city the slug of its own name', () => {
    for (const city of CITIES) expect(city.id, city.name).toBe(slug(city.name));
  });

  /**
   * The plots are the exception, and the exception has to be the narrow one.
   *
   * A plot's tag shows whoever lives on it, so there is no name to take: every one of them is
   * called "Player District" and matching the rule would give twelve districts one id. They keep
   * the names they were authored under. What is still checked is that they are not carrying a city
   * prefix either, which is the half of the rename that was about ids saying things a player
   * never sees.
   */
  it('leaves no city prefix on a plot, which has no tag name to take', () => {
    const plots = ALL_DISTRICTS.filter((district) => district.kind === 'residential');
    expect(plots.length).toBeGreaterThan(8);
    for (const plot of plots) {
      expect(plot.id, plot.id).not.toMatch(/^(tm|sm|rl|dc)-/);
    }
  });

  /**
   * And a location wears its district's id, which is what makes a location id readable on its own
   * and what the 0120 migration's prefix rewrite depends on being true.
   */
  it('prefixes every location with the district it stands in', () => {
    for (const district of ALL_DISTRICTS) {
      for (const location of district.locations) {
        expect(location.id, `${location.name} in ${district.name}`).toMatch(
          new RegExp(`^${district.id}-`),
        );
      }
    }
  });
});

/**
 * A city's blurb counts its own ground, and the count has to be true.
 *
 * Ashfall's said "Ten districts" while the map had twelve, and it is the first sentence a player
 * reads about the place: it is on the world screen, on the card they choose a city from, and it is
 * the only number on that screen. Nothing counted it, because prose is prose, so it went stale the
 * day the map grew and stayed stale.
 *
 * The blurbs are written by hand and stay written by hand. What is checked is the one thing in
 * them that is a fact about the atlas rather than a fact about the city.
 */
describe('what a city says about itself', () => {
  const WORDS: Readonly<Record<string, number>> = {
    no: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
  };

  it('counts its districts the way the atlas counts them, or does not count them at all', () => {
    let claimed = 0;
    for (const city of CITIES) {
      const said = /\b([A-Za-z]+)\s+districts\b/i.exec(city.blurb);
      if (said === null) continue;
      const number = WORDS[said[1]!.toLowerCase()];
      // A blurb may say "the districts" or "its districts" and mean nothing countable.
      if (number === undefined) continue;
      claimed += 1;
      expect(number, `${city.name}: "${said[0]}"`).toBe(districtsOfCity(city.id).length);
    }
    // A guard on the guard: if nobody's blurb names a count any more, this test passes by saying
    // nothing, and the next one written goes unchecked.
    expect(claimed, 'no city blurb names a district count for this to check').toBeGreaterThan(0);
  });
});
