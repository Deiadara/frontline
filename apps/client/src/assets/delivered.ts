/**
 * Asking for a domain object's art — the view-facing half of the ADR 0001 §5.1 seam.
 *
 * A view names a *thing* (this overseer, this district), never a file. It gets pixels back only
 * when a delivery file for that thing exists in `assets/`; otherwise it gets `null` and paints its
 * own interim look. Dropping `portrait-overseer-1.webp` into `assets/` flips the portrait from
 * gradient to painted with no TypeScript edit — the same rule the Pixi planes already follow.
 *
 * The planes do not come through here, though: a plane's art is an `AssetKey` sitting on
 * `PARALLAX_PLANES`, not a domain id needing resolution, so `CityMap` reads `artLoader` directly.
 * Grepping this module finds every *domain-addressed* consumer of delivered art, not every consumer.
 */
import { tryResolveAssetKey, type AssetRef } from '@frontline/shared';
import type { Texture } from 'pixi.js';
import { artLoader, type ArtLoader } from './loader';

/** For DOM views: the delivered file's URL, or `null` while the key still paints procedurally. */
export function deliveredUrl(ref: AssetRef, loader: ArtLoader = artLoader): string | null {
  const key = tryResolveAssetKey(ref);
  const source = key === undefined ? undefined : loader.sourceOf(key);
  return source?.kind === 'file' ? source.url : null;
}

/** For Pixi views: the delivered texture, or `null` while it is loading or procedural. */
export function deliveredTexture(ref: AssetRef, loader: ArtLoader = artLoader): Texture | null {
  const key = tryResolveAssetKey(ref);
  return key === undefined ? null : loader.textureOf(key);
}
