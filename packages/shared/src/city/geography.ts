import { MAX_TRAVEL_SPEED_BONUS, roadMinutes } from '../time/speed.js';
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
 * The frontier between one city and the next, in minutes, before any bonus (2026-09-24).
 *
 * A position is normalised 0 to 1 **inside its own city**, because the renderer scales each map to
 * its own viewport. Two cities therefore occupy the same unit square and lie exactly on top of one
 * another, and `mapDistance` between them measures nothing: Ashfall's Ashen Terraces sits at
 * (0.84, 0.62) and Terminus's Last Platform at (0.80, 0.34), so a march from a plot in the first
 * city to the seat of Combine power in the second came to **two minutes**, while crossing Ashfall
 * end to end takes the better part of two hours. The map model had no "between cities" term at all.
 *
 * This is that term. A cross-city journey is priced as the road out to the middle of your own city,
 * plus this, plus the road in from the middle of theirs, which is the shape of the thing: you leave
 * a city, you cross the frontier, you arrive in a city. Two hours is deliberately a commitment.
 * Taking a foothold abroad is the maintainer's chosen route into a second city (2026-09-24), and it
 * should cost an afternoon rather than a coffee break, but it is still a road: the crew's pace and
 * its travel bonuses are spent on the whole of it, exactly as they are at home.
 */
export const INTER_CITY_MINUTES = 120;

/** The middle of any city's unit square: where a journey out of it is measured to. */
const CITY_MIDDLE: Position = { x: 0.5, y: 0.5 };

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
  /** Whole minutes the crew's holdings take off after the percentage. See `roadMinutes`. */
  flatMinutesOff?: number;
}

/** Re-exported from `time/speed.ts`, where the arithmetic that spends it lives. */
export { MAX_TRAVEL_SPEED_BONUS };

export function travelMinutesBetween(from: District, to: District, pace: RoadPace = {}): number {
  return Math.max(
    MIN_TRAVEL_MINUTES,
    roadMinutes(
      rawMinutesBetween(from, to),
      pace.speed ?? 0,
      pace.reductionPercent ?? 0,
      pace.flatMinutesOff ?? 0,
    ),
  );
}

/**
 * The road between two districts in minutes, before anybody's pace or bonuses are spent on it.
 *
 * Inside one city it is the straight-line distance at {@link TRAVEL_MINUTES_PER_MAP_UNIT}. Between
 * two cities it is the way out, the frontier and the way in, because the two maps are drawn in the
 * same unit square and subtracting one from the other is meaningless. See {@link INTER_CITY_MINUTES}.
 */
export function rawMinutesBetween(from: District, to: District): number {
  if (from.cityId === to.cityId) {
    return mapDistance(from.position, to.position) * TRAVEL_MINUTES_PER_MAP_UNIT;
  }
  const out = mapDistance(from.position, CITY_MIDDLE) * TRAVEL_MINUTES_PER_MAP_UNIT;
  const back = mapDistance(CITY_MIDDLE, to.position) * TRAVEL_MINUTES_PER_MAP_UNIT;
  return out + INTER_CITY_MINUTES + back;
}

/** The same, by id. Returns `null` when either end is not on the map. */
export function travelMinutes(fromId: string, toId: string, pace: RoadPace = {}): number | null {
  const from = findDistrict(fromId);
  const to = findDistrict(toId);
  if (!from || !to) return null;
  return travelMinutesBetween(from, to, pace);
}
