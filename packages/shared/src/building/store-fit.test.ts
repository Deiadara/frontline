import { describe, expect, it } from 'vitest';
import { BUILD_BOOST_OIL_PER_LEVEL, buildBoostOilCost } from './boost.js';
import { apothecaryAllowedFor, baseBuildingCost } from './cost.js';
import { BUILDING_KINDS, levelCeilingFor } from './kinds.js';
import { storageCapacityFor } from './production.js';
import type { ResourceKey } from '../resources.js';

/**
 * Every list price fits the store the required Nexus allows (maintainer ruling P4-A, 2026-10-02).
 *
 * Measured before: seventeen bill lines and the burn at Generator 6 and 7 asked more than the
 * biggest Apothecary their Nexus permits could ever hold, so the button said "short of" a figure
 * no amount of waiting reached. Quarters 16 asked 8,113 supplies of 3,896, Gauntlet 20 asked
 * 32,667 of 28,457.
 */
const storeAt = (apothecary: number, key: ResourceKey): number =>
  storageCapacityFor(
    [{ id: 'store', kind: 'apothecary', level: apothecary, modifications: [] }],
    key,
  );

describe('every price fits the store its Nexus allows', () => {
  it('asks no more of any resource than that store holds, at every level', () => {
    const over: string[] = [];
    for (const kind of BUILDING_KINDS) {
      for (let level = 1; level <= levelCeilingFor(kind); level += 1) {
        const apothecary = apothecaryAllowedFor(kind, level);
        for (const [key, amount] of Object.entries(baseBuildingCost(kind, level))) {
          const store = storeAt(apothecary, key as ResourceKey);
          if ((amount ?? 0) > store) over.push(`${kind} ${level}: ${amount} ${key} of ${store}`);
        }
      }
    }
    expect(over, over.join('\n')).toEqual([]);
  });

  it('never makes a level cheaper than the one below it', () => {
    const fell: string[] = [];
    for (const kind of BUILDING_KINDS) {
      for (let level = 2; level <= levelCeilingFor(kind); level += 1) {
        const below = baseBuildingCost(kind, level - 1);
        for (const [key, amount] of Object.entries(baseBuildingCost(kind, level))) {
          const was = below[key as ResourceKey] ?? 0;
          if ((amount ?? 0) < was) fell.push(`${kind} ${level}: ${key} ${amount} under ${was}`);
        }
      }
    }
    expect(fell, fell.join('\n')).toEqual([]);
  });

  it('prices the burn under the oil store its Generator allows, and still by the level', () => {
    let previous = 0;
    for (let level = 1; level <= levelCeilingFor('generator'); level += 1) {
      const buildings = [{ id: 'g', kind: 'generator' as const, level, modifications: [] }];
      const oil = buildBoostOilCost(buildings);
      expect(oil, `Generator ${level}`).toBeLessThanOrEqual(
        storeAt(apothecaryAllowedFor('generator', level), 'oil'),
      );
      expect(oil, `Generator ${level}`).toBeGreaterThanOrEqual(previous);
      expect(oil, `Generator ${level}`).toBeLessThanOrEqual(level * BUILD_BOOST_OIL_PER_LEVEL);
      previous = oil;
    }
  });
});
