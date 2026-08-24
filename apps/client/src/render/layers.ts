/**
 * The city map's parallax stack: ADR 0001 §5.2, back to front.
 *
 * This module is data plus one pure transform. Mounting the planes into `CityMap` is phase 2;
 * keeping the model here means the scroll factors live in one place a test can pin against the ADR.
 */
import type { AssetKey } from '@frontline/shared';

export const PLANE_IDS = ['sky', 'far', 'mid', 'nodes', 'fore', 'atmosphere', 'grade'] as const;
export type PlaneId = (typeof PLANE_IDS)[number];

export interface ParallaxPlane {
  /** Draw order, back to front. Equal to the plane's index in {@link PARALLAX_PLANES}. */
  index: number;
  id: PlaneId;
  /** Human-readable role, for debug overlays. */
  label: string;
  /**
   * Rate the plane scrolls at relative to the world: `1` tracks it exactly, `<1` lags (further
   * away), `>1` overtakes (nearer the camera). `null` marks a screen-space overlay that does not
   * parallax at all: ADR §5.2 leaves those two rows blank.
   */
  scrollFactor: number | null;
  /** Manifest key the plane is painted from; `null` where it is composed at runtime. */
  assetKey: AssetKey | null;
  /**
   * ADR §5.4: blurred planes are baked with `cacheAsTexture` and invalidated only on resize. Data
   * only so far: nothing applies it yet. Whoever does must call `updateCacheTexture()` on the
   * container after `buildPlanes` swaps its children, or a delivered master lands behind a stale
   * bake and never appears: Pixi does not refresh a cache on its own.
   */
  cacheAsTexture: boolean;
  /** Exactly one plane takes pointer events: district nodes and base markers. */
  interactive: boolean;
}

export const PARALLAX_PLANES: readonly ParallaxPlane[] = [
  {
    index: 0,
    // Visible only while `mid` is procedural. `plate-city` is opaque by specification
    // (ART-BIBLE §6), so the day it is delivered as a file it covers this plane completely and
    // `plane-city-sky` stops contributing a pixel, which is why the order sheet no longer asks the
    // board for a master for it (MOU-309, `isOccludedBackdropAsset`). Until then this carries the
    // backdrop: `procedural.ts` paints only `sky` opaque and composites every plane over it.
    id: 'sky',
    label: 'Sky / arcology silhouette',
    scrollFactor: 0.15,
    assetKey: 'plane-city-sky',
    cacheAsTexture: true,
    interactive: false,
  },
  {
    index: 1,
    // Occluded by a delivered `mid` on the same terms as `sky` above. Its ART-BIBLE §6 ≥30%
    // transparency floor guards the *procedural* stack it is drawn over today, not the delivered
    // one: once the plate lands there is no sky behind this left to hide.
    id: 'far',
    label: 'Far city block mass',
    scrollFactor: 0.35,
    assetKey: 'plane-city-far',
    cacheAsTexture: true,
    interactive: false,
  },
  {
    index: 2,
    // The opaque one. Everything behind it (`sky`, `far`) is visible only for as long as this plane
    // resolves to procedural art rather than a delivered file.
    id: 'mid',
    label: 'Mid city (the base plate)',
    scrollFactor: 1,
    assetKey: 'plate-city',
    cacheAsTexture: false,
    interactive: false,
  },
  {
    index: 3,
    id: 'nodes',
    label: 'District nodes + base markers',
    scrollFactor: 1,
    assetKey: null,
    cacheAsTexture: false,
    interactive: true,
  },
  {
    index: 4,
    id: 'fore',
    label: 'Foreground occluders',
    scrollFactor: 1.35,
    assetKey: 'plane-city-fore',
    cacheAsTexture: false,
    interactive: false,
  },
  {
    index: 5,
    id: 'atmosphere',
    label: 'Atmosphere (godrays + drifting smog)',
    scrollFactor: null,
    assetKey: null,
    cacheAsTexture: false,
    interactive: false,
  },
  {
    index: 6,
    id: 'grade',
    label: 'Grade (post-FX chain + vignette)',
    scrollFactor: null,
    assetKey: null,
    cacheAsTexture: false,
    interactive: false,
  },
];

const PLANE_BY_ID: ReadonlyMap<PlaneId, ParallaxPlane> = new Map(
  PARALLAX_PLANES.map((plane) => [plane.id, plane]),
);

export function plane(id: PlaneId): ParallaxPlane {
  const found = PLANE_BY_ID.get(id);
  if (!found) throw new Error(`Unknown parallax plane "${id}"`);
  return found;
}

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Local position that gives `plane` its own scroll rate inside a viewport that has already
 * translated the world by `-camera` (`camera` being the world point at the viewport's top-left).
 *
 * The viewport moves every child by `-camera`, so a plane cancels back `(1 - factor) * camera`
 * of that: factor `1` cancels nothing and tracks the world, factor `0` cancels all of it and pins
 * the plane to the screen, factor `1.35` over-cancels and overtakes the world.
 */
export function planeOffset(target: ParallaxPlane, camera: Vec2): Vec2 {
  const factor = target.scrollFactor ?? 0;
  return { x: camera.x * (1 - factor) || 0, y: camera.y * (1 - factor) || 0 };
}
