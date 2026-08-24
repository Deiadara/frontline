import {
  CITY_DISTRICTS,
  CITY_LOCATIONS,
  HOLDER_LABELS,
  LOCATION_CATALOG,
  describeHoldBonus,
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
  type TerritoryEffects,
  blurredCount,
  bonusesAt,
  isNight,
  mergeLabels,
  upgradeCost,
  upgradeNote,
  weatherAt,
  weatherLabels,
} from '@frontline/shared';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import { upgradeSeconds } from './upgrade.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * Reading the city (GDD §A4).
 *
 * The fog is enforced **here**, on the way out, and nowhere else. A district this crew has not
 * scouted returns no locations at all — not a redacted list, not zeroes. That is the only version
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
   * §F2 — how much of somebody else's garrison count this crew fails to bring back, in percent.
   *
   * The holder's counter-intelligence minus this crew's own reading. Zero for a location we hold, and
   * for the unaligned holders, who keep no secrets worth the name.
   */
  blurAgainst: (baseId: string) => number;
}

export function cityContextFor(repos: Repositories, base: Base): CityContext {
  const controls = repos.city.controls();
  const effects = standingEffectsFor(repos, base);
  const names = new Map(repos.bases.listSummaries().map((summary) => [summary.id, summary.name]));
  const reading = crewEffectsFor(repos, base).intelYieldPercent;
  // One lookup per rival, cached for the whole projection: a district page draws a dozen locations
  // and most of them belong to the same two or three crews.
  const resistance = new Map<string, number>();

  return {
    base,
    controls,
    effects,
    visible: visibleDistricts(repos, base, controls, effects),
    nameOf: (baseId) => names.get(baseId) ?? 'a crew nobody knows',
    blurAgainst: (baseId) => {
      if (baseId === base.id) return 0;
      let held = resistance.get(baseId);
      if (held === undefined) {
        const rival = repos.bases.findById(baseId);
        held = rival ? crewEffectsFor(repos, rival).intelResistancePercent : 0;
        resistance.set(baseId, held);
      }
      return Math.max(0, held - reading);
    },
  };
}

/**
 * Which districts this crew can see inside.
 *
 * Three ways in, and they compose: your own district is always visible, anywhere you have sent
 * people stays visible, and a Satellite Uplink shows you the nearest few without walking into them
 * — which is the whole reason that location is worth taking.
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
      summarise(
        district,
        context,
        summaries.find((candidate) => candidate.districtId === district.id) ?? null,
      ),
    ),
    homeDistrictId: base.districtId,
    serverNow: now.toISOString(),
  };
}

/** One location as its holder's opponent sees it — or, for a location you hold, in full. */
export function projectLocation(
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
      control.holder.kind === 'faction'
        ? context.nameOf(control.holder.baseId)
        : HOLDER_LABELS[control.holder.kind],
    fortification: control.fortification,
    fortifyingUntil: control.fortifyingUntil,
    defense: locationDefense(location, control),
    // §F2 — what a scout can actually count. Exact on our own ground; on somebody else's, only as
    // sharp as their cryptography lets it be.
    garrisonSize: mine
      ? garrisonSize(control)
      : blurredCount(
          garrisonSize(control),
          control.holder.kind === 'faction' ? context.blurAgainst(control.holder.baseId) : 0,
        ),
    // Somebody else's composition is what scouting would be for. Ours, we know.
    garrison: mine ? control.garrison : null,
    bonuses: bonusesAt(location.kind, control.level).map(describeHoldBonus),
    reward: spec.reward,
    /*
     * What the ground is like *right now* (§A4).
     *
     * The location's authored labels folded with the day's sky and the hour, which is exactly what
     * `battlefieldFor` will compute when the fight actually happens — the same two calls in the
     * same order. A screen that promised `Crammed IV, Wet II` and a fight that produced something
     * else would be worse than showing nothing.
     */
    labels: mergeLabels(spec.labels, weatherLabels(weatherAt(now), isNight(now))),
    unlocks: unitsUnlockedByLocation(location.kind).map((unit) => unit.name),
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
  const resident = repos.bases
    .listSummaries()
    .find((summary) => summary.districtId === district.id);
  // What is standing on their ground. Read behind the fog like everything else: you cannot describe
  // a street you have never walked down.
  const residentBuildings =
    scouted && resident ? (repos.bases.findById(resident.id)?.buildings ?? []) : [];

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
    base: district.kind === 'residential' ? (resident ?? null) : null,
    residentBuildings: district.kind === 'residential' ? residentBuildings : [],
    raidable:
      resident !== undefined &&
      resident.id !== base.id &&
      isDistrictRaidable(district, district.id === base.districtId),
    serverNow: now.toISOString(),
  };
}
