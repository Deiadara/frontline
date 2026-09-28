import { cityOf } from '@frontline/shared';
import { useEffect } from 'react';
import { useHomeCity } from '../../lib/queries';
import { useViewedCity } from '../../store/viewedCity';

/** What a room screen needs: which city to read, and what its {@link CityPicker} calls. */
export interface CityRoom {
  /**
   * The city to ask the server for. `undefined` is the crew's own, which is what a bare read
   * answers with, so a player who has not walked anywhere sends no city on any request.
   */
  city: string | undefined;
  /** What the picker calls when the player walks into another city's room. */
  choose: (next: string) => void;
}

/**
 * Which city's room this screen is standing in (maintainer, 2026-09-24).
 *
 * The Bar, the market, the board of offers, the back room and the mission board each held this in
 * a `useState` that was thrown away on the next navigation, so changing the city in the Bar and
 * glancing at anything else put you back in your own city. They share {@link useViewedCity} now,
 * which is also what the map reads, so switching in the Bar and opening the map shows the city you
 * switched to.
 *
 * ## A city you can look at is not always a city you can walk into
 *
 * The map will draw any city with a painting behind it, which is how a player decides where to
 * take ground next. A room needs ground already held: `city/access.ts` is the rule and the server
 * applies it, refusing with `CITY_SHUT`. So a remembered city is served here only while the door
 * list says it is open, and that list is learned from the rooms themselves (see `useCityDoor`).
 * Until any room has answered, the list is unknown and the remembered city is tried: a crew that
 * holds ground there, which is the common case, gets the room it asked for with no extra round
 * trip, and a crew that does not gets one refusal that shuts the door and puts them home.
 *
 * Nothing here writes to the *viewed* city. A refused room leaves the map looking where the player
 * left it: losing the bar in Terminus is not a reason to stop looking at Terminus.
 *
 * ## Why this does not read `/me`
 *
 * It could take the crew's own city and record a player who picks it as nothing chosen, which
 * would keep their requests free of a `?city=` they do not need. It is not worth an extra
 * `useMe` observer on five screens for a case the picker reaches only when somebody walks back
 * into the room they are already standing in, and that is what the screens did before this store
 * existed. The one navigation where it *is* worth it is opening a district, which happens
 * constantly and already has `/me` in hand: see {@link useRememberDistrictCity}.
 */
export function useCityRoom(): CityRoom {
  const chosen = useViewedCity((state) => state.cityId);
  const rooms = useViewedCity((state) => state.rooms);
  const look = useViewedCity((state) => state.look);

  const open = chosen !== null && (rooms === null || rooms.includes(chosen));
  return { city: open ? chosen : undefined, choose: look };
}

/**
 * Standing in a district is standing in its city.
 *
 * `DistrictView` is reached from the map, from a notification and from a pasted link, and only the
 * first of those three has already been through the city screen. Recording it here is what makes
 * the X, the back link and the browser's own back button all land on the map of the city the
 * district is in rather than on the crew's home map.
 *
 * Waits for `/me`, because the city is only worth recording relative to the crew's own: without it
 * this would write `ashfall` for an Ashfall crew and then correct itself to `null` a moment later,
 * which is two renders of churn to reach the state it started in.
 */
export function useRememberDistrictCity(districtId: string | undefined): void {
  const look = useViewedCity((state) => state.look);
  const home = useHomeCity();
  const city = cityOf(districtId ?? '') ?? null;
  useEffect(() => {
    if (city === null || home === null) return;
    look(city === home ? null : city);
  }, [city, home, look]);
}
