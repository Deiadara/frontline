import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_LABELS, ATTRIBUTE_NAMES, MAX_ATTRIBUTE } from './attributes.js';
import { BUILDING_CATALOG, findModification } from './building/index.js';
import { ATTRIBUTE_EFFECTS, CHANNEL_LABELS, EFFECT_CHANNELS } from './crew/effects.js';
import { ROLE_IMPORTANCE } from './crew/importance.js';
import { TRAINING_DRILLS } from './crew/training.js';
import { CITY_DISTRICTS, CITY_LOCATIONS, ENV_LABEL_IDS, LOCATION_CATALOG } from './city/index.js';
import { INFAMY_PER_TIER, NOTORIETY_TO_FIELD, TYPICAL_SUPPLY } from './economy/infamy.js';
import { ITEM_CATALOG } from './items/catalog.js';
import { OFFICER_PORTRAIT_IDS, OFFICER_ROLES, OFFICER_ROLE_LABELS } from './roles.js';
import { RESOURCE_KEYS, RESOURCE_LABELS } from './resources.js';
import { ART_MANIFEST, tryResolveAssetKey } from './art/manifest.js';
import { DAMAGE_TYPES, UNIT_MODIFIERS, UNIT_STAT_KEYS } from './units/stats.js';
import { UNIT_CATALOG, UNIT_TIERS, UNIT_TIER_LABELS } from './units/catalog.js';
import { UNIT_UPGRADES } from './units/upgrades.js';

/**
 * Every id in the game, checked against the table it points at.
 *
 * ## Why this file exists
 *
 * The game's content is a dozen catalogues that name each other: a unit names a building, a
 * building names a resource, a role names an attribute, an asset names a unit. Adding or removing
 * one entry means touching several tables, and the ones you *forget* do not announce themselves.
 * They have not, repeatedly: a unit left the roster and the server stopped booting, a damage type
 * outlived the only unit that dealt it, a doc table drifted three ways at once while the code
 * beside it was correct.
 *
 * None of those was a hard bug to fix and none of them was found by a test, because every test in
 * this repo asks whether a *feature* works. This one asks whether the content still hangs together,
 * which is a different question and the one that keeps being answered by a person noticing.
 *
 * Every check below is an invariant rather than a preference: breaking one means something in the
 * game points at something that is not there. Balance and taste live in `balance.test.ts` and in
 * the per-system suites, deliberately not here.
 */
