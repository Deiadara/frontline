import { findAssetSpec, type AssetSpec } from '@frontline/shared';
import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { AssetBundleName } from './bundles';
import { createArtLoader } from './loader';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`no manifest entry for ${key}`);
  return found;
};

const SPECS: Record<AssetBundleName, readonly AssetSpec[]> = {
  splash: [spec('splash-auth')],
  overseer: [spec('portrait-overseer-1')],
  crew: [],
  city: [spec('plate-city'), spec('plane-city-sky')],
  base: [spec('building-nexus')],
  units: [spec('unit-razors')],
  ui: [spec('ui-frame-panel')],
};

const texture = (url: string) => ({ label: url }) as unknown as Texture;

const loaderWith = (
  delivered: Map<string, string>,
  loadTexture = vi.fn((url: string) => Promise.resolve(texture(url))),
) => ({
  loader: createArtLoader({ specs: SPECS, delivered, loadTexture }),
  loadTexture,
});

describe('createArtLoader', () => {
  it('reports a fully procedural bundle ready without fetching anything', () => {
    const { loader, loadTexture } = loaderWith(new Map());
    loader.ensure('city');
    expect(loader.stateOf('city')).toMatchObject({ status: 'ready', total: 0, progress: 1 });
    expect(loadTexture).not.toHaveBeenCalled();
  });

  it('starts idle until a screen asks for its bundle', () => {
    const { loader } = loaderWith(new Map([['plate-city.webp', '/art/plate-city.webp']]));
    expect(loader.stateOf('city').status).toBe('idle');
    loader.ensure('city');
    expect(loader.stateOf('city').status).toBe('loading');
  });

  it('loads delivered files once and exposes their textures', async () => {
    const { loader, loadTexture } = loaderWith(
      new Map([
        ['plate-city.webp', '/art/plate-city.webp'],
        ['plane-city-sky.webp', '/art/plane-city-sky.webp'],
      ]),
    );
    const seen: number[] = [];
    loader.subscribe(() => seen.push(loader.stateOf('city').loaded));

    loader.ensure('city');
    loader.ensure('city');
    await vi.waitFor(() => expect(loader.stateOf('city').status).toBe('ready'));

    expect(loadTexture).toHaveBeenCalledTimes(2);
    expect(loader.stateOf('city')).toMatchObject({ loaded: 2, total: 2, progress: 1 });
    expect(loader.textureOf('plate-city')).toMatchObject({ label: '/art/plate-city.webp' });
    expect(seen).toContain(1);
  });

  it('counts only delivered files toward progress', async () => {
    const { loader } = loaderWith(new Map([['plate-city.webp', '/art/plate-city.webp']]));
    loader.ensure('city');
    await vi.waitFor(() => expect(loader.stateOf('city').status).toBe('ready'));
    expect(loader.stateOf('city')).toMatchObject({ total: 1, loaded: 1 });
    expect(loader.textureOf('plane-city-sky')).toBeNull();
    expect(loader.sourceOf('plane-city-sky')?.kind).toBe('procedural');
  });

  it('surfaces a failed fetch as an error state rather than an unhandled rejection', async () => {
    const loadTexture = vi.fn(() => Promise.reject(new Error('404')));
    const loader = createArtLoader({
      specs: SPECS,
      delivered: new Map([['plate-city.webp', '/art/plate-city.webp']]),
      loadTexture,
    });
    loader.ensure('city');
    await vi.waitFor(() => expect(loader.stateOf('city').status).toBe('error'));
    expect(loader.stateOf('city').error).toContain('404');
  });

  it('keeps bundles independent', () => {
    const { loader } = loaderWith(new Map([['plate-city.webp', '/art/plate-city.webp']]));
    loader.ensure('base');
    expect(loader.stateOf('base').status).toBe('ready');
    expect(loader.stateOf('city').status).toBe('idle');
  });

  it('stops notifying an unsubscribed listener', () => {
    const { loader } = loaderWith(new Map());
    const listener = vi.fn();
    loader.subscribe(listener)();
    loader.ensure('ui');
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns a stable snapshot identity while nothing changes', () => {
    const { loader } = loaderWith(new Map());
    loader.ensure('ui');
    expect(loader.stateOf('ui')).toBe(loader.stateOf('ui'));
  });
});
