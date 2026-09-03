/**
 * The mark scale, checked against the measurement it was built from rather than against itself.
 *
 * Most of these could be written by calling `markFromPoints` and asserting it agrees with
 * `markFromPoints`, which would pass whatever the bands were. The numbers below are independent:
 * they come from the measured distribution of role fit over 142,500 generated officer-and-role pairs
 * (floor 10.23, recruitment median 20.77, best recruitable 35.85) and from the brief.
 */
import { describe, expect, it } from 'vitest';
import {
  OFFICER_MARKS,
  OFFICER_MARK_CEILING,
  OFFICER_MARK_FLOOR,
  markAtLeast,
  markFromPoints,
  markIndex,
} from './marks.js';

describe('the mark ladder', () => {
  it('runs F- to S+ in twenty one bands', () => {
    expect(OFFICER_MARKS).toHaveLength(21);
    expect(OFFICER_MARKS[0]).toBe('F-');
    expect(OFFICER_MARKS[OFFICER_MARKS.length - 1]).toBe('S+');
    expect(new Set(OFFICER_MARKS).size, 'a mark appears twice').toBe(OFFICER_MARKS.length);
  });

  it('puts every band in ascending order with no gaps', () => {
    // Walking the whole range a point at a time: the mark may never go backwards, and every band
    // must be reachable. A band no score maps to is a rung of the ladder nobody can stand on.
    const seen = new Set<string>();
    let last = -1;
    for (let points = OFFICER_MARK_FLOOR; points <= OFFICER_MARK_CEILING; points += 0.1) {
      const index = markIndex(markFromPoints(points));
      expect(index, `went backwards at ${points}`).toBeGreaterThanOrEqual(last);
      last = index;
      seen.add(markFromPoints(points));
    }
    expect(seen.size, 'a band is unreachable').toBe(OFFICER_MARKS.length);
  });

  it('anchors the bottom on the worst real officer rather than on an empty sheet', () => {
    // The measured worst was 10.23, a Scout. It has to be F-, and so does anything below it.
    expect(markFromPoints(10.23)).toBe('F-');
    expect(markFromPoints(OFFICER_MARK_FLOOR)).toBe('F-');
    expect(markFromPoints(0), 'a score under the floor still reads as the bottom').toBe('F-');
  });

  it('leaves a fresh recruit most of the ladder to climb', () => {
    // The recruitment median was 20.77 and the best recruitable score was 35.85. A scale that put
    // either of those near the top would have nothing left to say about a trained officer.
    expect(
      markIndex(markFromPoints(20.77)),
      'the median recruit is already halfway up',
    ).toBeLessThan(5);
    expect(
      markIndex(markFromPoints(35.85)),
      'the best recruit is already near the top',
    ).toBeLessThan(OFFICER_MARKS.length / 2);
  });

  it('reserves the top band for a small margin under the ceiling', () => {
    expect(markFromPoints(OFFICER_MARK_CEILING)).toBe('S+');
    // 95.7 is where the last band starts, so just under it must not be S+ yet.
    expect(markFromPoints(95)).not.toBe('S+');
    expect(markFromPoints(96)).toBe('S+');
  });

  it('compares two marks by where they sit, not alphabetically', () => {
    // 'S' sorts after 'F' by luck and 'A' sorts before 'B' against it: a string comparison gets
    // this exactly backwards for half the ladder.
    expect(markAtLeast('A', 'B')).toBe(true);
    expect(markAtLeast('B', 'A')).toBe(false);
    expect(markAtLeast('S+', 'F-')).toBe(true);
    expect(markAtLeast('C', 'C')).toBe(true);
  });
});
