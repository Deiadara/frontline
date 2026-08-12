import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RegisterRequestSchema } from './api.js';
import { BUILDING_CATALOG, BUILDING_KINDS } from './building.js';
import { CITY_DISTRICTS, DistrictSchema, STARTER_DISTRICT_ID, findDistrict } from './city.js';
import { OVERSEER_PRESETS, OverseerPresetSchema } from './overseer.js';
import { DEFAULT_SKILLS, SKILL_NAMES, SkillsSchema, clampSkill } from './skills.js';

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
