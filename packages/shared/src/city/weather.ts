import { z } from 'zod';
import { envLabel, mergeLabels, type EnvLabel } from './labels.js';
import { GAME_TIMEZONE, dayInZone } from '../time/zone.js';

/**
 * The weather (GDD §A4).
 *
 * One roll a day, at game midnight, for the whole city. Everybody fighting anywhere on the map that
 * day is fighting in the same sky, which is the point: weather is a *shared* condition, so "the
 * week it would not stop raining" is a thing two crews can talk about, and a player planning a
 * push at 23:50 knows the ground is about to change under them.
 *
 * ## Seven skies, and most days are none of them
 *
 * Seven in ten days are **Normal** and carry no label at all, not even a chip saying so. A game
 * where every day is Something has no Something in it; the weather has to be *usually nothing* for
 * a foggy morning to be worth re-planning around. The other three in ten split evenly across the
 * six real skies, so any given weather is about one day in twenty.
 *
 * ## Deterministic, like the Bar's roster
 *
 * A pure function of the game date, hashed, with no state anywhere. Two players asking on the same
 * day get the same sky; a server restart does not re-roll it; and a test can ask what 2031-04-04
 * looks like without moving a clock. The alternative, rolling and storing, puts the one piece of
 * world state everybody reads behind a write that can fail.
 *
 * ## A day is a day, whatever the hour
 *
 * The sky used to be half of it: `Dark II` after nine, a tier of Cold on top of whatever was
 * already there, and a Clear day that inverted from Hot to Cold once the sun went. That whole
 * clock is gone. It made the same location fight differently at 20:59 and 21:01 with nothing on
 * screen counting down to it, and it turned every declaration into a question about the wall clock
 * rather than about the fight. What is left is the sky: a cold snap is cold, a storm is a storm,
 * and both of them are the same all day.
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
  /** What the day is called. `Normal` is deliberately never shown: see {@link isPlainDay}. */
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

/** `2026-08-17`: the game day a moment belongs to, the same key the Bar's roster turns on. */
export function weatherDay(at: Date, zone: string = GAME_TIMEZONE): string {
  return dayInZone(at, zone);
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
  // Salted so the weather and anything else keyed on the same date string: the Bar's roster, for
  // one: cannot move together and quietly correlate a foggy day with a particular set of faces.
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

/** What each sky puts on the ground. One row per sky, and it holds all day. */
export const WEATHER_LABELS: Readonly<Record<WeatherKind, readonly EnvLabel[]>> = {
  normal: [],
  sunny: [envLabel('hot', 2)],
  cold: [envLabel('cold', 2)],
  foggy: [envLabel('foggy', 3)],
  rainy: [envLabel('wet', 2), envLabel('cold', 1)],
  stormy: [envLabel('wet', 3), envLabel('windy', 2), envLabel('noisy', 2), envLabel('cold', 1)],
  snowy: [envLabel('snowy', 2), envLabel('cold', 3)],
};

/** The labels the sky puts on every location in the city. */
export function weatherLabels(kind: WeatherKind): EnvLabel[] {
  return mergeLabels(WEATHER_LABELS[kind]);
}
