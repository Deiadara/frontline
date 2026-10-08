import { DEFAULT_CITY_ID, cityIsOpen } from './cities.js';
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

/**
 * Whether this crew may walk into that city's bar and its market.
 *
 * Never a city that is not open (maintainer, 2026-09-29): ground claimed in Saltmarch, the shut
 * city of the day, before its doors were shut opened its Bar, fence, Runner, board and missions to
 * the crew holding it. No shut city has ground today (Arca opened 2026-10-07); the door stays for
 * the next one authored.
 */
export function canEnterCity(stake: CityStake): boolean {
  return cityIsOpen(stake.cityId) && (stake.resident || stake.locationsHeld > 0);
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

/** One crew as a room sees it: how far it has built, and the rank the street has given it. */
export interface RoomCrew {
  level: number;
  /** A `NOTORIETY_TIERS` index. Fractional on an average. */
  notoriety: number;
}

/**
 * Who a city's Bar is pouring for tonight (maintainer, 2026-09-28).
 *
 * "If 3 players are max level and one is a beginner have an officer appear for him as well." One
 * weighted mean cannot say that: three crews at ninety and one at level one average out near
 * seventy, and a room stocked at seventy has nobody the beginner can afford or clear. So the room
 * carries both ends of the city as well as its middle, and the Bar seats one person for each end.
 *
 * `lowest` and `highest` are real crews, ranked by `crewStanding`. `average` is the same
 * stake-weighted mean `cityCalibre` takes, split into its two halves so the sheet and the doors can
 * each read the half that is theirs.
 */
export interface RoomProfile {
  lowest: RoomCrew;
  highest: RoomCrew;
  average: RoomCrew;
  /**
   * The highest rank any crew in the room holds. Not `highest.notoriety`: `highest` is ranked by
   * standing, which leans on level, so a level-80 crew at rank 3 is `highest` in a room where two
   * level-20 crews hold rank 13, and a door capped off its rank sat below the room's own floor.
   */
  highestRank: number;
}

/** A room where every crew stands in the same place: a city of one, and the shape tests read. */
export function flatRoom(level: number, notoriety = 0): RoomProfile {
  const crew = { level, notoriety };
  return { lowest: crew, highest: crew, average: crew, highestRank: notoriety };
}

/**
 * The room a city's rooms are stocked against, off everybody with a stake in it.
 *
 * A visitor holding one location is a tenth of a voice in the average and a whole crew at either
 * end: they may walk in and bid, so the seat pitched at them has to exist for them too.
 *
 * `null` when nobody has a stake, for the reason `cityCalibre` gives.
 */
export function cityRoomProfile(participants: readonly CityParticipant[]): RoomProfile | null {
  const inside = participants.filter((participant) => stakeWeight(participant.stake) > 0);
  const [first, ...rest] = inside;
  if (first === undefined) return null;

  const standingOf = (crew: RoomCrew) => crewStanding(crew.level, crew.notoriety);
  let lowest: RoomCrew = first;
  let highest: RoomCrew = first;
  for (const participant of rest) {
    if (standingOf(participant) < standingOf(lowest)) lowest = participant;
    if (standingOf(participant) > standingOf(highest)) highest = participant;
  }

  let weight = 0;
  let level = 0;
  let notoriety = 0;
  for (const participant of inside) {
    const share = stakeWeight(participant.stake);
    weight += share;
    level += share * participant.level;
    notoriety += share * participant.notoriety;
  }
  return {
    lowest: { level: lowest.level, notoriety: lowest.notoriety },
    highest: { level: highest.level, notoriety: highest.notoriety },
    average: { level: level / weight, notoriety: notoriety / weight },
    highestRank: Math.max(...inside.map((participant) => participant.notoriety)),
  };
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
