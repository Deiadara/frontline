import { z } from 'zod';

/**
 * The cities of the world (maintainer request, §J9a).
 *
 * Two are playable: Ashfall and Terminus (maintainer, 2026-09-24). The list exists rather than an
 * implicit "everywhere" because a scope of "my city" and a scope of "all cities" stopped being the
 * same set the day the second one opened, and every filter in the game was written against a city
 * id in advance so that day would be a data change.
 *
 * ## A city can be a name before it is a map
 *
 * Redline and Deepcut are rows here with nothing in the atlas behind them (maintainer, 2026-09-24:
 * the world screen shows five). That is deliberate and it is the cheap half of adding a city: the
 * screen that tells a player what the world is can say there are five places in it long before
 * three contested districts and four plots have been drawn for each. Every reader of this list
 * either walks the atlas for ground, and finds none, or shows the name, which is the thing the row
 * is carrying. `atlas.test.ts` holds the one rule that keeps it honest: a city with no ground is
 * shut.
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
   * Ashfall, Terminus and Arca are the three with a painted map, a seeded world and a mission
   * board (Arca was written a district at a time from 2026-10-06, in the place Saltmarch's sketch
   * held until then, and opened on 2026-10-07 when its painting landed). Redline and Deepcut are
   * shut: no ground at all yet, only a name and what the place is. A card that pretended either
   * was playable would be a door onto an empty room. The screen draws all five, because "there is
   * a frontier" is the thing worth knowing.
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
      'Twelve districts under a permanent grey fall, and the Combine still calls it a going concern. Everything anybody fights over here was built to do something else.',
    open: true,
  },
  {
    id: 'terminus',
    name: 'Terminus',
    nickname: 'the End of the Line',
    blurb:
      'The junction at the end of the line, kept by real soldiers because it is the only road out. Hold the platforms and you decide what leaves the frontier.',
    open: true,
  },
  {
    id: 'arca',
    name: 'Arca',
    nickname: 'the Old Quarter',
    blurb:
      'The cathedral city the Combine never modernised, so it wired it instead: white stone and crimson banners, bells that are transmitters now, and a camera in every saint. The dead outnumber the living and are better housed.',
    open: true,
  },
  {
    id: 'redline',
    name: 'Redline',
    nickname: 'the Company Town',
    blurb:
      'Combine ground from the gate to the fence, and everyone inside it is on the books. Nobody there is owed a wage; they are owed against one.',
    open: false,
  },
  {
    id: 'deepcut',
    name: 'Deepcut',
    nickname: 'the Six Levels',
    blurb:
      'A town that grew downward instead of outward, six galleries deep into the cut. The people on the bottom level have not stood under weather in a generation.',
    open: false,
  },
];

/** The city every district currently sits in. The seam a second city arrives through. */
export const DEFAULT_CITY_ID = 'ashfall';

export function findCity(cityId: string): City | undefined {
  return CITIES.find((city) => city.id === cityId);
}

/**
 * Whether anybody may act in this city yet: call a fight, walk a column in, plant a cell, send a spy.
 *
 * Saltmarch is the case this exists for. Its ground is in the atlas and its control rows are real,
 * so every door that only asked "is this a place on the map" let a crew into a city no screen draws
 * (bug pass, 2026-09-29). The doors that start a journey there ask this instead.
 */
export function cityIsOpen(cityId: string): boolean {
  return findCity(cityId)?.open === true;
}
