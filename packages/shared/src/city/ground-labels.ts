import { EVERY_LOCATION, findDistrict } from './atlas.js';
import {
  combineLeaderLabels,
  groundStateOf,
  tollingTowerNoise,
  type LocationControl,
} from './control.js';
import type { District } from './districts.js';
import { MAX_LABEL_TIER, envLabel, mergeLabels, type EnvLabel } from './labels.js';
import { LAMP_LABELS, lampsReach, type Location } from './locations.js';
import { weatherAt, weatherLabels } from './weather.js';

/**
 * What a location's ground is like at an instant, every source folded in: the one place the game
 * works it out (maintainer, 2026-10-09).
 *
 * The fight (`battlefieldOf` on the server), the location sheet's chips and the "Fights as" row
 * all read this, so a screen cannot promise ground the fight will not be had on. Four sources, in
 * the order they land:
 *
 *   1. the location's own labels (`Location.labels`),
 *   2. the day's sky (`weatherLabels`),
 *   3. what a district lays over itself: the Tolling Tower's Noisy and the Blood Priest's Eerie,
 *   4. Lampman's Row, last, because it is the one source that can take a label away.
 */
export function locationGroundLabels(
  location: Location,
  at: Date,
  controls: ReadonlyMap<string, LocationControl>,
): EnvLabel[] {
  const district = findDistrict(location.districtId);
  const laid = mergeLabels(
    location.labels,
    weatherLabels(weatherAt(at)),
    district ? districtGroundLabels(district, controls) : [],
  );
  return lampsOver(location, controls).reduce(withLamps, laid);
}

/**
 * Every label a district lays over all of its own ground: the Tolling Tower's Noisy while its
 * switch is on, and the Blood Priest's Eerie while he is alive in the Cloisters.
 */
export function districtGroundLabels(
  district: District,
  controls: ReadonlyMap<string, LocationControl>,
): EnvLabel[] {
  return [...tollingTowerNoise(district, controls), ...combineLeaderLabels(district, controls)];
}

/** One Lampman's Row's hold on one location: lit or out, and by how many tiers. */
export interface LampsOver {
  lit: boolean;
  tiers: number;
}

/** Every Lampman's Row on the map, found once. Only one exists today. */
const LAMP_POSTS: readonly Location[] = EVERY_LOCATION.filter((location) =>
  location.bonuses.some((bonus) => bonus.kind === 'lamps_switch'),
);

/**
 * Whether the lamps are lit on this row. Lampman's Row keeps its state in the switch fields the
 * Tolling Tower uses (`switchedOn`): thrown means the lamps are out. A row nobody has thrown reads
 * lit, which is the state a crew takes it in, because a capture clears the switch
 * (`clearedGroundState`) and the lamps a crew walks in under are the ones the last keeper left on.
 */
export function lampsLit(control: LocationControl): boolean {
  return !groundStateOf(control).switchedOn;
}

/**
 * The lamps that reach a location, each with its tiers.
 *
 * Only while a crew holds the row: the lamps are the holder's switch, and the looters or the
 * Combine sitting on it throw nothing, so the city's ground is what the catalogue says until
 * somebody takes the row. Levels 1 to 4 reach the row's own district; level 5 reaches the city.
 */
export function lampsOver(
  location: Location,
  controls: ReadonlyMap<string, LocationControl>,
): LampsOver[] {
  const cityId = findDistrict(location.districtId)?.cityId;
  return LAMP_POSTS.flatMap((post) => {
    const control = controls.get(post.id);
    if (control === undefined || control.holder.kind !== 'crew') return [];
    const reach = lampsReach(control.level);
    const reaches = reach.wholeCity
      ? findDistrict(post.districtId)?.cityId === cityId
      : post.districtId === location.districtId;
    return reaches ? [{ lit: lampsLit(control), tiers: reach.tiers }] : [];
  });
}

/**
 * The labels with one row's lamps applied. Lit, Dark and Foggy fall `tiers` and a label brought
 * to nothing is gone; out, they rise `tiers`, arriving at that tier where the ground had none, and
 * never past the top of the scale.
 */
export function withLamps(labels: readonly EnvLabel[], lamps: LampsOver): EnvLabel[] {
  const moved = labels.flatMap((label) => {
    if (!LAMP_LABELS.includes(label.id)) return [label];
    const tier = lamps.lit ? label.tier - lamps.tiers : label.tier + lamps.tiers;
    return tier <= 0 ? [] : [envLabel(label.id, Math.min(MAX_LABEL_TIER, tier))];
  });
  if (lamps.lit) return moved;
  const added = LAMP_LABELS.filter((id) => !labels.some((label) => label.id === id)).map((id) =>
    envLabel(id, lamps.tiers),
  );
  return [...moved, ...added];
}
