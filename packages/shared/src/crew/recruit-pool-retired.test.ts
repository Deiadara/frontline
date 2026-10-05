import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_EFFECTS,
  EFFECT_CHANNELS,
  LOCATION_CATALOG,
  PERK_CATALOG,
  PERK_BREADTH_BY_KIND,
  RESEARCH_ITEMS,
  UNIFIED_BONUSES,
  noCrewEffects,
} from '../index.js';

/**
 * The Bar's extra seats are gone (maintainer, 2026-09-30): "Remove this completely from the game
 * and replace whatever gives you bonuses towards this with other stuff of your choice."
 *
 * The union type already refuses `recruit_pool` in source, so this guards the other way back in: a
 * catalogue that is data, a cast, or a retired id revived with its old payout. Every catalogue that
 * can carry a bonus is read whole, as text, so a new field holding a bonus is covered as well.
 */
const SOURCES = {
  perks: PERK_CATALOG,
  research: RESEARCH_ITEMS,
  locations: LOCATION_CATALOG,
  unified: UNIFIED_BONUSES,
  attributes: ATTRIBUTE_EFFECTS,
  breadth: PERK_BREADTH_BY_KIND,
};

describe('the retired recruit pool', () => {
  it('is paid by nothing in the game', () => {
    for (const [name, catalogue] of Object.entries(SOURCES)) {
      const text = JSON.stringify(catalogue);
      expect(text, name).not.toContain('recruit_pool');
      expect(text, name).not.toContain('recruitPool');
    }
  });

  it('is not a channel a crew can hold', () => {
    expect(EFFECT_CHANNELS as readonly string[]).not.toContain('recruitPoolPercent');
    expect(Object.keys(noCrewEffects())).not.toContain('recruitPoolPercent');
  });
});
