import { describe, expect, it } from 'vitest';
import {
  GAME_TIMEZONE,
  OFFERED_TIMEZONES,
  TimezoneSchema,
  dayInZone,
  formatClock,
  gameHourInZone,
  hourInZone,
  instantAtHourInZone,
  isValidTimezone,
  lastWeekBoundary,
  nextDayBoundary,
  utcHourInZone,
  zoneCity,
  zoneLabel,
} from './zone.js';

/**
 * The whole reason this module exists is that "what day is it" has a different answer in Athens
 * than in UTC for two hours out of every twenty-four, and a different answer again across a
 * summer-time boundary. Every test here is an instant where a naive implementation is wrong.
 */

describe('the game runs on the Athens clock', () => {
  it('names Europe/Athens as the house clock and offers it first', () => {
    expect(GAME_TIMEZONE).toBe('Europe/Athens');
    expect(OFFERED_TIMEZONES[0]).toBe(GAME_TIMEZONE);
  });

  it('is two hours ahead of UTC in winter and three in summer', () => {
    // The offset is not a constant, which is exactly why nothing here stores one.
    expect(formatClock(new Date('2026-01-15T12:00:00.000Z'), GAME_TIMEZONE)).toBe('14:00');
    expect(formatClock(new Date('2026-07-15T12:00:00.000Z'), GAME_TIMEZONE)).toBe('15:00');
    expect(hourInZone(new Date('2026-07-15T12:00:00.000Z'), GAME_TIMEZONE)).toBe(15);
  });

  it('labels the zone at the instant asked about, not once and forever', () => {
    expect(zoneLabel(new Date('2026-01-15T12:00:00.000Z'), GAME_TIMEZONE)).toBe('GMT+2');
    expect(zoneLabel(new Date('2026-07-15T12:00:00.000Z'), GAME_TIMEZONE)).toBe('GMT+3');
  });
});

describe('the day boundary', () => {
  it('rolls over at Athens midnight, which is not UTC midnight', () => {
    // 22:30 UTC in summer is 01:30 on the *next* Athens day. A UTC-derived day is a day behind
    // here, which would put the whole city on yesterday's black-market shelf for three hours.
    expect(dayInZone(new Date('2026-07-15T22:30:00.000Z'), GAME_TIMEZONE)).toBe('2026-07-16');
    expect(dayInZone(new Date('2026-07-15T22:30:00.000Z'), 'UTC')).toBe('2026-07-15');
  });

  it('is still the previous day just before Athens midnight', () => {
    expect(dayInZone(new Date('2026-07-15T20:59:00.000Z'), GAME_TIMEZONE)).toBe('2026-07-15');
    expect(dayInZone(new Date('2026-07-15T21:01:00.000Z'), GAME_TIMEZONE)).toBe('2026-07-16');
  });

  it('finds the next rollover to the minute', () => {
    const at = nextDayBoundary(new Date('2026-07-15T12:00:00.000Z'), GAME_TIMEZONE);
    expect(at.toISOString()).toBe('2026-07-15T21:00:00.000Z');
    // Which is midnight where the player is standing.
    expect(formatClock(at, GAME_TIMEZONE)).toBe('00:00');
  });

  it('lands on the minute the date turns, whatever second it was asked at', () => {
    const at = nextDayBoundary(new Date('2026-07-15T12:00:37.250Z'), GAME_TIMEZONE);
    expect(at.toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });

  it('survives the spring-forward night, where a day is 23 hours long', () => {
    // Greece moves its clocks at 03:00 local on the last Sunday in March 2026 (the 29th).
    const inside = new Date('2026-03-29T00:30:00.000Z'); // 02:30 local, before the jump
    expect(dayInZone(inside, GAME_TIMEZONE)).toBe('2026-03-29');
    const boundary = nextDayBoundary(inside, GAME_TIMEZONE);
    expect(dayInZone(boundary, GAME_TIMEZONE)).toBe('2026-03-30');
    // Adding a flat 24 hours would land on the 30th at 01:30 local, an hour past the boundary:
    // the arithmetic this function exists to avoid.
    expect(boundary.getTime()).toBeLessThan(inside.getTime() + 24 * 3_600_000);
    expect(formatClock(boundary, GAME_TIMEZONE)).toBe('00:00');
  });

  it('survives the autumn fall-back night, where a day is 25 hours long', () => {
    const inside = new Date('2026-10-25T12:00:00.000Z');
    const boundary = nextDayBoundary(inside, GAME_TIMEZONE);
    expect(formatClock(boundary, GAME_TIMEZONE)).toBe('00:00');
    expect(dayInZone(boundary, GAME_TIMEZONE)).toBe('2026-10-26');
  });
});

describe('the week boundary', () => {
  /**
   * Sunday midnight, the instant before Monday begins, which is Monday 00:00 in Athens.
   *
   * The Combine's garrisons grow back on this mark (`city/regrowth.ts`), so what it answers is
   * the difference between a regime that is rebuilt once a week and one that is rebuilt on every
   * tick after the mark has passed.
   */
  it('answers the most recent Monday midnight in Athens', () => {
    // Thursday 24 September 2026, midday UTC. Athens is GMT+3, so the Monday before it began at
    // 21:00 UTC on the Sunday.
    const at = lastWeekBoundary(new Date('2026-09-24T12:00:00.000Z'));
    expect(at.toISOString()).toBe('2026-09-20T21:00:00.000Z');
    expect(formatClock(at, GAME_TIMEZONE)).toBe('00:00');
    expect(dayInZone(at, GAME_TIMEZONE)).toBe('2026-09-21');
  });

  it('is still last week a minute before the mark', () => {
    // 23:59 on the Sunday in Athens: the week has not turned over yet.
    const at = lastWeekBoundary(new Date('2026-09-20T20:59:00.000Z'));
    expect(at.toISOString()).toBe('2026-09-13T21:00:00.000Z');
  });

  it('answers the mark itself when it is exactly the mark', () => {
    const mark = new Date('2026-09-20T21:00:00.000Z');
    expect(lastWeekBoundary(mark).toISOString()).toBe(mark.toISOString());
    // ...and a minute later is the same answer, which is what makes a tick idempotent.
    expect(lastWeekBoundary(new Date('2026-09-20T21:01:00.000Z')).toISOString()).toBe(
      mark.toISOString(),
    );
  });

  it('moves with summer time rather than with a fixed offset', () => {
    // Greece puts its clocks back on Sunday 25 October 2026, so the Monday that follows starts an
    // hour later in UTC than the Monday before it did.
    expect(lastWeekBoundary(new Date('2026-10-28T12:00:00.000Z')).toISOString()).toBe(
      '2026-10-25T22:00:00.000Z',
    );
    expect(lastWeekBoundary(new Date('2026-10-21T12:00:00.000Z')).toISOString()).toBe(
      '2026-10-18T21:00:00.000Z',
    );
  });

  it('reads the week in the zone it is asked about', () => {
    // 01:00 UTC on a Monday is still Sunday evening in New York, so that week has not turned.
    const at = new Date('2026-09-21T01:00:00.000Z');
    expect(dayInZone(at, GAME_TIMEZONE)).toBe('2026-09-21');
    expect(lastWeekBoundary(at, GAME_TIMEZONE).toISOString()).toBe('2026-09-20T21:00:00.000Z');
    expect(lastWeekBoundary(at, 'America/New_York').toISOString()).toBe('2026-09-14T04:00:00.000Z');
  });
});

describe('reading the same instant in somebody else’s clock', () => {
  it('renders a UTC session hour as a local wall clock', () => {
    expect(utcHourInZone('2026-07-15', 6, GAME_TIMEZONE)).toBe('09:00');
    expect(utcHourInZone('2026-07-15', 6, 'UTC')).toBe('06:00');
    expect(utcHourInZone('2026-07-15', 6, 'America/New_York')).toBe('02:00');
  });

  it('renders a game hour as a local wall clock, and as itself at home', () => {
    expect(gameHourInZone('2026-07-15', 18)).toBe('18:00');
    // Athens is GMT+3 in July, so 18:00 Athens is 15:00 UTC and 11:00 in New York.
    expect(gameHourInZone('2026-07-15', 18, 'UTC')).toBe('15:00');
    expect(gameHourInZone('2026-07-15', 18, 'America/New_York')).toBe('11:00');
    // And GMT+2 in January, so the same game hour is one hour earlier in UTC.
    expect(gameHourInZone('2026-01-15', 18, 'UTC')).toBe('16:00');
  });

  it('falls back to the house clock rather than throwing on a zone it does not know', () => {
    // A settings row written against a tz database the runtime has since changed must show the
    // wrong city, not take the screen down.
    expect(formatClock(new Date('2026-07-15T12:00:00.000Z'), 'Mars/Olympus')).toBe('15:00');
  });

  it('names the place, not the path', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneCity(GAME_TIMEZONE)).toBe('Athens');
  });
});

