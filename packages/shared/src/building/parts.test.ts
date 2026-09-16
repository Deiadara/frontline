import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from './kinds.js';
import { BUILDING_PART_GATES, buildingNeedsParts, buildingParts } from './parts.js';
import { UNIT_MODIFICATIONS } from '../units/modifications.js';
import { ITEM_CATALOG, ITEM_IDS, type ItemId } from '../items/catalog.js';

/**
 * Every part the game sells has somewhere to be spent.
 *
 * This is the relic lesson written down as a gate. Three relics shipped for months with
 * `usedFor: ''` and no code path that consumed them: they dropped, they showed a caps value on a
 * card, and they could never be used for anything. A component is the same shape of thing and one
 * added without a sink would be the same bug, invisible in exactly the same way, because nothing
 * fails when an item is merely useless.
 *
 * The two sinks are the building gates in this file and the `parts` on a unit modification card.
 * Anything else that starts consuming components should be added to `DEMAND` below rather than
 * worked around.
 */

const COMPONENTS = ITEM_IDS.filter((id) => ITEM_CATALOG[id].kind === 'component');

/** Every component the world asks for, counted across a full district and every card in the set. */
const DEMAND = ((): Record<string, number> => {
  const need: Record<string, number> = {};
  for (const levels of Object.values(BUILDING_PART_GATES)) {
    for (const cost of Object.values(levels ?? {})) {
      for (const [id, count] of Object.entries(cost)) need[id] = (need[id] ?? 0) + (count ?? 0);
    }
  }
  for (const card of UNIT_MODIFICATIONS) {
    for (const [id, count] of Object.entries(card.parts ?? {})) {
      need[id] = (need[id] ?? 0) + (count ?? 0);
    }
  }
  return need;
})();

describe('the parts the district and the bench ask for', () => {
  it('gives every component something that actually spends it', () => {
    const stranded = COMPONENTS.filter((id) => (DEMAND[id] ?? 0) === 0);
    expect(stranded, `these drop and can never be used: ${stranded.join(', ')}`).toEqual([]);
  });

  it('asks only for parts that exist, and only for components', () => {
    for (const [kind, levels] of Object.entries(BUILDING_PART_GATES)) {
      for (const [level, cost] of Object.entries(levels ?? {})) {
        for (const [id, count] of Object.entries(cost)) {
          const spec = ITEM_CATALOG[id as ItemId] as { kind: string } | undefined;
          expect(spec, `${kind} at ${level} wants ${id}`).toBeDefined();
          // A gate asking for a blueprint or a trap would be a gate nobody can pass by trading.
          expect(spec?.kind, `${kind} at ${level} wants ${id}`).toBe('component');
          expect(count, `${kind} at ${level} wants ${id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gates a level a structure can actually reach', () => {
    for (const [kind, levels] of Object.entries(BUILDING_PART_GATES)) {
      expect(BUILDING_KINDS, kind).toContain(kind);
      for (const level of Object.keys(levels ?? {})) {
        const at = Number(level);
        // A toll on level 21 is a toll nobody ever pays: the ceiling is 20.
        expect(at, `${kind} at ${level}`).toBeGreaterThan(0);
        expect(at, `${kind} at ${level}`).toBeLessThanOrEqual(20);
      }
    }
  });

  it('stays sparse: most levels of most structures ask for nothing', () => {
    const gated = BUILDING_KINDS.flatMap((kind) =>
      Array.from({ length: 20 }, (_, at) => buildingNeedsParts(kind, at + 1)),
    ).filter(Boolean).length;
    // The module's own rule: parts are the five or six moments where the answer to "why can I not
    // build this" is a name rather than a number. A game where every level is a shopping trip is a
    // game about shopping.
    expect(gated).toBeLessThan(BUILDING_KINDS.length * 3);
    expect(gated).toBeGreaterThan(5);
  });

  it('answers with nothing for a level that is not a gate', () => {
    expect(buildingParts('nexus', 5)).toEqual({});
    expect(buildingNeedsParts('nexus', 5)).toBe(false);
  });
});
