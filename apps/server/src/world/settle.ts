import { GAME_TIMEZONE, lastWeekBoundary, type SkirmishEngine } from '@frontline/shared';
import { settleAutomations } from '../automations/runners.js';
import { settleBarAuctions } from '../bar/auction.js';
import { settleVendorAuctions } from '../market/auction.js';
import { settleMarketBoard } from '../market/board.js';
import { settleBlackMarketLots } from '../blackmarket/shelf.js';
import { settleBattles } from '../battle/resolve.js';
import { settleMovements } from '../battle/movement.js';
import { settleSleepers } from '../city/sleepers.js';
import { settleLocationUpgrades } from '../city/actions.js';
import { settleCapturedGates } from '../city/gates.js';
import { settleGarrisonRegrowth } from '../city/regrowth.js';
import { settleSpying, snapshotSpying } from '../spying/spying.js';
import { settleCouriers } from '../spying/courier.js';
import { settleMoves } from '../moves/moves.js';
import type { Repositories } from '../db/repos/index.js';
import { liveHub } from '../live/hub.js';
import { settleStackhouse } from '../blackmarket/stackhouse.js';
import { callOffUnderstrength } from '../battle/understrength.js';
import { guardStage } from './guard.js';

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
 * 1. **Location upgrades**, because ground worked up before the mark is at its new level when it
 *    is attacked.
 * 2. **Movements**, because a column whose march ended before the mark is *in* the district, and
 *    settling the fight first would resolve it without those units and land the reinforcements in
 *    a battle that is already over.
 * 3. **Captured gates**, because a gate that finished going up before the mark changes how hard
 *    that ground is to take, and it changes it for somebody else.
 * 4. **The weekly regrowth**, because a fight called for a minute past the mark is a fight against
 *    the regime as it stands on Monday. Settled after it and the first fight of the week would be
 *    fought against last week's casualties and then have its survivors overwritten. Fights marked
 *    before the week turned, or on the mark itself, are settled just ahead of it, for the mirror of
 *    that reason.
 * 5. **Battles**, which read all four.
 * 6. **Crews coming home**, **spy jobs**, **the courier's daily report** and **the two closed
 *    auctions**, the Bar's and the Runner's, which read nothing above them and write receipts. Last
 *    because a receipt only has to arrive, not to arrive in any particular order.
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
  /**
   * Admin mode: parties run on the flattened mission clock (the gap between them stays real), and
   * the Bar's close waives what its tables waived. Every caller passes the server's mode, because
   * whichever door reaches a table first after midnight is the one that closes it.
   */
  admin = false,
): number {
  /*
   * Every stage guarded (`world/guard.ts`, robustness pass 2026-09-25). A stage that throws for a
   * reason no single row explains is reported and skipped for this tick, and the ones after it
   * still run: a broken auction table is not a reason for no fight to land anywhere. The rows
   * inside each stage are guarded one by one on top of this.
   */
  guardStage('location upgrades', null, () => settleLocationUpgrades(repos, now));
  const landed = guardStage('columns arriving', 0, () => settleMovements(repos, now));
  // Columns between the crew's own places land beside the ones bound for a fight, and for the
  // same reason: a garrison that arrived before the mark is standing when the mark comes.
  const moved = guardStage('moves', 0, () => settleMoves(repos, now));
  const planted = guardStage('sleeper cells', 0, () => settleSleepers(repos, now));
  const gates = guardStage('captured gates', 0, () => settleCapturedGates(repos, now));
  /*
   * Last week's fights before this week's regrowth (bug pass, 2026-09-29). A fight marked for
   * Sunday night and settled after the mark, by a restart over it or a battles stage that threw on
   * the Sunday tick, was fought against Monday's rebuilt garrison and then spent the rebuild.
   *
   * The mark itself is last week's too (maintainer, 2026-09-29): the regrowth "happens after any
   * battles on exactly midnight, for the remaining units", and midnight is a half-hour slot a
   * fight can be called for. `settleBattles` takes every fight at or before `dueBy`.
   */
  // Calls nobody means to fight are off at the lock (maintainer, 2026-10-05): under twenty unit
  // slots on the attacking side, everybody walks home and every bet on it is refunded.
  guardStage('under-strength calls', 0, () => callOffUnderstrength(repos, now));
  const late = guardStage('last week’s battles', [], () =>
    settleBattles(repos, engine, now, lastWeekBoundary(now)),
  ).length;
  const regrown = guardStage('regrowth', 0, () => settleGarrisonRegrowth(repos, now));
  const fights = late + guardStage('battles', [], () => settleBattles(repos, engine, now)).length;
  // The Stackhouse's bets on the fights that just landed, or were abandoned (2026-10-05).
  guardStage('stackhouse bets', 0, () => settleStackhouse(repos, now));
  guardStage('crews coming home', null, () => bringCrewsHome?.(repos, now));
  if (bringCrewsHome) guardStage('automations', 0, () => settleAutomations(repos, now, admin));
  // Spy jobs with the receipts: the runners read the ground the moment they reach it, after the
  // fights above, and deliver the read when they are home.
  guardStage('spy snapshots', 0, () => snapshotSpying(repos, now));
  guardStage('spying', 0, () => settleSpying(repos, now));
  // Turned Runners: one report a day at the Athens boundary, reading the same settled ground.
  guardStage('couriers', 0, () => settleCouriers(repos, now));
  const tables = guardStage('bar auctions', 0, () => settleBarAuctions(repos, now, admin));
  const lots = guardStage('runner lots', 0, () => settleVendorAuctions(repos, now, admin));
  guardStage('black market lots', 0, () => settleBlackMarketLots(repos, now, GAME_TIMEZONE, admin));
  // Listings past their lifetime and claims past their 24 hours, whether or not anybody looks.
  const board = guardStage('market board', 0, () => settleMarketBoard(repos, now));
  if (fights > 0 || landed > 0 || moved > 0 || planted > 0 || gates > 0 || regrown > 0) {
    liveHub.broadcast('world', now);
  }
  if (tables > 0) liveHub.broadcast('bar', now);
  if (lots > 0 || board > 0) liveHub.broadcast('market', now);
  return fights;
}
