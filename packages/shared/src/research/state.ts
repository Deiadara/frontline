import { z } from 'zod';
import { ActiveResearchSchema } from './projects.js';

/**
 * Everything the crew has put into research and got out of it (GDD §C).
 *
 * Stored per base in `bases.research_json`. `active` is the one project in flight, or nothing;
 * `technologies` is what the Lab has finished and only ever grows.
 */
export const ResearchStateSchema = z.object({
  /** One project at a time: the crew has one Lab, not a department. */
  active: ActiveResearchSchema.nullable(),
  /**
   * The Lab's finished standing programmes.
   *
   * Defaulted, so a district written before the Lab had a tech tree parses without a migration:
   * `research_json` is already a JSON column and this is a new key inside it, not a new column.
   */
  technologies: z.array(z.string()).default([]),
});
export type ResearchState = z.infer<typeof ResearchStateSchema>;

/** A crew that has never researched anything has nothing finished and nothing running. */
export function startingResearch(): ResearchState {
  return { active: null, technologies: [] };
}
