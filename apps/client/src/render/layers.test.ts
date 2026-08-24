import { BACKDROP_STACK, findAssetSpec } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { PARALLAX_PLANES, PLANE_IDS, plane, planeOffset } from './layers';

describe('the ADR 0001 §5.2 plane stack', () => {
  it('is seven planes, back to front, indexed by position', () => {
    expect(PARALLAX_PLANES).toHaveLength(7);
    expect(PARALLAX_PLANES.map((p) => p.id)).toEqual([...PLANE_IDS]);
    PARALLAX_PLANES.forEach((p, index) => expect(p.index).toBe(index));
  });

  it('carries the ADR scroll factors verbatim', () => {
    expect(PARALLAX_PLANES.map((p) => p.scrollFactor)).toEqual([
      0.15,
      0.35,
      1,
      1,
      1.35,
      null,
      null,
    ]);
  });

  it('makes exactly one plane interactive', () => {
    expect(PARALLAX_PLANES.filter((p) => p.interactive).map((p) => p.id)).toEqual(['nodes']);
  });

  it('names only real manifest keys as plane art', () => {
    for (const p of PARALLAX_PLANES) {
      if (p.assetKey === null) continue;
      expect(findAssetSpec(p.assetKey), `${p.id} → ${p.assetKey}`).toBeDefined();
    }
  });

  /**
   * `BACKDROP_STACK` is what decides who the order sheet stops asking the board to draw (MOU-309),
   * but this module is what actually draws them. The two orders must agree, or a plane reordered
   * here would silently change who is occluded there.
   */
  it('draws the backdrop in the order @frontline/shared derives occlusion from', () => {
    const painted = PARALLAX_PLANES.flatMap((p) => (p.assetKey === null ? [] : [p.assetKey]));
    expect(painted).toEqual([...BACKDROP_STACK]);
  });

  it('looks planes up by id and rejects unknown ones', () => {
    expect(plane('nodes').index).toBe(3);
    // @ts-expect-error: the id union is the guard; this pins the runtime behaviour too.
    expect(() => plane('basement')).toThrow(/Unknown parallax plane/);
  });
});

describe('planeOffset', () => {
  const camera = { x: 400, y: 250 };

  it('leaves a factor-1 plane pinned to the world', () => {
    expect(planeOffset(plane('mid'), camera)).toEqual({ x: 0, y: 0 });
  });

  it('lags a distant plane by the un-scrolled remainder', () => {
    // 0.15 of the camera's motion → 0.85 of it cancelled back out.
    expect(planeOffset(plane('sky'), camera)).toEqual({ x: 340, y: 212.5 });
  });

  it('overtakes the world on the foreground plane', () => {
    const offset = planeOffset(plane('fore'), camera);
    expect(offset.x).toBeCloseTo(-140);
    expect(offset.y).toBeCloseTo(-87.5);
  });

  it('pins screen-space overlays', () => {
    expect(planeOffset(plane('grade'), camera)).toEqual(camera);
    expect(planeOffset(plane('atmosphere'), camera)).toEqual(camera);
  });

  it('is identity at the origin for every plane, with no signed zero leaking out', () => {
    for (const p of PARALLAX_PLANES) {
      expect(planeOffset(p, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    }
  });
});
