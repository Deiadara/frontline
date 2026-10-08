import {
  ALL_DISTRICTS,
  districtWholeFor,
  findDistrict,
  wholeHolderAmong,
  type District,
  type LocationHolder,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Holding ground as a faction (maintainer ruling, 2026-10-07).
 *
 * The whole-district bonus and the armed gate count for a faction: its members together must
 * hold every location, and then every member is paid and the gate stands. Each location's own
 * pay stays with the crew holding it. Everything that asks "is this district whole, and whose is
 * it" reads through here, so the map, the gate, the fight and the fold agree on one answer.
 *
 * Reads only: nothing here writes, and nothing here imports a module that does, so the fight
 * rules (`battle/ground.ts`) can read it without closing a cycle through the settle.
 */

/** A crew's table, read off its owner's membership; null for a crew at no table. */
export interface TableSeat {
  factionId: string;
  joinedAt: string;
}

/**
 * Every crew's seat, by base id, read once for a pass over the map.
 *
 * Read through the standing fold, which every test of a fight, a chair or a track reaches with a
 * stub `Repositories` carrying only the tables it is about. A stub with no crews table or no
 * factions table is a world where nobody sits anywhere, and is answered as one rather than
 * thrown at, so the fold keeps working for the hundred fixtures written before the ruling.
 */
export function seatsByBase(repos: Partial<Repositories>): Map<string, TableSeat> {
  const seats = new Map<string, TableSeat>();
  const summaries = repos.bases?.listSummaries?.() ?? [];
  /*
   * One query for every seat in the world (2026-10-07), not one per crew.
   *
   * This read one `membershipOf` per base, and it is called from `alliesOf`, `tableOf` and
   * `wholeHolderOf`, which the battle board then calls once for each of the 36 districts on every
   * read, on a board that refetches on every world broadcast. `everySeat` is the same answer in a
   * single statement. The per-crew path is kept for the stub repositories a hundred fixtures pass
   * in, which carry `membershipOf` and not the newer reader.
   */
  const everySeat = repos.factions?.everySeat?.();
  for (const summary of summaries) {
    const seat = everySeat
      ? everySeat.get(summary.ownerId)
      : repos.factions?.membershipOf?.(summary.ownerId);
    if (seat) seats.set(summary.id, { factionId: seat.factionId, joinedAt: seat.joinedAt });
  }
  return seats;
}

/**
 * The two reads every question on this page starts from, taken once for a sweep over the map.
 *
 * `wholeHolderOf` and `districtsHeldWhole` each take their own copy when asked about one district,
 * which is right for one question and wrong for thirty-six: a caller walking the world passes this
 * instead and the queries stop multiplying by the district count.
 */
export interface MapRead {
  seats: Map<string, TableSeat>;
  controls: ReturnType<Repositories['city']['controls']>;
}

export function readTheMap(repos: Repositories): MapRead {
  return { seats: seatsByBase(repos), controls: repos.city.controls() };
}

/** The crew's faction mates, by base id: the crew itself is not in the set. */
export function alliesOf(repos: Repositories, baseId: string): Set<string> {
  const seats = seatsByBase(repos);
  const mine = seats.get(baseId);
  if (!mine) return new Set();
  const allies = new Set<string>();
  for (const [other, seat] of seats) {
    if (other !== baseId && seat.factionId === mine.factionId) allies.add(other);
  }
  return allies;
}

/** The crew and its faction mates together: the set a district is whole for. */
export function tableOf(repos: Repositories, baseId: string): Set<string> {
  return new Set([baseId, ...alliesOf(repos, baseId)]);
}

/**
 * Who holds a district whole, a faction counted as one party and named by its defender
 * (`wholeHolderAmong`), or null when nobody does.
 */
export function wholeHolderOf(
  repos: Repositories,
  district: District,
  /** A read already taken, for a caller sweeping the map. See {@link readTheMap}. */
  read?: MapRead,
): LocationHolder | null {
  const { seats, controls } = read ?? readTheMap(repos);
  return wholeHolderAmong(
    district,
    controls,
    (baseId) => seats.get(baseId)?.factionId ?? null,
    (baseId) => seats.get(baseId)?.joinedAt ?? '',
  );
}

/** Whether this crew, with its faction mates, holds every location in a district. */
export function holdsDistrictWhole(
  repos: Repositories,
  baseId: string,
  districtId: string,
): boolean {
  const district = findDistrict(districtId);
  if (!district) return false;
  return districtWholeFor(district, repos.city.controls(), tableOf(repos, baseId));
}

/**
 * Every district this crew holds whole with its faction mates, in map order, across every city
 * (2026-09-24: the gate screen draws from this, so a district in a second city has to be here).
 */
export function districtsHeldWhole(repos: Repositories, baseId: string): string[] {
  const controls = repos.city.controls();
  const table = tableOf(repos, baseId);
  return ALL_DISTRICTS.filter((district) => districtWholeFor(district, controls, table)).map(
    (district) => district.id,
  );
}
