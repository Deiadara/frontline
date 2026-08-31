import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import {
  SCOUT_MINUTES_MAX,
  SCOUT_MINUTES_MIN,
  SCOUT_PEAK_TOTAL,
  scoutMinutesFor,
  scoutRating,
  scoutRunMinutes,
} from './scouting.js';

/**
 * §A4: what a scouting run costs, in time.
 *
 * The board's rework in one sentence: scouting is a journey somebody makes, its length is the walk
 * plus the looking, and the looking is the half the officer changes. These pin the shape of that,
 * because "a better scout is faster" is the whole reason the Scout's chair exists and it is the
 * kind of claim that quietly stops being true after a retune.
 */

describe('how long somebody spends on the ground', () => {
  it('takes the longest from somebody with nothing to recommend them', () => {
    expect(scoutMinutesFor(makeAttributes(0))).toBe(SCOUT_MINUTES_MAX);
  });

  it('takes the least from somebody at the top of the scale', () => {
    expect(scoutMinutesFor(makeAttributes(100))).toBe(SCOUT_MINUTES_MIN);
  });

  /** The property the chair is bought for: more sheet, less time, with no exceptions. */
  it('never gets slower as the sheet gets better', () => {
    let previous = Infinity;
    for (let rating = 0; rating <= 100; rating += 5) {
      const minutes = scoutMinutesFor(makeAttributes(rating));
      expect(minutes).toBeLessThanOrEqual(previous);
      previous = minutes;
    }
  });

  it('never goes below the floor, however good they are', () => {
    expect(scoutMinutesFor(makeAttributes(100))).toBeGreaterThanOrEqual(SCOUT_MINUTES_MIN);
  });

  /**
   * A fresh recruit is nearer the ceiling than the floor.
   *
   * The Bar rolls around 15 an attribute, so a new officer is a slow scout and staying slow is the
   * thing a crew pays to fix. If a retune ever put a fresh hire near the floor, the whole mechanic
   * would be decoration on the first evening.
   */
  it('leaves a fresh recruit slow', () => {
    const fresh = scoutMinutesFor(makeAttributes(15));
    const midpoint = (SCOUT_MINUTES_MIN + SCOUT_MINUTES_MAX) / 2;
    expect(fresh).toBeGreaterThan(midpoint);
  });

  it('is priced against the whole sheet rather than one attribute', () => {
    const specialist = makeAttributes(0, { stealth: 100, navigation: 100 });
    const rounded = makeAttributes(20);
    // The all-rounder totals more, so they are the faster scout even with no standout skill.
    expect(scoutRating(rounded)).toBeGreaterThan(scoutRating(specialist));
    expect(scoutMinutesFor(rounded)).toBeLessThan(scoutMinutesFor(specialist));
  });

  it('treats the peak total as the point where the floor is reached', () => {
    const atPeak = SCOUT_PEAK_TOTAL / Object.keys(makeAttributes(0)).length;
    expect(scoutMinutesFor(makeAttributes(Math.ceil(atPeak)))).toBe(SCOUT_MINUTES_MIN);
  });
});

describe('the whole run', () => {
  /** The walk counts twice, which is what makes the far side of the city a real decision. */
  it('pays for the journey out and the journey home', () => {
    const sheet = makeAttributes(20);
    const near = scoutRunMinutes(10, sheet);
    const far = scoutRunMinutes(60, sheet);
    expect(far - near).toBe(100);
  });

  it('is the walk plus the looking, and nothing else', () => {
    const sheet = makeAttributes(35);
    expect(scoutRunMinutes(25, sheet)).toBe(50 + scoutMinutesFor(sheet));
  });

  it('still costs the looking when the ground is next door', () => {
    expect(scoutRunMinutes(0, makeAttributes(100))).toBe(SCOUT_MINUTES_MIN);
  });
});
