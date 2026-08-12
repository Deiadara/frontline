import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RegisterRequestSchema } from './api.js';
import { BUILDING_CATALOG, BUILDING_KINDS } from './building.js';
import {
  BOT_DISTRICT_ID,
  CITY_DISTRICTS,
  DistrictSchema,
  STARTER_DISTRICT_ID,
  findDistrict,
  isDistrictAttackable,
  type District,
} from './city.js';
import { OVERSEER_PRESETS, OverseerPresetSchema } from './overseer.js';
import { DEFAULT_SKILLS, SKILL_NAMES, SkillsSchema, clampSkill } from './skills.js';

/** Minimum gap between two district positions, in normalized (0..1) map units. */
const MIN_DISTRICT_SEPARATION = 0.06;

describe('SkillsSchema', () => {
  it('accepts a full 1..20 skill sheet', () => {
    expect(SkillsSchema.parse(DEFAULT_SKILLS)).toEqual(DEFAULT_SKILLS);
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(SkillsSchema.safeParse({ ...DEFAULT_SKILLS, hacking: 0 }).success).toBe(false);
    expect(SkillsSchema.safeParse({ ...DEFAULT_SKILLS, hacking: 21 }).success).toBe(false);
    expect(SkillsSchema.safeParse({ ...DEFAULT_SKILLS, hacking: 10.5 }).success).toBe(false);
  });

  it('rejects a sheet missing a skill', () => {
    const { medicine: _medicine, ...incomplete } = DEFAULT_SKILLS;
    expect(SkillsSchema.safeParse(incomplete).success).toBe(false);
  });

  it('clampSkill clamps onto 1..20', () => {
    expect(clampSkill(-5)).toBe(1);
    expect(clampSkill(99)).toBe(20);
    expect(clampSkill(12.4)).toBe(12);
  });
});

describe('OVERSEER_PRESETS', () => {
  it('has one valid preset per archetype', () => {
    expect(OVERSEER_PRESETS).toHaveLength(4);
    const archetypes = OVERSEER_PRESETS.map((p) => p.archetype);
    expect(new Set(archetypes).size).toBe(4);
    for (const preset of OVERSEER_PRESETS) {
      expect(() => OverseerPresetSchema.parse(preset)).not.toThrow();
      for (const skill of SKILL_NAMES) {
        expect(preset.skills[skill]).toBeGreaterThanOrEqual(1);
        expect(preset.skills[skill]).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('CITY_DISTRICTS', () => {
  it('is a valid map with a starter district', () => {
    expect(() => z.array(DistrictSchema).min(10).parse(CITY_DISTRICTS)).not.toThrow();
    expect(findDistrict(STARTER_DISTRICT_ID)?.kind).toBe('player_base');
  });

  it('settles the player and the AI rival in two different, real districts', () => {
    expect(STARTER_DISTRICT_ID).not.toBe(BOT_DISTRICT_ID);
    expect(findDistrict(STARTER_DISTRICT_ID)).toBeDefined();
    expect(findDistrict(BOT_DISTRICT_ID)).toBeDefined();
  });

  it('has unique ids', () => {
    const ids = CITY_DISTRICTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The map renderer anchors each base marker to its district's position, so districts
  // that sit on top of each other would render overlapping markers and labels.
  it('keeps every district at least MIN_DISTRICT_SEPARATION apart', () => {
    for (let i = 0; i < CITY_DISTRICTS.length; i++) {
      for (let j = i + 1; j < CITY_DISTRICTS.length; j++) {
        const a = CITY_DISTRICTS[i];
        const b = CITY_DISTRICTS[j];
        if (!a || !b) throw new Error('district index out of range');
        const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        expect(
          distance,
          `${a.id} and ${b.id} are ${distance.toFixed(3)} apart`,
        ).toBeGreaterThanOrEqual(MIN_DISTRICT_SEPARATION);
      }
    }
  });
});

describe('isDistrictAttackable', () => {
  const district = (id: string): District => {
    const found = findDistrict(id);
    if (!found) throw new Error(`fixture error: no district ${id}`);
    return found;
  };
  const EMPTY = { isOwnBase: false, hasBotBase: false };

  it('offers raid sites and NPC strongholds', () => {
    expect(isDistrictAttackable(district('rustyard'), EMPTY)).toBe(true);
    expect(isDistrictAttackable(district('blacksite-7'), EMPTY)).toBe(true);
  });

  it('holds the line at markets', () => {
    expect(isDistrictAttackable(district('sprawl-exchange'), EMPTY)).toBe(false);
  });

  it('never targets your own base', () => {
    expect(
      isDistrictAttackable(district(STARTER_DISTRICT_ID), { isOwnBase: true, hasBotBase: false }),
    ).toBe(false);
  });

  it('never targets another human player', () => {
    expect(isDistrictAttackable(district(STARTER_DISTRICT_ID), EMPTY)).toBe(false);
  });

  it('targets the AI rival garrisoning a district', () => {
    // Empty, the rival's district is an ordinary player_base node; the bot makes it hostile.
    expect(isDistrictAttackable(district(BOT_DISTRICT_ID), EMPTY)).toBe(false);
    expect(
      isDistrictAttackable(district(BOT_DISTRICT_ID), { isOwnBase: false, hasBotBase: true }),
    ).toBe(true);
  });
});

describe('BUILDING_CATALOG', () => {
  it('covers every building kind', () => {
    for (const kind of BUILDING_KINDS) {
      expect(BUILDING_CATALOG[kind].name.length).toBeGreaterThan(0);
    }
  });
});

describe('RegisterRequestSchema', () => {
  it('rejects short passwords and bad usernames', () => {
    expect(RegisterRequestSchema.safeParse({ username: 'neo', password: 'short' }).success).toBe(
      false,
    );
    expect(RegisterRequestSchema.safeParse({ username: 'x', password: 'longenough' }).success).toBe(
      false,
    );
    expect(
      RegisterRequestSchema.safeParse({ username: 'neo_2077', password: 'longenough' }).success,
    ).toBe(true);
  });
});
