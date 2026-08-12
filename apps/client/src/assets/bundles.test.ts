import { ART_MANIFEST } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { ASSET_BUNDLES, BUNDLE_SPECS, bundleFor } from './bundles';

describe('bundle partition', () => {
  it('places every manifest entry in exactly one bundle', () => {
    const placed = ASSET_BUNDLES.flatMap((name) => BUNDLE_SPECS[name].map((spec) => spec.key));
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(ART_MANIFEST.map((spec) => spec.key).sort());
  });

  it('leaves no bundle empty — an empty one is a dead screen', () => {
    for (const name of ASSET_BUNDLES) expect(BUNDLE_SPECS[name].length).toBeGreaterThan(0);
  });

  it('keeps the city bundle free of the heavy portraits', () => {
    expect(BUNDLE_SPECS.city.every((spec) => spec.class !== 'portrait')).toBe(true);
    expect(BUNDLE_SPECS.overseer.filter((spec) => spec.class === 'portrait')).toHaveLength(4);
  });

  it('routes icons by their subject, not by their class', () => {
    const bundleOf = (key: string) => {
      const spec = ART_MANIFEST.find((s) => s.key === key);
      if (!spec) throw new Error(`no manifest entry for ${key}`);
      return bundleFor(spec);
    };
    expect(bundleOf('icon-caps')).toBe('ui');
    expect(bundleOf('icon-archetype-netrunner')).toBe('overseer');
    expect(bundleOf('icon-kind-npc-stronghold')).toBe('city');
  });

  it('puts the map plates and planes on the city screen', () => {
    const cityKeys = BUNDLE_SPECS.city.map((spec) => spec.key);
    expect(cityKeys).toEqual(
      expect.arrayContaining(['plate-city', 'plane-city-sky', 'plane-city-far', 'plane-city-fore']),
    );
  });
});
