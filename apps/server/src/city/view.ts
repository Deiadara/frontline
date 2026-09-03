import {
  capturedGateIntelResistancePercent,
  CITY_DISTRICTS,
  findDistrict,
  CITY_LOCATIONS,
  HOLDER_LABELS,
  LOCATION_CATALOG,
  describeHoldBonus,
  districtHolder,
  gateIntelResistancePercent,
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
  type TerritoryEffects,
  blurredCount,
  bonusesAt,
  mergeLabels,
  upgradeCost,
  upgradeNote,
  weatherAt,
  weatherLabels,
  BUILDING_KINDS,
  type Building,
} from '@frontline/shared';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import { upgradeSeconds } from './upgrade.js';
import type { Repositories } from '../db/repos/index.js';
import { defaultScout, planScout } from '../scouting/scouting.js';
import { capturedGatesFor, gateFor, holdsDistrictWhole } from './gates.js';

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
  /**
   * §F2/§A4: how much a scout report tells this crew beyond the bare count, people and ground
   * folded together. Exposed so the battle board reads the same figure the city view does instead
   * of re-deriving it from a different fold, which is how the two came to disagree.
   */
  intelYieldPercent: number;
  base: Base;
  controls: Map<string, LocationControl>;
  visible: Set<string>;
  effects: TerritoryEffects;
  /** A crew's name by base id, for "who holds this". */
  nameOf: (baseId: string) => string;
  /**
   * §F2: how much of somebody else's garrison count this crew fails to bring back, in percent.
   *
   * The holder's counter-intelligence minus this crew's own reading. Zero for a location we hold, and
   * for the unaligned holders, who keep no secrets worth the name.
   */
  blurAgainst: (baseId: string) => number;
  /** §B7: what the gate on one district adds, when that crew holds the whole of it. */
  gateBlurOn: (districtId: string, baseId: string) => number;
}

export function cityContextFor(repos: Repositories, base: Base): CityContext {
  const controls = repos.city.controls();
  const effects = standingEffectsFor(repos, base);
  const names = new Map(repos.bases.listSummaries().map((summary) => [summary.id, summary.name]));
  /*
   * What a scout brings home: **the people and the ground together**.
   *
   * `crewEffectsFor` is the crew-only fold, and reading it here was a silent hole. `intelYield`
   * became a `TerritoryEffects` channel when the Watchtower arrived: precisely so a location and
   * a Head Spy would push the same lever, and this line kept asking the fold that has no
   * locations in it. The Watchtower's whole advertised reward ("everything your scouts do, they
   * do better") moved nothing at all, and neither did the Planetarium's or the Pirate Radio's.
   *
   * `effects` on the line above is already the combined fold, so this costs nothing.
   */
  const reading = effects.intelYieldPercent;
  // One lookup per rival, cached for the whole projection: a district page draws a dozen locations
  // and most of them belong to the same two or three crews.
  const resistance = new Map<string, number>();

  return {
    base,
    controls,
    effects,
    intelYieldPercent: reading,
    visible: visibleDistricts(repos, base, controls, effects),
    nameOf: (baseId) => names.get(baseId) ?? 'a crew nobody knows',
    blurAgainst: (baseId) => {
      if (baseId === base.id) return 0;
      let held = resistance.get(baseId);
      if (held === undefined) {
        const rival = repos.bases.findById(baseId);
        // §B7: their Gate is half of what a scout has to see past. Folded here rather than into
        // `crewEffectsFor`, which is about the people: a wall is not one of the crew.
        held = rival
          ? crewEffectsFor(repos, rival).intelResistancePercent +
            gateIntelResistancePercent(rival.buildings)
          : 0;
        resistance.set(baseId, held);
      }
      return Math.max(0, held - reading);
    },
    gateBlurOn: (districtId, baseId) => {
      if (baseId === base.id) return 0;
      if (!holdsDistrictWhole(repos, baseId, districtId)) return 0;
      return capturedGateIntelResistancePercent(gateFor(repos, districtId).level);
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
  const visible = repos.city.scouted(base.id);
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
 * **Your own front door is always you.** Every human account is created in `STARTER_DISTRICT_ID`
 * (`routes/overseer.ts`), the `bases` table carries no unique index on `district_id` and no writer
 * for the column, and the map has four residential districts, so a district holds as many crews as
 * have registered. Answering "the resident" with the first row of a `SELECT ... FROM bases` served
 * the earliest-registered player's whole structure list, damage and all, to every other player on
 * the one screen nobody has to scout.
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
      ? travelMinutesBetween(home, district, context.effects.travelSpeedPercent)
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

/** One location as its holder's opponent sees it, or, for a location you hold, in full. */
export /**
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
    damage: 0,
    fortification: 0,
  }));
}

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
    fortification: control.fortification,
    fortifyingUntil: control.fortifyingUntil,
    defense: locationDefense(location, control),
    // §F2: what a scout can actually count. Exact on our own ground; on somebody else's, only as
    // sharp as their cryptography lets it be.
    garrisonSize: mine
      ? garrisonSize(control)
      : blurredCount(
          garrisonSize(control),
          /*
           * §B7: their crew's counter-intel, their home Gate, and the gate on *this* ground.
           *
           * The board's rule is that the spying half is true for all gates. A district somebody
           * has taken whole and walled is exactly as hard to read as a home district behind the
           * same level of wall, so the captured gate lands on the same channel rather than on a
           * parallel one nobody would remember to check.
           */
          control.holder.kind === 'crew'
            ? context.blurAgainst(control.holder.baseId) +
                context.gateBlurOn(location.districtId, control.holder.baseId)
            : 0,
        ),
    // Somebody else's composition is what scouting would be for. Ours, we know.
    garrison: mine ? control.garrison : null,
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
function scoutingRunView(repos: Repositories, base: Base): DistrictDetailResponse['scoutingRun'] {
  const run = repos.scouting.activeFor(base.id)[0];
  if (!run) return null;
  const officer = base.commanders.find((held) => held.id === run.officerId);
  return {
    districtId: run.districtId,
    districtName: findDistrict(run.districtId)?.name ?? run.districtId,
    officerId: run.officerId,
    // A run whose officer was let go mid-journey still has to draw: the walk is under way whoever
    // is doing it, and a card that renders nothing is worse than one that says "somebody".
    officerName: officer?.name ?? 'Somebody',
    departedAt: run.departedAt,
    returnsAt: run.returnsAt,
  };
}

/** What sending somebody here would cost, before it is committed to. */
function quoteScout(
  repos: Repositories,
  base: Base,
  district: District,
  now: Date,
): DistrictDetailResponse['scoutPlan'] {
  const officer = defaultScout(base);
  if (!officer) return null;
  const plan = planScout(repos, base, district.id, officer, now);
  if (!plan) return null;
  return { officerId: officer.id, officerName: officer.name, minutes: plan.minutes };
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
      ? travelMinutesBetween(home, district, context.effects.travelSpeedPercent)
      : 0,
    // The fog, enforced in one location: unscouted ground returns nothing at all.
    locations: scouted
      ? district.locations.flatMap((location) => {
          const control = context.controls.get(location.id);
          return control ? [projectLocation(location, control, context, now)] : [];
        })
      : [],
    holder: scouted ? districtHolder(district, context.controls) : null,
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
    serverNow: now.toISOString(),
  };
}
