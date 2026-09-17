import { describe, expect, it } from 'vitest';
import { MAX_EFFECT_REDUCTION } from './effects.js';
import {
  MODIFICATIONS,
  MODIFICATION_RARITY_BANDS,
  MODIFICATION_SLOT_LEVELS,
  findModification,
} from './modifications.js';
import {
  MODIFICATION_REQUIREMENT_BANDS,
  modificationRequirement,
  requirementRefusal,
} from './requirements.js';

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
  const requirementOf = (id: string) => modificationRequirement(findModification(id)!);
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
