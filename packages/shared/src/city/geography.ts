import { roadMinutes } from '../time/speed.js';
import type { District, Position } from './districts.js';
import { findDistrict } from './atlas.js';

/**
 * How far apart things are (GDD §A4: "some relative geography").
 *
 * The map is not a menu. Hitting the Spire from the Docks is most of the way across the city, and
 * that has to *cost* something or the positions on the map are decoration. What it costs is time:
 * a force sent to a far district arrives later, which is the whole reason a crew wants ground near
 * home and a rail yard to reach the ground that is not.
 */

/**
 * Minutes to cross the entire map corner to corner.
 *
 * Distances are normalized, so the longest journey in the city is `sqrt(2)` map units ≈ 1.41, and
 * the diagonal therefore takes about two hours before any bonus. Sized against §E7's mission band
 * so a raid across town reads as the same game as a mission, not as a different one.
 */
export const TRAVEL_MINUTES_PER_MAP_UNIT = 85;

/** The shortest journey the city admits. Adjacent ground is quick, never instant. */
export const MIN_TRAVEL_MINUTES = 2;

/**
 * The whole road between one city and the next, in minutes, before any bonus (2026-10-07).
 *
 * A position is normalised 0 to 1 **inside its own city**, because the renderer scales each map to
 * its own viewport. Two cities therefore occupy the same unit square and lie exactly on top of one
 * another, and `mapDistance` between them measures nothing: Ashfall's Ashen Terraces sits at
 * (0.84, 0.62) and Terminus's Last Platform at (0.80, 0.34), so a march from a plot in the first
 * city to the seat of Combine power in the second came to **two minutes**, while the longest road
 * inside Ashfall is 75 minutes. The map model had no "between cities" term at all.
 *
 * This is that term, and since the maintainer's ruling of 2026-10-07 it is the entire crossing:
 * "make the base (0 speed) of between cities to be 4 hours... Assume that relative geography only
 * happens inside a city, so it takes time to go from location to location. But city to city, it's
 * always the same, adding then the bonuses." So every district abroad is four hours from every
 * district at home, whichever two cities they are in.
 *
 * The journey used to be the road out to the middle of your own city, plus the frontier, plus the
 * road in from the middle of theirs, which put a crossing anywhere between 135 and 214 raw minutes
 * depending on how central the two ends happened to be. Those two legs are gone because positions
 * are an inside-a-city idea: a district's place on its own map says how far it is from its
 * neighbours, and reading it as a distance from the frontier is reading a number that was never
 * measured. One figure for every pair also means a player can hold it in their head, which the
 * sliding one could not be.
 *
 * Four hours is the maintainer's figure for the commitment: taking a foothold abroad is the chosen
 * route into a second city, and it should cost most of a day's play rather than a coffee break. It
 * is still a road, so the crew's pace, its vehicles and every travel cut are spent on the whole of
 * it exactly as they are at home, with no floor under the crossing and no cap over it.
 */
export const INTER_CITY_MINUTES = 240;

export function mapDistance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * How a column is moving, for the two numbers a road is measured with.
 *
 * `speed` is the pace of the slowest group in the column, 0 to 100: everybody walking at their own
 * sheet, and everybody in a machine at the machine's (`building/vehicles.ts`, `columnSpeed`).
 * `reductionPercent` is what the crew's holdings then take off the clock, already summed, so this
 * module never has to know what a Rail Yard is.
 *
 * An object rather than two positional numbers because the two used to be one argument and meant
 * the reduction: a caller that kept passing its old figure positionally would now be claiming its
 * ground makes the *walkers* faster, which is a silent wrong answer rather than a compile error.
 */
export interface RoadPace {
  speed?: number;
  reductionPercent?: number;
  /** The Cartographer's cut off the road's base, before everything else. See `roadMinutes`. */
  baseCutPercent?: number;
}

export function travelMinutesBetween(from: District, to: District, pace: RoadPace = {}): number {
  return Math.max(
    MIN_TRAVEL_MINUTES,
    roadMinutes(
      rawMinutesBetween(from, to),
      pace.speed ?? 0,
      pace.reductionPercent ?? 0,
      pace.baseCutPercent ?? 0,
    ),
  );
}

/**
 * The road between two districts in minutes, before anybody's pace or bonuses are spent on it.
 *
 * Inside one city it is the straight-line distance at {@link TRAVEL_MINUTES_PER_MAP_UNIT}. Between
 * two cities it is a flat {@link INTER_CITY_MINUTES}, the same for every pair of districts and
 * every pair of cities: the two maps are drawn in the same unit square, so neither end's position
 * says anything about how far it is from the other city.
 */
export function rawMinutesBetween(from: District, to: District): number {
  if (from.cityId !== to.cityId) return INTER_CITY_MINUTES;
  return mapDistance(from.position, to.position) * TRAVEL_MINUTES_PER_MAP_UNIT;
}

/** The same, by id. Returns `null` when either end is not on the map. */
export function travelMinutes(fromId: string, toId: string, pace: RoadPace = {}): number | null {
  const from = findDistrict(fromId);
  const to = findDistrict(toId);
  if (!from || !to) return null;
  return travelMinutesBetween(from, to, pace);
}
