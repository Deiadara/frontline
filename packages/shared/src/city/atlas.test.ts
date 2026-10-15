import { describe, expect, it } from 'vitest';
import { CITIES, DEFAULT_CITY_ID, findCity } from './cities.js';
import {
  ALL_DISTRICTS,
  ATLAS_UNIFIED_BONUSES,
  ARCA_CITY_ID,
  TERMINUS_CITY_ID,
  cityOf,
  districtsOfCity,
  findLocation,
} from './atlas.js';
import { CITY_DISTRICTS, DistrictSchema } from './districts.js';
import {
  applyHoldBonus,
  bonusesAt,
  describeHoldBonus,
  fiveLevelLadder,
  isStation,
  LOCATION_ICONS,
  noTerritoryEffects,
  stationCapsLadder,
} from './locations.js';
import { bareBattlefield } from '../battle/battlefield.js';
import { crewStealth, effectiveStats } from '../battle/effects.js';
import { findUnit, unitsUnlockedByLocation } from '../units/catalog.js';
import { vehiclePrice } from '../crew/effects.js';
import { buildBoostOilCost } from '../building/boost.js';
import { supplyMarkup } from '../market/supply.js';
import { missionSpeedCut } from '../economy/soft-bounds.js';
import { timeSavingPercent } from '../time/speed.js';

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
     * live. Arca was authored to the same shape and opened on 2026-10-07.
     */
    expect(countsOf(DEFAULT_CITY_ID)).toEqual({ contested: 8, plots: 4 });
    expect(countsOf(TERMINUS_CITY_ID)).toEqual({ contested: 8, plots: 4 });
    // Arca was authored a district at a time and finished on 2026-10-07: eight contested
    // and the four plots, the same shape. Saltmarch's three-district sketch went on 2026-10-06, to
    // keep the world screen at five.
    expect(countsOf(ARCA_CITY_ID)).toEqual({ contested: 8, plots: 4 });

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
      contested.map((district) => [district.id, district.locations.filter(isStation).length]),
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
      expect(district.locations.some(isStation), district.id).toBe(false);
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

  it('keeps every location pointed at the district it is in, wearing an icon the game has', () => {
    for (const district of ALL_DISTRICTS) {
      for (const place of district.locations) {
        expect(place.districtId, place.id).toBe(district.id);
        expect(LOCATION_ICONS, place.id).toContain(place.icon);
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
    // Three are playable (Arca since 2026-10-07), in the order the world screen draws them in.
    // The other two are drawn shut rather than hidden.
    expect(CITIES.filter((city) => city.open).map((city) => city.id)).toEqual([
      DEFAULT_CITY_ID,
      TERMINUS_CITY_ID,
      ARCA_CITY_ID,
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
    // Eight Terminus and eight Arca (finished 2026-10-07); Saltmarch's three went on
    // 2026-10-06.
    expect(contested.length).toBe(16);

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

      // What each plot pays, read off the plot itself.
      const inside = new Set(
        district.locations.flatMap((place) => place.bonuses.map((bonus) => bonus.kind)),
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
  /**
   * Lowercased, hyphenated, and a leading "The" dropped: `The Last Platform` is `last-platform`.
   * An apostrophe is not a word break: `Saint's Rest` is `saints-rest` (2026-10-07), not
   * `saint-s-rest`, which no reader would type.
   */
  const slug = (name: string): string =>
    name
      .toLowerCase()
      .replace(/^the /, '')
      .replace(/['\u2019]/g, '')
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

/**
 * Coldwater Halt and the Stations (maintainer, 2026-10-09). The figures are the maintainer's, so
 * they are written out here rather than derived from the functions that produce them.
 */
describe('what the Stations and Coldwater Halt pay', () => {
  const placed = (id: string) => {
    const location = findLocation(id);
    expect(location, id).toBeDefined();
    return location!;
  };
  const capsAt = (id: string, level: number) =>
    bonusesAt(placed(id), level).find((one) => one.kind === 'resource' && one.resource === 'caps');

  it('grows a ticket office by half its opening figure a step, the last step double', () => {
    expect(stationCapsLadder(20)).toEqual([20, 30, 40, 50, 70]);
    expect(stationCapsLadder(100)).toEqual([100, 150, 200, 250, 350]);
  });

  it('pays ten caps an hour per point of difficulty at level 1, and twenty at Coldwater', () => {
    const stations = districtsOfCity(TERMINUS_CITY_ID).flatMap((district) =>
      district.locations
        .filter(isStation)
        .map((one) => [one.id, district.kind === 'contested' ? district.difficulty : 0] as const),
    );
    expect(stations.map(([id]) => id)).toEqual([
      'coldwater-halt-platform',
      'ironmouth-halt',
      'marshalling-yards-platformfour',
      'bonded-row-halt',
      'viaduct-halt',
      'last-platform-platform',
      'blockhouse-officershalt',
    ]);
    for (const [id, difficulty] of stations) {
      const start = id === 'coldwater-halt-platform' ? 20 : difficulty * 10;
      const ladder = [1, 2, 3, 4, 5].map((level) => {
        const caps = capsAt(id, level);
        return caps?.kind === 'resource' ? caps.perHour : 0;
      });
      expect(ladder, id).toEqual(stationCapsLadder(start));
      // The line on every one, and no beds of a Station's own any more.
      expect(bonusesAt(placed(id), 1).map((one) => one.kind)).toEqual(['rail_link', 'resource']);
    }
    expect(capsAt('blockhouse-officershalt', 5)).toMatchObject({ perHour: 350 });
  });

  it('pays the Standpipe 35 supplies an hour, fifteen more a step', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => {
        const [only] = bonusesAt(placed('coldwater-halt-standpipe'), level);
        return only?.kind === 'resource' && only.resource === 'supplies' ? only.perHour : 0;
      }),
    ).toEqual([35, 50, 65, 80, 110]);
  });

  it('turns the Halt Market into a better Broker: 10, 15, 20, 25, 35%', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) =>
        bonusesAt(placed('coldwater-halt-market'), level).map((one) =>
          one.kind === 'broker_rate' ? one.percent : `${one.kind}`,
        ),
      ),
    ).toEqual([[10], [15], [20], [25], [35]]);
    // Only this Market: the Tideline keeps its caps.
    expect(placed('neon-docks-tideline').bonuses).toEqual([
      { kind: 'resource', resource: 'caps', perHour: 30 },
    ]);
  });

  it('pays the Fuelling Point oil and a cheaper scrap bill on vehicles', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => bonusesAt(placed('coldwater-halt-fuelling'), level)),
    ).toEqual(
      [
        [25, 5],
        [35, 6],
        [45, 7],
        [55, 8],
        [75, 10],
      ].map(([oil, scrap], step) => [
        {
          kind: 'resource',
          resource: 'oil',
          perHour: oil,
          ladder: [25, 35, 45, 55, 75],
          level: step + 1,
        },
        { kind: 'vehicle_scrap', percent: scrap, ladder: [5, 6, 7, 8, 10], level: step + 1 },
      ]),
    );
    // The Steelbelt's pumps keep their oil and scrap.
    expect(placed('steelbelt-pumps').bonuses.map((one) => one.kind)).toEqual([
      'resource',
      'resource',
    ]);
  });

  it('takes the Fuelling Point`s share off the scrap line alone, after the parts cut', () => {
    const cost = { caps: 100, scrap: 200, oil: 40 };
    const none = { vehiclePartsPercent: 0, vehicleScrapPercent: 0 };
    expect(vehiclePrice(cost, none)).toEqual(cost);
    expect(vehiclePrice(cost, { ...none, vehicleScrapPercent: 5 })).toEqual({
      caps: 100,
      scrap: 190,
      oil: 40,
    });
    // With a Rail Yard's 20 points: 20% off every line, then 9% off what is left of the scrap.
    expect(vehiclePrice(cost, { vehiclePartsPercent: 20, vehicleScrapPercent: 9 })).toEqual({
      caps: 80,
      scrap: Math.round(160 * 0.91),
      oil: 32,
    });
    // A machine with no scrap in its price is not touched.
    expect(vehiclePrice({ caps: 50 }, { ...none, vehicleScrapPercent: 9 })).toEqual({ caps: 50 });
  });

  it('houses people at Tent Row and pays no caps: 50 rising to 175', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) =>
        bonusesAt(placed('coldwater-halt-tentrow'), level).map((one) =>
          one.kind === 'unit_slots' ? one.flat : `${one.kind}`,
        ),
      ),
    ).toEqual([[50], [75], [100], [125], [175]]);
  });

  it('pays the Distant Signal 40 spy points, twenty more a step', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) =>
        bonusesAt(placed('coldwater-halt-signal'), level).map((one) =>
          one.kind === 'intel' ? one.percent : `${one.kind}`,
        ),
      ),
    ).toEqual([[40], [60], [80], [100], [140]]);
  });

  it('feeds the rabble at Trackside Kitchens and nobody else', () => {
    const fold = (level: number) =>
      bonusesAt(placed('coldwater-halt-kitchens'), level).reduce(
        (into, bonus) => applyHoldBonus(into, bonus),
        noTerritoryEffects(),
      );
    expect(fold(1).unitStatFlats).toEqual([{ stat: 'vitality', flat: 10, tier: 'rabble' }]);
    expect(fold(5).unitStatFlats).toEqual([{ stat: 'vitality', flat: 20, tier: 'rabble' }]);
    // Nothing the Soup Kitchen kind pays leaks through.
    expect(fold(1).perHour).toEqual({});
    expect(fold(1).unitMoraleFlat).toBe(0);
    expect(fold(1).unitSlotBonus).toBe(0);

    const field = bareBattlefield();
    const side = { defending: false, outnumbered: 0 };
    const gained = (unitId: string, level: number) => {
      const unit = findUnit(unitId)!;
      return (
        effectiveStats(unit, field, side, fold(level)).vitality -
        effectiveStats(unit, field, side, noTerritoryEffects()).vitality
      );
    };
    expect(findUnit('razors')!.tier).toBe('rabble');
    expect([1, 2, 3, 4, 5].map((level) => gained('razors', level))).toEqual([10, 12, 14, 16, 20]);
    for (const unitId of ['ironsides', 'anodics', 'sparks']) {
      if (findUnit(unitId)!.tier === 'rabble') continue;
      expect(gained(unitId, 5), unitId).toBe(0);
    }
    expect(describeHoldBonus(bonusesAt(placed('coldwater-halt-kitchens'), 1)[0]!)).toBe(
      '+10 vitality on every Rabble unit',
    );
  });
});

