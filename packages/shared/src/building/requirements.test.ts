import { describe, expect, it } from 'vitest';
import { MAX_EFFECT_REDUCTION } from './effects.js';
import {
  MODIFICATIONS,
  MODIFICATION_RARITY_BANDS,
  MODIFICATION_SLOT_LEVELS,
  findModification,
  modificationFits,
  type ModificationSpec,
} from './modifications.js';
import {
  MODIFICATION_REQUIREMENT_BANDS,
  UNIT_MODIFICATION_HOST,
  modificationRequirement,
  requirementRefusal,
  unitModificationRequirement,
} from './requirements.js';
import { BUILDING_KINDS, levelCeilingFor, type BuildingKind } from './kinds.js';
import { boltInRefusal } from './addons.js';
import { UNIT_MODIFICATIONS } from '../units/modifications.js';
import { OFFICER_MARKS } from '../crew/marks.js';
import { MAX_NOTORIETY } from '../economy/notoriety.js';
import { MODIFICATION_RARITIES } from '../modification-rarity.js';
import type { Building } from './state.js';

/**
 * What a crew has to be before a modification goes into anything (maintainer rulings, 2026-09-16).
 *
 * Two decisions live in these numbers and neither is derivable from the code around them, so they
 * are pinned by name rather than read back out of the tables they came from:
 *
 * - **A BASIC card asks nobody.** The cheap end is about the structures you have raised. Asking for
 *   a particular chair there decided a new crew's first modification by whichever role they had
 *   happened to fill, which is arbitrary rather than strategic on a card worth three per cent.
 * - **The top two grades were lifted** when the gates made them hard to reach, and the reduction
 *   ceiling went up with them so a finished deck is not throwing its third card away.
 */
describe('the four gates', () => {
  const requirementOf = (id: string) => {
    const spec = findModification(id)!;
    return modificationRequirement(spec, spec.building);
  };
  const cardOf = (rarity: string) => MODIFICATIONS.find((spec) => spec.rarity === rarity)!;

  it('asks nobody for a basic card, and the trade’s own officer from intricate up', () => {
    expect(requirementOf(cardOf('basic').id).officer, 'a bolt-on needs a chair filled').toBeNull();
    for (const rarity of ['intricate', 'advanced', 'masterpiece'] as const) {
      const requirement = requirementOf(cardOf(rarity).id);
      expect(requirement.officer, rarity).not.toBeNull();
      expect(requirement.officer?.mark, rarity).toBe(MODIFICATION_REQUIREMENT_BANDS[rarity].mark);
    }
  });

  /**
   * A crew with no officers at all, which is every crew on its first evening (`crew/starting.ts`).
   *
   * The whole point of the ruling: the opening move is available. A basic card is refused for the
   * structure or the crew's level and never for the roster, and an intricate one still is.
   */
  it('lets a crew with nobody hired fit a basic card, and no better', () => {
    const basic = requirementOf(cardOf('basic').id);
    expect(
      requirementRefusal({
        requirement: basic,
        buildingLevel: basic.buildingLevel,
        crewLevel: basic.crewLevel,
        officerMark: null,
      }),
    ).toBeNull();

    const intricate = requirementOf(cardOf('intricate').id);
    expect(
      requirementRefusal({
        requirement: intricate,
        buildingLevel: intricate.buildingLevel,
        crewLevel: intricate.crewLevel,
        officerMark: null,
      }),
    ).toBe('no_officer');
  });

  /**
   * The level a basic card asks for is the level its bracket opens at.
   *
   * It asked for two, and the first bracket opens at five, so the card printed a gate that was
   * never the reason anybody was refused. A requirement line that is not the binding one is worse
   * than no line: it sends a player to raise a structure that was already tall enough.
   */
  it('asks for the level the first bracket actually opens at', () => {
    expect(MODIFICATION_REQUIREMENT_BANDS.basic.buildingLevel).toBe(MODIFICATION_SLOT_LEVELS[0]);
  });
});

describe('what the top grades are worth', () => {
  it('pays a masterpiece enough that three of them are worth a full deck', () => {
    // Lifted on 2026-09-16: 12-16 became 14-18, and 18-22 became 24-28.
    expect(MODIFICATION_RARITY_BANDS.advanced).toEqual({ min: 14, max: 18 });
    expect(MODIFICATION_RARITY_BANDS.masterpiece).toEqual({ min: 24, max: 28 });
    // ...and the grades still do not meet in the middle, which is what the words promise.
    expect(MODIFICATION_RARITY_BANDS.advanced.min).toBeGreaterThan(
      MODIFICATION_RARITY_BANDS.intricate.max,
    );
    expect(MODIFICATION_RARITY_BANDS.masterpiece.min).toBeGreaterThan(
      MODIFICATION_RARITY_BANDS.advanced.max,
    );
  });

  /**
   * The ceiling moved with them, which is the half that is easy to forget.
   *
   * Three masterpiece cards of one reduction family come to 72. At a ceiling of 60 the third card
   * was paying for two points, so making the grade harder to reach and dearer to cut would have
   * made the climb worth *less* than before. The ceiling still bites, and that is deliberate.
   */
  it('leaves a deck of three masterpieces mostly inside the reduction ceiling', () => {
    const deck = MODIFICATION_RARITY_BANDS.masterpiece.min * 3;
    expect(deck, 'three of the weakest masterpieces').toBeGreaterThan(MAX_EFFECT_REDUCTION);
    // Within ten points of the cap rather than twelve past it: the overflow is a trim, not a waste.
    expect(deck - MAX_EFFECT_REDUCTION).toBeLessThanOrEqual(10);
  });
});

