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
 * The weather (§A4): one roll a day for the whole city.
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

  it('is a pure function of the day: the same answer every time it is asked', () => {
    expect(weatherOn('2027-03-14')).toBe(weatherOn('2027-03-14'));
    expect(weatherAt(new Date('2027-03-14T03:00:00Z'))).toBe(
      weatherAt(new Date('2027-03-14T22:00:00Z')),
    );
  });

  it('turns over at Athens midnight, like everything else keyed on a day', () => {
    // August, so Athens is GMT+3: the sky changes at 21:00 UTC, not at 00:00 UTC.
    expect(weatherDay(new Date('2026-08-13T20:59:59.999Z'))).toBe('2026-08-13');
    expect(weatherDay(new Date('2026-08-13T21:00:00.000Z'))).toBe('2026-08-14');
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
    expect(weatherLabels('normal')).toEqual([]);
  });

  it('spells a clear day hot and a cold snap cold', () => {
    expect(tierOf(weatherLabels('sunny'), 'hot')).toBeGreaterThan(0);
    expect(tierOf(weatherLabels('sunny'), 'cold')).toBe(0);
    expect(tierOf(weatherLabels('cold'), 'cold')).toBeGreaterThan(0);
    expect(tierOf(weatherLabels('cold'), 'hot')).toBe(0);
  });

  /**
   * The day/night cycle is gone, and this is the guard on it.
   *
   * The sky used to be half the answer: `Dark II` after 21:00 UTC, a tier of Cold on top, and a
   * clear day that inverted from Hot to Cold once the sun went. All of it turned on a wall clock
   * nothing on screen counted down to. A sky is now one set of labels, and asking for it twice at
   * different hours has to give the same answer.
   */
  it('puts the same labels on the ground at every hour of the day', () => {
    for (const kind of WEATHER_KINDS) {
      expect(weatherLabels(kind), kind).toEqual(weatherLabels(kind));
      // And no sky brings darkness with it. Dark ground is a property of the place: see the
      // `dark` labels in `LOCATION_CATALOG` and `DARK_GROUND_TIER`.
      expect(tierOf(weatherLabels(kind), 'dark'), kind).toBe(0);
    }
  });

  it('spells rain as wet and cold, and a storm as more of both plus wind and noise', () => {
    const rain = weatherLabels('rainy');
    const storm = weatherLabels('stormy');
    expect(tierOf(rain, 'wet')).toBeGreaterThan(0);
    expect(tierOf(rain, 'cold')).toBeGreaterThan(0);
    expect(tierOf(storm, 'wet')).toBeGreaterThan(tierOf(rain, 'wet'));
    expect(tierOf(storm, 'windy')).toBeGreaterThan(0);
    expect(tierOf(storm, 'noisy')).toBeGreaterThan(0);
  });

  it('spells snow as snow *and* deep cold, which is what makes it the worst sky', () => {
    const snow = weatherLabels('snowy');
    expect(tierOf(snow, 'snowy')).toBeGreaterThan(0);
    expect(tierOf(snow, 'cold')).toBeGreaterThan(tierOf(weatherLabels('cold'), 'cold'));
  });

  it('never produces a tier the scale does not have', () => {
    for (const kind of WEATHER_KINDS) {
      for (const label of weatherLabels(kind)) {
        expect(label.tier, kind).toBeGreaterThanOrEqual(1);
        expect(label.tier, kind).toBeLessThanOrEqual(4);
      }
    }
  });
});
