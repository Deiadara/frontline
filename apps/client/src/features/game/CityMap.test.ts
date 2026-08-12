import type { BaseSummary } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { groupByDistrict, markerY } from './CityMap';

/** The vertical pitch CityMap stacks co-located markers by. */
const STEP = 28;
/** The clamp CityMap keeps markers below. */
const MIN_Y = 26;

const base = (id: string, districtId: string): BaseSummary => ({
  id,
  ownerId: `owner-${id}`,
  name: id,
  districtId,
  level: 1,
  isBot: false,
});

describe('markerY', () => {
  it('leaves a district with a single base exactly where it was', () => {
    // nodeY - radius - MARKER_LIFT, with no stack offset at all.
    expect(markerY(400, 10, { index: 0, count: 1 })).toBe(400 - 10 - 17);
  });

  it('still clamps a lone marker off the top edge', () => {
    expect(markerY(4, 10, { index: 0, count: 1 })).toBe(MIN_Y);
  });

  it('stacks co-located markers a full pitch apart, bottom-up', () => {
    const ys = [0, 1, 2].map((index) => markerY(400, 10, { index, count: 3 }));
    expect(ys).toEqual([373, 373 - STEP, 373 - STEP * 2]);
    expect(new Set(ys).size).toBe(3);
  });

  it('pushes a stack that would overflow the top edge down as a whole', () => {
    const ys = [0, 1].map((index) => markerY(40, 10, { index, count: 2 }));
    // The topmost marker lands on the clamp and the pitch below it is preserved.
    expect(Math.min(...ys)).toBe(MIN_Y);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(STEP);
  });
});

describe('groupByDistrict', () => {
  it('groups co-located bases and orders them by id, whatever order they arrive in', () => {
    const bases = [base('c', 'neon-docks'), base('a', 'neon-docks'), base('b', 'ashen-terraces')];

    const groups = groupByDistrict(bases);

    expect([...groups.keys()].sort()).toEqual(['ashen-terraces', 'neon-docks']);
    expect(groups.get('neon-docks')?.map((b) => b.id)).toEqual(['a', 'c']);
    expect(groups.get('ashen-terraces')?.map((b) => b.id)).toEqual(['b']);
    // Stable: the same input in a different order yields the same stack order.
    expect(
      groupByDistrict([...bases].reverse())
        .get('neon-docks')
        ?.map((b) => b.id),
    ).toEqual(['a', 'c']);
  });
});
