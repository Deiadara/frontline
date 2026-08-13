import { CITY_DISTRICTS, type AssetKey, type BaseSummary } from '@frontline/shared';
import { Container, Graphics, Sprite, Texture, TextureSource } from 'pixi.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtLoader, BundleState } from '../../assets/loader';
import type { AssetSource } from '../../assets/source';
import { PARALLAX_PLANES, type PlaneId } from '../../render/layers';
import { buildPlanes, districtFace, groupByDistrict, markerY } from './CityMap';

const deliveredTexture = vi.hoisted(() => vi.fn<() => Texture | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredTexture }));

/**
 * The procedural painters bake gradients through a 2D canvas, which jsdom has none of (see
 * `procedural.ts`). Stubbing them keeps this file on the dispatch question — *which* painter a
 * plane reaches for — and leaves the painting itself to the Chromium suite.
 */
const painters = vi.hoisted(() => ({
  paintProcedural: vi.fn(),
  paintPlaneFallback: vi.fn(),
}));
vi.mock('../../render/procedural', () => painters);

beforeEach(() => {
  deliveredTexture.mockClear().mockReturnValue(null);
  // The stubs keep the real contract — a display object can only have one parent, so every call
  // needs its own container, and `paintProcedural` declines a delivered file exactly as it does in
  // production. Without that second half a plane could look painted here while rendering blank.
  painters.paintProcedural
    .mockReset()
    .mockImplementation((source?: AssetSource) =>
      source?.kind === 'procedural' ? new Container() : null,
    );
  painters.paintPlaneFallback.mockReset().mockImplementation(() => new Container());
});

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

describe('buildPlanes', () => {
  /** Every plane that is painted from a manifest key — the ones a delivered master can land on. */
  const PAINTED = PARALLAX_PLANES.filter((spec) => spec.assetKey !== null);

  const READY: BundleState = { status: 'ready', loaded: 1, total: 1, progress: 1, error: null };

  /** A loader where every plane key has a master delivered, loaded or not. */
  const loaderWith = (textures: ReadonlyMap<AssetKey, Texture>): ArtLoader => ({
    ensure: () => {},
    stateOf: () => READY,
    subscribe: () => () => {},
    sourceOf: (key) => ({ kind: 'file', key, url: `/${key}.webp` }),
    textureOf: (key) => textures.get(key) ?? null,
  });

  const sceneOf = (width: number, height: number) => ({
    planes: new Map<PlaneId, Container>(PARALLAX_PLANES.map((spec) => [spec.id, new Container()])),
    width,
    height,
  });

  const delivered = (width: number, height: number): Texture =>
    new Texture({ source: new TextureSource({ width, height }) });

  const master = delivered(400, 200);
  const allDelivered = new Map(PAINTED.map((spec) => [spec.assetKey as AssetKey, master]));

  it('renders the delivered master on every plane that has one', () => {
    const scene = sceneOf(800, 600);

    buildPlanes(scene, loaderWith(allDelivered));

    for (const spec of PAINTED) {
      const children = scene.planes.get(spec.id)?.children ?? [];
      expect(children, `the ${spec.id} plane paints nothing at all`).toHaveLength(1);
      expect(children[0], `the ${spec.id} plane ignores its delivered master`).toBeInstanceOf(
        Sprite,
      );
    }
    expect(
      painters.paintProcedural,
      'a delivered plane still paints procedurally',
    ).not.toHaveBeenCalled();
  });

  it('fits the master cover — full-bleed, undistorted, centred', () => {
    const scene = sceneOf(800, 800);

    buildPlanes(scene, loaderWith(allDelivered));

    const sprite = scene.planes.get('mid')?.children[0] as Sprite;
    // 800/400 = 2 wide, 800/200 = 4 tall: the taller ratio wins, so the frame is covered.
    expect(sprite.scale.x).toBe(4);
    expect(sprite.scale.y, 'a non-uniform scale distorts the art').toBe(sprite.scale.x);
    expect(sprite.width).toBeGreaterThanOrEqual(scene.width);
    expect(sprite.height).toBeGreaterThanOrEqual(scene.height);
    // Anchored centre-on-centre, so the cropped surplus is split between both edges.
    expect([sprite.x, sprite.y]).toEqual([400, 400]);
    expect([sprite.anchor.x, sprite.anchor.y]).toEqual([0.5, 0.5]);
  });

  // Until this branch existed a delivered key painted nothing at all: `paintProcedural` declines a
  // file source and the caller had no other painter to fall back on.
  it('holds the interim painting while a delivered master is still in flight', () => {
    const scene = sceneOf(800, 600);

    buildPlanes(scene, loaderWith(new Map()));

    for (const spec of PAINTED) {
      expect(
        scene.planes.get(spec.id)?.children ?? [],
        `the ${spec.id} plane is a hole in the background until its master lands`,
      ).toHaveLength(1);
      expect(painters.paintPlaneFallback).toHaveBeenCalledWith(spec.assetKey, 800, 600);
    }
  });

  it('repaints a plane rather than stacking a second painting on it', () => {
    const scene = sceneOf(800, 600);
    const loader = loaderWith(allDelivered);

    buildPlanes(scene, loader);
    buildPlanes(scene, loader);

    for (const spec of PAINTED) {
      expect(scene.planes.get(spec.id)?.children).toHaveLength(1);
    }
  });
});

