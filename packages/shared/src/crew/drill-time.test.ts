import { describe, expect, it } from 'vitest';
import { makeAttributes, type Attributes } from '../attributes.js';
import {
  DRILL_TIME_CUT_CEILING,
  TRAINING_SECONDS,
  drillSeconds,
  drillTimeCutPercent,
  drillTimePoints,
} from './training.js';

/**
 * An officer's own pace on the training floor (maintainer, 2026-10-01).
 *
 * Speed, Resolve and Organization take time off the hour, Speed counting double, along
 * `50 x (1 - e^(-points / 174))`: from nothing toward half the hour, never reaching it.
 */

const sheet = (speed: number, resolve: number, organization: number): Attributes =>
  makeAttributes(0, { speed, resolve, organization });

const even = (value: number): Attributes => sheet(value, value, value);

describe('how long an officer takes over an hour', () => {
  it('is the full hour for a sheet with none of the three', () => {
    expect(drillTimeCutPercent(even(0))).toBe(0);
    expect(drillSeconds(even(0))).toBe(TRAINING_SECONDS);
  });

  it('reads Speed, Resolve and Organization and nothing else', () => {
    // Every other attribute at 100 changes nothing.
    expect(drillSeconds(makeAttributes(100, { speed: 0, resolve: 0, organization: 0 }))).toBe(
      TRAINING_SECONDS,
    );
    // Positive control: each of the three on its own shortens the hour.
    for (const one of [sheet(40, 0, 0), sheet(0, 40, 0), sheet(0, 0, 40)]) {
      expect(drillSeconds(one)).toBeLessThan(TRAINING_SECONDS);
    }
  });

  it('lands on the anchors the maintainer was given', () => {
    const percent = (value: number): number => Math.round(drillTimeCutPercent(even(value)));
    expect(percent(100)).toBe(45);
    expect(percent(50)).toBe(34);
    expect(percent(15)).toBe(15);
    expect(drillSeconds(even(100))).toBe(1981);
    expect(drillSeconds(even(50))).toBe(2370);
    expect(drillSeconds(even(15))).toBe(3075);
  });

  it('counts a point of Speed as two of Resolve or Organization', () => {
    expect(drillTimePoints(sheet(10, 0, 0))).toBe(20);
    expect(drillTimePoints(sheet(0, 10, 0))).toBe(10);
    expect(drillTimePoints(sheet(0, 0, 10))).toBe(10);
    expect(drillSeconds(sheet(30, 0, 0))).toBe(drillSeconds(sheet(0, 60, 0)));
    expect(drillSeconds(sheet(30, 0, 0))).toBe(drillSeconds(sheet(0, 30, 30)));
    // So on an even sheet Speed's share of the cut is half and the other two a quarter each:
    // the maintainer's 20% that is 10 from Speed and 5 from each of the others.
    const points = drillTimePoints(even(40));
    expect((2 * 40) / points).toBe(0.5);
    expect(40 / points).toBe(0.25);
  });

  it('keeps shortening with every point and never reaches half the hour', () => {
    let previous = drillSeconds(even(0));
    for (let value = 5; value <= 100; value += 5) {
      const next = drillSeconds(even(value));
      expect(next, String(value)).toBeLessThan(previous);
      previous = next;
    }
    expect(drillTimeCutPercent(even(100))).toBeLessThan(DRILL_TIME_CUT_CEILING);
    expect(drillSeconds(even(100))).toBeGreaterThan(TRAINING_SECONDS / 2);
  });
});
