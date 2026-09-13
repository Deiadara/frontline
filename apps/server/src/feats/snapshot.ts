import {
  BUILDING_KINDS,
  CITY_LOCATIONS,
  ITEM_CATALOG,
  OFFICER_ROLES,
  RESOURCE_KEYS,
  featMeasureKey,
  markFromPoints,
  markIndex,
  supplyUsed,
  type Base,
  type Commander,
  type FeatSnapshot,
  type ItemId,
} from '@frontline/shared';
import { roleFit } from '../roles/requirements.js';
import { districtsHeldWhole } from '../city/gates.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * Every number a feat might ask about this crew, in one flat record.
 *
 * Built in two halves. The **tallies** come straight off `crew_tallies`, already keyed by the
 * snapshot key they were written under, so they are merged in whole and cost one indexed read. The
 * **crew** half is computed here from state the game already keeps.
 *
 * ## Why the crew half is computed rather than counted
 *
 * These are all "is this true of you now" questions, and the answer can fall: an army dies, a
 * stockpile is spent, an officer is released, a location is taken back. A counter would say a crew
 * still holds fifteen places the evening after it lost twelve of them. Computing them means the
 * answer is always the true one, and none of them costs more than a walk over a list the crew row
 * already carries.
 *
 * The one that is not free is `locations_held`, which walks the city's control map. That map is a
 * single read of one row per location and is already loaded by half the screens in the game, so it
 * is cheap in practice; it is called out here because it is the one line in this function that
 * would need looking at again if the city got ten times bigger.
 *
 * ## The scoped measures, and why every scope is filled in
 *
 * A scoped measure is a family, and this fills in **every member of the family** rather than only
 * the ones some feat happens to ask about today. Writing the whole family is a handful of extra
 * integers and it means the catalogue can add a feat about the Infirmary, or about planks, with no
 * server change at all. The two exceptions are the ones whose family is unbounded: mission areas
 * and Overseer thresholds are tallied and read on demand rather than enumerated.
 */
export function featSnapshot(repos: Repositories, base: Base): FeatSnapshot {
  const snapshot: Record<string, number> = { ...repos.feats.tallies(base.id) };
  const put = (measure: Parameters<typeof featMeasureKey>[0], value: number, scope?: string) => {
    snapshot[featMeasureKey(measure, scope)] = value;
  };

  // --- the crew itself ---
  put('level', base.level);
  put('infamy_held', base.economy.infamy);
  put('notoriety', base.economy.notoriety);
  put('research_done', base.research.technologies.length);

  // --- what is standing in the district ---
  const levelOf = new Map(base.buildings.map((building) => [building.kind, building.level]));
  for (const kind of BUILDING_KINDS) put('building_level', levelOf.get(kind) ?? 0, kind);
  put(
    'buildings_total',
    base.buildings.reduce((total, building) => total + building.level, 0),
  );

  // --- the roster ---
  const army = base.army;
  const counts = Object.values(army).filter((count): count is number => (count ?? 0) > 0);
  put(
    'army_bodies',
    counts.reduce((total, count) => total + count, 0),
  );
  put('army_supply', supplyUsed(army));
  put('unit_kinds_held', counts.length);
  put(
    'fleet_size',
    Object.values(base.fleet).reduce((total, count) => total + (count ?? 0), 0),
  );

  // --- the officers ---
  put('officers_held', base.commanders.length);
  /*
   * The best mark on the books, as an index on the ladder rather than a letter.
   *
   * An index because a feat is a threshold on a number and "D or better" is `>= markIndex('D')`,
   * which is the same comparison every other feat makes. A benched officer has no chair and so no
   * mark at all (`crew/roster.ts` says the same thing and why), so they are read at the best of
   * any role they could sit in: the feat asks what this crew *has*, and somebody who would be a B
   * in a chair is a B whether or not they are sitting in one today.
   */
  const marks = base.commanders.map((officer) => markIndex(markFromPoints(bestFit(officer))));
  put('officer_best_mark', marks.length > 0 ? Math.max(...marks) : 0);

  // --- the city ---
  const controls = repos.city.controls();
  put(
    'locations_held',
    CITY_LOCATIONS.filter((location) => {
      const holder = controls.get(location.id)?.holder;
      return holder?.kind === 'crew' && holder.baseId === base.id;
    }).length,
  );
  put('districts_held_whole', districtsHeldWhole(repos, base.id).length);
  put('districts_scouted', repos.city.scouted(base.id).size);

  // --- the table ---
  const membership = repos.factions.membershipOf(base.ownerId);
  const faction = membership ? repos.factions.find(membership.factionId) : undefined;
  put('faction_infamy', faction?.infamyEarned ?? 0);
  put('faction_seats', faction ? repos.factions.members(faction.id).length : 0);

  // --- the satchel and the stockpile ---
  const held = Object.entries(base.inventory).filter(([, count]) => (count ?? 0) > 0);
  put(
    'blueprints_unlocked',
    held.filter(([id]) => ITEM_CATALOG[id as ItemId]?.kind === 'blueprint').length,
  );
  put('satchel_kinds', held.length);
  for (const key of RESOURCE_KEYS) put('resources_held', base.resources[key] ?? 0, key);

  return snapshot;
}

/**
 * How many of the Overseer's skills are at or above a threshold.
 *
 * Separate from the walk above because its family is unbounded: a feat may ask about fifty, or
 * about eighty, and enumerating every threshold from one to a hundred to fill a record would be a
 * hundred integers on every read to answer two questions. The caller fills in exactly the
 * thresholds the catalogue asks for, which is what `overseerMeasures` below does.
 */
export function overseerSnapshot(
  attributes: Readonly<Record<string, number>> | undefined,
  thresholds: readonly number[],
): Record<string, number> {
  const values = Object.values(attributes ?? {});
  const snapshot: Record<string, number> = {
    [featMeasureKey('overseer_best_skill')]: values.length > 0 ? Math.max(...values) : 0,
  };
  for (const threshold of thresholds) {
    snapshot[featMeasureKey('overseer_skills_at', String(threshold))] = values.filter(
      (value) => value >= threshold,
    ).length;
  }
  return snapshot;
}

/**
 * The score this officer would be marked on.
 *
 * Their chair when they are sitting in one, and otherwise the best of any role they could sit in.
 * The bench half is the point: `crew/roster.ts` shows no mark at all for somebody with no chair,
 * which is right on a card about a seat, and reading that as a zero here made the mark ladder sit
 * at nothing for a crew whose best officer happened to be waiting for a room to open. The feat
 * asks what this crew has, and somebody who would be a B in a chair is a B whether or not they
 * are sitting in one today.
 */
function bestFit(officer: Commander): number {
  if (officer.role !== null) return roleFit(officer.attributes, officer.role);
  return OFFICER_ROLES.reduce((best, role) => Math.max(best, roleFit(officer.attributes, role)), 0);
}
