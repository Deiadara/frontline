import { describe, expect, it } from 'vitest';
import {
  UNIT_MODIFICATIONS,
  type UnitModificationRarity,
  type UnitModificationSpec,
} from '../units/modifications.js';
import { BLUEPRINTS, type BlueprintSpec } from './catalog.js';
import { blueprintForUnitUpgrade, blueprintGateMet } from './requirements.js';

/**
 * The twenty-eight drawings behind the unit modification cards.
 *
 * `units/modifications.ts` says which cards want a document and cannot say which document: it sits
 * below `blueprints/` in the import graph and takes the answer as a predicate. So the catalogue
 * there and the catalogue here have to agree by test, and the failure is quiet in both directions.
 * A gated card with no document is open, because `blueprintGateMet` treats an unnamed target as
 * one nothing gates, and that is the hole these documents were written to close. An open card
 * with a document is a first-day card a crew cannot build.
 */

const GATED: readonly UnitModificationSpec[] = UNIT_MODIFICATIONS.filter(
  (spec) => spec.requiresBlueprint,
);
const OPEN: readonly UnitModificationSpec[] = UNIT_MODIFICATIONS.filter(
  (spec) => !spec.requiresBlueprint,
);

function documentsTargeting(modificationId: string): readonly BlueprintSpec[] {
  return BLUEPRINTS.filter((spec) =>
    spec.targets.some((target) => target.kind === 'unit_upgrade' && target.id === modificationId),
  );
}

/**
 * Pages by rarity, off the §D bands the catalogue module doc lays out. A masterpiece is the top of
 * the "engineered" band or the bottom of the "one of a kind" one, so it gets a range.
 */
const PAGES_BY_RARITY: Readonly<Record<UnitModificationRarity, readonly number[]>> = {
  basic: [2],
  intricate: [3],
  advanced: [4],
  masterpiece: [5, 6],
};

describe('the unit modification documents (§D12g, second model)', () => {
  /**
   * Pinned so the rest of this file cannot pass on an empty catalogue. Every other test here is a
   * loop over `GATED` or `OPEN`, and a loop over nothing asserts nothing.
   */
  it('has twenty-eight gated cards and three open ones to check', () => {
    expect(UNIT_MODIFICATIONS).toHaveLength(31);
    expect(GATED).toHaveLength(28);
    expect(OPEN.map((spec) => spec.id)).toEqual(['taped_grips', 'scrap_vest', 'broken_in_boots']);
  });

  it('gives every gated card exactly one upgrade document, and the open cards none', () => {
    for (const spec of GATED) {
      const documents = documentsTargeting(spec.id);
      expect(
        documents.map((document) => document.id),
        spec.id,
      ).toHaveLength(1);
      expect(documents[0]?.category, spec.id).toBe('upgrade');
      expect(blueprintForUnitUpgrade(spec.id)?.id, spec.id).toBe(documents[0]?.id);
    }
    for (const spec of OPEN) {
      expect(documentsTargeting(spec.id), spec.id).toEqual([]);
      expect(blueprintForUnitUpgrade(spec.id), spec.id).toBeUndefined();
    }
  });

  it('gives a document as many pages as the card is rare', () => {
    for (const spec of GATED) {
      const document = blueprintForUnitUpgrade(spec.id);
      expect(document, spec.id).toBeDefined();
      if (!document) continue;
      expect(
        PAGES_BY_RARITY[spec.rarity],
        `${document.id} has ${document.pages.length} pages for a ${spec.rarity} card`,
      ).toContain(document.pages.length);
    }
  });

  /**
   * The hole itself. Before the documents existed this answered true for all of them, which
   * is `blueprintGateMet` doing what it says: nothing named the id, so nothing gated it.
   */
  it('shuts the gate on every gated card until its document is unlocked, and leaves the open ones open', () => {
    for (const spec of GATED) {
      expect(blueprintGateMet({}, 'unit_upgrade', spec.id), spec.id).toBe(false);
      const document = blueprintForUnitUpgrade(spec.id);
      if (!document) continue;
      expect(blueprintGateMet({ [document.id]: 1 }, 'unit_upgrade', spec.id), spec.id).toBe(true);
    }
    for (const spec of OPEN) {
      expect(blueprintGateMet({}, 'unit_upgrade', spec.id), spec.id).toBe(true);
    }
  });
});
