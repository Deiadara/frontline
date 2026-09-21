import { GAME_TIMEZONE, type SkirmishEngine } from '@frontline/shared';
import { settleBarAuctions } from '../bar/auction.js';
import { settleVendorAuctions } from '../market/auction.js';
import { settleBlackMarketLots } from '../blackmarket/shelf.js';
import { settleBattles } from '../battle/resolve.js';
import { settleMovements } from '../battle/movement.js';
import { settleSleepers } from '../city/sleepers.js';
import { settleFortifications } from '../city/actions.js';
import { settleCapturedGates } from '../city/gates.js';
import { settleScouting } from '../scouting/scouting.js';
import type { Repositories } from '../db/repos/index.js';
import { liveHub } from '../live/hub.js';

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
 *    settling the fight first would resolve it without those units and land the reinforcements in
 *    a battle that is already over.
 * 3. **Captured gates**, because a gate that finished going up before the mark changes how hard
 *    that ground is to take, and it changes it for somebody else.
 * 4. **Battles**, which read all three.
 * 5. **Crews coming home**, **scouting** and **the two closed auctions**, the Bar's and the
 *    Runner's, which read nothing above them and write receipts. Last because a receipt only has to
 *    arrive, not to arrive in any particular order.
 *
 * Both auctions are here rather than only on their own read paths, because a table closes at
 * midnight and a lot closes when the Runner packs up whether or not anybody is looking: the crew
 * that won should find the officer on the books or the goods in the inventory and a bell rung, not
 * discover both by opening the right screen three days later.
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
  const landed = settleMovements(repos, now);
  /*
   * §A4: cells going to ground and cells coming home, **before** the fights.
   *
   * Order matters for exactly one case and it is the case the mechanic is for: a cell whose walk
   * lands on the same tick as the fight it was planted for has to be standing there when
   * `assemble` reads the ground. Settled after, it would arrive to a battle already resolved.
   */
  const planted = settleSleepers(repos, now);
  const gates = settleCapturedGates(repos, now);
  const fights = settleBattles(repos, engine, now).length;
  bringCrewsHome?.(repos, now);
  settleScouting(repos, now);
  const tables = settleBarAuctions(repos, now);
  const lots = settleVendorAuctions(repos, now);
  /*
   * The fence's five, which settle at midnight.
   *
   * On the clock as well as on the shelf's own read, for the reason the barrow is: without it, a
   * crew that won a crate overnight is not charged and not given it until somebody in the city
   * next opens the back room, which on a quiet server can be hours. Nothing is broadcast: the
   * shelf polls, and the crate lands in an inventory whose own screens poll too.
   */
  settleBlackMarketLots(repos, now, GAME_TIMEZONE);
  /*
   * Tell every open tab what the clock just moved, **after** every settle above has committed.
   *
   * These are the changes nobody pressed a button for: a fight going off, a column landing, a
   * gate coming up, a table closing at the Bar. Before this, another player learned of them on
   * their next poll, five to fifteen seconds later, and two players looking at the same street
   * saw two different streets for that long. A nudge costs nothing when nobody is connected and
   * is only sent when something actually settled, so a quiet world stays quiet.
   */
  if (fights > 0 || landed > 0 || planted > 0 || gates > 0) liveHub.broadcast('world', now);
  if (tables > 0) liveHub.broadcast('bar', now);
  if (lots > 0) liveHub.broadcast('market', now);
  return fights;
}
