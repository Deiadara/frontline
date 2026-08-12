/**
 * Lazy, observable art loading — ADR 0001 §5.1.
 *
 * A bundle is fetched the first time something asks for it and never again. Keys backed by the
 * procedural fallback need no network at all, so a bundle with nothing delivered yet reaches
 * `ready` synchronously: there is no spinner to flash and no layout to shift.
 */
import { Assets, type Texture } from 'pixi.js';
import { BUNDLE_SPECS, type AssetBundleName } from './bundles';
import { DELIVERED_ART, prefersRetina, resolveAssetSources, type AssetSource } from './source';
import type { AssetKey, AssetSpec } from '@frontline/shared';

export type BundleStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BundleState {
  status: BundleStatus;
  /** Delivered files fetched so far. Procedural keys are never counted — they cost nothing. */
  loaded: number;
  total: number;
  /** `0`–`1`. A bundle with no delivered files is complete on arrival. */
  progress: number;
  error: string | null;
}

export interface ArtLoader {
  /** Idempotent; starts the fetch on first call. */
  ensure(bundle: AssetBundleName): void;
  stateOf(bundle: AssetBundleName): BundleState;
  subscribe(listener: () => void): () => void;
  sourceOf(key: AssetKey): AssetSource | undefined;
  /** The delivered texture, or `null` while it is still loading or the key is procedural. */
  textureOf(key: AssetKey): Texture | null;
}

export interface ArtLoaderOptions {
  specs?: Readonly<Record<AssetBundleName, readonly AssetSpec[]>>;
  delivered?: ReadonlyMap<string, string>;
  retina?: boolean;
  loadTexture?: (url: string) => Promise<Texture>;
}

const idle = (total: number): BundleState => ({
  status: 'idle',
  loaded: 0,
  total,
  progress: total === 0 ? 1 : 0,
  error: null,
});

const UNKNOWN_BUNDLE: BundleState = Object.freeze(idle(0));

export function createArtLoader(options: ArtLoaderOptions = {}): ArtLoader {
  const specs = options.specs ?? BUNDLE_SPECS;
  const retina = options.retina ?? prefersRetina();
  const loadTexture = options.loadTexture ?? ((url: string) => Assets.load<Texture>(url));

  const sources = new Map<AssetKey, AssetSource>();
  const fileKeys = new Map<AssetBundleName, AssetKey[]>();
  const states = new Map<AssetBundleName, BundleState>();

  for (const [name, bundleSpecs] of Object.entries(specs) as [
    AssetBundleName,
    readonly AssetSpec[],
  ][]) {
    const resolved = resolveAssetSources(bundleSpecs, options.delivered ?? DELIVERED_ART, retina);
    for (const [key, source] of resolved) sources.set(key, source);
    const files = [...resolved.values()].filter((s) => s.kind === 'file').map((s) => s.key);
    fileKeys.set(name, files);
    states.set(name, idle(files.length));
  }

  const textures = new Map<AssetKey, Texture>();
  const listeners = new Set<() => void>();
  const started = new Set<AssetBundleName>();

  const publish = (bundle: AssetBundleName, patch: Partial<BundleState>): void => {
    const previous = states.get(bundle);
    if (!previous) return;
    const next = { ...previous, ...patch };
    next.progress = next.total === 0 ? 1 : next.loaded / next.total;
    states.set(bundle, next);
    for (const listener of listeners) listener();
  };

  async function load(bundle: AssetBundleName, keys: readonly AssetKey[]): Promise<void> {
    let loaded = 0;
    const fetches = keys.map(async (key) => {
      const source = sources.get(key);
      if (source?.kind !== 'file') return;
      textures.set(key, await loadTexture(source.url));
      loaded += 1;
      publish(bundle, { loaded });
    });
    const results = await Promise.allSettled(fetches);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
      publish(bundle, { status: 'error', error: String(failure.reason) });
      return;
    }
    publish(bundle, { status: 'ready' });
  }

  return {
    ensure(bundle) {
      if (started.has(bundle)) return;
      started.add(bundle);
      const keys = fileKeys.get(bundle) ?? [];
      if (keys.length === 0) {
        publish(bundle, { status: 'ready' });
        return;
      }
      publish(bundle, { status: 'loading' });
      void load(bundle, keys);
    },
    stateOf(bundle) {
      // Stable identity per bundle — `useSyncExternalStore` re-renders on snapshot inequality.
      return states.get(bundle) ?? UNKNOWN_BUNDLE;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sourceOf(key) {
      return sources.get(key);
    },
    textureOf(key) {
      return textures.get(key) ?? null;
    },
  };
}

/** The app-wide loader. Tests build their own with {@link createArtLoader}. */
export const artLoader: ArtLoader = createArtLoader();
