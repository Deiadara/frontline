import { describe, expect, it } from 'vitest';
import { ROLE_IMPORTANCE, SEATS, type Seat } from './importance.js';
import { OFFICER_MARKS, OFFICER_MARK_BAND, OFFICER_MARK_FLOOR, markIndex } from './marks.js';
import { overseerLift } from './passives.js';
import { OFFICER_ROLES } from '../roles.js';
import type { AttributeName } from '../attributes.js';

/**
 * The tag table behind every grade and the Overseer's lift (maintainer, 2026-10-04): one
 * irreplaceable, two essential and four useful in every one of the fourteen seats, and the
 * Overseer's grade dealt over each chair's own irreplaceable and essentials in a fixed rotation.
 */

const tagged = (seat: Seat, tag: string): AttributeName[] =>
  (Object.entries(ROLE_IMPORTANCE[seat]) as [AttributeName, string][])
    .filter(([, value]) => value === tag)
    .map(([name]) => name);

describe('the tags on every seat', () => {
  it('has fourteen seats: the thirteen chairs and the Overseer', () => {
    expect(OFFICER_ROLES).toHaveLength(13);
    expect(SEATS).toHaveLength(14);
    expect(SEATS).toContain('overseer');
  });

  it('tags exactly one irreplaceable, two essential and four useful skills in each', () => {
    for (const seat of SEATS) {
      expect(tagged(seat, 'irreplaceable'), seat).toHaveLength(1);
      expect(tagged(seat, 'essential'), seat).toHaveLength(2);
      expect(tagged(seat, 'useful'), seat).toHaveLength(4);
      expect(Object.keys(ROLE_IMPORTANCE[seat]), seat).toHaveLength(7);
    }
  });
});

describe("the Overseer's rotation, on every chair", () => {
  /** Steps dealt to irreplaceable, first essential, second essential: F- is one, S+ twenty one. */
  const ROTATION: readonly (readonly [number, number, number])[] = [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [2, 1, 1],
    [2, 2, 1],
    [2, 2, 2],
    [3, 2, 2],
    [3, 3, 2],
    [3, 3, 3],
    [4, 3, 3],
    [4, 4, 3],
    [4, 4, 4],
    [5, 4, 4],
    [5, 5, 4],
    [5, 5, 5],
    [6, 5, 5],
    [6, 6, 5],
    [6, 6, 6],
    [7, 6, 6],
    [7, 7, 6],
    [7, 7, 7],
  ];
  const middleOf = (index: number): number =>
    OFFICER_MARK_FLOOR + (index + 0.5) * OFFICER_MARK_BAND;

  it('deals the exact table at every grade, for every chair and both essential orders', () => {
    expect(ROTATION).toHaveLength(OFFICER_MARKS.length);
    for (const role of OFFICER_ROLES) {
      const [irreplaceable] = tagged(role, 'irreplaceable');
      const essentials = tagged(role, 'essential');
      const firsts = new Set<AttributeName>();
      for (const id of ['officer-a', 'officer-b', 'officer-c', 'officer-d']) {
        const first = Object.keys(overseerLift(middleOf(1), role, id)).find(
          (name) => name !== irreplaceable,
        ) as AttributeName;
        expect(essentials, `${role} ${id}`).toContain(first);
        firsts.add(first);
        const second = essentials.find((name) => name !== first)!;
        for (const mark of OFFICER_MARKS) {
          const index = markIndex(mark);
          const lift = overseerLift(middleOf(index), role, id);
          const [i, e1, e2] = ROTATION[index]!;
          const expected: Partial<Record<AttributeName, number>> = { [irreplaceable!]: i };
          if (e1 > 0) expected[first] = e1;
          if (e2 > 0) expected[second] = e2;
          expect(lift, `${role} ${id} ${mark}`).toEqual(expected);
        }
      }
      // The four ids cover both orders, so both halves of the rotation are pinned.
      expect(firsts, role).toEqual(new Set(essentials));
    }
  });

  it('reads the grade of points under the floor as F- and of a perfect sheet as S+', () => {
    expect(overseerLift(0, 'researcher', 'officer-a')).toEqual({ analysis: 1 });
    expect(overseerLift(100, 'researcher', 'officer-a')).toEqual({
      analysis: 7,
      intuition: 7,
      encyclopedia: 7,
    });
  });
});
