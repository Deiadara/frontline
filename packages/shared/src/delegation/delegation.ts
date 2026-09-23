import { z } from 'zod';

/**
 * How hard a job is (GDD §G6).
 *
 * All that is left of a module that used to hold the staffing economy: the assignee pool, the §G7
 * bonus table, and then the officer gate that replaced them. Who leads a run and what that is
 * worth is `missions.leading.ts` now, and it reads the same for every job: somebody leads it, or
 * the crew has researched how to go without and pays for it in the odds. Difficulty is still
 * authored on the template and still read all over the board, for the page prize and for what a
 * card says it is asking of a crew, so the enum stays here where every reader already imports it.
 */

export const MissionDifficultySchema = z.enum(['easy', 'hard']);
