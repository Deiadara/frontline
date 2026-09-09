import { MAX_TRAVEL_SPEED_BONUS, roadMinutes } from '../time/speed.js';
import { CITY_DISTRICTS, findDistrict, type District, type Position } from './districts.js';

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
  const raw = mapDistance(from.position, to.position) * TRAVEL_MINUTES_PER_MAP_UNIT;
  return Math.max(
    MIN_TRAVEL_MINUTES,
    roadMinutes(raw, pace.speed ?? 0, pace.reductionPercent ?? 0, pace.flatMinutesOff ?? 0),
  );
}

/** The same, by id. Returns `null` when either end is not on the map. */
export function travelMinutes(fromId: string, toId: string, pace: RoadPace = {}): number | null {
  const from = findDistrict(fromId);
  const to = findDistrict(toId);
  if (!from || !to) return null;
  return travelMinutesBetween(from, to, pace);
}

/**
 * The `count` districts closest to `fromId`, nearest first, excluding `fromId` itself.
 *
 * What a Satellite Uplink sees. Ties break on district id so the answer is stable: a vision list
 * that reshuffled between two reads would flicker the fog on the map for no reason.
 */
export function nearestDistricts(fromId: string, count: number): District[] {
  const from = findDistrict(fromId);
  if (!from || count <= 0) return [];
  return CITY_DISTRICTS.filter((district) => district.id !== fromId)
    .map((district) => ({ district, at: mapDistance(from.position, district.position) }))
    .sort((a, b) => a.at - b.at || a.district.id.localeCompare(b.district.id))
    .slice(0, count)
    .map((entry) => entry.district);
}
