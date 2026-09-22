import {
  findUnit,
  findLocation,
  combineLeaderOf,
  combineLeaderAlive,
  CITY_DISTRICTS,
  findDistrict,
  CITY_LOCATIONS,
  HOLDER_LABELS,
  LOCATION_CATALOG,
  describeHoldBonus,
  displayNameOf,
  districtHolder,
  garrisonSize,
  isDistrictRaidable,
  isHeldBy,
  nearestDistricts,
  locationDefense,
  travelMinutesBetween,
  unifiedBonusFor,
  unitsUnlockedByLocation,
  type Base,
  type CityResponse,
  type District,
  type DistrictDetailResponse,
  type DistrictSummary,
  type LocationControl,
  type LocationView,
  type SpyReport,
  type TerritoryEffects,
  bonusesAt,
  mergeLabels,
  upgradeCost,
  upgradeNote,
  weatherAt,
  weatherLabels,
  BUILDING_KINDS,
  type Building,
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import { upgradeSeconds, upgradingSince } from './upgrade.js';
import { fortifyingSince } from './actions.js';
import type { Repositories } from '../db/repos/index.js';
import { scoutBlocker, scoutParty, planScout } from '../scouting/scouting.js';
import { planSpy, spyBlocker, spyRunView } from '../spying/spying.js';
import { capturedGatesFor } from './gates.js';

/**
 * Reading the city (GDD §A4).
 *
 * The fog is enforced **here**, on the way out, and nowhere else. A district this crew has not
 * scouted returns no locations at all, not a redacted list, not zeroes. That is the only version
 * that cannot leak: a client cannot render what was never sent, and there is one function to check
 * rather than one per field.
 */

/** Everything the city read needs, gathered once rather than per district. */
export interface CityContext {
  base: Base;
  controls: Map<string, LocationControl>;
  visible: Set<string>;
  effects: TerritoryEffects;
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
    visible: visibleDistricts(repos, base, controls, effects),
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
 * Which districts this crew can see inside.
 *
 * Three ways in, and they compose: your own district is always visible, anywhere you have sent
 * people stays visible, and a Satellite Uplink shows you the nearest few without walking into them,
 * which is the whole reason that location is worth taking.
 */
export function visibleDistricts(
  repos: Repositories,
  base: Base,
  controls: Map<string, LocationControl>,
  effects: TerritoryEffects,
): Set<string> {
  // Through the admin-aware read, so the testing build sees every district it has not hidden.
  const visible = repos.city.visibleDistricts(base.id);
  visible.add(base.districtId);

  // Anywhere this crew is already standing is, self-evidently, somewhere they can see.
  for (const location of CITY_LOCATIONS) {
    const control = controls.get(location.id);
    if (control && isHeldBy(control, base.id)) visible.add(location.districtId);
  }

  for (const district of nearestDistricts(base.districtId, effects.visionRange)) {
    visible.add(district.id);
  }
  return visible;
}

/**
 * The crew a residential district page is about, from the viewer's side of the fog.
 *
 * **Your own front door is always you.** New accounts are spread across the four residential
 * districts now (`quietestDistrict` in `routes/overseer.ts`), but spreading is not exclusivity: the
 * `bases` table carries no unique index on `district_id`, four districts hold any number of players,
 * and the seeded rivals live in three of them. So a district still holds as many crews as have
 * landed on it. Answering "the resident" with the first row of a `SELECT ... FROM bases` served the
 * earliest-registered player's whole structure list to every other player on the one screen
 * nobody has to scout.
 *
 * For somebody else's ground it is still the first row, but a stably ordered one
 * (`db/repos/bases.ts` orders the summary scan), so at least the map and the battle board name the
 * same crew from one request to the next.
 */
function residentSummary(
  summaries: DistrictSummary['base'][],
  districtId: string,
  base: Base,
): DistrictSummary['base'] {
  if (districtId === base.districtId) {
    return summaries.find((summary) => summary?.id === base.id) ?? null;
  }
  return summaries.find((summary) => summary?.districtId === districtId) ?? null;
}

function summarise(
  district: District,
  context: CityContext,
  resident: DistrictSummary['base'],
): DistrictSummary {
  const scouted = context.visible.has(district.id);
  const home = CITY_DISTRICTS.find((candidate) => candidate.id === context.base.districtId);

  return {
    district,
    scouted,
    travelMinutes: home
      ? travelMinutesBetween(home, district, {
          reductionPercent: context.effects.travelSpeedPercent,
          flatMinutesOff: context.effects.roadMinutesOff,
        })
      : 0,
    holder: scouted ? districtHolder(district, context.controls) : null,
    // Null rather than 0/0 on unscouted ground: zero is a fact about the world, null is a fact
    // about what this crew knows, and the map must not confuse the two.
    held: scouted
      ? {
          mine: district.locations.filter((location) => {
            const control = context.controls.get(location.id);
            return control !== undefined && isHeldBy(control, context.base.id);
          }).length,
          total: district.locations.length,
        }
      : null,
    base: district.kind === 'residential' ? resident : null,
    isHome: district.id === context.base.districtId,
  };
}

export function projectCity(repos: Repositories, base: Base, now: Date): CityResponse {
  const context = cityContextFor(repos, base);
  const summaries = repos.bases.listSummaries();

  return {
    districts: CITY_DISTRICTS.map((district) =>
      summarise(district, context, residentSummary(summaries, district.id, base)),
    ),
    // §B7: the gates on ground this crew holds outright. Empty for a crew that holds none.
    capturedGates: capturedGatesFor(repos, base, now),
    homeDistrictId: base.districtId,
    serverNow: now.toISOString(),
  };
}

/**
 * A plot as it stands before anybody builds on it: every structure at level 1.
 *
 * Not persisted and never written: it is what the *scene* needs to draw a district, for a plot that
 * has no crew on it. Ids are derived from the district and the kind so the same plot draws the same
 * way on every read, which the scene needs to keep its outlines stable between polls.
 */
function unbuiltDistrict(districtId: string): Building[] {
  return BUILDING_KINDS.map((kind) => ({
    id: `${districtId}-${kind}`,
    kind,
    level: 1,
    modifications: [] as string[],
    fortification: 0,
  }));
}

/** One location as its holder's opponent sees it, or, for a location you hold, in full. */
function projectLocation(
  location: (typeof CITY_LOCATIONS)[number],
  control: LocationControl,
  context: CityContext,
  now: Date,
): LocationView {
  const spec = LOCATION_CATALOG[location.kind];
  const mine = isHeldBy(control, context.base.id);
  const nextCost = upgradeCost(location.kind, control.level);
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
    fortification: control.fortification,
    fortifyingUntil: control.fortifyingUntil,
    // So the sheet can offer to call the work off in its first tenth (`time/cancel.ts`).
    upgradingSince: upgradingSince(location, control),
    fortifyingSince: fortifyingSince(control),
    /*
     * Nothing about somebody else's garrison is free any more (maintainer, 2026-09-22). The
     * count used to be blurred by their counter-intel and served anyway; now the defence figure
     * on their ground is the ground and the digging alone, the count is null, and what the crew
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

/** The run this crew has out, if any, named so a screen can say who and where. */
export function scoutingRunView(
  repos: Repositories,
  base: Base,
): DistrictDetailResponse['scoutingRun'] {
  const run = repos.scouting.activeFor(base.id)[0];
  if (!run) return null;
  const officer = base.commanders.find((held) => held.id === run.officerId);
  return {
    districtId: run.districtId,
    districtName: findDistrict(run.districtId)?.name ?? run.districtId,
    officerId: run.officerId,
    // A party since 2026-09-22, which is what every run sent since then is drawn as. A run from
    // before that still names who went, and one whose officer was let go mid-journey still has
    // to draw: the walk is under way whoever is doing it.
    officerName: run.officerId === null ? 'Scout Party' : (officer?.name ?? 'Somebody'),
    departedAt: run.departedAt,
    returnsAt: run.returnsAt,
    // The leg the screen times its recall window off: see `ScoutingRunViewSchema`.
    travelMinutes: run.travelMinutes,
    recalledAt: run.recalledAt,
  };
}

/** What sending somebody here would cost, before it is committed to. */
function quoteScout(
  repos: Repositories,
  base: Base,
  district: District,
  now: Date,
): DistrictDetailResponse['scoutPlan'] {
  const whispers = scoutParty(base);
  if (!whispers) return null;
  const plan = planScout(repos, base, district.id, whispers, now);
  if (!plan) return null;
  return { minutes: plan.minutes };
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
 * What is *under* him stays behind the fog with the rest of the garrison.
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

export function projectDistrict(
  repos: Repositories,
  base: Base,
  district: District,
  now: Date,
): DistrictDetailResponse {
  const context = cityContextFor(repos, base);
  const scouted = context.visible.has(district.id);
  const home = CITY_DISTRICTS.find((candidate) => candidate.id === base.districtId);
  const unified = unifiedBonusFor(district.id);
  const resident = residentSummary(repos.bases.listSummaries(), district.id, base);
  /*
   * What is standing on their ground. Read behind the fog like everything else: you cannot describe
   * a street you have never walked down.
   *
   * A plot **nobody has moved into** draws a district at level 1 rather than nothing at all. The
   * screen for another crew's home is the district scene, and an empty plot used to render as one
   * sentence saying nobody was there: a hole where every other plot has a place. Every plot is the
   * same ground, so an unoccupied one is honestly drawn as that ground before anybody built on it,
   * which is also exactly what a crew moving in would start from.
   */
  const residentBuildings = !scouted
    ? []
    : resident
      ? (repos.bases.findById(resident.id)?.buildings ?? [])
      : district.kind === 'residential'
        ? unbuiltDistrict(district.id)
        : [];

  return {
    district,
    scouted,
    travelMinutes: home
      ? travelMinutesBetween(home, district, {
          reductionPercent: context.effects.travelSpeedPercent,
          flatMinutesOff: context.effects.roadMinutesOff,
        })
      : 0,
    // The fog, enforced in one location: unscouted ground returns nothing at all.
    locations: scouted
      ? district.locations.flatMap((location) => {
          const control = context.controls.get(location.id);
          return control ? [projectLocation(location, control, context, now)] : [];
        })
      : [],
    holder: scouted ? districtHolder(district, context.controls) : null,
    // The Combine legendary over this ground, dead or alive: public, like the seat-of-power tag.
    combineLeader: combineLeaderView(district, [...context.controls.values()]),
    unified: unified ? { title: unified.title, effect: describeHoldBonus(unified.bonus) } : null,
    base: district.kind === 'residential' ? resident : null,
    residentBuildings: district.kind === 'residential' ? residentBuildings : [],
    raidable:
      resident !== null &&
      resident.id !== base.id &&
      isDistrictRaidable(district, district.id === base.districtId),
    scoutingRun: scoutingRunView(repos, base),
    // Quoted only where it could be acted on. A price beside ground you have already walked is
    // noise, and one beside your own front door is nonsense.
    scoutPlan:
      scouted || district.id === base.districtId ? null : quoteScout(repos, base, district, now),
    scoutBlocker: scoutBlocker(base),
    spyRun: spyRunView(repos, base),
    // Quoted where a job could be sent: open ground somebody else holds. The tier is the
    // client's choice and only moves the caps, so any tier prices the clock.
    spyQuote:
      scouted && district.id !== base.districtId ? quoteSpy(repos, base, district, now) : null,
    spyBlocker: spyBlocker(base),
    // The door's own last look, for the gate window (`SpyPanel`). Only where a gate is a thing
    // a stranger could read: never on the crew's own district.
    spyGateReport:
      district.id === base.districtId
        ? null
        : (repos.spying.latestFor(base.id, { kind: 'gate', districtId: district.id }) ?? null),
    serverNow: now.toISOString(),
  };
}