describe('reading a game hour back as an instant', () => {
  it('lands on the hour it was asked for, on both sides of summer time', () => {
    for (const day of ['2026-01-15', '2026-07-15', '2026-03-29', '2026-10-25']) {
      for (let hour = 0; hour < 24; hour++) {
        const at = instantAtHourInZone(day, hour);
        // The one exception is the hour a spring-forward deletes: 03:00 on 2026-03-29 in Athens
        // does not exist, and the honest answer is the instant the clock jumped to.
        if (day === '2026-03-29' && hour === 3) {
          expect(hourInZone(at)).toBe(4);
          continue;
        }
        expect(dayInZone(at), `${day} ${hour}`).toBe(day);
        expect(hourInZone(at), `${day} ${hour}`).toBe(hour);
      }
    }
  });

  it('reads hour 24 as the start of the next day', () => {
    const at = instantAtHourInZone('2026-07-15', 24);
    expect(dayInZone(at)).toBe('2026-07-16');
    expect(hourInZone(at)).toBe(0);
  });

  it('agrees with nextDayBoundary about where a day ends', () => {
    const midnight = instantAtHourInZone('2026-07-15', 24);
    expect(midnight.toISOString()).toBe(
      nextDayBoundary(new Date('2026-07-15T12:00:00.000Z')).toISOString(),
    );
  });

  it('carries the right offset across an autumn fall-back', () => {
    // Athens moves from GMT+3 to GMT+2 at 04:00 local on 2026-10-25. An hour either side has to
    // resolve to a different UTC instant spacing than a plain 24-hour day would give.
    expect(instantAtHourInZone('2026-10-25', 2).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(instantAtHourInZone('2026-10-25', 12).toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });
});

describe('the timezone schema', () => {
  it('accepts every offered zone', () => {
    for (const zone of OFFERED_TIMEZONES) {
      expect(TimezoneSchema.safeParse(zone).success).toBe(true);
    }
  });

  it('accepts an IANA name that is not on the list', () => {
    // The list is a convenience for the picker. Validation is the runtime's own tz database.
    expect(TimezoneSchema.safeParse('Africa/Nairobi').success).toBe(true);
  });

  it('rejects an offset, which is the classic wrong answer', () => {
    expect(isValidTimezone('UTC+03:00')).toBe(false);
    expect(TimezoneSchema.safeParse('UTC+03:00').success).toBe(false);
    expect(TimezoneSchema.safeParse('not a zone').success).toBe(false);
  });
});
