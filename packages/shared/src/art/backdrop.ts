/**
 * The **backdrop stack**: the full-frame 16:9 assets the city was to be painted from, back to front.
 *
 * Nothing renders this any more. It was the parallax stack behind the pan-and-zoom city map, and
 * that map is gone: the city is `plate-city` drawn whole with DOM tags on it (`CityView`). What the
 * module is still for is the order sheet, which is why it has not simply been deleted: it is what
 * keeps `scripts/order-art.ts` from asking the board to paint a layer that could never be seen.
 *
 * It answers the one question the manifest alone cannot, *which of them can still be seen once
 * every file has been delivered*. Occlusion is a property of the stack, not of the asset:
 * `plate-city` is declared opaque (ART-BIBLE §6: the plate is the base image and carries no alpha),
 * so every stack member behind it stops contributing a pixel the moment the plate lands as a real
 * file. Ordering a master for one of those is wasted work, which is why `scripts/order-art.ts`
 * files them apart from the sets the board is asked to draw.
 *
 * `plate-city` has since landed as a real file, so the two members behind it are occluded and the
 * order sheet files them under "nothing to draw". See {@link isOccludedBackdropAsset}.
 */
import { ART_MANIFEST, type AssetKey, type AssetSpec } from './manifest.js';

/**
 * Back to front.
 *
 * It used to mirror `PARALLAX_PLANES` in the client's `render/layers.ts`, with a client test
 * holding the two orders together. That renderer and that test are both gone, so **this order is
 * no longer cross-checked against anything that draws it**: `backdrop.test.ts` pins the sequence
 * literally instead, which is what stops a silent reorder changing who counts as occluded.
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
