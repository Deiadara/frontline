import { isStation, railLinkMinutes } from './locations.js';
import { ALL_DISTRICTS, findDistrict } from './atlas.js';
import { rawMinutesBetween, type RoadPace } from './geography.js';
import { roadMinutes } from '../time/speed.js';
import { MIN_TRAVEL_MINUTES } from './geography.js';
import type { District } from './districts.js';

/**
 * Terminus's railway: the one trait that city has, and the only thing in the game that replaces a
 * road rather than discounting one (maintainer, 2026-09-24).
 *
 * ## The rule, in the maintainer's own terms
 *
 * "You can choose to use the station to move the units and that is the only thing that changes.
 * Moving units around or to send them somewhere for battle. It does not count for missions. Also,
 * if the trip is 15 minutes between the stations, and the location is in that district but its the
 * terminal, then add that extra time of going from the terminal to there. Vehicles and the colossus
 * cannot use the railway."
 *
 * So: a unit move or a battle column may **choose** to ride. The clock is the road to the platform
 * it boards at, plus {@link railLinkMinutes} on the rails for the level of that platform
 * (maintainer, 2026-10-09: 15 minutes from a level 1 Station down to 7 from a level 5), plus the
 * road from the platform it gets off at to wherever it is actually going. Missions and spy jobs
 * never ride.
 *
 * ## Why it is a search and not a lookup
 *
 * A crew is linked between any two districts it holds a Station in, not only neighbouring ones,
 * because a train runs the whole line. The useful question is therefore not "is this journey
 * linked" but "is there a pair of platforms that makes this journey shorter", and the answer has
 * to allow for boarding somewhere that is not where you started and getting off somewhere that is
 * not where you are going. With seven platforms in the city that is a forty-nine-way search, which
 * is nothing, and writing it as a search is what makes the two ends fall out for free: boarding at
 * home is the pair where the first leg is zero.
 *
 * ## Why the ride is never forced
 *
 * Riding is not always what you want. The train leaves the machines behind ({@link partyCanRide}),
 * and a short hop between two neighbouring districts is quicker on foot than the minutes on the
 * rails. So this answers with *both* clocks and the caller offers the choice, which is what
 * the maintainer asked for. `railwayOffer` returning `null` means there is nothing to offer.
 */

/**
 * The Stations a crew holds, as the level of the platform in each district, by district id.
 *
 * A level because the rails out of a platform take {@link railLinkMinutes} of it. Takes the held
 * locations with their levels, or bare ids for a crew whose platforms are all at level 1.
 */
export type StationLevels = ReadonlyMap<string, number>;

export function stationDistricts(
  held: ReadonlyMap<string, number> | Iterable<string>,
): Map<string, number> {
  const levels = held instanceof Map ? held : new Map([...held].map((id) => [id, 1] as const));
  const districts = new Map<string, number>();
  for (const district of ALL_DISTRICTS) {
    const station = district.locations.find((one) => isStation(one) && levels.has(one.id));
    if (station) districts.set(district.id, levels.get(station.id) as number);
  }
  return districts;
}

/**
 * Whether a party may board at all.
 *
 * Vehicles and the Colossus cannot ride (maintainer, 2026-09-24), and the rule is a refusal rather
 * than a penalty: there is no flat-bed on this railway, so a column that is taking its machines is
 * a column that is walking. Expressed as two counts rather than as a unit list because that is
 * what every caller already has to hand, and because "the Colossus" is one sheet today and the
 * rule is about anything that cannot be got onto a train.
 */
export function partyCanRide(party: { vehicles: number; unridables: number }): boolean {
  return party.vehicles === 0 && party.unridables === 0;
}

export interface RailwayOffer {
  /** Where the party gets on. */
  readonly boardAt: District;
  /** Where it gets off. */
  readonly alightAt: District;
  /** The road to the platform, in minutes, already paced. */
  readonly toPlatform: number;
  /** The road from the far platform to the destination, in minutes, already paced. */
  readonly fromPlatform: number;
  /** The rails between the two, set by the level of the platform it boards at. */
  readonly ride: number;
  /** The whole journey by rail, in minutes. */
  readonly minutes: number;
}

/**
 * The best ride this crew can offer for this journey, or `null` if there is none worth taking.
 *
 * `null` covers all four ways a journey is not a rail journey: the crew holds fewer than two
 * platforms, the two ends are in different cities (a train does not cross the frontier), the party
 * cannot board, or the rails simply come to more minutes than the road does.
 *
 * The two road legs are paced with the caller's own `pace`, because they are roads: the column's
 * speed, its travel bonuses and its road shortcuts all apply to the walk at either end exactly as
 * they would to the whole journey. The middle leg is not paced, and that is the point of it being
 * a rule: no road bonus touches it, and only the level of the departure platform moves it.
 */
export function railwayOffer(
  from: District,
  to: District,
  stations: StationLevels,
  pace: RoadPace = {},
): RailwayOffer | null {
  // Maintainer, 2026-09-29: the line is for moving within Terminus, between two stations you hold;
  // since 2026-10-13 a mate's Station counts as yours here.
  if (from.cityId !== to.cityId) return null;
  if (stations.size < 2) return null;

  const platforms = ALL_DISTRICTS.filter(
    (district) => district.cityId === from.cityId && stations.has(district.id),
  );
  if (platforms.length < 2) return null;

  let best: RailwayOffer | null = null;
  for (const boardAt of platforms) {
    for (const alightAt of platforms) {
      if (boardAt.id === alightAt.id) continue;
      const toPlatform = pacedRoad(from, boardAt, pace);
      const fromPlatform = pacedRoad(alightAt, to, pace);
      const ride = railLinkMinutes(stations.get(boardAt.id) ?? 1);
      const minutes = toPlatform + ride + fromPlatform;
      if (best === null || minutes < best.minutes) {
        best = { boardAt, alightAt, toPlatform, fromPlatform, ride, minutes };
      }
    }
  }
  return best;
}

/** The same, by district id, for callers holding ids rather than districts. */
export function railwayOfferBetween(
  fromId: string,
  toId: string,
  stations: StationLevels,
  pace: RoadPace = {},
): RailwayOffer | null {
  const from = findDistrict(fromId);
  const to = findDistrict(toId);
  if (!from || !to) return null;
  return railwayOffer(from, to, stations, pace);
}

/**
 * One leg of the walk, in whole minutes.
 *
 * Zero when the party is already in that district, which is the common case at both ends and is
 * what makes "board at home, get off at the destination" cost exactly the rails the rule
 * promises. Everywhere else it is an ordinary road and is charged as one, including the floor:
 * a leg that exists is never free.
 */
function pacedRoad(from: District, to: District, pace: RoadPace): number {
  if (from.id === to.id) return 0;
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
