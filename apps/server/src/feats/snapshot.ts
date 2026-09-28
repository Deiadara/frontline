import {
  ALL_DISTRICTS,
  BLUEPRINTS,
  BUILDING_KINDS,
  EVERY_LOCATION,
  cityOf,
  isBlueprintUnlocked,
  levelCeilingFor,
  OFFICER_ROLES,
  RESOURCE_KEYS,
  completedSet,
  featMeasureKey,
  findUnitModification,
  isHeldBy,
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
 * The one that is not free is `locations_held`, which walks the world's control map. That map is a
 * single read of one row per location and is already loaded by half the screens in the game, so it
 * is cheap in practice; it is called out here because it is the one line in this function that
 * would need looking at again if the world got ten times bigger. It doubled on 2026-09-24, when
 * the second city opened, and one walk over a hundred and twenty rows is still one walk.
 *
 * ## Whose city, and whose world
 *
 * Six measures here name ground, and the day Terminus opened each one had to answer whether it
 * means "everywhere" or "in my city". Five of them mean everywhere, and say so where they are
 * computed: a holding, a whole district, the regime's ground, its chapels and a district walked
 * into are all the same thing wherever they stand. The three that mean "not where I live" are the
 * frontier measures, and they are the same walk read against `cityOf(base.districtId)`.
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
  /*
   * What this crew holds, anywhere in the world (2026-09-24).
   *
   * This walked `CITY_LOCATIONS`, which is Ashfall, so a crew that had taken half of Terminus was
   * told it held nothing: the holdings ladder, the one that says how much of the map is yours,
   * counted the first city and silently ignored the second. "Everywhere" is the only reading that
   * survives a second city, because a holding is a holding and the rent is the same money.
   *
   * Not filtered to the open cities. That filter belongs on the *targets*, which is where an
   * unreachable rung does damage (`feats/world.ts`); here it would be a clause that changes no
   * answer, since nobody can hold ground in a city with no way in.
   */
  const heldPlaces = EVERY_LOCATION.filter((location) => {
    const holder = controls.get(location.id)?.holder;
    return holder?.kind === 'crew' && holder.baseId === base.id;
  });
  put('locations_held', heldPlaces.length);
  /*
   * ...and the same ground read from where the crew lives.
   *
   * Home is the city the crew's own district sits in, derived on every read rather than stored:
   * a crew gets its foothold abroad by marching across and taking ground, not by moving house, so
   * there is no moment at which anybody would remember to write a city onto the crew row.
   *
   * `cities_held` counts home in, and is not the same question as "is anything abroad": a crew
   * that holds one Terminus platform and nothing in Ashfall is abroad and is in one city.
   */
  const homeCity = cityOf(base.districtId);
  put(
    'locations_held_abroad',
    heldPlaces.filter((one) => cityOf(one.districtId) !== homeCity).length,
  );
  put('cities_held', new Set(heldPlaces.map((one) => cityOf(one.districtId))).size);
  // The railway, which is one location kind and therefore one filter (`city/rails.ts`). A rival
  // does not have to break your city to break your line, only to take one platform.
  put('rail_stations_held', heldPlaces.filter((one) => one.kind === 'rail_station').length);
  const heldWhole = districtsHeldWhole(repos, base.id);
  put('districts_held_whole', heldWhole.length);
  put(
    'districts_held_whole_abroad',
    heldWhole.filter((districtId) => cityOf(districtId) !== homeCity).length,
  );
  /*
   * The Combine's ground, read off the same walk (`city/combine.ts`).
   *
   * A district that was the regime's is one whose allegiance is `government` in the city table,
   * whoever stands on it today: the measure asks what a crew has taken off the Combine, and a
   * district it took off looters is not that. The Chapel is the one location of its kind, so
   * "held" is a lookup on the control row rather than a walk; it is read here rather than off
   * `combineLeaderAlive` because holding the plot is the question, and a plot can be held with
   * Directive Xero dead on it or lost with him still standing.
   */
  put(
    'combine_districts_held',
    heldWhole.filter((districtId) => COMBINE_GROUND.has(districtId)).length,
  );
  put(
    'chapel_held',
    CHAPELS.filter((location) => {
      const control = controls.get(location.id);
      return control !== undefined && isHeldBy(control, base.id);
    }).length,
  );
  /*
   * Districts walked into, everywhere.
   *
   * A raw count of `district_intel` rows with no district filter, which means it has counted both
   * cities since the day the second one opened, and that is the reading kept on purpose:
   * `sendScout` resolves its target through `findDistrict`, which answers for every city, so a
   * scout really can be sent across and a number that refused to count the trip would be lying
   * about work the player did. What was wrong was the ladder above it, which still asked for one
   * city's worth; `catalog.ts` grew the rung rather than narrowing this.
   */
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
   * This counted `kind: 'blueprint'` items, which once took in six pre-war collectibles that
   * opened nothing (retired 2026-09-28), so 440 infamy at the fence claimed the first rung without
   * a single page ever being found. `isBlueprintUnlocked` over `BLUEPRINTS` asks the question the
   * feat is actually about: does this crew hold the document, assembled or bought whole from the
   * fence.
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
 * The districts the regime holds by allegiance, which is the set `combine_districts_held` counts
 * over.
 *
 * Every city, not Ashfall's six (2026-09-24). The Combine holds Telemetry Hill, the Viaduct, the
 * Last Platform and the Blockhouse as well, and it is the same regime: a crew that took the
 * Blockhouse off it had taken a Combine district and was told it had taken none. "Everywhere" is
 * forced here by what the measure is about, which is the opponent rather than the postcode.
 */
const COMBINE_GROUND: ReadonlySet<string> = new Set(
  ALL_DISTRICTS.filter((district) => district.allegiance === 'government').map(
    (district) => district.id,
  ),
);

/**
 * The regime's chapels: the Chosen Chapel over Ashfall and the Frontier Chapel inside Control.
 *
 * Read off every location rather than Ashfall's, for the same reason as the ground above. It was
 * one chapel and one standalone feat; there are two now, a city apart, and the ladder in
 * `feats/catalog.ts` ends on holding both.
 */
const CHAPELS = EVERY_LOCATION.filter((location) => location.kind === 'combine_chapel');

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