/**
 * No band may ask a structure for a rung it does not have (bug pass, 2026-09-18).
 *
 * The bands are written against a twenty-rung structure, and the Garage and the Infirmary stop at
 * ten (`BUILDING_LEVEL_CEILINGS`). Nothing held the two tables together, so ADVANCED asked for 12
 * and MASTERPIECE for 17 on plots whose last rung is 10: twenty-eight card and structure pairs
 * that could never be installed, four of them on the Garage's own bench and three on the
 * Infirmary's. The bench listed them anyway and printed "The Garage has to reach level 12".
 *
 * The first test here is the one that would have caught all twenty-eight, and it is written over
 * the catalogue rather than over the two ids, so the next structure to get a ceiling is covered
 * the day it gets one.
 */
describe('a card asks for a level its host structure can reach', () => {
  const marked = OFFICER_MARKS.at(-1)!;
  const standing = (kind: BuildingKind, level: number): Building => ({
    id: `b-${kind}`,
    kind,
    level,
    modifications: [],
  });

  /** A crew with everything but the structure: only the building gate can answer here. */
  const boltInAt = (spec: ModificationSpec, kind: BuildingKind, level: number) =>
    boltInRefusal({
      spec,
      kind,
      yardLevel: levelCeilingFor('scrapyard'),
      blueprintUnlocked: () => true,
      buildings: [standing(kind, level), standing('scrapyard', levelCeilingFor('scrapyard'))],
      crewLevel: 99,
      notoriety: MAX_NOTORIETY,
      markFor: () => marked,
      affordable: () => true,
    });

  it('leaves no card and structure pair that can never be installed', () => {
    const dead: string[] = [];
    let pairs = 0;
    for (const spec of MODIFICATIONS) {
      for (const kind of BUILDING_KINDS) {
        if (!modificationFits(spec, kind)) continue;
        pairs += 1;
        const asked = modificationRequirement(spec, kind).buildingLevel;
        if (asked > levelCeilingFor(kind)) {
          dead.push(`${spec.id} in ${kind} asks for ${asked}, ceiling ${levelCeilingFor(kind)}`);
        }
      }
    }
    expect(dead, dead.join('\n')).toEqual([]);
    // A guard on the guard: a `fits` rule that stopped matching would make the loop vacuous.
    expect(pairs, 'no card fits anywhere').toBeGreaterThan(MODIFICATIONS.length);
  });

  /** The same for the unit bench, whose one host is the Gauntlet. */
  it('leaves no unit card asking the Gauntlet for a rung it does not have', () => {
    const ceiling = levelCeilingFor(UNIT_MODIFICATION_HOST);
    for (const spec of UNIT_MODIFICATIONS) {
      expect(unitModificationRequirement(spec).buildingLevel, spec.id).toBeLessThanOrEqual(ceiling);
    }
    expect(UNIT_MODIFICATIONS.length).toBeGreaterThan(20);
  });

  /**
   * The maintainer's shape, in the numbers: "you have the one before and then you get both at
   * level 10 instead of it being level 20".
   *
   * Pinned per rarity rather than read back out of the band table, because the point is what a
   * ten-rung structure asks for and the band table is what it asks *instead of*.
   */
  it('opens both top bands at ten on a ten-rung structure, and moves nothing below them', () => {
    for (const kind of ['garage', 'infirmary'] as const) {
      expect(levelCeilingFor(kind), `${kind} is the ten-rung case`).toBe(10);
      const asks = Object.fromEntries(
        MODIFICATION_RARITIES.map((rarity) => [
          rarity,
          modificationRequirement({ rarity, effect: 'production_percent' }, kind).buildingLevel,
        ]),
      );
      expect(asks, kind).toEqual({ basic: 5, intricate: 7, advanced: 10, masterpiece: 10 });
    }
  });

  it('leaves a twenty-rung structure on the band table', () => {
    for (const rarity of MODIFICATION_RARITIES) {
      expect(
        modificationRequirement({ rarity, effect: 'production_percent' }, 'quarters').buildingLevel,
        rarity,
      ).toBe(MODIFICATION_REQUIREMENT_BANDS[rarity].buildingLevel);
    }
  });

  /** A hand-written override past the ceiling is the same dead pair, written by hand. */
  it('brings a per-card override inside the ceiling too', () => {
    const asked = modificationRequirement(
      { rarity: 'basic', effect: 'production_percent', requires: { buildingLevel: 18 } },
      'garage',
    ).buildingLevel;
    expect(asked).toBe(levelCeilingFor('garage'));
  });

  /**
   * And the same answer through the door a player presses, which is the half a pure-function test
   * cannot see: `boltInRefusal` has to read the requirement against the structure being fitted,
   * not against the structure the card calls home.
   */
  it('lets a maxed Garage take its own masterpiece, and one visiting from a taller structure', () => {
    const home = MODIFICATIONS.find(
      (spec) => spec.building === 'garage' && spec.rarity === 'masterpiece',
    )!;
    const visitor = MODIFICATIONS.find(
      (spec) =>
        spec.building !== 'garage' &&
        spec.rarity === 'masterpiece' &&
        modificationFits(spec, 'garage') &&
        levelCeilingFor(spec.building) > levelCeilingFor('garage'),
    )!;
    expect(boltInAt(home, 'garage', levelCeilingFor('garage')), home.id).toBeNull();
    expect(boltInAt(visitor, 'garage', levelCeilingFor('garage')), visitor.id).toBeNull();
    // And the gate still bites one rung down, so the test above is not passing on a dead gate.
    expect(boltInAt(home, 'garage', levelCeilingFor('garage') - 1), home.id).toBe(
      'building_too_low',
    );
  });
});
