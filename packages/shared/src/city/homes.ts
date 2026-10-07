import { z } from 'zod';
import { CITIES, findCity } from './cities.js';
import { districtsOfCity } from './atlas.js';
import { mulberry32, seedFrom } from '../rng.js';

/**
 * Where a new crew may move in, and why it may not (maintainer, 2026-09-24).
 *
 * "There are 4 plots, so if there are 4 players already you cannot go. Otherwise it assigns a free
 * plot at random if you choose it."
 *
 * A city is a home if it has a map and a plot nobody lives on. Both halves are facts about the
 * world rather than about the reader, which is why they are computed here and sent over the wire:
 * a browser cannot see who lives where, and a client that guessed would offer a city that filled
 * up two seconds ago.
 *
 * ## Plots are counted off the atlas, never written down
 *
 * Every city has four residential districts (`atlas.ts`, and Ashfall's four in `districts.ts`),
 * and the four is read out of the map on every call. A `PLOTS_PER_CITY = 4` constant would be a
 * second copy of that fact, free to disagree with the map the day a city is drawn with three.
 *
 * ## Bots take a plot
 *
 * A plot holds one crew, and a seeded bot is a crew (maintainer, 2026-09-28: "there should be no
 * bots seated on players' locations"). The caller hands in every district somebody lives on, bots
 * included (`takenHomes` in the overseer route). Bots used to be left out so the rivals on three of
 * Ashfall's four plots did not fill the city, and the price was a player seated on a bot's plot.
 * With the bots seeded a dev world has four free plots; they go before launch (`seed/index.ts`).
 */

/** Why a city is not on offer as a home. */
export const HomeRefusalSchema = z.enum(['unbuilt', 'full']);
export type HomeRefusal = z.infer<typeof HomeRefusalSchema>;

/**
 * One city, as the choose screen reads it.
 *
 * `available` and `refusal` are the same fact twice, deliberately: the screen presses on the
 * first and prints the second, and a card that said "Full" while staying pressable is the defect
 * this shape makes impossible to write.
 */
export const CityHomeOfferSchema = z.object({
  cityId: z.string().min(1),
  available: z.boolean(),
  /** Null when the city is on offer. */
  refusal: HomeRefusalSchema.nullable(),
  /** Residential plots this city has at all. Four everywhere the map is drawn. */
  plots: z.number().int().nonnegative(),
  /** How many of them nobody lives on. */
  free: z.number().int().nonnegative(),
});
export type CityHomeOffer = z.infer<typeof CityHomeOfferSchema>;

/** The residential plots of one city, in map order. Empty for a city with no map yet. */
export function homePlots(cityId: string): readonly string[] {
  return districtsOfCity(cityId)
    .filter((district) => district.kind === 'residential')
    .map((district) => district.id);
}

/** The plots of one city nobody lives on. `taken` is where every crew lives, bots included. */
export function freeHomePlots(cityId: string, taken: Iterable<string>): string[] {
  const occupied = new Set(taken);
  return homePlots(cityId).filter((id) => !occupied.has(id));
}

/**
 * Whether a new crew may move into this city.
 *
 * A city with no map is `unbuilt` rather than `full`, even though both have no free plot, because
 * the two read differently to a player: one is a place that is not finished and one is a place
 * that filled up. Shut cities are checked first for that reason.
 */
export function cityHomeOffer(cityId: string, taken: Iterable<string>): CityHomeOffer {
  const plots = homePlots(cityId);
  const free = freeHomePlots(cityId, taken);
  const open = findCity(cityId)?.open === true && plots.length > 0;
  const refusal: HomeRefusal | null = !open ? 'unbuilt' : free.length === 0 ? 'full' : null;
  return {
    cityId,
    available: refusal === null,
    refusal,
    plots: plots.length,
    free: open ? free.length : 0,
  };
}

/** Every city in the world, in the order the wall of portraits hangs them. */
export function cityHomeOffers(taken: Iterable<string>): CityHomeOffer[] {
  const occupied = [...taken];
  return CITIES.map((city) => cityHomeOffer(city.id, occupied));
}

/**
 * A free plot in this city, drawn at random, or null when there is none.
 *
 * Random was the maintainer's call and it replaces the old "quietest plot" rule, which sorted by
 * how many players were already on each: that put the first three crews in a city on three
 * different plots by construction and made where you live a function of when you registered.
 *
 * Seeded rather than `Math.random`, like every other draw in this game, so a test can pin the
 * answer and the route can hand it a fresh id per registration. The point is taken off the
 * `mulberry32` stream rather than by a modulus of the hash: a modulus over four is the collapse
 * `drawWeighted` documents at length, and with a pool this small it is a visible bias.
 */
export function pickHomePlot(cityId: string, taken: Iterable<string>, seed: string): string | null {
  /*
   * Through the offer rather than straight to the free list, so the two cannot disagree.
   *
   * Reliquary is the case that makes this load-bearing (Saltmarch was, until it was dropped): it
   * is shut, and it has four authored plots in the atlas behind the shut door. A free-list check alone handed a crew a plot on a
   * map with no server behind it.
   */
  const occupied = [...taken];
  if (!cityHomeOffer(cityId, occupied).available) return null;
  const free = freeHomePlots(cityId, occupied);
  if (free.length === 0) return null;
  return free[Math.floor(mulberry32(seedFrom(seed))() * free.length)] ?? null;
}
