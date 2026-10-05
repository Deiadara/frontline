import {
  chairPassiveOf,
  findUnit,
  findLocation,
  combineLeaderOf,
  combineLeaderAlive,
  cityOfDistrict,
  districtsOfCity,
  findDistrict,
  HOLDER_LABELS,
  LOCATION_CATALOG,
  describeHoldBonus,
  displayNameOf,
  districtHolder,
  garrisonSize,
  isDistrictRaidable,
  isHeldBy,
  locationDefense,
  openSpyTiers,
  travelMinutesBetween,
  unifiedBonusFor,
  unitsUnlockedByLocation,
  type Base,
  type CityResponse,
  type District,
  type DistrictDetailResponse,
  type DistrictSummary,
  type Location,
  type LocationControl,
  type LocationHolder,
  type LocationView,
  type SpyReport,
  type CrewEffects,
  bonusesAt,
  mergeLabels,
  upgradeCost,
  upgradeNote,
  weatherAt,
  weatherLabels,
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import { upgradeSeconds, upgradingSince } from './upgrade.js';
import type { Repositories } from '../db/repos/index.js';
import { isClosedPlot } from '../battle/ground.js';
import { planSpy, spyBlocker, spyPartiesFor, spyRunViews } from '../spying/spying.js';
import { capturedGatesFor } from './gates.js';

/**
 * Reading the city (GDD §A4).
 *
 * Every district is open to every crew (maintainer, 2026-09-29: "whole city visible"): who holds
 * each location and the district as a whole is on the map for anybody. What stays hidden is what
 * is standing there, and that is enforced **here**, on the way out, in `projectLocation`: a
 * garrison on ground this crew does not hold is never sent, and what the crew knows about it is its
 * last spy report. A client cannot render what was never sent.
 */

/** Everything the city read needs, gathered once rather than per district. */
export interface CityContext {
  base: Base;
  controls: Map<string, LocationControl>;
  effects: CrewEffects;
  /** A crew's name by base id, for "who holds this". */
  nameOf: (baseId: string) => string;
  /**
   * The player behind a crew, by the name they go by, or null for a crew with no account behind it.
   *
   * A sign says which crew; a file says which person, and the person is who a player is sizing up
   * before they call a fight. The seeded neighbours have accounts too, so they answer here like
   * anybody else.
   */
  playerOf: (baseId: string) => string | null;
  /** The last spy report this crew wrote on a location, or null (2026-09-22). */
  latestSpyReport: (locationId: string) => SpyReport | null;
}

export function cityContextFor(repos: Repositories, base: Base): CityContext {
  const controls = repos.city.controls();
  const effects = standingEffectsFor(repos, base);
  const summaries = repos.bases.listSummaries();
  const names = new Map(summaries.map((summary) => [summary.id, summary.name]));
  // One user read per crew, cached for the projection: a district draws a dozen locations and most
  // of them belong to the same two or three crews.
  const owners = new Map(summaries.map((summary) => [summary.id, summary.ownerId]));
  const players = new Map<string, string | null>();
  return {
    base,
    controls,
    effects,
    nameOf: (baseId) => names.get(baseId) ?? 'a crew nobody knows',
    latestSpyReport: (locationId) =>
      repos.spying.latestFor(base.id, { kind: 'location', locationId }) ?? null,
    playerOf: (baseId) => {
      let player = players.get(baseId);
      if (player === undefined) {
        const ownerId = owners.get(baseId);
        const user = ownerId === undefined ? undefined : repos.users.findById(ownerId);
        player = user ? displayNameOf(user) : null;
        players.set(baseId, player);
      }
      return player;
    },
  };
}

/**
 * The crew a residential district page is about, from the viewer's side.
 *
 * **Your own front door is always you.** A home plot holds one crew now, bots included
 * (`takenHomes` in `routes/overseer.ts`, maintainer 2026-09-28), so for anybody else's plot there is
 * one row to find. A database from before that rule can still hold a player on a seeded bot's plot,
 * and there the player is the resident, as `residentOf` (`battle/ground.ts`) answers for the fight
 * rules: the map used to take the first row, the bot, so the plate, the buildings and the raid
 * button named one crew while every call landed on the other.
 */
function residentSummary(
  summaries: DistrictSummary['base'][],
  districtId: string,
  base: Base,
): DistrictSummary['base'] {
  if (districtId === base.districtId) {
    return summaries.find((summary) => summary?.id === base.id) ?? null;
  }
  const living = summaries.filter((summary) => summary?.districtId === districtId);
  return living.find((summary) => summary?.isBot === false) ?? living[0] ?? null;
}

function summarise(
  district: District,
  context: CityContext,
  resident: DistrictSummary['base'],
): DistrictSummary {
  const home = findDistrict(context.base.districtId);

  return {
    district,
    travelMinutes: home
      ? travelMinutesBetween(home, district, {
          reductionPercent: context.effects.travelSpeedPercent,
          baseCutPercent: chairPassiveOf(context.effects, 'cartographer', 'travel_time'),
          flatMinutesOff: context.effects.roadMinutesOff,
        })
      : 0,
    holder: districtHolder(district, context.controls),
    held: {
      mine: district.locations.filter((location) => {
        const control = context.controls.get(location.id);
        return control !== undefined && isHeldBy(control, context.base.id);
      }).length,
      total: district.locations.length,
    },
    base: district.kind === 'residential' ? resident : null,
    isHome: district.id === context.base.districtId,
  };
}

/**
 * The map of one city, as one crew sees it.
 *
 * `cityId` defaults to the city the crew is standing in, which is the answer a bare read wants and
 * what every write that answers with the map gives back. `cityOfDistrict` walks the one edge the
 * map carries (a crew is in a district, a district is in a city) and answers Ashfall for an id the
 * map does not have, so a save written before the second city opened still draws the map it was
 * written against.
 *
 * Any other city is a map a player is **looking at** rather than standing in (`routes/city.ts`
 * holds that door), and it reads exactly as the crew's own does: the whole city is visible.
 */
export function projectCity(
  repos: Repositories,
  base: Base,
  now: Date,
  cityId: string = cityOfDistrict(base.districtId),
): CityResponse {
  const context = cityContextFor(repos, base);
  const summaries = repos.bases.listSummaries();

  return {
    districts: districtsOfCity(cityId).map((district) =>
      summarise(district, context, residentSummary(summaries, district.id, base)),
    ),
    /*
     * §B7: the gates on ground this crew holds outright, in every city.
     *
     * Not narrowed to `cityId`, because a gate is a fact about the crew rather than about the map
     * being looked at, and the same list is read by the screens that draw what a crew has running
     * anywhere. The map filters to the city it is painting.
     */
    capturedGates: capturedGatesFor(repos, base, now),
    cityId,
    homeDistrictId: base.districtId,
    serverNow: now.toISOString(),
  };
}

/** One location as its holder's opponent sees it, or, for a location you hold, in full. */
function projectLocation(
  location: Location,
  control: LocationControl,
  context: CityContext,
  now: Date,
  admin: boolean,
): LocationView {
  const spec = LOCATION_CATALOG[location.kind];
  const mine = isHeldBy(control, context.base.id);
  const nextCost = upgradeCost(
    location.kind,
    control.level,
    chairPassiveOf(context.effects, 'engineer', 'building_cost'),
  );
  const note = upgradeNote(location.kind, control.level);

  return {
    location,
    holder: control.holder,
    level: control.level,
    upgradingUntil: control.upgradingUntil,
    // The whole upgrade offer in one object, priced and worded here rather than on the client:
    // the screen showing what a level costs and the route charging for it read the same function.
    upgrade:
      nextCost && note
        ? {
            toLevel: control.level + 1,
            cost: nextCost,
            note,
            seconds: upgradeSeconds(location.kind, control.level),
          }
        : null,
    holderName:
      control.holder.kind === 'crew'
        ? context.nameOf(control.holder.baseId)
        : HOLDER_LABELS[control.holder.kind],
    holderPlayer: control.holder.kind === 'crew' ? context.playerOf(control.holder.baseId) : null,
    // So the sheet can offer to call the work off in its first tenth (`time/cancel.ts`).
    upgradingSince: upgradingSince(location, control, admin),
    /*
     * Nothing about somebody else's garrison is free any more (maintainer, 2026-09-22). The
     * count used to be blurred by their counter-intel and served anyway; now the defence figure
     * on their ground is the ground alone, the count is null, and what the crew
     * knows is whatever its last spy report on the place said. Ours, we know exactly.
     */
    defense: mine
      ? locationDefense(location, control)
      : locationDefense(location, { ...control, garrison: {} }),
    garrisonSize: mine ? garrisonSize(control) : null,
    garrison: mine ? control.garrison : null,
    latestSpyReport: mine ? null : context.latestSpyReport(location.id),
    bonuses: bonusesAt(location.kind, control.level).map(describeHoldBonus),
    reward: spec.reward,
    /*
     * What the ground is like *right now* (§A4).
     *
     * The location's authored labels folded with the day's sky and the hour, which is exactly what
     * `battlefieldFor` will compute when the fight actually happens: the same two calls in the
     * same order. A screen that promised `Crammed IV, Wet II` and a fight that produced something
     * else would be worse than showing nothing.
     */
    labels: mergeLabels(spec.labels, weatherLabels(weatherAt(now))),
    unlocks: unitsUnlockedByLocation(location.kind).map((unit) => unit.name),
  };
}

function quoteSpy(
  repos: Repositories,
  base: Base,
  district: District,
  now: Date,
): DistrictDetailResponse['spyQuote'] {
  const plan = planSpy(repos, base, district.id, 'loose_ears', now);
  return plan ? { minutes: plan.minutes } : null;
}

/**
 * The legendary whose shadow a district is under, for the district screen (`city/combine.ts`).
 *
 * His existence is public and his death is public: which leader runs which district is the
 * thing everybody in the city already knows, and a crew that took his plot has told everybody.
 * What is *under* him stays unknown with the rest of the garrison until somebody spies on it.
 */
function combineLeaderView(
  district: District,
  controls: readonly LocationControl[],
): DistrictDetailResponse['combineLeader'] {
  const leader = combineLeaderOf(district.id);
  if (!leader) return null;
  const unit = findUnit(leader.unitId);
  const plot = findLocation(leader.locationId);
  if (!unit || !plot) return null;
  return {
    unitId: leader.unitId,
    name: unit.name,
    locationId: leader.locationId,
    locationName: plot.name,
    alive: combineLeaderAlive(leader, controls),
    powerName: leader.powerName,
    pronoun: leader.pronoun,
    powerLine: leader.powerLine,
  };
}

/** The table the crew holding a district whole sits at, for its "Held by" plaque. */
function factionOfHolder(
  repos: Repositories,
  holder: LocationHolder | null,
): DistrictDetailResponse['holderFaction'] {
  if (holder?.kind !== 'crew') return null;
  const owner = repos.bases.findById(holder.baseId)?.ownerId;
  const seat = owner ? repos.factions.membershipOf(owner) : undefined;
  const faction = seat ? repos.factions.find(seat.factionId) : undefined;
  return faction ? { name: faction.name, badge: faction.badge } : null;
}

export function projectDistrict(
  repos: Repositories,
  base: Base,
  district: District,
  now: Date,
  /** Testing mode, for the start of a location's five-second upgrade (`upgradingSince`). */
  admin = false,
): DistrictDetailResponse {
  const context = cityContextFor(repos, base);
  const home = findDistrict(base.districtId);
  const unified = unifiedBonusFor(district.id);
  const resident = residentSummary(repos.bases.listSummaries(), district.id, base);
  /*
   * What is standing on their ground: public, like any building on a street.
   *
   * A plot **nobody has moved into** is closed until a crew claims it (maintainer, 2026-09-28), so it
   * draws nothing. It used to draw a level-1 district, so a crew could walk the streets of a plot
   * that is nobody's.
   */
  const closed = isClosedPlot(repos, district, base);
  const standingThere =
    closed || !resident ? [] : (repos.bases.findById(resident.id)?.buildings ?? []);
  /*
   * The structures and their levels, and not the cards fitted to them. A card is what a crew bought,
   * not what a passer-by sees from the street, and two of them are a term of the spy contest: an
   * Encrypted Core's points and the gate level summed to the resident's counter score, which is
   * private (maintainer, 2026-10-01). The crew profile strips them for the same reason.
   */
  const residentBuildings =
    resident?.id === base.id
      ? standingThere
      : standingThere.map((building) => ({ ...building, modifications: [] }));
  const holder = districtHolder(district, context.controls);

  return {
    district,
    travelMinutes: home
      ? travelMinutesBetween(home, district, {
          reductionPercent: context.effects.travelSpeedPercent,
          baseCutPercent: chairPassiveOf(context.effects, 'cartographer', 'travel_time'),
          flatMinutesOff: context.effects.roadMinutesOff,
        })
      : 0,
    locations: district.locations.flatMap((location) => {
      const control = context.controls.get(location.id);
      return control ? [projectLocation(location, control, context, now, admin)] : [];
    }),
    holder,
    holderFaction: factionOfHolder(repos, holder),
    // The Combine legendary over this ground, dead or alive: public, like the seat-of-power tag.
    combineLeader: combineLeaderView(district, [...context.controls.values()]),
    unified: unified ? { title: unified.title, effect: describeHoldBonus(unified.bonus) } : null,
    base: district.kind === 'residential' ? resident : null,
    residentBuildings: district.kind === 'residential' ? residentBuildings : [],
    closed,
    raidable:
      resident !== null &&
      resident.id !== base.id &&
      isDistrictRaidable(district, district.id === base.districtId),
    spyRuns: spyRunViews(repos, base),
    spyParties: spyPartiesFor(repos, base, now),
    spyTiersOpen: openSpyTiers(base.research.technologies),
    // Quoted where a job could be sent: anywhere but the crew's own district and a plot nobody
    // has claimed, which has nobody to read. The tier is the client's choice and only moves the
    // caps, so any tier prices the clock.
    spyQuote:
      closed || district.id === base.districtId ? null : quoteSpy(repos, base, district, now),
    spyBlocker: spyBlocker(base, now),
    // The door's own last look, for the gate window (`SpyPanel`). Only where a gate is a thing
    // a stranger could read: never on the crew's own district.
    spyGateReport:
      district.id === base.districtId
        ? null
        : (repos.spying.latestFor(base.id, { kind: 'gate', districtId: district.id }) ?? null),
    serverNow: now.toISOString(),
  };
}
