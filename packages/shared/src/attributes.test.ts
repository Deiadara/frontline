import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_NAMES,
  AttributesSchema,
  DEFAULT_ATTRIBUTES,
  MAX_RECRUITMENT_ATTRIBUTE,
  clampAttribute,
  groupOf,
  makeAttributes,
} from './attributes.js';
import { OVERSEER_PRESETS, OverseerPresetSchema } from './overseer.js';
import {
  OFFICER_ROLES,
  OFFICER_ROLE_LABELS,
  HIRING_INSIGHT_ROLES,
  RESKILLING_ROLE,
} from './roles.js';
import { TRAIT_CATALOG, TRAIT_IDS, applyTraitBonuses, findTrait } from './traits.js';

describe('the attribute set', () => {
  // B3/B5: wide enough that all 19 roles have their own field. The server-side requirement
  // table pins the stronger claim (one distinct primary per role); this is the floor.
  it('is many attributes, with no duplicates, covering every group', () => {
    expect(ATTRIBUTE_NAMES.length).toBeGreaterThanOrEqual(OFFICER_ROLES.length);
    expect(new Set(ATTRIBUTE_NAMES).size).toBe(ATTRIBUTE_NAMES.length);
    for (const group of ATTRIBUTE_GROUPS) {
      expect(ATTRIBUTES_BY_GROUP[group].length).toBeGreaterThan(0);
    }
  });

  it('partitions every attribute into exactly one group', () => {
    const grouped = ATTRIBUTE_GROUPS.flatMap((group) => [...ATTRIBUTES_BY_GROUP[group]]);
    expect(grouped.slice().sort()).toEqual([...ATTRIBUTE_NAMES].sort());
    for (const name of ATTRIBUTE_NAMES) {
      expect(ATTRIBUTES_BY_GROUP[groupOf(name)]).toContain(name);
    }
  });
});

describe('AttributesSchema', () => {
  it('accepts a full 0..100 sheet', () => {
    expect(AttributesSchema.parse(DEFAULT_ATTRIBUTES)).toEqual(DEFAULT_ATTRIBUTES);
    expect(AttributesSchema.safeParse(makeAttributes(0)).success).toBe(true);
    expect(AttributesSchema.safeParse(makeAttributes(100)).success).toBe(true);
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(AttributesSchema.safeParse({ ...DEFAULT_ATTRIBUTES, hacking: -1 }).success).toBe(false);
    expect(AttributesSchema.safeParse({ ...DEFAULT_ATTRIBUTES, hacking: 101 }).success).toBe(false);
    expect(AttributesSchema.safeParse({ ...DEFAULT_ATTRIBUTES, hacking: 10.5 }).success).toBe(
      false,
    );
  });

  // B6: every human carries every attribute, including the ones their role never touches.
  it('rejects a sheet missing an attribute', () => {
    const { medicine: _medicine, ...incomplete } = DEFAULT_ATTRIBUTES;
    expect(AttributesSchema.safeParse(incomplete).success).toBe(false);
  });

  it('clampAttribute clamps onto 0..100', () => {
    expect(clampAttribute(-5)).toBe(0);
    expect(clampAttribute(999)).toBe(100);
    expect(clampAttribute(12.4)).toBe(12);
  });
});

describe('TRAIT_CATALOG', () => {
  it('is keyed by id and only grants known attributes', () => {
    for (const id of TRAIT_IDS) {
      const trait = TRAIT_CATALOG[id];
      expect(trait.id).toBe(id);
      expect(trait.name.length).toBeGreaterThan(0);
      expect(Object.keys(trait.bonus).length).toBeGreaterThan(0);
      for (const name of Object.keys(trait.bonus)) {
        expect(ATTRIBUTE_NAMES).toContain(name);
      }
    }
    expect(findTrait('not_a_trait')).toBeUndefined();
  });

  it('applies bonuses on top of the sheet without leaving the scale', () => {
    const boosted = applyTraitBonuses(makeAttributes(20), ['field_surgeon']);
    expect(boosted.medicine).toBe(30);
    expect(boosted.hacking).toBe(20);
    expect(applyTraitBonuses(makeAttributes(100), ['field_surgeon']).medicine).toBe(100);
  });
});

describe('officer roles', () => {
  // C1: exactly the 19 positions the board listed.
  it('declares the 19 positions, each with a label', () => {
    expect(OFFICER_ROLES).toHaveLength(19);
    expect(new Set(OFFICER_ROLES).size).toBe(19);
    for (const role of OFFICER_ROLES) {
      expect(OFFICER_ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  // C4: W4 (reskilling, §G4) and W7 (hiring insight, §B9) read these bindings rather than
  // each inventing its own role check.
  it('binds reskilling and hiring insight to real roles', () => {
    expect(OFFICER_ROLES).toContain(RESKILLING_ROLE);
    expect(RESKILLING_ROLE).toBe('professor');
    expect(HIRING_INSIGHT_ROLES).toEqual(['professor', 'head_of_research']);
    for (const role of HIRING_INSIGHT_ROLES) {
      expect(OFFICER_ROLES).toContain(role);
    }
  });
});

describe('OVERSEER_PRESETS', () => {
  // F6: the same four options as before, restated on the new model. F1: same sheet as everyone.
  it('has one valid preset per archetype, inside the recruitment band', () => {
    expect(OVERSEER_PRESETS).toHaveLength(4);
    expect(new Set(OVERSEER_PRESETS.map((p) => p.archetype)).size).toBe(4);
    for (const preset of OVERSEER_PRESETS) {
      expect(() => OverseerPresetSchema.parse(preset)).not.toThrow();
      for (const name of ATTRIBUTE_NAMES) {
        expect(preset.attributes[name]).toBeLessThanOrEqual(MAX_RECRUITMENT_ATTRIBUTE);
      }
      const mean =
        ATTRIBUTE_NAMES.reduce((sum, name) => sum + preset.attributes[name], 0) /
        ATTRIBUTE_NAMES.length;
      expect(mean).toBeGreaterThanOrEqual(15);
      expect(mean).toBeLessThanOrEqual(20);
      for (const trait of preset.traits) {
        expect(TRAIT_IDS).toContain(trait);
      }
    }
  });

  // Pins the one meaning `attributes` has: the *effective* sheet, trait bonuses already in it.
  // The presets are the standing proof: the fixer's negotiation is 35 and silver_tongue grants
  // +8, so reading these as pre-trait would put them at 43, past the §B2a ceiling of 40. Nothing
  // may apply a preset's bonuses a second time, and this fails if someone tries.
  it('stores sheets with trait bonuses already applied', () => {
    const breached = OVERSEER_PRESETS.filter((preset) =>
      ATTRIBUTE_NAMES.some(
        (name) =>
          applyTraitBonuses(preset.attributes, preset.traits)[name] > MAX_RECRUITMENT_ATTRIBUTE,
      ),
    );
    expect(
      breached.map((preset) => preset.presetId),
      'applying a preset trait again breaks §B2a: sheets are post-trait, not raw',
    ).toContain('fixer');
  });
});
