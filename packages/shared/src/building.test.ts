import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATALOG,
  BUILDING_COST_GROWTH,
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  buildingCost,
  nextStructureLevel,
  structureLevelCap,
  type Building,
} from './building.js';
import { RESOURCE_KEYS } from './resources.js';

const at = (kind: Building['kind'], level: number): Building => ({ id: kind, kind, level });

describe('the building catalogue (GDD §D3)', () => {
  it('makes every structure cost oil, at every level', () => {
    for (const kind of BUILDING_KINDS) {
      for (const level of [1, 5, BUILDING_MAX_LEVEL]) {
        expect(buildingCost(kind, level).oil ?? 0, `${kind} lv${level}`).toBeGreaterThan(0);
      }
    }
  });

  it('charges the catalogue price for the first level', () => {
    for (const kind of BUILDING_KINDS) {
      expect(buildingCost(kind, 1)).toEqual(BUILDING_CATALOG[kind].baseCost);
    }
  });

  it('never makes a level cheaper than the one below it, in any resource', () => {
    for (const kind of BUILDING_KINDS) {
      for (let level = 2; level <= BUILDING_MAX_LEVEL; level += 1) {
        const previous = buildingCost(kind, level - 1);
        const current = buildingCost(kind, level);
        for (const key of RESOURCE_KEYS) {
          expect(current[key] ?? 0, `${kind} lv${level} ${key}`).toBeGreaterThanOrEqual(
            previous[key] ?? 0,
          );
        }
      }
    }
  });

  it('scales the whole bundle by the growth factor, not just the oil', () => {
    // Fixed against the literal so retuning `BUILDING_COST_GROWTH` has to be a deliberate edit,
    // and against the formula so the two cannot disagree about what the constant means.
    expect(buildingCost('reactor', 3)).toEqual({ caps: 384, scrap: 256, oil: 154 });
    expect(buildingCost('reactor', 3).oil).toBe(Math.round(60 * BUILDING_COST_GROWTH ** 2));
  });

  it('gives every kind a short name that fits a village name plate', () => {
    for (const kind of BUILDING_KINDS) {
      const { shortName } = BUILDING_CATALOG[kind];
      expect(shortName.length, `${kind}: "${shortName}"`).toBeLessThanOrEqual(10);
    }
  });
});

describe('level caps', () => {
  it('lets the Command Center reach the content ceiling', () => {
    expect(structureLevelCap('command_center', [])).toBe(BUILDING_MAX_LEVEL);
    expect(nextStructureLevel('command_center', [at('command_center', 9)])).toBe(10);
    expect(nextStructureLevel('command_center', [at('command_center', 10)])).toBeNull();
  });

  it('holds every other structure at the Command Center s level', () => {
    const village = [at('command_center', 2), at('reactor', 2)];
    expect(structureLevelCap('reactor', village)).toBe(2);
    expect(nextStructureLevel('reactor', village)).toBeNull();
    expect(nextStructureLevel('reactor', [at('command_center', 3), at('reactor', 2)])).toBe(3);
  });

  it('refuses to raise anything at all without a Command Center standing', () => {
    for (const kind of BUILDING_KINDS.filter((k) => k !== 'command_center')) {
      expect(nextStructureLevel(kind, []), kind).toBeNull();
    }
  });

  it('treats an empty plot as level 0, so the next level is 1', () => {
    expect(nextStructureLevel('foundry', [at('command_center', 1)])).toBe(1);
  });
});
