import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../items/catalog.js';
import { addItems, type ItemCost } from '../items/inventory.js';
import { BLACK_MARKET_GOODS } from '../market/blackmarket.js';
import {
  UNIT_MODIFICATIONS,
  findUnitModification,
  unitModificationPower,
} from '../units/modifications.js';
import { BLUEPRINTS, type BlueprintSpec } from './catalog.js';
import { blueprintGateMet } from './requirements.js';
import { blueprintStatus } from './state.js';

/**
 * The fence's four documents (maintainer, 2026-09-28): blueprints for modifications that only the
 * black market unlocks, and that are good.
 *
 * The four blueprint lots used to hand over pre-war documents that opened nothing. Each now sells
 * a whole document for a masterpiece unit card, and nothing else in the game carries that document.
 */
const FENCE_DOCUMENTS = (BLUEPRINTS as readonly BlueprintSpec[]).filter((spec) => spec.fenceOnly);
const BLUEPRINT_LOTS = Object.values(BLACK_MARKET_GOODS).filter(
  (good) => good.kind === 'blueprint',
);

const lotsGranting = (documentId: string) =>
  BLUEPRINT_LOTS.filter((good) => good.grants?.[documentId as never]);

describe('the fence’s own blueprints', () => {
  it('has four, one behind each of the fence’s blueprint lots', () => {
    expect(FENCE_DOCUMENTS).toHaveLength(4);
    expect(BLUEPRINT_LOTS).toHaveLength(4);
    for (const document of FENCE_DOCUMENTS) {
      expect(lotsGranting(document.id), document.id).toHaveLength(1);
    }
    // And the other way: no blueprint lot sells anything but one of these.
    for (const lot of BLUEPRINT_LOTS) {
      const granted = Object.keys(lot.grants ?? {});
      expect(granted, lot.id).toHaveLength(1);
      expect(
        FENCE_DOCUMENTS.map((document) => document.id),
        lot.id,
      ).toContain(granted[0]);
    }
  });

  it('is sold by nobody else: no pages to drop, and not a good the Runner or a bin can draw', () => {
    for (const document of FENCE_DOCUMENTS) {
      expect(document.pages, document.id).toEqual([]);
      expect(ITEM_IDS as readonly string[], document.id).not.toContain(document.id);
    }
  });

  it('arrives unlocked, and opens its card at the yard the moment it lands', () => {
    for (const document of FENCE_DOCUMENTS) {
      const [lot] = lotsGranting(document.id);
      const inventory = addItems({}, lot!.grants as ItemCost);
      expect(blueprintStatus(inventory, document), document.id).toBe('unlocked');
      for (const target of document.targets) {
        expect(target.kind, document.id).toBe('unit_upgrade');
        expect(blueprintGateMet({}, 'unit_upgrade', target.id), target.id).toBe(false);
        expect(blueprintGateMet(inventory, 'unit_upgrade', target.id), target.id).toBe(true);
      }
    }
  });

  /** "And are good": no masterpiece a crew can assemble out of pages beats one of these. */
  it('puts a card behind each one that no paged masterpiece outclasses', () => {
    const fenceCards = new Set(
      FENCE_DOCUMENTS.flatMap((document) => document.targets.map((target) => target.id)),
    );
    const pagedBest = Math.max(
      ...UNIT_MODIFICATIONS.filter(
        (spec) => spec.rarity === 'masterpiece' && !fenceCards.has(spec.id),
      ).map(unitModificationPower),
    );
    for (const id of fenceCards) {
      const card = findUnitModification(id);
      expect(card?.rarity, id).toBe('masterpiece');
      expect(unitModificationPower(card!), id).toBeGreaterThanOrEqual(pagedBest);
    }
  });

  /** The lot's copy is the only place a player reads what they are bidding infamy on. */
  it('states every number of the card on the lot', () => {
    for (const document of FENCE_DOCUMENTS) {
      const [lot] = lotsGranting(document.id);
      const card = findUnitModification(document.targets[0]!.id)!;
      for (const [key, delta] of Object.entries(card.effect)) {
        expect(lot!.effect, `${lot!.id} leaves out ${key}`).toContain(`+${delta as number}`);
      }
    }
  });
});
