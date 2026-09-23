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
 * Turning a scout round (`time/cancel.ts`).
 *
 * The rule is the one every clock in the game keeps since 2026-09-22: **the first tenth of the
 * whole job**, `departedAt` to `returnsAt`, which for a scout is the walk out, the looking and
 * the walk home. It was a tenth of the way out until then, and the maintainer's call is that a
 * player is deciding about the evening they committed rather than about the first leg of it.
 *
 * That rule has a consequence this file has to hold: the looking is anything from forty minutes
 * to four hours, so a tenth of the whole run is often **longer than the walk out**, and a scout
 * can be turned round while already standing on the ground. The walk home is therefore the
 * distance covered *capped at the way out* (`turnaroundMs`), or somebody recalled at the far end
 * would be sent home for longer than the entire journey took.
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

  /** The whole run, from leaving to being back, which is what the tenth is a tenth of. */
  const totalMs = () => Date.parse(run.returnsAt) - DEPART;

  it('shuts the window a tenth of the whole run, not a tenth of the way out', () => {
    expect(scoutRecallWindowMs(run, new Date(DEPART))).toBe(0.1 * totalMs());
    // Written out as well, so the assertion above is not simply agreeing with the code: five
    // minutes out, four hours looking and five back is 250 minutes, a tenth of which is 25.
    expect(totalMs()).toBe(250 * 60_000);
    expect(scoutRecallWindowMs(run, new Date(DEPART))).toBe(25 * 60_000);

    const shut = DEPART + 0.1 * totalMs();
    expect(scoutRecallable(run, new Date(shut - 1_000))).toBe(true);
    expect(scoutRecallable(run, new Date(shut + 1_000))).toBe(false);
  });

  /**
   * The window outlasts the walk out, and that is the rule rather than a bug.
   *
   * A tenth of 250 minutes is 25, and the walk out is 5, so a scout can be turned round twenty
   * minutes after arriving. This used to be forbidden and is now the point: the player is
   * deciding about the whole evening.
   */
  it('stays open after the scout has arrived, because the tenth is of the whole run', () => {
    expect(scoutRecallable(run, new Date(DEPART + TRAVEL * 60_000 + 60_000))).toBe(true);
  });

  /**
   * The looking is the half the officer changes, so a quick scout has a shorter run, and under
   * the new rule a correspondingly shorter window. That is the rule doing what it says: the
   * window is a tenth of what was committed, and a quick scout commits less.
   */
  it('gives a shorter window for a shorter run', () => {
    const quick = makeAttributes(100);
    const quickRun = {
      ...run,
      returnsAt: new Date(DEPART + scoutRunMinutes(TRAVEL, quick) * 60_000).toISOString(),
    };
    expect(scoutRunMinutes(TRAVEL, quick)).toBeLessThan(scoutRunMinutes(TRAVEL, slow));
    expect(scoutRecallWindowMs(quickRun, new Date(DEPART))).toBeLessThan(
      scoutRecallWindowMs(run, new Date(DEPART)),
    );
  });

  /**
   * The walk home is the distance covered, capped at the way out.
   *
   * The cap is what the wider window made necessary: recalled at the last legal moment, twenty
   * minutes past arrival, "as far back as you have come" would be 25 minutes of walking for a
   * journey whose entire outbound leg is 5.
   */
  it('never sends them home for longer than the walk out took', () => {
    const last = new Date(DEPART + scoutRecallWindowMs(run, new Date(DEPART)) - 1);
    expect(scoutRecalledReturnsAt(run, last).getTime() - last.getTime()).toBe(TRAVEL * 60_000);
    // ...and a scout turned round early still only walks back as far as they have gone.
    const early = new Date(DEPART + 60_000);
    expect(scoutRecalledReturnsAt(run, early).getTime() - early.getTime()).toBe(60_000);
  });
});
