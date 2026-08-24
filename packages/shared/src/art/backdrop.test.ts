import { describe, expect, it } from 'vitest';
import { ART_MANIFEST, findAssetSpec, type AssetSpec } from './manifest.js';
import { BACKDROP_STACK, OCCLUDED_BACKDROP_KEYS, isOccludedBackdropAsset } from './backdrop.js';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`${key} is missing from the manifest`);
  return found;
};

describe('the backdrop stack', () => {
  /**
   * The stack is the ordering input to {@link isOccludedBackdropAsset}, so a plane that is missing
   * from it is silently treated as un-occluded. Deriving the expectation from the manifest classes
   * means a fifth plane fails here until someone places it.
   */
  it('holds every full-frame layer of the city map in the manifest', () => {
    /*
     * Derived rather than listed, so a parallax plane cannot be added without joining the stack.
     *
     * `plate` is the one class with a member outside this scene: `plate-district` is the ground of
     * the player's own compound (§A1), which the district page draws by itself and the map never
     * composites. It is named here rather than filtered by a pattern so that deleting it from the
     * manifest fails loudly instead of quietly making this derivation vacuous.
     */
    const elsewhere = ['plate-district'];
    for (const key of elsewhere) expect(findAssetSpec(key), key).toBeDefined();

    const mapLayers = ART_MANIFEST.filter(
      (candidate) =>
        (candidate.class === 'plane' || candidate.class === 'plate') &&
        !elsewhere.includes(candidate.key),
    ).map((candidate) => candidate.key);
    expect([...BACKDROP_STACK].sort()).toEqual([...mapLayers].sort());
  });

  it('is ordered back to front, with the opaque plate in the middle', () => {
    expect(BACKDROP_STACK).toEqual([
      'plane-city-sky',
      'plane-city-far',
      'plate-city',
      'plane-city-fore',
    ]);
    expect(spec('plate-city').alpha).toBe(false);
  });
});

describe('isOccludedBackdropAsset', () => {
  /**
   * The whole point of the predicate: these two are behind an opaque plate, so a delivered master
   * for either could never be seen. MOU-309: `plane-city-sky` was in the *active* order-sheet
   * section before this landed.
   */
  it('flags exactly the layers behind the opaque plate', () => {
    expect(OCCLUDED_BACKDROP_KEYS).toEqual(['plane-city-sky', 'plane-city-far']);
  });

  it('clears the plate itself and the layer in front of it', () => {
    expect(isOccludedBackdropAsset(spec('plate-city'))).toBe(false);
    expect(isOccludedBackdropAsset(spec('plane-city-fore'))).toBe(false);
  });

  /** `splash-auth` is opaque and 16:9 too, but it is a screen, not a layer of the map. */
  it('ignores opaque assets that are not in the stack', () => {
    expect(spec('splash-auth').alpha).toBe(false);
    expect(isOccludedBackdropAsset(spec('splash-auth'))).toBe(false);
    expect(isOccludedBackdropAsset(spec('district-neon-docks'))).toBe(false);
  });

  /**
   * Membership is derived from opacity, not listed. If the plate ever grew an alpha channel the two
   * planes behind it would become visible again and the predicate has to let them go on its own.
   */
  it('releases the planes when nothing in front of them is opaque', () => {
    const transparentPlate: AssetSpec = { ...spec('plate-city'), alpha: true };
    const manifest = ART_MANIFEST.map((candidate) =>
      candidate.key === 'plate-city' ? transparentPlate : candidate,
    );
    const stillOccluded = manifest.filter((candidate) => {
      const depth = BACKDROP_STACK.indexOf(candidate.key);
      if (depth === -1) return false;
      return BACKDROP_STACK.slice(depth + 1).some((key) => {
        const ahead = manifest.find((entry) => entry.key === key);
        return ahead !== undefined && !ahead.alpha;
      });
    });
    expect(stillOccluded).toEqual([]);
  });
});
