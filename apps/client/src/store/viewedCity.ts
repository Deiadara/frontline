import { create } from 'zustand';

/**
 * Which city the player is looking at, for every screen that has one.
 *
 * The same fact used to be held five times over: `CityView` had a `looking` state for the map, and
 * the Bar, the market, the board of offers, the back room and the mission board each had a `city`
 * of their own. All six were `useState`, so every one of them was thrown away on the next
 * navigation and every one of them came back as the crew's home city. Walking into a district in
 * Terminus and pressing the X put you back on Ashfall's map; switching the Bar to Terminus and
 * glancing at the board put the board back in Ashfall. One store, and the screens agree because
 * there is only one thing left to agree with.
 *
 * ## Remembered per crew, across reloads (maintainer, 2026-09-25)
 *
 * "When you click on the city tab it should take you to the last one you left it at, unless you
 * never did, at which point it's your home city." This held the city in memory only, so a reload
 * (and the dev server reloads constantly) put every player back on their home map however recently
 * they had been looking at another.
 *
 * It is kept in `localStorage` under the crew's **base id**, not per browser, which was the reason
 * given for keeping it out of storage: a second account signing in on the same machine has a
 * different base and so a different key, and starts on its own home. Base ids are UUIDs, so a crew
 * founded after a database reset does not inherit a city from the crew that held the id before.
 *
 * A remembered city whose rooms are shut to the crew by now is not a problem worth refusing to
 * remember over: the map draws any city, and a room that refuses one says `CITY_SHUT`, which
 * `shutRoom` already takes off the list. Storage can be missing or throw (a private window,
 * blocked site data), and every read and write is guarded so the game behaves exactly as it did
 * before when it does.
 */
interface ViewedCityState {
  /** The city last chosen, or `null` while that is the crew's own. */
  cityId: string | null;
  /** The base whose memory this is, once the shell has said (`settle`), or `null` before. */
  crew: string | null;
  /**
   * Every city whose rooms the crew may walk into, as the server last listed them, or `null`
   * before any room has answered.
   *
   * The client cannot work this out: it cannot see who holds what. It comes off the `cities` field
   * that the Bar, the market, the back room and the mission board all carry, and `shutRoom` takes
   * a city back out of it when the server refuses one with `CITY_SHUT`.
   *
   * It exists because {@link cityId} and this are not the same question. A player may look at the
   * map of a city they hold nothing in, which is how they decide to take something there, and the
   * map is happy to draw it. The rooms in it are shut to them until they do.
   */
  rooms: readonly string[] | null;
  /** Remember a city. `null` puts the player back on their own. */
  look: (cityId: string | null) => void;
  /**
   * Take up where this crew left off: the city it was last looking at, or its own.
   *
   * Called by the game shell once `/me` has named the base. A no-op for the crew already settled,
   * so the shell can call it on every render without undoing a choice made since.
   */
  settle: (baseId: string) => void;
  /** Take the door list off a room payload. */
  noteRooms: (cities: readonly string[]) => void;
  /** The server refused this city's room. It is not on the list, whatever the list said. */
  shutRoom: (cityId: string) => void;
  /** Forget everything held in memory. What the crew left behind in storage stays for its return. */
  forget: () => void;
}

export const useViewedCity = create<ViewedCityState>()((set, get) => ({
  cityId: null,
  crew: null,
  rooms: null,
  look: (cityId) => {
    set({ cityId });
    remember(get().crew, cityId);
  },
  settle: (baseId) => {
    if (get().crew === baseId) return;
    set({ crew: baseId, cityId: recall(baseId) });
  },
  noteRooms: (cities) =>
    set((state) =>
      // Compared before it is written: this is called from an effect on every poll of every room,
      // and a fresh array each time would wake every subscriber five times a minute for nothing.
      sameList(state.rooms, cities) ? state : { rooms: [...cities] },
    ),
  shutRoom: (cityId) =>
    set((state) => ({ rooms: (state.rooms ?? []).filter((open) => open !== cityId) })),
  forget: () => set({ cityId: null, crew: null, rooms: null }),
}));

/** Where one crew's last city is kept. Exported for the tests. */
export const viewedCityKey = (baseId: string): string => `frontline:viewed-city:${baseId}`;

function recall(baseId: string): string | null {
  try {
    return localStorage.getItem(viewedCityKey(baseId));
  } catch {
    return null;
  }
}

function remember(baseId: string | null, cityId: string | null): void {
  if (baseId === null) return;
  try {
    if (cityId === null) localStorage.removeItem(viewedCityKey(baseId));
    else localStorage.setItem(viewedCityKey(baseId), cityId);
  } catch {
    // Storage refused: the choice still holds for this sitting, which is all it used to do.
  }
}

function sameList(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((one, at) => one === b[at]);
}
