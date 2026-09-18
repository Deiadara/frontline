import {
  BLUEPRINTS,
  BUILDING_KINDS,
  CITY_LOCATIONS,
  isBlueprintUnlocked,
  levelCeilingFor,
  OFFICER_ROLES,
  RESOURCE_KEYS,
  completedSet,
  featMeasureKey,
  findUnitModification,
  markFromPoints,
  markIndex,
  unitSlotsUsed,
  type Base,
  type Commander,
  type FeatSnapshot,
} from '@frontline/shared';
import { officerFitReader, type OfficerFitReader } from '../crew/standing.js';
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
  /*
   * ...and how many of them have nowhere left to go.
   *
   * Each structure against its own ceiling rather than against `BUILDING_MAX_LEVEL`: the Garage and
   * the Infirmary stop at 10, so one flat twenty would report a finished district as unfinished for
   * ever and strand the last rung of the ladder that asks for all eleven.
   */
  put(
    'buildings_maxed',
    base.buildings.filter((building) => building.level >= levelCeilingFor(building.kind)).length,
  );
  /*
   * The deck, counted two ways, because they are two different questions.
   *
   * `modifications_fitted` is how many cards are bolted in anywhere, which climbs steadily from
   * the first slot at Scrapyard level 5. `modification_sets` is how many structures are built
   * around one family end to end, which needs three open slots and so needs a structure at twenty:
   * it is the late-game question, and a crew with thirty fittings and no set has still never
   * committed a building to a plan.
   *
   * Read off the buildings rather than tallied. Both can go down, which is the point: dismantling
   * is permanent, but losing a structure takes its fittings with it, and a feat that asked "have
   * you ever" here would stay lit over an empty district.
   */
  put(
    'modifications_fitted',
    base.buildings.reduce((total, building) => total + building.modifications.length, 0),
  );
  put(
    'modification_sets',
    base.buildings.filter((building) => completedSet(building) !== null).length,
  );
  /*
   * The unit bench, read off the brackets the same way the deck is read off the slots.
   *
   * Through `findUnitModification` rather than counting non-null ids, so a bracket holding an id
   * the catalogue has since dropped counts for nothing, which is what it pays.
   */
  const cards = Object.values(base.unitLoadouts)
    .flat()
    .map((id) => (id === null ? undefined : findUnitModification(id)))
    .filter((spec) => spec !== undefined);
  put('unit_modifications_fitted', cards.length);
  put('masterpieces_fitted', cards.filter((spec) => spec.rarity === 'masterpiece').length);

  // --- the roster ---
  const army = base.army;
  const counts = Object.values(army).filter((count): count is number => (count ?? 0) > 0);
  put(
    'army_units',
    counts.reduce((total, count) => total + count, 0),
  );
  put('army_unit_slots', unitSlotsUsed(army));
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
  /*
   * Off the lifted sheet, which is the sheet `crew/roster.ts` prints and the Scrapyard gates on.
   * Measured on `officer.attributes` this counted the mark the crew had before the Overseer, the
   * teaching perks, the ground and the Lab, so the one ladder that asks "how good are your people"
   * was the one place none of that showed up.
   */
  const fit = officerFitReader(repos, base);
  const marks = base.commanders.map((officer) => markIndex(markFromPoints(bestFit(officer, fit))));
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

  // --- the inventory and the stockpile ---
  const held = Object.entries(base.inventory).filter(([, count]) => (count ?? 0) > 0);
  /*
   * Documents assembled, not paper on a shelf.
   *
   * This counted `kind: 'blueprint'` items, which is the generated document *and* six hand-written
   * pre-war collectibles whose own `usedFor` reads "Nothing the Lab can use". Four of those six sit
   * on the Black Market for infamy, so 440 infamy claimed the first rung of this ladder without a
   * single page ever being found. `isBlueprintUnlocked` over `BLUEPRINTS` asks the question the
   * feat is actually about: did this crew press Unlock.
   */
  put(
    'blueprints_unlocked',
    BLUEPRINTS.filter((spec) => isBlueprintUnlocked(base.inventory, spec.id)).length,
  );
  put('inventory_kinds', held.length);
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
function bestFit(officer: Commander, fit: OfficerFitReader): number {
  if (officer.role !== null) return fit.pointsFor(officer, officer.role);
  return OFFICER_ROLES.reduce((best, role) => Math.max(best, fit.pointsFor(officer, role)), 0);
}
