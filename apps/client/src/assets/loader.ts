/**
 * Where a view gets the URL of a delivered file: ADR 0001 §5.1, what is left of it.
 *
 * Every spec in the manifest is resolved once, at module load, against the files the bundler
 * globbed (`source.ts`). A key with a delivered file answers with its URL; a key without one
 * answers `undefined` and the caller paints its own interim look. Nothing is fetched here: an
 * `<img src>` is a fetch the browser already knows how to make, and it makes it when the element
 * is actually on screen.
 *
 * ## What used to be here
 *
 * A lazy, observable, bundle-at-a-time **texture** loader, for Pixi: `ensure(bundle)` kicked off
 * `Assets.load` for every delivered file in a bundle, `stateOf` reported the progress and
 * `textureOf` handed back the `Texture`. It was removed on 2026-09-24 because nothing ever called
 * it. `useAssetBundle` was its only caller and no screen mounted that hook, so no screen ever
 * prefetched a bundle; `deliveredTexture` was the only reader of the texture cache and no screen
 * called that either. The whole of it was reachable code that nothing reached, and it was holding
 * the `pixi.js` dependency and a partition of the manifest (`bundles.ts`) up with it.
 *
 * If a canvas view ever comes back, it comes back with its own loader. The shape above is in the
 * history and the ADR still describes the intent.
 */
import { ART_MANIFEST } from '@frontline/shared';
import { DELIVERED_ART, prefersRetina, resolveAssetSources, type AssetSource } from './source';
import type { AssetKey, AssetSpec } from '@frontline/shared';

export interface ArtLoader {
  /** The delivered file for a key, or `undefined` while that key is still procedural. */
  sourceOf(key: AssetKey): AssetSource | undefined;
}

export interface ArtLoaderOptions {
  specs?: readonly AssetSpec[];
  delivered?: ReadonlyMap<string, string>;
  retina?: boolean;
}

export function createArtLoader(options: ArtLoaderOptions = {}): ArtLoader {
  const sources = resolveAssetSources(
    options.specs ?? ART_MANIFEST,
    options.delivered ?? DELIVERED_ART,
    options.retina ?? prefersRetina(),
  );
  return {
    sourceOf(key) {
      return sources.get(key);
    },
  };
}

/** The app-wide loader. Tests build their own with {@link createArtLoader}. */
export const artLoader: ArtLoader = createArtLoader();
