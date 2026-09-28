import type { Repositories } from '../db/repos/index.js';
import { settleMoves } from '../moves/moves.js';

/**
 * Lands every column still walking, as if the clock had run on until everybody was home.
 *
 * Survivors of a fight, units pulled out of one and postings whose alliance ended all walk home on
 * the clock now (maintainer, 2026-09-28), so a test that asks "is the roster whole again" has to let
 * them arrive first. Settled three times, a century apart, because a landing can start a walk of
 * its own: a column reaching ground that will not have it turns for home from there.
 */
export function everybodyHome(repos: Repositories): void {
  for (const year of [2100, 2200, 2300])
    settleMoves(repos, new Date(`${year}-01-01T00:00:00.000Z`));
}
