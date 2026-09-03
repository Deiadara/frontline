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
import { PERK_CATALOG, PERK_CATEGORIES, findPerk } from './crew/perks.js';

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
    expect(AttributesSchema.safeParse({ ...DEFAULT_ATTRIBUTES, signals: -1 }).success).toBe(false);
    expect(AttributesSchema.safeParse({ ...DEFAULT_ATTRIBUTES, signals: 101 }).success).toBe(false);
    expect(AttributesSchema.safeParse({ ...DEFAULT_ATTRIBUTES, signals: 10.5 }).success).toBe(
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

describe('PERK_CATALOG', () => {
  it('is a hundred-odd distinct perks, each with a name, a line and a category', () => {
    expect(PERK_CATALOG.length).toBeGreaterThanOrEqual(100);
    const ids = PERK_CATALOG.map((entry) => entry.id);
    // The ids are what a save stores, so a duplicate is two different perks sharing a slot: the
    // second would silently win the `Map` lookup and the first would never apply again.
    expect(new Set(ids).size, 'duplicate perk id').toBe(ids.length);
    for (const entry of PERK_CATALOG) {
      expect(entry.name.length, entry.id).toBeGreaterThan(0);
      expect(entry.description.length, entry.id).toBeGreaterThan(0);
      expect(PERK_CATEGORIES, entry.id).toContain(entry.category);
    }
  });

  it('grants something on every entry, and nothing on an id it does not carry', () => {
    for (const entry of PERK_CATALOG) {
      // Every bonus is a discriminated union member with one numeric payload. A perk whose
      // magnitude is zero is a keyword that reads as a bonus and does nothing.
      const magnitude = Object.entries(entry.bonus)
        .filter(([key]) => key !== 'kind')
        .map(([, value]) => value)
        .find((value) => typeof value === 'number');
      expect(magnitude, `${entry.id} grants nothing`).toBeGreaterThan(0);
    }
    expect(findPerk('not_a_perk')).toBeUndefined();
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
      for (const id of preset.perks) {
        expect(findPerk(id), `${preset.presetId} carries an unknown perk ${id}`).toBeDefined();
      }
    }
  });

  /*
   * The hazard this replaces is worth recording, because the fix was structural rather than a
   * test.
   *
   * A trait moved the character's *own* attributes, so a stored sheet was ambiguous: pre-trait or
   * post-trait, and applying the bonuses a second time pushed the fixer's Negotiation past the
   * §B2a ceiling. A whole test existed to pin which of the two a preset held. A perk cannot create
   * that question, because it never touches the sheet of the person carrying it: it goes into the
   * crew's effects. So the invariant now is the simpler one, that a sheet is just a sheet.
   */
  it('stores sheets that are already inside the recruitment ceiling, perks or not', () => {
    for (const preset of OVERSEER_PRESETS) {
      for (const name of ATTRIBUTE_NAMES) {
        expect(preset.attributes[name], `${preset.presetId}.${name}`).toBeLessThanOrEqual(
          MAX_RECRUITMENT_ATTRIBUTE,
        );
      }
    }
  });
});
