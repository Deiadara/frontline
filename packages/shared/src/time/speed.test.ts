import { describe, expect, it } from 'vitest';
import {
  MAX_SPEED,
  MAX_TRAVEL_SPEED_BONUS,
  effectiveSpeed,
  roadMinutes,
  timeSavingPercent,
} from './speed.js';

/**
 * The one arithmetic every road in the game is measured with.
 *
 * Written against the board's own worked example rather than against the implementation: *"a 30
 * speed unit makes it 30% faster to go there, and a 100 speed unit makes it 100% faster, e.g. 20
 * mins down to 10 mins"*, and then *"other bonuses like 10% less travel time stack on top, so 20 to
 * 10 mins and then another 10 percent of that"*. Every number below is one of those sentences.
 */
describe('roadMinutes', () => {
  it('leaves a walk with nobody quick and no holdings at the base', () => {
    expect(roadMinutes(20)).toBe(20);
    expect(roadMinutes(20, 0, 0)).toBe(20);
    expect(roadMinutes(75)).toBe(75);
  });

  it('halves the road at 100 and takes about a quarter off at 30', () => {
    expect(roadMinutes(20, 100)).toBe(10);
    // 20 / 1.3 = 15.38, which the board wrote as "about 15.4".
    expect(roadMinutes(20, 30)).toBe(15);
    expect(roadMinutes(200, 30)).toBe(154);
  });

  it('stacks the ground on top of the speed rather than adding it in', () => {
    // 20 to 10 on speed alone, and another tenth off that.
    expect(roadMinutes(20, 100, 10)).toBe(9);
    // The order matters: summed into the speed, 110 would give 20/2.1 = 9.5 and round to 10.
    expect(roadMinutes(200, 100, 10)).toBe(90);
    expect(roadMinutes(200, 0, 10)).toBe(180);
  });

  it('caps the speed at 100 and the reduction at its own ceiling', () => {
    expect(roadMinutes(200, 500)).toBe(roadMinutes(200, MAX_SPEED));
    expect(roadMinutes(200, 0, 500)).toBe(roadMinutes(200, 0, MAX_TRAVEL_SPEED_BONUS));
    // Both ceilings together still leave a road on the clock, which is the point of having them.
    expect(roadMinutes(200, 500, 500)).toBe(40);
  });

  it('never lets a road round away to nothing, and never lengthens one', () => {
    expect(roadMinutes(1, 100, 60)).toBe(1);
    expect(roadMinutes(0, 0, 0)).toBe(1);
    expect(roadMinutes(60, -50, -50)).toBe(60);
  });
});

describe('effectiveSpeed', () => {
  it('is the sheet when nothing is raising it', () => {
    expect(effectiveSpeed(45)).toBe(45);
    expect(effectiveSpeed(45, {})).toBe(45);
  });

  it('adds flat points and scales percentage channels', () => {
    expect(effectiveSpeed(45, { flat: 3 })).toBe(48);
    expect(effectiveSpeed(50, { percent: 20 })).toBe(60);
    expect(effectiveSpeed(50, { percent: 20, flat: 3 })).toBe(63);
  });

  /** The board's rule: *"flat +3 speed to units does not exceed 100. Same for vehicles."* */
  it('does not let a flat bonus push anything past 100', () => {
    expect(effectiveSpeed(98, { flat: 3 })).toBe(MAX_SPEED);
    expect(effectiveSpeed(95, { flat: 3 })).toBe(98);
    expect(effectiveSpeed(95, { percent: 50 })).toBe(MAX_SPEED);
    expect(effectiveSpeed(100, { percent: 200, flat: 40 })).toBe(MAX_SPEED);
  });

  it('does not let anything push a speed below nothing', () => {
    expect(effectiveSpeed(10, { flat: -40 })).toBe(0);
  });
});

describe('timeSavingPercent', () => {
  it('reports what a divisor channel is really worth, not its raw number', () => {
    // The University's "-12% research time" is 1 - 1/1.12.
    expect(timeSavingPercent(12)).toBe(11);
    expect(timeSavingPercent(100)).toBe(50);
    expect(timeSavingPercent(200, 100)).toBe(50);
    expect(timeSavingPercent(-5)).toBe(0);
  });
});
