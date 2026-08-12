import { useCallback, useSyncExternalStore } from 'react';
import type { AssetBundleName } from './bundles';
import { artLoader, type ArtLoader, type BundleState } from './loader';

/**
 * Subscribes a screen to its art bundle and starts the fetch on first render (ADR 0001 §5.1).
 *
 * `ensure` runs during render rather than in an effect so the request is in flight before the
 * first paint; it is idempotent, so React's double-invoked renders are harmless. Bundles with
 * nothing delivered yet come back `ready` on the very first snapshot — the procedural fallback
 * needs no fetch, so there is nothing to flash.
 */
export function useAssetBundle(
  bundle: AssetBundleName,
  loader: ArtLoader = artLoader,
): BundleState {
  loader.ensure(bundle);
  const subscribe = useCallback((onChange: () => void) => loader.subscribe(onChange), [loader]);
  const snapshot = useCallback(() => loader.stateOf(bundle), [loader, bundle]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
