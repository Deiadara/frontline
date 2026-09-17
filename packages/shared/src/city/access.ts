import { CITIES, DEFAULT_CITY_ID } from './cities.js';
import { ALL_DISTRICTS } from './atlas.js';

/**
 * Who may walk into a city's rooms, and whose standing decides what is in them (maintainer request,
 * 2026-09-17).
 *
 * "If you own even a single location in a district, you can access its bar and its market and bid on
 * stuff. If you are kicked out you lose that privilege."
 *
 * ## Why this is a city rule and not a district one
 *
 * The maintainer said district and then called the control a Choose City button, and both readings
 * point at the same place in this codebase: a bar and a market are **city** rooms. There is one
 * Runner for Ashfall, not one per district, and one room at the Bar. A district belongs to exactly
 * one city (`districts.ts` stamps `cityId` on every one of them), so "a location in that district"
 * and "a location in that city" are the same test from the door's point of view, and the door is
 * what this file is about.
 *
 * ## Ground held, not ground taken
 *
 * The privilege is read off the control map every time it is asked for rather than granted and
 * stored, which is the whole of "if you are kicked out you lose it": the moment somebody takes a
 * crew's last location in a city, the next read says they may not enter. Nothing has to remember to
 * revoke anything, and there is no state to get out of step with the map.
 */

/** Where a crew stands with one city: whether they live there, and how much of it they hold. */
export interface CityStake {
  cityId: string;
  /** Their home district is in this city. A resident never loses the door. */
  resident: boolean;
  /** Locations they hold in it right now, off the control map. */
  locationsHeld: number;
}

/**
 * Holding this many locations makes a visitor count for as much as somebody who lives there.
 *
 * The maintainer's number: "if you own 10 locations you max out, which means you affect it just as
 * much as a player who is there". A resident is a constant 1 because their home district is in the
 * city, which is a stake they cannot be talked out of.
 */
export const MAX_WEIGHTED_LOCATIONS = 10;

/** Whether this crew may walk into that city's bar and its market. */
export function canEnterCity(stake: CityStake): boolean {
  return stake.resident || stake.locationsHeld > 0;
}

/**
 * How much this crew's standing counts towards what the city's rooms offer.
 *
 * A resident is one whole share. A visitor is the share of ten locations they hold, so one location
 * is a tenth of a voice and ten or more is a whole one. Somebody with no stake has no voice, which
 * is the same answer `canEnterCity` gives: the two are one rule read two ways, and a crew that
 * cannot get through the door cannot be shaping what is behind it.
 */
export function stakeWeight(stake: CityStake): number {
  if (stake.resident) return 1;
  return Math.min(stake.locationsHeld, MAX_WEIGHTED_LOCATIONS) / MAX_WEIGHTED_LOCATIONS;
}

/**
 * What a rank on the notoriety ladder is worth, in levels, when a room is weighing a crew.
 *
 * "Both your infamy level and your district level count towards it." A district level and a rung of
 * the ladder are not the same size of thing, so one of them has to be quoted in the other: two
 * levels a rung, which puts the fourteen-rung ladder at twenty six levels of pull at the very top
 * and leaves the district level the larger term for everybody who is not `Nameless`. The alternative
 * was to average two normalised scores, which reads well and hides the fact that nobody can say what
 * a point of it means.
 */
export const LEVELS_PER_NOTORIETY_RANK = 2;

/** One crew's pull on a room: what they have built, plus what the street says about them. */
export function crewStanding(level: number, notoriety: number): number {
  return Math.max(0, level) + Math.max(0, notoriety) * LEVELS_PER_NOTORIETY_RANK;
}

/** A crew at the door of one city: their stake in it and what they are worth to it. */
export interface CityParticipant {
  stake: CityStake;
  level: number;
  notoriety: number;
}

/**
 * The standing a city's rooms are stocked against: everybody with a stake, weighted by their stake.
 *
 * This replaces the flat average of every base in the game. The Bar used `bases.averageLevel()`,
 * which is one number for a world that now has three cities in it and a rule about who is in which:
 * a crew holding half of Ashfall had exactly as much say over its room as a crew who has never been
 * there. Weighted, the room is stocked by the people who are actually in it.
 *
 * Answers `null` when nobody has a stake, because the caller has to decide what an empty city
 * offers and this has nothing to say about it.
 */
export function cityCalibre(participants: readonly CityParticipant[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const participant of participants) {
    const share = stakeWeight(participant.stake);
    if (share <= 0) continue;
    weighted += share * crewStanding(participant.level, participant.notoriety);
    weight += share;
  }
  return weight === 0 ? null : weighted / weight;
}

/** Every city id the map has, in the order the cities table lists them. */
export function cityIds(): readonly string[] {
  return CITIES.map((city) => city.id);
}

/** Which city a district belongs to, or the default city for an id the map does not have. */
export function cityOfDistrict(districtId: string): string {
  return ALL_DISTRICTS.find((district) => district.id === districtId)?.cityId ?? DEFAULT_CITY_ID;
}

/**
 * The cities a crew may enter, in map order, with the one they live in first.
 *
 * First because it is the default and because a picker that buries a player's own city under two
 * they visit is a picker that makes them hunt for home.
 */
export function citiesOpenTo(stakes: readonly CityStake[]): string[] {
  const open = stakes.filter(canEnterCity).map((stake) => stake.cityId);
  const home = stakes.find((stake) => stake.resident)?.cityId;
  if (home === undefined) return open;
  return [home, ...open.filter((id) => id !== home)];
}
