import {
  CITY_DISTRICTS,
  CITY_PLACES,
  HOLDER_LABELS,
  PLACE_KIND_CATALOG,
  describeHoldBonus,
  districtHolder,
  garrisonSize,
  isDistrictRaidable,
  isHeldBy,
  nearestDistricts,
  placeDefense,
  territoryEffectsFor,
  travelMinutesBetween,
  unifiedBonusFor,
  unitsUnlockedByPlace,
  type Base,
  type CityResponse,
  type District,
  type DistrictDetailResponse,
  type DistrictSummary,
  type PlaceControl,
  type PlaceView,
  type TerritoryEffects,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Reading the city (GDD §A4).
 *
 * The fog is enforced **here**, on the way out, and nowhere else. A district this crew has not
 * scouted returns no places at all — not a redacted list, not zeroes. That is the only version
 * that cannot leak: a client cannot render what was never sent, and there is one function to check
 * rather than one per field.
 */

/** Everything the city read needs, gathered once rather than per district. */
export interface CityContext {
  base: Base;
  controls: Map<string, PlaceControl>;
  visible: Set<string>;
  effects: TerritoryEffects;
  /** A crew's name by base id, for "who holds this". */
  nameOf: (baseId: string) => string;
}

export function cityContextFor(repos: Repositories, base: Base): CityContext {
  const controls = repos.city.controls();
  const effects = territoryEffectsFor(base.id, CITY_PLACES, controls);
  const names = new Map(repos.bases.listSummaries().map((summary) => [summary.id, summary.name]));

  return {
    base,
    controls,
    effects,
    visible: visibleDistricts(repos, base, controls, effects),
    nameOf: (baseId) => names.get(baseId) ?? 'a crew nobody knows',
  };
}

/**
 * Which districts this crew can see inside.
 *
 * Three ways in, and they compose: your own district is always visible, anywhere you have sent
 * people stays visible, and a Satellite Uplink shows you the nearest few without walking into them
 * — which is the whole reason that place is worth taking.
 */
export function visibleDistricts(
  repos: Repositories,
  base: Base,
  controls: Map<string, PlaceControl>,
  effects: TerritoryEffects,
): Set<string> {
  const visible = repos.city.scouted(base.id);
  visible.add(base.districtId);

  // Anywhere this crew is already standing is, self-evidently, somewhere they can see.
  for (const place of CITY_PLACES) {
    const control = controls.get(place.id);
    if (control && isHeldBy(control, base.id)) visible.add(place.districtId);
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
          mine: district.places.filter((place) => {
            const control = context.controls.get(place.id);
            return control !== undefined && isHeldBy(control, context.base.id);
          }).length,
          total: district.places.length,
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

/** One place as its holder's opponent sees it — or, for a place you hold, in full. */
export function projectPlace(
  place: (typeof CITY_PLACES)[number],
  control: PlaceControl,
  context: CityContext,
): PlaceView {
  const spec = PLACE_KIND_CATALOG[place.kind];
  const mine = isHeldBy(control, context.base.id);

  return {
    place,
    holder: control.holder,
    holderName:
      control.holder.kind === 'faction'
        ? context.nameOf(control.holder.baseId)
        : HOLDER_LABELS[control.holder.kind],
    fortification: control.fortification,
    fortifyingUntil: control.fortifyingUntil,
    defense: placeDefense(place, control),
    garrisonSize: garrisonSize(control),
    // Somebody else's composition is what scouting would be for. Ours, we know.
    garrison: mine ? control.garrison : null,
    bonus: describeHoldBonus(spec.bonus),
    reward: spec.reward,
    unlocks: unitsUnlockedByPlace(place.kind).map((unit) => unit.name),
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

  return {
    district,
    scouted,
    travelMinutes: home
      ? travelMinutesBetween(home, district, context.effects.travelSpeedPercent)
      : 0,
    // The fog, enforced in one place: unscouted ground returns nothing at all.
    places: scouted
      ? district.places.flatMap((place) => {
          const control = context.controls.get(place.id);
          return control ? [projectPlace(place, control, context)] : [];
        })
      : [],
    holder: scouted ? districtHolder(district, context.controls) : null,
    unified: unified ? { title: unified.title, effect: describeHoldBonus(unified.bonus) } : null,
    base: district.kind === 'residential' ? (resident ?? null) : null,
    raidable:
      resident !== undefined &&
      resident.id !== base.id &&
      isDistrictRaidable(district, district.id === base.districtId),
    serverNow: now.toISOString(),
  };
}