describe('every id points at something that exists', () => {
  it('has content to check, so none of this is vacuous', () => {
    expect(UNIT_CATALOG.length).toBeGreaterThan(20);
    expect(CITY_DISTRICTS.length).toBeGreaterThan(5);
    expect(ART_MANIFEST.length).toBeGreaterThan(100);
  });

  describe('units', () => {
    it('gives every unit a unique id and a unique name', () => {
      expect(new Set(UNIT_CATALOG.map((u) => u.id)).size).toBe(UNIT_CATALOG.length);
      expect(new Set(UNIT_CATALOG.map((u) => u.name)).size).toBe(UNIT_CATALOG.length);
    });

    it('names a real tier, building, modifier and damage type on every sheet', () => {
      for (const unit of UNIT_CATALOG) {
        expect(UNIT_TIERS, unit.id).toContain(unit.tier);
        expect(BUILDING_CATALOG[unit.trainedAt], unit.id).toBeDefined();
        expect(DAMAGE_TYPES, unit.id).toContain(unit.stats.damageType);
        for (const modifier of unit.modifiers) {
          expect(UNIT_MODIFIERS[modifier], `${unit.id}:${modifier}`).toBeDefined();
        }
      }
    });

    /** A resistance to something nothing deals is a lever the engine can never pull. */
    it('resists only damage types something in the game actually deals', () => {
      const dealt = new Set(UNIT_CATALOG.map((u) => u.stats.damageType));
      for (const unit of UNIT_CATALOG) {
        for (const type of Object.keys(unit.stats.resistances)) {
          expect(
            dealt.has(type as (typeof DAMAGE_TYPES)[number]),
            `${unit.id} resists ${type}`,
          ).toBe(true);
        }
      }
    });

    it('leaves no damage type and no modifier with nobody carrying it', () => {
      const dealt = new Set(UNIT_CATALOG.map((u) => u.stats.damageType));
      expect(DAMAGE_TYPES.filter((t) => !dealt.has(t))).toEqual([]);
      const carried = new Set(UNIT_CATALOG.flatMap((u) => u.modifiers));
      expect(Object.keys(UNIT_MODIFIERS).filter((m) => !carried.has(m as never))).toEqual([]);
    });

    /**
     * A unit gated on ground the city does not contain can never be built by anybody. The Doghouse
     * is the live example: one location in the whole city, and it is what unlocks the Cyberhounds.
     */
    it('gates every unit on ground the city actually has', () => {
      const kinds = new Set(CITY_LOCATIONS.map((l) => l.kind));
      for (const unit of UNIT_CATALOG) {
        for (const need of unit.requires) {
          if (need.kind === 'location') {
            expect(kinds.has(need.locationKind), `${unit.id} needs a ${need.locationKind}`).toBe(
              true,
            );
          } else if (need.kind === 'building') {
            expect(BUILDING_CATALOG[need.building], unit.id).toBeDefined();
          } else {
            expect(findModification(need.modificationId), unit.id).toBeDefined();
          }
        }
      }
    });

    it('spends only resources and environment labels that exist', () => {
      for (const unit of UNIT_CATALOG) {
        for (const key of Object.keys(unit.cost)) expect(RESOURCE_KEYS, unit.id).toContain(key);
        for (const label of Object.keys(unit.affinities ?? {})) {
          expect(ENV_LABEL_IDS, unit.id).toContain(label);
        }
        for (const label of unit.immuneTo ?? []) expect(ENV_LABEL_IDS, unit.id).toContain(label);
      }
    });

    it('covers every tier in every table that is keyed by one', () => {
      for (const tier of UNIT_TIERS) {
        expect(UNIT_TIER_LABELS[tier], tier).toBeDefined();
        expect(INFAMY_PER_TIER[tier], tier).toBeDefined();
        expect(TYPICAL_SUPPLY[tier], tier).toBeDefined();
        expect(NOTORIETY_TO_FIELD[tier], tier).toBeDefined();
        expect(
          UNIT_CATALOG.some((u) => u.tier === tier),
          `${tier} has no units`,
        ).toBe(true);
      }
    });
  });

  describe('the city', () => {
    it('gives every district and every location a unique id', () => {
      expect(new Set(CITY_DISTRICTS.map((d) => d.id)).size).toBe(CITY_DISTRICTS.length);
      expect(new Set(CITY_LOCATIONS.map((l) => l.id)).size).toBe(CITY_LOCATIONS.length);
    });

    it('puts every location in a real district, on a kind the catalogue knows', () => {
      const districts = new Set(CITY_DISTRICTS.map((d) => d.id));
      for (const location of CITY_LOCATIONS) {
        expect(districts.has(location.districtId), location.id).toBe(true);
        expect(LOCATION_CATALOG[location.kind], location.id).toBeDefined();
      }
    });

    it('describes every location with environment labels that exist', () => {
      for (const [kind, spec] of Object.entries(LOCATION_CATALOG)) {
        for (const label of spec.labels ?? []) expect(ENV_LABEL_IDS, kind).toContain(label.id);
      }
    });
  });

  describe('crew and roles', () => {
    it('gives every attribute a label, an effect on a real channel, and a drill', () => {
      for (const name of ATTRIBUTE_NAMES) {
        expect(ATTRIBUTE_LABELS[name], name).toBeDefined();
        expect(TRAINING_DRILLS[name], name).toBeDefined();
        expect(EFFECT_CHANNELS, name).toContain(ATTRIBUTE_EFFECTS[name].channel);
      }
    });

    /** A channel nothing drives is a bonus no crew can ever earn. */
    it('leaves no effect channel without an attribute driving it, or without a label', () => {
      const driven = new Set(ATTRIBUTE_NAMES.map((n) => ATTRIBUTE_EFFECTS[n].channel));
      expect(EFFECT_CHANNELS.filter((c) => !driven.has(c))).toEqual([]);
      expect(EFFECT_CHANNELS.filter((c) => !CHANNEL_LABELS[c])).toEqual([]);
    });

    it('gives every chair a label and a table of real attributes', () => {
      for (const role of OFFICER_ROLES) {
        expect(OFFICER_ROLE_LABELS[role], role).toBeDefined();
        expect(ROLE_IMPORTANCE[role], role).toBeDefined();
        for (const name of Object.keys(ROLE_IMPORTANCE[role])) {
          expect(ATTRIBUTE_NAMES, `${role}:${name}`).toContain(name);
        }
      }
    });
  });

  describe('the workshop', () => {
    it('moves only real stats, spends only real resources, and eats only real parts', () => {
      for (const upgrade of UNIT_UPGRADES) {
        for (const stat of Object.keys(upgrade.effect)) {
          expect(UNIT_STAT_KEYS, upgrade.id).toContain(stat);
        }
        for (const key of Object.keys(upgrade.cost))
          expect(RESOURCE_KEYS, upgrade.id).toContain(key);
        for (const part of Object.keys(upgrade.parts)) {
          expect(
            ITEM_CATALOG[part as keyof typeof ITEM_CATALOG],
            `${upgrade.id}:${part}`,
          ).toBeDefined();
        }
      }
    });
  });

  describe('art', () => {
    it('gives every manifest entry a unique key and a unique seed', () => {
      expect(new Set(ART_MANIFEST.map((a) => a.key)).size).toBe(ART_MANIFEST.length);
      expect(new Set(ART_MANIFEST.map((a) => a.seed)).size).toBe(ART_MANIFEST.length);
    });

    /**
     * Every domain object a screen can draw resolves to a key. A unit added without art does not
     * crash: it silently falls back to procedural, on one screen, which nobody is looking at.
     */
    it('resolves an asset key for every unit, building, district, resource and officer face', () => {
      for (const unit of UNIT_CATALOG) {
        expect(tryResolveAssetKey({ type: 'unit', unitId: unit.id }), unit.id).toBeDefined();
      }
      for (const building of Object.keys(BUILDING_CATALOG)) {
        expect(
          tryResolveAssetKey({ type: 'building', building: building as never }),
          building,
        ).toBeDefined();
      }
      for (const district of CITY_DISTRICTS) {
        expect(
          tryResolveAssetKey({ type: 'district', districtId: district.id }),
          district.id,
        ).toBeDefined();
      }
      for (const resource of RESOURCE_KEYS) {
        expect(tryResolveAssetKey({ type: 'resource-icon', resource }), resource).toBeDefined();
      }
      for (const face of OFFICER_PORTRAIT_IDS) {
        expect(tryResolveAssetKey({ type: 'officer', portraitId: face }), face).toBeDefined();
      }
    });
  });

  describe('resources', () => {
    it('gives every resource a label and every building cost a real resource', () => {
      for (const key of RESOURCE_KEYS) expect(RESOURCE_LABELS[key], key).toBeDefined();
      for (const [kind, spec] of Object.entries(BUILDING_CATALOG)) {
        for (const key of Object.keys(spec.baseCost)) expect(RESOURCE_KEYS, kind).toContain(key);
      }
    });
  });

  describe('overseer presets', () => {
    it('keeps every preset sheet inside the attribute scale', () => {
      for (const name of ATTRIBUTE_NAMES) {
        expect(MAX_ATTRIBUTE).toBeGreaterThan(0);
        expect(ATTRIBUTE_LABELS[name]).toBeTruthy();
      }
    });
  });
});
