import {
  BUILDING_KINDS,
  resolveAssetKey,
  type AssetKey,
  type BuildingKind,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { buildingPortraitUrl, deliveredUrl } from './delivered';
import type { ArtLoader } from './loader';
import type { AssetSource } from './source';

/** Only the lookup `delivered.ts` uses; the rest of the loader is irrelevant here. */
function stubLoader(sources: Partial<Record<AssetKey, AssetSource>>): ArtLoader {
  return { sourceOf: (key) => sources[key] };
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

/**
 * Every structure a screen can draw has a picture (moved here 2026-09-24).
 *
 * `content.integrity.test.ts` in the shared package used to sweep this, through a
 * `{ type: 'building' }` asset ref. That ref and the eleven `building-<kind>` masters behind it
 * are gone: a structure's picture is a cut-out of the district painting, resolved by filename
 * through `buildingPortraitUrl`, which the shared package cannot see. So the sweep lives here,
 * against the real glob rather than a stub, which is also what catches a delivery going missing.
 */
describe('buildingPortraitUrl', () => {
  it('finds a picture for every building the catalogue can put up', () => {
    for (const kind of BUILDING_KINDS) {
      expect(buildingPortraitUrl(kind), kind).not.toBeNull();
    }
  });

  it('answers null for a kind nobody builds, rather than a broken src', () => {
    expect(buildingPortraitUrl('sky_hook' as BuildingKind)).toBeNull();
  });
});
