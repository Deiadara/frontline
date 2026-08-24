/**
 * The **backdrop stack**: the full-frame 16:9 assets the district map paints behind and in front of
 * its nodes, ordered back to front.
 *
 * It answers the one question the manifest alone cannot, *which of them can still be seen once
 * every file has been delivered*. Occlusion is a property of the stack, not of the asset:
 * `plate-city` is declared opaque (ART-BIBLE §6: the plate is the base image and carries no alpha),
 * so every stack member behind it stops contributing a pixel the moment the plate lands as a real
 * file. Ordering a master for one of those is wasted work, which is why `scripts/order-art.ts`
 * files them apart from the sets the board is asked to draw.
 *
 * Today the occluded members are not dead: `plate-city` is still procedural, and while it is, they
 * carry the map's depth. See {@link isOccludedBackdropAsset}.
 */
import { ART_MANIFEST, type AssetKey, type AssetSpec } from './manifest.js';

/**
 * Back to front. Mirrors the asset-bearing rows of `PARALLAX_PLANES`
 * (`apps/client/src/render/layers.ts`), which is what actually draws them: a client test pins the
 * two orders together, so a plane reordered there fails rather than silently changing who is
 * occluded here.
 */
export const BACKDROP_STACK: readonly AssetKey[] = [
  'plane-city-sky',
  'plane-city-far',
  'plate-city',
  'plane-city-fore',
];

function isOpaque(key: AssetKey): boolean {
  const spec = ART_MANIFEST.find((candidate) => candidate.key === key);
  return spec !== undefined && !spec.alpha;
}

/**
 * Whether a delivered `spec` would be painted over by an opaque stack member in front of it.
 *
 * Membership is derived, never listed: any stack member sitting behind an `alpha: false` one is
 * occluded, so a plane added behind the plate inherits this by existing and one moved in front of
 * it loses it. Every stack member is the same full-frame 16:9 size, so opacity alone settles
 * coverage: an opaque member leaves no edge uncovered.
 *
 * Assets outside the stack are never occluded: `splash-auth` is opaque and 16:9 too, but it is a
 * screen of its own, not a layer of the map.
 */
export function isOccludedBackdropAsset(spec: AssetSpec): boolean {
  const depth = BACKDROP_STACK.indexOf(spec.key);
  if (depth === -1) return false;
  return BACKDROP_STACK.slice(depth + 1).some(isOpaque);
}

/** Every occluded backdrop asset, in manifest order. */
export const OCCLUDED_BACKDROP_ASSETS: readonly AssetSpec[] =
  ART_MANIFEST.filter(isOccludedBackdropAsset);

export const OCCLUDED_BACKDROP_KEYS: readonly AssetKey[] = OCCLUDED_BACKDROP_ASSETS.map(
  (spec) => spec.key,
);
