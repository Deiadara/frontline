import {
  CITY_DISTRICTS,
  LOCATION_CATALOG,
  weatherLabels,
  type EnvLabel,
  type EnvLabelId,
  type LocationKind,
  type WeatherKind,
} from '@frontline/shared';
import type { LabelWhen } from '../../components/ui/LabelChip';

/**
 * Which of a place's characteristics are only true today (GDD §A4).
 *
 * Two things put characteristics on a location and they compose (`city/labels.ts`): the location
 * itself, authored in the catalogue, and the day's sky. A smuggler's tunnel is Crammed and Dark
 * whatever is happening outside; the same tunnel is Wet because it rained this morning, and it will
 * not be tomorrow. Both draw as the identical chip, so a player planning tomorrow's push reads a
 * temporary problem as a permanent one and brings the wrong people.
 *
 * There is no *hour* in this: darkness used to be read off the clock and is not any more
 * (`battle/battlefield.ts`, `DARK_GROUND_TIER`), because a floodlit yard at ten at night is not
 * dark and a sewer at noon is. The sky is one roll for the whole city and it holds all day
 * (`city/weather.ts`), so "when" here means which day, and nothing says "after dark".
 */

/** What each sky reads as on a chip. `normal` puts no characteristics on anything. */
const SKY_PHRASE: Readonly<Record<WeatherKind, string>> = {
  normal: '',
  sunny: 'While the sun is on it',
  cold: 'While the cold snap lasts',
  foggy: 'While the fog sits',
  rainy: 'In the rain',
  stormy: 'In the storm',
  snowy: 'In the snow',
};

/**
 * A `LabelWhen` for one place under one sky.
 *
 * `kind` is the location's own kind, or null for ground the catalogue does not describe: a home
 * district under raid, a gate. Ground like that has no characteristics of its own, so everything on
 * it came out of the sky.
 */
export function whenItHolds(kind: LocationKind | null, weather: string): LabelWhen {
  const sky = weather as WeatherKind;
  const phrase = SKY_PHRASE[sky] ?? '';
  if (phrase === '') return () => undefined;

  const fromSky = new Set<EnvLabelId>(weatherLabels(sky).map((label) => label.id));
  const ownGround = new Set<EnvLabelId>(
    (kind === null ? [] : LOCATION_CATALOG[kind].labels).map((label) => label.id),
  );

  // Only the ones the ground would not carry on its own. A tunnel that is Wet in the dry is Wet
  // for good, and telling a player it lifts with the rain would be the opposite of the truth.
  return (label: EnvLabel) =>
    fromSky.has(label.id) && !ownGround.has(label.id)
      ? `${phrase}. Today's sky, not this ground.`
      : undefined;
}

/** The kind of location a fight is over, or null when it is a gate, a building or a home district. */
export function locationKindOf(locationId: string | undefined): LocationKind | null {
  if (locationId === undefined) return null;
  for (const district of CITY_DISTRICTS) {
    const found = district.locations.find((location) => location.id === locationId);
    if (found) return found.kind;
  }
  return null;
}