/**
 * The maintainer's "X scaling up to Y" (2026-10-09): six even steps, levels 1 to 4 on the first
 * four and level 5 on the last.
 */
describe('a five level ladder from two figures', () => {
  it('is the maintainer`s two worked examples', () => {
    expect(fiveLevelLadder(10, 20)).toEqual([10, 12, 14, 16, 20]);
    expect(fiveLevelLadder(5, 10)).toEqual([5, 6, 7, 8, 10]);
  });

  it('keeps an uneven step to two places rather than rounding it away', () => {
    expect(fiveLevelLadder(3, 7)).toEqual([3, 3.8, 4.6, 5.4, 7]);
  });
});

/** Ironmouth's two reworked plots (maintainer, 2026-10-09). */
describe('what Ironmouth`s shafts and arches pay', () => {
  const placed = (id: string) => {
    const location = findLocation(id);
    expect(location, id).toBeDefined();
    return location!;
  };
  const fold = (id: string, level: number) =>
    bonusesAt(placed(id), level).reduce(
      (into, bonus) => applyHoldBonus(into, bonus, { cityId: TERMINUS_CITY_ID }),
      noTerritoryEffects(),
    );

  it('gives every unit flat stealth at the Ventilation Shafts: 5, 6, 7, 8, 10', () => {
    expect([1, 2, 3, 4, 5].map((level) => fold('ironmouth-shafts', level).unitStatFlats)).toEqual(
      [5, 6, 7, 8, 10].map((flat) => [{ stat: 'stealth', flat }]),
    );
    // No share of stealth any more, and the Undergrid's junction keeps its share.
    expect(fold('ironmouth-shafts', 5).unitStealthPercent).toBe(0);
    expect(placed('undergrid-junction').bonuses).toEqual([{ kind: 'unit_stealth', percent: 15 }]);
    expect(describeHoldBonus(bonusesAt(placed('ironmouth-shafts'), 1)[0]!)).toBe(
      '+5 stealth on every unit',
    );

    // On every unit, before the percentage, in a fight and out of one.
    const field = bareBattlefield();
    const side = { defending: false, outnumbered: 0 };
    for (const unitId of ['razors', 'ironsides']) {
      const unit = findUnit(unitId)!;
      const held = fold('ironmouth-shafts', 5);
      expect(
        effectiveStats(unit, field, side, held).stealth -
          effectiveStats(unit, field, side, noTerritoryEffects()).stealth,
        unitId,
      ).toBe(10);
      expect(crewStealth(unit, unit.stats.stealth, held), unitId).toBe(unit.stats.stealth + 10);
      expect(crewStealth(unit, unit.stats.stealth, { ...held, unitStealthPercent: 50 })).toBe(
        Math.min(100, Math.round((unit.stats.stealth + 10) * 1.5)),
      );
    }
  });

  it('cuts mission roads in Terminus at the Bricked Arches: 10, 12, 14, 16, 20', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => fold('ironmouth-arches', level).missionTravelPercentByCity),
    ).toEqual([10, 12, 14, 16, 20].map((percent) => ({ [TERMINUS_CITY_ID]: percent })));
    const held = fold('ironmouth-arches', 1);
    expect(held.missionSpeedPercent).toBe(0);
    // With no city to belong to it pays nothing rather than everywhere.
    const nowhere = bonusesAt(placed('ironmouth-arches'), 1).reduce(
      (into, bonus) => applyHoldBonus(into, bonus),
      noTerritoryEffects(),
    );
    expect(nowhere.missionTravelPercentByCity).toEqual({});
    // The Iron Footbridge pays on the whole job clock, everywhere (2026-10-14), not on the road.
    expect(bonusesAt(placed('last-platform-footbridge'), 1)).toMatchObject([
      { kind: 'mission_speed', percent: 15 },
    ]);
    expect(describeHoldBonus(bonusesAt(placed('ironmouth-arches'), 1)[0]!)).toBe(
      '-10% mission travel time in this city (tapers, no hard stop)',
    );
  });
});

