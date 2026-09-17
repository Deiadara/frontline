import {
  ALL_DISTRICTS,
  CITIES,
  DEFAULT_CITY_ID,
  canEnterCity,
  citiesOpenTo,
  cityCalibre,
  cityOfDistrict,
  type Base,
  type CityParticipant,
  type CityStake,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Who holds what, where, read off the live map (maintainer request, 2026-09-17).
 *
 * The rule itself is `city/access.ts` in `@frontline/shared`, which knows nothing about a database.
 * This is the half that does: it turns one read of the control map and one read of the standings
 * into the stakes that rule takes.
 *
 * ## One read, not one per city
 *
 * Every function here goes through {@link holdings}, which walks the control map once and counts
 * locations per crew per city. The Bar and the market ask these questions on every poll, and the
 * alternative shape (ask the map once per city, or once per crew) turns one scan into nine.
 */

/**
 * Every location on the map, not only the open city's.
 *
 * `CITY_LOCATIONS` is Ashfall's sixty, which is every location a control row can name today because
 * Ashfall is the one city with `open: true`. Walking the whole atlas instead costs nothing now and
 * is the difference between this rule working the day a second city opens and silently reporting
 * that nobody holds anything there.
 */
const EVERY_LOCATION = ALL_DISTRICTS.flatMap((district) =>
  district.locations.map((location) => ({ id: location.id, districtId: district.id })),
);

/** How many locations each crew holds in each city: `baseId -> cityId -> count`. */
function holdings(repos: Repositories): Map<string, Map<string, number>> {
  const controls = repos.city.controls();
  const byCrew = new Map<string, Map<string, number>>();
  for (const location of EVERY_LOCATION) {
    const holder = controls.get(location.id)?.holder;
    if (holder?.kind !== 'crew') continue;
    const city = cityOfDistrict(location.districtId);
    const cities = byCrew.get(holder.baseId) ?? new Map<string, number>();
    cities.set(city, (cities.get(city) ?? 0) + 1);
    byCrew.set(holder.baseId, cities);
  }
  return byCrew;
}

/** Where one crew stands with every city on the map, in map order. */
export function stakesOf(repos: Repositories, base: Base): CityStake[] {
  const held = holdings(repos).get(base.id) ?? new Map<string, number>();
  const home = cityOfDistrict(base.districtId);
  return CITIES.map((city) => ({
    cityId: city.id,
    resident: city.id === home,
    locationsHeld: held.get(city.id) ?? 0,
  }));
}

/** The cities this crew may walk into, their own first. Never empty: a crew always has a home. */
export function citiesFor(repos: Repositories, base: Base): string[] {
  return citiesOpenTo(stakesOf(repos, base));
}

/** Whether this crew may walk into that city's rooms right now. */
export function mayEnter(repos: Repositories, base: Base, cityId: string): boolean {
  const stake = stakesOf(repos, base).find((one) => one.cityId === cityId);
  return stake !== undefined && canEnterCity(stake);
}

/**
 * What a city's rooms are stocked against: everybody with a stake in it, weighted by that stake.
 *
 * Falls back to the average level of every base when nobody has a stake at all, which is the number
 * the Bar used for the whole world before this. A city with nobody in it still has to put somebody
 * behind the bar, and the flat average is the only honest thing left to scale them by.
 *
 * Bots are counted. They hold ground, they are somebody to fight, and a city where the only crews
 * are rivals is exactly the city whose rooms should reflect them.
 */
export function calibreOf(repos: Repositories, cityId: string): number {
  const held = holdings(repos);
  const participants: CityParticipant[] = repos.bases.listStandings().map((standing) => ({
    stake: {
      cityId,
      resident: cityOfDistrict(standing.districtId) === cityId,
      locationsHeld: held.get(standing.id)?.get(cityId) ?? 0,
    },
    level: standing.level,
    notoriety: standing.notoriety,
  }));
  return cityCalibre(participants) ?? repos.bases.averageLevel();
}

/** The city a crew lives in, which is where every door opens by default. */
export function homeCityOf(base: Base): string {
  return cityOfDistrict(base.districtId);
}

/**
 * The city a request asked for, checked against the door.
 *
 * Answers the crew's own city for a request that named none, and `null` for one naming a city they
 * hold no ground in: the caller turns that into the refusal, because the Bar and the market word
 * theirs differently.
 */
export function cityAsked(
  repos: Repositories,
  base: Base,
  asked: string | undefined,
): string | null {
  const wanted = asked ?? homeCityOf(base);
  if (!CITIES.some((city) => city.id === wanted)) return null;
  return mayEnter(repos, base, wanted) ? wanted : null;
}

/** The map's own default, re-exported so a route does not have to know which city that is. */
export { DEFAULT_CITY_ID };
