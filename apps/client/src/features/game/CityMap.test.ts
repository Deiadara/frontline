import { CITY_DISTRICTS, type BaseSummary } from '@frontline/shared';
import { Graphics, Sprite, Texture } from 'pixi.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { districtFace, groupByDistrict, markerY } from './CityMap';

const deliveredTexture = vi.hoisted(() => vi.fn<() => Texture | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredTexture }));

beforeEach(() => deliveredTexture.mockClear().mockReturnValue(null));

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

describe('districtFace', () => {
  const [district] = CITY_DISTRICTS;
  if (!district) throw new Error('expected at least one city district');

  it('draws the flat vector node while the district art is undelivered', () => {
    const face = districtFace(district, 10, 0x22d3ee, false);

    expect(face).toBeInstanceOf(Graphics);
    expect(deliveredTexture).toHaveBeenCalledWith({ type: 'district', districtId: district.id });
  });

  it('masks the delivered illustration into the node and keeps the kind-coloured ring', () => {
    deliveredTexture.mockReturnValue(Texture.EMPTY);

    const face = districtFace(district, 10, 0x22d3ee, false);

    const art = face.children.find((child): child is Sprite => child instanceof Sprite);
    expect(art, 'the delivered art replaces the flat fill').toBeDefined();
    expect(art?.mask, 'art outside the node circle would spill over the map').not.toBeNull();
    expect(face.children.at(-1), 'the ring stays on top of the art').toBeInstanceOf(Graphics);
  });
});
