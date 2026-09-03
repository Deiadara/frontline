import type { SkirmishEngine } from '@frontline/shared';
import { settleBattles } from '../battle/resolve.js';
import { settleMovements } from '../battle/movement.js';
import { settleFortifications } from '../city/actions.js';
import { settleCapturedGates } from '../city/gates.js';
import { settleScouting } from '../scouting/scouting.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The order the shared world settles in, in one place.
 *
 * There were four of these: `routes/city.ts` ran fortifications, scouting, gates, battles;
 * `battle/routes.ts` ran fortifications, movements, battles; `live/clock.ts` ran fortifications,
 * movements, battles, crews, scouting, gates; and `routes/units.ts` ran fortifications alone. The
 * tick's own comment said it used "the same order the read paths use", and no two of the three
 * agreed.
 *
 * The differences decided fights. The world clock only runs from `index.ts`, so any restart, deploy
 * gap or test-built app leaves the first request to arrive as the settler. If that request was a
 * city page, `settleBattles` ran without `settleMovements`, and a defender's column that landed at
 * 20:45 was not in the 21:00 fight; if it was a battle page, the same fight was decided with those
 * units in the line. And neither read path settled captured gates before battles, so a wall that
 * finished an hour before the mark was not standing when the mark came.
 *
 * The order is an argument, not a list, and each step is here because of what the step after it
 * reads:
 *
 * 1. **Fortifications**, because ground that finished digging in before the mark is dug in when it
 *    is attacked.
 * 2. **Movements**, because a column whose march ended before the mark is *in* the district, and
 *    settling the fight first would resolve it without those bodies and land the reinforcements in
 *    a battle that is already over.
 * 3. **Captured gates**, because a gate that finished going up before the mark changes how hard
 *    that ground is to take, and it changes it for somebody else.
 * 4. **Battles**, which read all three.
 * 5. **Crews coming home** and **scouting**, which read nothing above them and write receipts. Last
 *    because a receipt only has to arrive, not to arrive in any particular order.
 *
 * Crews coming home is passed in rather than imported, because it lives in `live/clock.ts` with the
 * missions half of the tick and importing it here would be a cycle.
 */
export function settleWorld(
  repos: Repositories,
  engine: SkirmishEngine,
  now: Date,
  /** Optional: only the world clock brings crews home, so a page load does not pay for it. */
  bringCrewsHome?: (repos: Repositories, now: Date) => void,
): number {
  settleFortifications(repos, now);
  settleMovements(repos, now);
  settleCapturedGates(repos, now);
  const fights = settleBattles(repos, engine, now).length;
  bringCrewsHome?.(repos, now);
  settleScouting(repos, now);
  return fights;
}