/** Ironmouth's second batch (maintainer, 2026-10-09). */
describe('what Shaft Nine, the Spoil Heap and the Tunnel Chapel pay', () => {
  const placed = (id: string) => {
    const location = findLocation(id);
    expect(location, id).toBeDefined();
    return location!;
  };
  const figures = (id: string, level: number) =>
    bonusesAt(placed(id), level).map((one) =>
      'perHour' in one
        ? one.perHour
        : 'flat' in one
          ? one.flat
          : 'percent' in one
            ? one.percent
            : 0,
    );

  it('pays Shaft Nine oil and a cheaper burn: 30 to 80 oil, 10 to 20% off', () => {
    expect([1, 2, 3, 4, 5].map((level) => figures('ironmouth-shaftnine', level))).toEqual([
      [30, 10],
      [40, 12],
      [50, 14],
      [60, 16],
      [80, 20],
    ]);
    expect(describeHoldBonus(bonusesAt(placed('ironmouth-shaftnine'), 1)[1]!)).toBe(
      "-10% oil on the Generator's burn",
    );
    const generator = [
      { id: 'n', kind: 'nexus' as const, level: 6, modifications: [] },
      { id: 'g', kind: 'generator' as const, level: 4, modifications: [] },
    ];
    expect(buildBoostOilCost(generator, 20)).toBe(buildBoostOilCost(generator) * 0.8);
    expect(buildBoostOilCost(generator, 0)).toBe(buildBoostOilCost(generator));
    expect(buildBoostOilCost([], 20)).toBe(0);
  });

  it('pays XP on every yard press at the Spoil Heap: 200, 360, 520, 680, 1000', () => {
    expect([1, 2, 3, 4, 5].map((level) => figures('ironmouth-spoil', level))).toEqual([
      [200],
      [360],
      [520],
      [680],
      [1000],
    ]);
    expect(
      bonusesAt(placed('ironmouth-spoil'), 1).reduce(
        (into, bonus) => applyHoldBonus(into, bonus),
        noTerritoryEffects(),
      ).scrapyardXp,
    ).toBe(200);
    // The Steelbelt's press keeps its scrap and planks.
    expect(placed('steelbelt-press').bonuses.map((one) => one.kind)).toEqual([
      'resource',
      'resource',
    ]);
  });

  it('lifts three named skills at the Tunnel Chapel, 5 rising to 10, and drops the steady nerve', () => {
    const fold = (level: number) =>
      bonusesAt(placed('ironmouth-chapel'), level).reduce(
        (into, bonus) => applyHoldBonus(into, bonus),
        noTerritoryEffects(),
      );
    expect([1, 2, 3, 4, 5].map((level) => fold(level).officerSkillFlat)).toEqual(
      [5, 6, 7, 8, 10].map((flat) => ({ craft: flat, resolve: flat, navigation: flat })),
    );
    expect(fold(5).steadyNerve).toBe(false);
    expect(fold(5).officerGroupFlat).toEqual({});
    // The rule is still on the map: the Chapel of the Furrow keeps it.
    const elsewhere = ALL_DISTRICTS.flatMap((district) => district.locations).filter(
      (one) =>
        one.id !== 'ironmouth-chapel' &&
        bonusesAt(one, 1).some((bonus) => bonus.kind === 'steady_nerve'),
    );
    expect(elsewhere.length).toBeGreaterThan(0);
  });
});

