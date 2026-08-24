import { z } from 'zod';
import { DiscoveredFactSchema, factKey, type DiscoveredFact } from './facts.js';
import { ActiveResearchSchema } from './projects.js';

/**
 * Everything the crew has put into research and got out of it (GDD §B9).
 *
 * Stored per base in `bases.research_json`. `facts` is the player's earned knowledge and only ever
 * grows; `active` is the one project in flight, or nothing.
 */
export const ResearchStateSchema = z.object({
  /** One project at a time — the crew has one Professor, not a department. */
  active: ActiveResearchSchema.nullable(),
  /** Discovered facts, de-duplicated by `factKey`. Never the raw table (§B8a, INTERFACES R4). */
  facts: z.array(DiscoveredFactSchema),
  /**
   * The Lab's finished standing programmes.
   *
   * Defaulted, so a district written before the Lab had a tech tree parses without a migration —
   * `research_json` is already a JSON column and this is a new key inside it, not a new column.
   */
  technologies: z.array(z.string()).default([]),
});
export type ResearchState = z.infer<typeof ResearchStateSchema>;

/** A crew that has never researched anything knows nothing and has nothing running. */
export function startingResearch(): ResearchState {
  return { active: null, facts: [], technologies: [] };
}

/**
 * Files new facts, dropping any the crew already had.
 *
 * De-duplication is on `factKey` rather than object identity so a re-derived fact — the same
 * pairing reached from a different role, say — never shows up twice on the page or eats a slot
 * against `MAX_PAIRINGS`.
 */
export function recordFacts(
  state: ResearchState,
  discovered: readonly DiscoveredFact[],
): ResearchState {
  const known = new Set(state.facts.map(factKey));
  const fresh = discovered.filter((fact) => {
    const key = factKey(fact);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  return fresh.length === 0 ? state : { ...state, facts: [...state.facts, ...fresh] };
}
