import { z } from 'zod';

/**
 * The cities of the world (board request, §J9a).
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
});
export type City = z.infer<typeof CitySchema>;

export const CITIES: readonly City[] = [
  {
    id: 'ashfall',
    name: 'Ashfall',
    nickname: 'the Frontline',
  },
];

/** The city every district currently sits in. The seam a second city arrives through. */
export const DEFAULT_CITY_ID = 'ashfall';

export function findCity(cityId: string): City | undefined {
  return CITIES.find((city) => city.id === cityId);
}