/** The Hump, Lampman's Row and Ironmouth's whole-district bonus (maintainer, 2026-10-09). */
describe('the Hump, the lamps and the gate', () => {
  const placed = (id: string) => {
    const location = findLocation(id);
    expect(location, id).toBeDefined();
    return location!;
  };

  it('loads more onto every machine at the Hump: 10, 12, 14, 16, 20%', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) =>
        bonusesAt(placed('marshalling-yards-hump'), level).map((one) =>
          one.kind === 'vehicle_capacity' ? one.percent : `${one.kind}`,
        ),
      ),
    ).toEqual([[10], [12], [14], [16], [20]]);
    // A rail yard's picture, but no door to the Loose End (maintainer, 2026-10-09); the Hauler
    // Yard in Glasshouse Fields still is.
    expect(placed('marshalling-yards-hump').icon).toBe('rail_yard');
    expect(unitsUnlockedByLocation('marshalling-yards-hump')).toEqual([]);
    expect(unitsUnlockedByLocation('glasshouse-fields-haulers').length).toBeGreaterThan(0);
    // The Hauler Yard keeps the parts cut and the road, so `vehiclePrice` still has one.
    const yards = [placed('glasshouse-fields-haulers')];
    expect(yards.length).toBeGreaterThan(0);
    for (const yard of yards) {
      expect(
        bonusesAt(yard, 1).map((one) => one.kind),
        yard.id,
      ).toEqual(['vehicle_parts', 'travel_speed']);
    }
  });

  it('turns Lampman`s Row into the lamps and nothing else', () => {
    expect(bonusesAt(placed('ironmouth-lampman'), 3)).toEqual([{ kind: 'lamps_switch', level: 3 }]);
    expect(placed('neon-docks-chandler').bonuses).toEqual([{ kind: 'loot_capacity', percent: 15 }]);
  });

  it('pays Ironmouth held whole at a gate rather than everywhere', () => {
    expect(ATLAS_UNIFIED_BONUSES.ironmouth).toEqual({
      title: 'Nobody Digs You Out',
      bonus: { kind: 'gate_fight', percent: 5 },
    });
    expect(describeHoldBonus(ATLAS_UNIFIED_BONUSES.ironmouth!.bonus)).toBe(
      '+5% damage and vitality for units defending at a gate',
    );
  });
});

