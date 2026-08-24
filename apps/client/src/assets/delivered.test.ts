import { resolveAssetKey, type AssetKey } from '@frontline/shared';
import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { deliveredTexture, deliveredUrl } from './delivered';
import type { ArtLoader } from './loader';
import type { AssetSource } from './source';

/** Only the two lookups `delivered.ts` uses; the rest of the loader is irrelevant here. */
function stubLoader(sources: Partial<Record<AssetKey, AssetSource>>): ArtLoader {
  return {
    ensure: () => undefined,
    stateOf: () => ({ status: 'ready', loaded: 0, total: 0, progress: 1, error: null }),
    subscribe: () => () => undefined,
    sourceOf: (key) => sources[key],
    textureOf: (key) => (sources[key]?.kind === 'file' ? Texture.EMPTY : null),
  };
}

const portraitKey = resolveAssetKey({ type: 'portrait', portraitId: 'overseer-1' });
const districtKey = resolveAssetKey({ type: 'district', districtId: 'neon-docks' });

const delivered = stubLoader({
  [portraitKey]: { kind: 'file', key: portraitKey, url: '/assets/portrait-overseer-1.webp' },
  [districtKey]: { kind: 'file', key: districtKey, url: '/assets/district-neon-docks.webp' },
});

const procedural = stubLoader({
  [portraitKey]: { kind: 'procedural', key: portraitKey, class: 'portrait', seed: 1 },
});

describe('deliveredUrl', () => {
  it('returns the delivery URL once the file exists', () => {
    expect(deliveredUrl({ type: 'portrait', portraitId: 'overseer-1' }, delivered)).toBe(
      '/assets/portrait-overseer-1.webp',
    );
  });

  it('returns null while the key still paints procedurally', () => {
    expect(deliveredUrl({ type: 'portrait', portraitId: 'overseer-1' }, procedural)).toBeNull();
  });

  /** `portraitId` and `districtId` are only `z.string()` on the wire: an unknown id must not throw. */
  it('returns null for an id with no manifest entry', () => {
    expect(
      deliveredUrl({ type: 'portrait', portraitId: 'no-such-overseer' }, delivered),
    ).toBeNull();
    expect(
      deliveredUrl({ type: 'district', districtId: 'no-such-district' }, delivered),
    ).toBeNull();
  });
});

describe('deliveredTexture', () => {
  it('returns the loaded texture for a delivered key', () => {
    expect(deliveredTexture({ type: 'district', districtId: 'neon-docks' }, delivered)).toBe(
      Texture.EMPTY,
    );
  });

  it('returns null for a procedural key and for an unknown id', () => {
    expect(deliveredTexture({ type: 'portrait', portraitId: 'overseer-1' }, procedural)).toBeNull();
    expect(deliveredTexture({ type: 'district', districtId: 'nowhere' }, delivered)).toBeNull();
  });
});
