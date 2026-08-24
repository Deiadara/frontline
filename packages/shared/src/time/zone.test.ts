import { describe, expect, it } from 'vitest';
import {
  GAME_TIMEZONE,
  OFFERED_TIMEZONES,
  TimezoneSchema,
  dayInZone,
  formatClock,
  hourInZone,
  isValidTimezone,
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

  it('survives the spring-forward night, where a day is 23 hours long', () => {
    // Greece moves its clocks at 03:00 local on the last Sunday in March 2026 (the 29th).
    const inside = new Date('2026-03-29T00:30:00.000Z'); // 02:30 local, before the jump
    expect(dayInZone(inside, GAME_TIMEZONE)).toBe('2026-03-29');
    const boundary = nextDayBoundary(inside, GAME_TIMEZONE);
    expect(dayInZone(boundary, GAME_TIMEZONE)).toBe('2026-03-30');
    // Adding a flat 24 hours would land on the 30th at 01:30 local, an hour past the boundary —
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

describe('reading the same instant in somebody else’s clock', () => {
  it('renders a UTC session hour as a local wall clock', () => {
    expect(utcHourInZone('2026-07-15', 6, GAME_TIMEZONE)).toBe('09:00');
    expect(utcHourInZone('2026-07-15', 6, 'UTC')).toBe('06:00');
    expect(utcHourInZone('2026-07-15', 6, 'America/New_York')).toBe('02:00');
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
