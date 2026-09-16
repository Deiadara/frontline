import { ART_MANIFEST } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { ASSET_BUNDLES, BUNDLE_SPECS, bundleFor } from './bundles';

describe('bundle partition', () => {
  it('places every manifest entry in exactly one bundle', () => {
    const placed = ASSET_BUNDLES.flatMap((name) => BUNDLE_SPECS[name].map((spec) => spec.key));
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(ART_MANIFEST.map((spec) => spec.key).sort());
  });

  it('leaves no bundle empty: an empty one is a dead screen', () => {
    for (const name of ASSET_BUNDLES) expect(BUNDLE_SPECS[name].length).toBeGreaterThan(0);
  });

  /**
   * The portraits are the heaviest class in the manifest and the city screen shows none of them.
   *
   * The count is read off the manifest rather than written as a literal (maintainer request,
   * 2026-09-15: the pool went from four characters to thirty). A literal here was a second place
   * to remember, and it failed the moment the pool grew: what this is actually about is the
   * partition, that every portrait is in the overseer bundle and none of them is in the city's.
   */
  it('keeps the city bundle free of the heavy portraits', () => {
    const portraits = ART_MANIFEST.filter((spec) => spec.class === 'portrait');
    expect(portraits.length, 'the manifest has no portraits to partition').toBeGreaterThan(0);
    expect(BUNDLE_SPECS.city.every((spec) => spec.class !== 'portrait')).toBe(true);
    expect(BUNDLE_SPECS.overseer.filter((spec) => spec.class === 'portrait')).toHaveLength(
      portraits.length,
    );
  });

  it('routes icons by their subject, not by their class', () => {
    const bundleOf = (key: string) => {
      const spec = ART_MANIFEST.find((s) => s.key === key);
      if (!spec) throw new Error(`no manifest entry for ${key}`);
      return bundleFor(spec);
    };
    expect(bundleOf('icon-caps')).toBe('ui');
    expect(bundleOf('icon-archetype-netrunner')).toBe('overseer');
    expect(bundleOf('icon-kind-contested')).toBe('city');
    expect(bundleOf('icon-location-power-station')).toBe('city');
  });

  it('puts the map plates and planes on the city screen', () => {
    const cityKeys = BUNDLE_SPECS.city.map((spec) => spec.key);
    expect(cityKeys).toEqual(
      expect.arrayContaining(['plate-city', 'plane-city-sky', 'plane-city-far', 'plane-city-fore']),
    );
  });
});
