import { describe, expect, it } from 'vitest';
import { tierOf } from './labels.js';
import {
  PLAIN_DAY_SHARE,
  ROLLED_WEATHER,
  WEATHER_CATALOG,
  WEATHER_KINDS,
  isPlainDay,
  weatherAt,
  weatherDay,
  weatherLabels,
  weatherOn,
} from './weather.js';

/**
 * The weather (§A4) — one roll a day for the whole city.
 *
 * Two properties carry the whole design and both are measured over twenty thousand days rather
 * than asserted about one: **most days are nothing**, so a foggy morning is worth re-planning
 * around, and **no sky is rare enough to never be seen**. A distribution test rather than a
 * spot check, because a hash that quietly favoured one bucket would pass any single date.
 */

const DAYS = 20_000;
const START = Date.UTC(2026, 0, 1);

function census(): Record<string, number> {
  const counts = Object.fromEntries(WEATHER_KINDS.map((kind) => [kind, 0])) as Record<
    string,
    number
  >;
  for (let i = 0; i < DAYS; i += 1) {
    const day = new Date(START + i * 86_400_000).toISOString().slice(0, 10);
    counts[weatherOn(day)] = (counts[weatherOn(day)] ?? 0) + 1;
  }
  return counts;
}

describe('the daily roll', () => {
  const counts = census();

  it('leaves about seven days in ten with nothing to say about them', () => {
    const share = (counts.normal ?? 0) / DAYS;
    expect(share).toBeGreaterThan(PLAIN_DAY_SHARE - 0.02);
    expect(share).toBeLessThan(PLAIN_DAY_SHARE + 0.02);
  });

  it('splits the rest evenly, so no sky is a curiosity', () => {
    const each = (1 - PLAIN_DAY_SHARE) / ROLLED_WEATHER.length;
    for (const kind of ROLLED_WEATHER) {
      const share = (counts[kind] ?? 0) / DAYS;
      expect(share, kind).toBeGreaterThan(each * 0.7);
      expect(share, kind).toBeLessThan(each * 1.3);
    }
  });

  it('is a pure function of the day — the same answer every time it is asked', () => {
    expect(weatherOn('2027-03-14')).toBe(weatherOn('2027-03-14'));
    expect(weatherAt(new Date('2027-03-14T03:00:00Z'))).toBe(
      weatherAt(new Date('2027-03-14T22:00:00Z')),
    );
  });

  it('turns over on the UTC boundary, like everything else keyed on a day', () => {
    expect(weatherDay(new Date('2026-08-13T23:59:59.999Z'))).toBe('2026-08-13');
    expect(weatherDay(new Date('2026-08-14T00:00:00.000Z'))).toBe('2026-08-14');
  });

  it('names and describes every sky', () => {
    for (const kind of WEATHER_KINDS) {
      expect(WEATHER_CATALOG[kind].name.length, kind).toBeGreaterThan(2);
      expect(WEATHER_CATALOG[kind].blurb.length, kind).toBeGreaterThan(20);
    }
  });
});

describe('what a sky puts on the ground', () => {
  it('says nothing at all on an ordinary day', () => {
    expect(isPlainDay('normal')).toBe(true);
    expect(weatherLabels('normal', false)).toEqual([]);
  });

  /** The one inversion: nothing in this city holds heat, so a clear day is cold once the sun is off it. */
  it('turns a clear day cold after dark', () => {
    expect(tierOf(weatherLabels('sunny', false), 'hot')).toBeGreaterThan(0);
    expect(tierOf(weatherLabels('sunny', false), 'cold')).toBe(0);
    expect(tierOf(weatherLabels('sunny', true), 'hot')).toBe(0);
    expect(tierOf(weatherLabels('sunny', true), 'cold')).toBeGreaterThan(0);
  });

  it('makes every other sky colder at night rather than different', () => {
    for (const kind of ['cold', 'rainy', 'stormy', 'snowy'] as const) {
      const day = tierOf(weatherLabels(kind, false), 'cold');
      const night = tierOf(weatherLabels(kind, true), 'cold');
      expect(night, kind).toBeGreaterThan(day);
    }
  });

  it('is dark at night whatever the sky is doing', () => {
    for (const kind of WEATHER_KINDS) {
      expect(tierOf(weatherLabels(kind, true), 'dark'), kind).toBeGreaterThan(0);
      expect(tierOf(weatherLabels(kind, false), 'dark'), kind).toBe(0);
    }
  });

  it('spells rain as wet and cold, and a storm as more of both plus wind and noise', () => {
    const rain = weatherLabels('rainy', false);
    const storm = weatherLabels('stormy', false);
    expect(tierOf(rain, 'wet')).toBeGreaterThan(0);
    expect(tierOf(rain, 'cold')).toBeGreaterThan(0);
    expect(tierOf(storm, 'wet')).toBeGreaterThan(tierOf(rain, 'wet'));
    expect(tierOf(storm, 'windy')).toBeGreaterThan(0);
    expect(tierOf(storm, 'noisy')).toBeGreaterThan(0);
  });

  it('spells snow as snow *and* deep cold, which is what makes it the worst sky', () => {
    const snow = weatherLabels('snowy', false);
    expect(tierOf(snow, 'snowy')).toBeGreaterThan(0);
    expect(tierOf(snow, 'cold')).toBeGreaterThan(tierOf(weatherLabels('cold', false), 'cold'));
  });

  it('never produces a tier the scale does not have', () => {
    for (const kind of WEATHER_KINDS) {
      for (const night of [false, true]) {
        for (const label of weatherLabels(kind, night)) {
          expect(label.tier, `${kind}/${night}`).toBeGreaterThanOrEqual(1);
          expect(label.tier, `${kind}/${night}`).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});