describe('districtFace', () => {
  const [district] = CITY_DISTRICTS;
  if (!district) throw new Error('expected at least one city district');

  /** What districtColor returns for a bot-garrisoned district (neon.magenta) and for a base. */
  const MAGENTA = 0xe11d8f;
  const KIND_CYAN = 0x22d3ee;

  /** The ring is the last child either way: the whole node when flat, the top layer over art. */
  const ringOf = (face: Container): Graphics => {
    const ring = face instanceof Graphics ? face : face.children.at(-1);
    if (!(ring instanceof Graphics)) throw new Error('expected a Graphics ring');
    return ring;
  };

  /** The paint Pixi records for a fill. Its own `instruction.data` is untyped. */
  interface FillPaint {
    style: { color: number; alpha: number };
  }

  /** The fills Pixi will actually paint, in draw order. */
  const fills = (ring: Graphics): { color: number; alpha: number }[] =>
    ring.context.instructions
      .filter((instruction) => instruction.action === 'fill')
      .map((instruction) => {
        const { style } = instruction.data as FillPaint;
        return { color: style.color, alpha: style.alpha };
      });

  it('draws the flat vector node while the district art is undelivered', () => {
    const face = districtFace(district, 10, 0x22d3ee, false);

    expect(face).toBeInstanceOf(Graphics);
    expect(deliveredTexture).toHaveBeenCalledWith({ type: 'district', districtId: district.id });
  });

  it('masks the delivered illustration into the node and keeps the kind-coloured ring', () => {
    deliveredTexture.mockReturnValue(Texture.EMPTY);

    const face = districtFace(district, 10, 0x22d3ee, false);

    const art = face.children.find((child): child is Sprite => child instanceof Sprite);
    expect(art, 'the delivered art is the node face').toBeDefined();
    expect(art?.mask, 'art outside the node circle would spill over the map').not.toBeNull();
    expect(face.children.at(-1), 'the ring stays on top of the art').toBeInstanceOf(Graphics);
  });

  // districtColor turns a bot-garrisoned district magenta, so the colour is threat information.
  // Delivering art must not demote it to a hairline on a node that is only 8-14px across.
  it('keeps the threat colour over the delivered art, and over it when selected too', () => {
    deliveredTexture.mockReturnValue(Texture.EMPTY);

    for (const isSelected of [false, true]) {
      const face = districtFace(district, 8, MAGENTA, isSelected);

      const scrim = fills(ringOf(face)).find((paint) => paint.color === MAGENTA);
      expect(
        scrim,
        `the threat colour is painted over the art (selected: ${isSelected})`,
      ).toBeDefined();
      expect(scrim?.alpha ?? 0).toBeGreaterThan(0.25);
    }
  });

  it('leaves a bot-held district distinguishable from the same district un-held, with art delivered', () => {
    deliveredTexture.mockReturnValue(Texture.EMPTY);

    const held = fills(ringOf(districtFace(district, 8, MAGENTA, false)));
    const free = fills(ringOf(districtFace(district, 8, KIND_CYAN, false)));

    expect(held, 'a node whose face paints nothing cannot encode anything').not.toHaveLength(0);
    expect(held).not.toEqual(free);
  });
});
