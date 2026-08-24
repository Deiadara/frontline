import { z } from 'zod';
import { envLabel, mergeLabels, type EnvLabel } from './labels.js';

/**
 * The weather (GDD §A4).
 *
 * One roll a day, at midnight UTC, for the whole city. Everybody fighting anywhere on the map that
 * day is fighting in the same sky, which is the point: weather is a *shared* condition, so "the
 * week it would not stop raining" is a thing two crews can talk about, and a player planning a
 * push at 23:50 knows the ground is about to change under them.
 *
 * ## Seven skies, and most days are none of them
 *
 * Seven in ten days are **Normal** and carry no label at all — not even a chip saying so. A game
 * where every day is Something has no Something in it; the weather has to be *usually nothing* for
 * a foggy morning to be worth re-planning around. The other three in ten split evenly across the
 * six real skies, so any given weather is about one day in twenty.
 *
 * ## Deterministic, like the Bar's roster
 *
 * A pure function of the UTC date, hashed, with no state anywhere. Two players asking on the same
 * day get the same sky; a server restart does not re-roll it; and a test can ask what 2031-04-04
 * looks like without moving a clock. The alternative — rolling and storing — puts the one piece of
 * world state everybody reads behind a write that can fail.
 *
 * ## The clock is half of it
 *
 * A sky is not a set of labels on its own: a sunny day is **Hot** at noon and **Cold** at four in
 * the morning, because the heat goes out of a city like this one the moment the sun does. So the
 * labels come from the sky *and the hour*, and the same location fights differently either side of
 * dusk — which is what makes "declare it for tonight" a decision.
 */

export const WEATHER_KINDS = [
  'normal',
  'sunny',
  'cold',
  'foggy',
  'rainy',
  'stormy',
  'snowy',
] as const;
export const WeatherKindSchema = z.enum(WEATHER_KINDS);
export type WeatherKind = z.infer<typeof WeatherKindSchema>;

export interface WeatherSpec {
  kind: WeatherKind;
  /** What the day is called. `Normal` is deliberately never shown — see {@link isPlainDay}. */
  name: string;
  /** One line, in the player's words. Shown under the day's name on the city screen. */
  blurb: string;
}

export const WEATHER_CATALOG: Readonly<Record<WeatherKind, WeatherSpec>> = {
  normal: {
    kind: 'normal',
    name: 'Ordinary',
    blurb: 'Grey, still, and nobody has an excuse.',
  },
  sunny: {
    kind: 'sunny',
    name: 'Clear',
    blurb: 'The smog has lifted off the upper levels and the ground is baking under it.',
  },
  cold: {
    kind: 'cold',
    name: 'Cold Snap',
    blurb: 'The temperature went through the floor overnight and has not come back.',
  },
  foggy: {
    kind: 'foggy',
    name: 'Fog',
    blurb: 'The river fog has come up over the lower levels and settled in to stay.',
  },
  rainy: {
    kind: 'rainy',
    name: 'Rain',
    blurb: 'Steady, cold, and finding every hole in every roof in the district.',
  },
  stormy: {
    kind: 'stormy',
    name: 'Storm',
    blurb: 'Crosswind, sheeting rain, and something coming off a roof every few minutes.',
  },
  snowy: {
    kind: 'snowy',
    name: 'Snow',
    blurb: 'Coming down hard enough to bury the ground and everything anybody left on it.',
  },
};

/** The share of days with nothing to say about them. */
export const PLAIN_DAY_SHARE = 0.7;

/** The six real skies, in roll order. Even odds between them across the remaining 30%. */
export const ROLLED_WEATHER: readonly WeatherKind[] = [
  'sunny',
  'cold',
  'foggy',
  'rainy',
  'stormy',
  'snowy',
];

/** A day with no weather worth naming. */
export function isPlainDay(kind: WeatherKind): boolean {
  return kind === 'normal';
}

/** `2026-08-17` — the day a moment belongs to, UTC, the same key the Bar's roster turns on. */
export function weatherDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * A stable 32-bit hash of the day string.
 *
 * FNV-1a. Deliberately not `Math.random` seeded anywhere: the roll has to be reproducible from the
 * date alone on every process that asks, including one that started thirty seconds ago.
 */
const WEATHER_SALT = 0x5ea50175;

function hashDay(day: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < day.length; i += 1) {
    hash ^= day.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Salted so the weather and anything else keyed on the same date string — the Bar's roster, for
  // one — cannot move together and quietly correlate a foggy day with a particular set of faces.
  return (hash ^ WEATHER_SALT) >>> 0;
}

/** The sky over the whole city on `day`. */
export function weatherOn(day: string): WeatherKind {
  const roll = hashDay(day) / 0x100000000;
  if (roll < PLAIN_DAY_SHARE) return 'normal';
  const into = (roll - PLAIN_DAY_SHARE) / (1 - PLAIN_DAY_SHARE);
  const index = Math.min(ROLLED_WEATHER.length - 1, Math.floor(into * ROLLED_WEATHER.length));
  return ROLLED_WEATHER[index] as WeatherKind;
}

/** The sky at a moment. */
export function weatherAt(at: Date): WeatherKind {
  return weatherOn(weatherDay(at));
}

/**
 * What each sky puts on the ground **by day**.
 *
 * Night is not a seventh sky: it is a modifier on whichever sky it is, applied by
 * {@link weatherLabels}. Writing fourteen rows instead of seven would let the day and the night
 * versions of one sky drift apart, and the interesting fact about a cold snap is precisely that
 * the night version is the day version and worse.
 */
export const WEATHER_LABELS: Readonly<Record<WeatherKind, readonly EnvLabel[]>> = {
  normal: [],
  sunny: [envLabel('hot', 2)],
  cold: [envLabel('cold', 2)],
  foggy: [envLabel('foggy', 3)],
  rainy: [envLabel('wet', 2), envLabel('cold', 1)],
  stormy: [envLabel('wet', 3), envLabel('windy', 2), envLabel('noisy', 2), envLabel('cold', 1)],
  snowy: [envLabel('snowy', 2), envLabel('cold', 3)],
};

/**
 * Night, as labels.
 *
 * `Dark II` on every night whatever the sky, because it is dark. The rest of the night's work is
 * done by {@link NIGHT_COLD_STEP} and by the one sky that inverts after dusk.
 */
export const NIGHT_LABELS: readonly EnvLabel[] = [envLabel('dark', 2)];

/** How many tiers of Cold the night adds on a sky that was already cold. */
export const NIGHT_COLD_STEP = 1;

/**
 * The labels the sky and the hour put on every location in the city.
 *
 * The one inversion worth reading twice: a **Clear** day is Hot while the sun is on it and Cold
 * once it is not, because nothing in this city holds heat. Every other sky gets colder at night
 * and otherwise stays itself.
 */
export function weatherLabels(kind: WeatherKind, night: boolean): EnvLabel[] {
  if (!night) return mergeLabels(WEATHER_LABELS[kind]);

  const afterDark: EnvLabel[] =
    kind === 'sunny'
      ? [envLabel('cold', 2)]
      : WEATHER_LABELS[kind].map((label) =>
          label.id === 'cold' ? envLabel('cold', label.tier + NIGHT_COLD_STEP) : label,
        );
  return mergeLabels(afterDark, NIGHT_LABELS);
}