/** The Marshalling Yards' second batch (maintainer, 2026-10-09). */
describe('the Coaling Stage', () => {
  it('runs every machine faster and pays oil: 5 to 10%, 40 to 140 an hour', () => {
    const coaling = findLocation('marshalling-yards-coalstage')!;
    expect(
      [1, 2, 3, 4, 5].map((level) =>
        bonusesAt(coaling, level).map((one) =>
          one.kind === 'vehicle_speed'
            ? one.percent
            : one.kind === 'resource'
              ? one.perHour
              : `${one.kind}`,
        ),
      ),
    ).toEqual([
      [5, 40],
      [6, 60],
      [7, 80],
      [8, 100],
      [10, 140],
    ]);
    // The Steelbelt's pumps keep their oil and scrap.
    expect(findLocation('steelbelt-pumps')!.bonuses.map((one) => one.kind)).toEqual([
      'resource',
      'resource',
    ]);
  });
});

/** The Wagon Breakers (maintainer, 2026-10-09). */
describe('the Wagon Breakers', () => {
  it('says what comes each morning, at the rarity the level fixes', () => {
    const wagons = findLocation('marshalling-yards-breakers')!;
    expect([1, 2, 3, 4, 5].map((level) => describeHoldBonus(bonusesAt(wagons, level)[0]!))).toEqual(
      [
        "1 basic component a day, delivered at the day's turn",
        "1 intricate component a day, delivered at the day's turn",
        "2 intricate components a day, delivered at the day's turn",
        "2 advanced components a day, delivered at the day's turn",
        "3 advanced components a day, delivered at the day's turn",
      ],
    );
    // The Chop Shop still rolls its rarity off the level, so its card names none.
    expect(describeHoldBonus(bonusesAt(findLocation('bloodstone-chopshop')!, 1)[0]!)).toBe(
      "1 component a day, delivered at the day's turn",
    );
  });
});

