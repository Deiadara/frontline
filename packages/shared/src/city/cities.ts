import { z } from 'zod';

/**
 * The cities of the world (maintainer request, §J9a).
 *
 * There is one today. It exists as a **list** rather than as an implicit "everywhere" because the
 * board is adding more, and the difference between the two shapes is what the standings screen is
 * built on: a scope of "my city" and a scope of "all cities" are the same set right now and will
 * stop being the same set the day a second row appears here. Writing the filter against a city id
 * now means that day is a data change.
 *
 * ## A district belongs to a city, and a crew belongs to its district
 *
 * The city is **not** a column on `bases`. A crew is in a district and a district is in a city, so
 * storing a crew's city would be a second copy of a fact the map already carries, free to drift the
 * first time a district is moved. `cityOf` walks the one edge that exists.
 */

export const CitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** What the street calls it. Drawn where there is room for a second line. */
  nickname: z.string().min(1),
  /** Two or three lines: what the place is, for the card on the cities screen. */
  blurb: z.string().min(1),
  /**
   * Whether a crew can actually play here yet.
   *
   * Ashfall is the one with a painted map, a seeded world and a mission board. The other two are
   * authored ground with no art and no server behind them, and a card that pretended otherwise
   * would be a door onto an empty room. The screen draws them either way, because "there is a
   * frontier and it is called Verge Station" is the thing worth knowing.
   */
  open: z.boolean(),
});
export type City = z.infer<typeof CitySchema>;

export const CITIES: readonly City[] = [
  {
    id: 'ashfall',
    name: 'Ashfall',
    nickname: 'the Frontline',
    blurb:
      'Ten districts under a permanent grey fall, and the Combine still calls it a going concern. Everything anybody fights over here was built to do something else.',
    open: true,
  },
  {
    id: 'saltmarch',
    name: 'Saltmarch',
    nickname: 'the Drowned Port',
    blurb:
      'The water came up and the town went with it. What is left stands on stilts, walkways and forty ships welded side to side, and every road worth holding is a crossing.',
    open: false,
  },
  {
    id: 'verge-station',
    name: 'Verge Station',
    nickname: 'the Last Platform',
    blurb:
      'The junction at the end of the line, kept by real soldiers because it is the only way out. Hold the yards and you decide what leaves the frontier.',
    open: false,
  },
];

/** The city every district currently sits in. The seam a second city arrives through. */
export const DEFAULT_CITY_ID = 'ashfall';

export function findCity(cityId: string): City | undefined {
  return CITIES.find((city) => city.id === cityId);
}
