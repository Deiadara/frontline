import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import {
  SCOUT_MINUTES_MAX,
  SCOUT_MINUTES_MIN,
  SCOUT_PEAK_TOTAL,
  scoutMinutesFor,
  scoutRating,
  scoutRecallWindowMs,
  scoutRecallable,
  scoutRecalledReturnsAt,
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

/**
 * Turning a scout round (maintainer request, 2026-09-12; `time/cancel.ts`).
 *
 * The rule is the same one a mission recall keeps: the first tenth **of the way out**, and the
 * walk home is the distance already covered. The way out is `travelMinutes`, which is not half the
 * round trip: the round trip is the walk twice plus the hours spent looking, and the looking is
 * anything from forty minutes to four hours. Deriving the leg from the mark left the window open
 * long after the scout had arrived, which is a recall of somebody who is already standing there.
 */
describe('turning a scout round', () => {
  const DEPART = Date.parse('2026-09-13T12:00:00.000Z');
  /** Nothing on the sheet, so the looking is the full four hours: the worst case for the split. */
  const slow = makeAttributes(0);
  const TRAVEL = 5;

  const run = {
    departedAt: new Date(DEPART).toISOString(),
    travelMinutes: TRAVEL,
    returnsAt: new Date(DEPART + scoutRunMinutes(TRAVEL, slow) * 60_000).toISOString(),
    recalledAt: null,
  };

  it('shuts the window a tenth of the way out, not a tenth of the whole run', () => {
    // Half a minute: a tenth of the five minute walk, and nothing to do with the four hours of
    // looking that follow it.
    expect(scoutRecallWindowMs(run, new Date(DEPART))).toBe(0.1 * TRAVEL * 60_000);
    expect(scoutRecallable(run, new Date(DEPART + 29_000))).toBe(true);
    expect(scoutRecallable(run, new Date(DEPART + 31_000))).toBe(false);
  });

  it('never leaves the window open once the scout has arrived', () => {
    expect(scoutRecallable(run, new Date(DEPART + TRAVEL * 60_000))).toBe(false);
  });

  /**
   * The looking is the half the officer changes, so a poor scout has a much longer run and must
   * not get a longer window for it: what they can undo is the walk they have started.
   */
  it('gives the same window whoever is doing the looking', () => {
    const quick = makeAttributes(100);
    const quickRun = {
      ...run,
      returnsAt: new Date(DEPART + scoutRunMinutes(TRAVEL, quick) * 60_000).toISOString(),
    };
    expect(scoutRecallWindowMs(quickRun, new Date(DEPART))).toBe(
      scoutRecallWindowMs(run, new Date(DEPART)),
    );
  });

  /**
   * The walk home is the distance covered, so the window has to keep the recall inside the way
   * out: a scout turned round at the last legal moment cannot take longer to get home than the
   * whole walk out was going to take.
   *
   * The instant is taken from the window helper rather than written down, because the claim is
   * about the two agreeing: an open window that lands somebody home after they would have arrived
   * is the bug, whatever the window is set to.
   */
  it('brings them home no later than the walk out would have finished', () => {
    const last = new Date(DEPART + scoutRecallWindowMs(run, new Date(DEPART)) - 1);
    expect(scoutRecalledReturnsAt(run, last).getTime()).toBeLessThan(DEPART + TRAVEL * 60_000);
  });
});