/** The Marshalling Yards and Bonded Row, batch 8 (maintainer, 2026-10-09). */
describe('the Running Sheds, the Long Bond and the Seized Goods Office', () => {
  const placed = (id: string) => findLocation(id)!;
  const fold = (id: string, level: number) =>
    bonusesAt(placed(id), level).reduce(
      (into, bonus) => applyHoldBonus(into, bonus, { locationId: id }),
      noTerritoryEffects(),
    );

  it('plates every Heavy at the Running Sheds, 5 to 10 armour, and pays nothing else', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => fold('marshalling-yards-sheds', level).unitStatFlats),
    ).toEqual([5, 6, 7, 8, 10].map((flat) => [{ stat: 'armor', flat, tier: 'heavy' }]));
    expect(fold('marshalling-yards-sheds', 5).perHour).toEqual({});
  });

  it('takes 10 to 20% off the supply run at the Long Bond, and nothing else', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => fold('bonded-row-longbond', level).supplyDiscountPercent),
    ).toEqual([10, 12, 14, 16, 20]);
    const top = fold('bonded-row-longbond', 5);
    expect(top.marketDiscountPercent).toBe(0);
    expect(top.perHour).toEqual({});
    expect(describeHoldBonus(bonusesAt(placed('bonded-row-longbond'), 1)[0]!)).toBe(
      '-10% on resources bought on the supply run',
    );
    // Off whatever the run would have charged, after the discount and the Trader.
    expect(supplyMarkup(0, null, 10)).toBeCloseTo(supplyMarkup(0, null) * 0.9, 9);
    expect(supplyMarkup(20, 100, 20)).toBeCloseTo(supplyMarkup(20, 100) * 0.8, 9);
  });

  it('owes 1, 1, 2, 2, 3 pages a day at the Seized Goods Office, at odds rows 1, 2, 2, 3, 3', () => {
    expect([1, 2, 3, 4, 5].map((level) => fold('bonded-row-seized', level).dailyPages)).toEqual(
      [
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 3],
        [3, 3],
      ].map(([count, row]) =>
        Array.from({ length: count! }, () => ({ level: row, locationId: 'bonded-row-seized' })),
      ),
    );
    expect(fold('bonded-row-seized', 5).lootCapacityPercent).toBe(0);
    expect(describeHoldBonus(bonusesAt(placed('bonded-row-seized'), 3)[0]!)).toBe(
      '2 blueprint pages a day, of a blueprint you have not finished, better odds of a rare one at higher levels',
    );
    // The Scriptorium keeps one a day at the odds of its own level.
    expect(fold('printworks-scriptorium', 4).dailyPages).toEqual([
      { level: 4, locationId: 'printworks-scriptorium' },
    ]);
  });

  it('makes every Heavy stronger with the Yards held whole', () => {
    expect(ATLAS_UNIFIED_BONUSES['marshalling-yards']).toEqual({
      title: 'Built in the Yards',
      bonus: { kind: 'tier_strength', tier: 'heavy', percent: 10 },
    });
    const whole = applyHoldBonus(
      noTerritoryEffects(),
      ATLAS_UNIFIED_BONUSES['marshalling-yards']!.bonus,
    );
    const field = bareBattlefield();
    const side = { defending: false, outnumbered: 0 };
    const ratio = (unitId: string, stat: 'offense' | 'vitality') =>
      effectiveStats(findUnit(unitId)!, field, side, whole)[stat] /
      effectiveStats(findUnit(unitId)!, field, side, noTerritoryEffects())[stat];
    expect(findUnit('ironsides')!.tier).toBe('heavy');
    expect(ratio('ironsides', 'vitality')).toBeGreaterThan(1);
    expect(ratio('ironsides', 'offense')).toBeGreaterThan(1);
    expect(ratio('razors', 'vitality')).toBe(1);
  });
});

