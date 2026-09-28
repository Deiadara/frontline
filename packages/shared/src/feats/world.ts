import { ALL_DISTRICTS } from '../city/atlas.js';
import { CITIES } from '../city/cities.js';
import { startingGarrison } from '../city/control.js';
import type { District } from '../city/districts.js';
import type { Location } from '../city/locations.js';

/**
 * The world as the catalogue is allowed to count it (2026-09-24).
 *
 * ## Why this is not `ALL_DISTRICTS`
 *
 * A feat's target has to be a number somebody can reach. `CITIES` carries five rows and only the
 * ones marked `open` have a painted map, a seeded world and a board behind them: Saltmarch is
 * authored ground with no server, and Redline and Deepcut are a name and a sentence. Counting
 * those into a ceiling would strand a rung, which is the `stock_3` failure this package already
 * shipped once and which looks exactly like a feat nobody has got round to.
 *
 * ## Why it is not `CITY_DISTRICTS` either
 *
 * That array is Ashfall, and Ashfall stopped being the world when Terminus opened. Every ceiling
 * derived from it quietly told a crew that holding forty five locations was half the city, on a
 * board where the second city alone has sixty.
 *
 * So the rule is **open cities, all of them**, and it is derived rather than listed: the day
 * Saltmarch gets a server, one boolean in `cities.ts` moves every ceiling and every generated
 * feat with it.
 *
 * ## The one number that is not a total
 *
 * {@link reachableAbroad} exists because "abroad" is measured from wherever a crew lives, and the
 * two open cities are not the same size. A target set at the bigger city's total is a rung an
 * Ashfall crew can stand on and a Terminus crew cannot, so anything counting foreign ground is
 * bounded by the **worst** home a player could have picked.
 */

const OPEN_CITY_IDS: ReadonlySet<string> = new Set(
  CITIES.filter((city) => city.open).map((city) => city.id),
);

/** Every district a crew can actually be sent to today, in map order. */
export const PLAYABLE_DISTRICTS: readonly District[] = ALL_DISTRICTS.filter((district) =>
  OPEN_CITY_IDS.has(district.cityId),
);

/** The contested half of it: the ground there is something to take, and something to work. */
export const PLAYABLE_CONTESTED: readonly District[] = PLAYABLE_DISTRICTS.filter(
  (district) => district.kind === 'contested',
);

export const PLAYABLE_LOCATIONS: readonly Location[] = PLAYABLE_DISTRICTS.flatMap(
  (district) => district.locations,
);

/** Cities a crew can hold ground in, which is the ceiling on "how many cities are you in". */
export const PLAYABLE_CITY_COUNT = OPEN_CITY_IDS.size;

/**
 * Districts in the leanest open city.
 *
 * The bound for anything a crew does **at home**, because a crew lives in exactly one city and a
 * rung sized off the roomiest one is a rung the other city's residents cannot reach. Twelve and
 * twelve today, which is why nothing has noticed; it is derived so that the first city with ten
 * districts does not strand a rung on the day it opens.
 */
export const SMALLEST_CITY_DISTRICTS: number = Math.min(
  ...[...OPEN_CITY_IDS].map(
    (cityId) => PLAYABLE_DISTRICTS.filter((district) => district.cityId === cityId).length,
  ),
);

/** Districts that can be held end to end. A plot has nothing on it to take. */
export const HOLDABLE_DISTRICTS: readonly District[] = PLAYABLE_DISTRICTS.filter(
  (district) => district.locations.length > 0,
);

/**
 * The regime's own ground, by allegiance rather than by who stands on it today.
 *
 * Six districts in Ashfall and four in Terminus. `allegiance` says whether the Combine owns the
 * district; a district the crew took off looters is not the regime's and never was.
 */
export const COMBINE_DISTRICTS: readonly District[] = HOLDABLE_DISTRICTS.filter(
  (district) => district.allegiance === 'government',
);

/**
 * Districts somebody other than a crew garrisons, which is the ground that can be stripped bare.
 *
 * Sixteen of the twenty four playable districts: the eight residential blocks hold no locations at
 * all, and every contested district has at least one plot the regime or the squatters stand on.
 * Derived off `startingGarrison`, which is the same reading the world seeder and the Monday sweep
 * take, so a district the catalogue stops garrisoning drops out of the ceiling with it rather than
 * stranding the top rung of the ladder that counts them (`districts_emptied`).
 *
 * The bound this gives is **per week**, not for ever: `settleGarrisonRegrowth` puts every one of
 * them back on Monday morning, so a ladder on stripped districts may ask for more than sixteen and
 * `catalog.test.ts` says how many weeks' worth it is allowed to want.
 */
export const GARRISONED_DISTRICTS: readonly District[] = PLAYABLE_DISTRICTS.filter((district) =>
  district.locations.some(
    (location) => Object.keys(startingGarrison(location, district)).length > 0,
  ),
);

/** The regime's chapels: the Chosen Chapel over Ashfall and the Frontier Chapel inside Control. */
export const CHAPEL_LOCATIONS: readonly Location[] = PLAYABLE_LOCATIONS.filter(
  (location) => location.kind === 'combine_chapel',
);

/** Terminus's seven platforms, which are the whole of the railway a crew can hold. */
export const RAIL_STATIONS: readonly Location[] = PLAYABLE_LOCATIONS.filter(
  (location) => location.kind === 'rail_station',
);

/**
 * The most of something a crew can hold outside its own city, whichever city that is.
 *
 * `count` is read off one city's worth of whatever is being counted, and the answer is the total
 * minus the **largest** city's share: that is the crew who lives in the biggest place and has the
 * least foreign ground left to take. Bounding a foreign target any higher writes a rung that only
 * some players can stand on, and which city you started in is not a thing a feat should price.
 */
export function reachableAbroad(count: (district: District) => number): number {
  const byCity = new Map<string, number>();
  for (const district of PLAYABLE_DISTRICTS) {
    byCity.set(district.cityId, (byCity.get(district.cityId) ?? 0) + count(district));
  }
  const total = [...byCity.values()].reduce((sum, share) => sum + share, 0);
  return total - Math.max(0, ...byCity.values());
}
