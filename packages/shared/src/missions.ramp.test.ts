import { describe, expect, it } from 'vitest';
import {
  EARLY_RAMP_BANDS,
  EARLY_RAMP_RUNS,
  EARLY_RAMP_SECOND_LEVEL,
  EARLY_RAMP_THIRD_LEVEL,
  MISSION_CEILING_MINUTES,
  earlyMissionRamp,
  rampedTimings,
  rampedTotalMinutes,
} from './missions.ramp.js';
import { MISSION_TEMPLATES, templateTimings } from './missions.js';

/**
 * The opening hour's clock (maintainer, 2026-09-23).
 *
 * Three things have to hold or the ramp is worse than not having one: every band answers inside
 * the minutes it advertises, the order of the board survives the compression, and a crew that is
 * past the opening is out of the ramp whatever their history.
 */

const band = (step: 1 | 2 | 3) => {
  const found = EARLY_RAMP_BANDS.find((one) => one.step === step);
  if (!found) throw new Error(`no band ${step}`);
  return found;
};

describe('which band a crew is in', () => {
  it('puts the first runs in the first band, whatever level they were reached at', () => {
    for (let done = 0; done < EARLY_RAMP_RUNS; done += 1) {
      expect(earlyMissionRamp(1, done)?.step, `${done} done`).toBe(1);
      expect(earlyMissionRamp(EARLY_RAMP_THIRD_LEVEL, done)?.step).toBe(1);
    }
  });

  it('moves to the second band once the first runs are behind them, to level 3', () => {
    for (let level = 1; level <= EARLY_RAMP_SECOND_LEVEL; level += 1) {
      expect(earlyMissionRamp(level, EARLY_RAMP_RUNS)?.step, `level ${level}`).toBe(2);
    }
  });

  it('moves to the third band from level 4 to level 6', () => {
    for (let level = EARLY_RAMP_SECOND_LEVEL + 1; level <= EARLY_RAMP_THIRD_LEVEL; level += 1) {
      expect(earlyMissionRamp(level, EARLY_RAMP_RUNS)?.step, `level ${level}`).toBe(3);
    }
  });

  it('is out of the ramp above the last band, even for a crew that never took a job', () => {
    expect(earlyMissionRamp(EARLY_RAMP_THIRD_LEVEL + 1, 0)).toBeNull();
    expect(earlyMissionRamp(20, 0)).toBeNull();
    expect(earlyMissionRamp(20, 500)).toBeNull();
  });

  it('pays double in the first band, half again in the second, and the clock in the third', () => {
    expect(band(1).payPercent).toBe(100);
    expect(band(2).payPercent).toBe(50);
    expect(band(3).payPercent).toBe(0);
  });
});

describe('the clock a band deals', () => {
  /** Every template's real door-to-door clock, which is what the ramp is fed in the game. */
  const totals = MISSION_TEMPLATES.map((template) => templateTimings(template).totalMinutes);

  it('is measured against a board that really does span the ceiling', () => {
    expect(Math.min(...totals)).toBeGreaterThan(0);
    expect(Math.max(...totals)).toBeLessThanOrEqual(MISSION_CEILING_MINUTES);
    // A spread worth compressing: the longest job is at least fifty times the shortest.
    expect(Math.max(...totals) / Math.min(...totals)).toBeGreaterThan(50);
  });

  for (const step of [1, 2, 3] as const) {
    it(`keeps band ${step} inside the minutes it advertises`, () => {
      const one = band(step);
      for (const total of totals) {
        const dealt = rampedTotalMinutes(total, one);
        expect(dealt, `${total} min in band ${step}`).toBeGreaterThanOrEqual(one.minMinutes);
        expect(dealt, `${total} min in band ${step}`).toBeLessThanOrEqual(one.maxMinutes);
      }
    });

    it(`never deals a longer job a shorter clock than a shorter one, in band ${step}`, () => {
      const one = band(step);
      const sorted = [...totals].sort((a, b) => a - b);
      let previous = 0;
      for (const total of sorted) {
        const dealt = rampedTotalMinutes(total, one);
        expect(dealt).toBeGreaterThanOrEqual(previous);
        previous = dealt;
      }
    });

    it(`spends more than one minute of band ${step} across the board`, () => {
      // The whole point of the log scale: a band that answered every job with its floor would be
      // one duration repeated, and the board would stop being worth reading.
      const one = band(step);
      const dealt = new Set(totals.map((total) => rampedTotalMinutes(total, one)));
      expect(dealt.size).toBeGreaterThan(1);
    });
  }

  it('leaves a minute of work in the shortest job the shortest band can deal', () => {
    for (const template of MISSION_TEMPLATES) {
      const dealt = rampedTimings(templateTimings(template), band(1));
      expect(dealt.durationMinutes, template.id).toBeGreaterThanOrEqual(1);
      expect(dealt.travelMinutes, template.id).toBeGreaterThanOrEqual(0);
      // The split has to add back up to the band's own total, or the card and the wait disagree.
      expect(dealt.totalMinutes).toBe(
        rampedTotalMinutes(templateTimings(template).totalMinutes, band(1)),
      );
    }
  });

  it('keeps some road on a long job in the widest band', () => {
    const furthest = MISSION_TEMPLATES.filter((one) => one.travelBand === 'furthest');
    expect(furthest.length, 'the catalogue has no furthest-band job to measure').toBeGreaterThan(0);
    for (const template of furthest) {
      expect(rampedTimings(templateTimings(template), band(3)).travelMinutes).toBeGreaterThan(0);
    }
  });
});