describe("Arca's written ladders", () => {
  /**
   * The last step double (maintainer, 2026-10-09): levels 1 to 4 as they were, level 5 at level 4
   * plus twice the step from 3 to 4. Counts of whole things keep their shape, and the two daily
   * chances take the double step under a 100% top (2026-10-13); the Tunnels are written as points into the mission clock's curve, so
   * they are held to the time they save instead.
   */
  const KEEP_SHAPE = new Set([
    'bloodstone-chopshop:daily_component',
    'saints-rest-yard:training_sessions',
    'printworks-tunnels:mission_speed',
  ]);
  const written = ALL_DISTRICTS.filter((district) => district.cityId === ARCA_CITY_ID).flatMap(
    (district) =>
      district.locations.flatMap((location) =>
        (location.bonuses ?? [])
          .filter((bonus) => bonus.ladder !== undefined)
          .map((bonus) => ({ id: `${location.id}:${bonus.kind}`, ladder: bonus.ladder! })),
      ),
  );

  it('pays the last step double on every one but the counts and the capped chances', () => {
    expect(written.length).toBeGreaterThan(20);
    for (const { id, ladder } of written) {
      if (KEEP_SHAPE.has(id)) continue;
      const [, , third, fourth, fifth] = ladder as [number, number, number, number, number];
      expect(fifth, id).toBe(fourth + 2 * (fourth - third));
    }
    expect(written.map(({ id }) => id)).toEqual(expect.arrayContaining([...KEEP_SHAPE]));
  });

  it('takes the Tunnels to 35% off at level 5, the last step double on the time saved', () => {
    const tunnels = written.find(({ id }) => id === 'printworks-tunnels:mission_speed')!;
    // Through the curve the clock applies (`missionTime`), not a plain divisor: the ladder was
    // checked against the divisor alone and paid 24% and 31% at the top two levels (2026-10-11).
    const off = tunnels.ladder.map((points) => timeSavingPercent(missionSpeedCut(points)));
    expect(off).toEqual([10, 15, 20, 25, 35]);
  });
});
