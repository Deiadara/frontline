import {
  accrueProduction,
  applyQueueEntry,
  driftMorale,
  moraleTarget,
  queueCompletesAt,
  splitDueQueue,
  type Base,
  type Building,
  type BuildQueueEntry,
  type Meter,
  type PlayerXpAward,
  type Resources,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { settleBaseEconomy } from '../economy/settle.js';
import { awardPlayerXp } from '../progression/award.js';

/**
 * Everything the district owes since it was last read (GDD §A1): finished builds, the resources
 * its structures made in the meantime, and where morale drifted to while that happened.
 *
 * Lazy, like payroll (§H7), missions (§E2) and research (§B9) — there is no tick. One stored
 * timestamp, `economy.productionSettledAt`, is the whole of the state this needs.
 *
 * It runs **before** payroll on every read path. A greenhouse that grew this week's rations has to
 * have grown them before the upkeep is taken, or the crew starves next to a full store.
 */

const HOUR_MS = 3_600_000;

/**
 * The shortest window worth settling.
 *
 * Below this, the settle is skipped **and the clock is left where it was**, so nothing is lost —
 * the next read that clears the step accrues the whole interval including this one. That is the
 * important half: the naive alternative, rounding the accrued amount, silently robs a player whose
 * client polls faster than the rounding survives.
 *
 * What it buys is that a burst of reads in the same second cannot leave a stockpile carrying
 * seven decimal places of fuel burn. Production is measured per hour; a second of granularity on
 * it is not a mechanic anyone can perceive, and it keeps whole numbers whole.
 */
export const PRODUCTION_MIN_STEP_MS = 1000;

export interface DistrictSettlement {
  base: Base;
  /** Orders that landed on this read, oldest first. Empty on a read that finished nothing. */
  completed: BuildQueueEntry[];
  /** §I1 pays for building things — one award per completed order. */
  awards: PlayerXpAward[];
}

/**
 * A settle is a walk along the timeline, not a single multiplication.
 *
 * Production and morale both depend on what is *standing*, and what is standing changes partway
 * through the window whenever a queued build lands in it. Accruing the whole window against the
 * final set of structures would back-date every one of them — three days away and a Greenhouse
 * finishing an hour ago would pay three days of harvests. So the window is cut at each completion
 * and each segment is accrued against the district as it actually was.
 */
function walk(
  base: Base,
  due: readonly BuildQueueEntry[],
  now: Date,
): { buildings: Building[]; resources: Resources; morale: Meter } {
  let buildings: Building[] = base.buildings.map((building) => ({ ...building }));
  let resources = base.resources;
  let morale = base.economy.morale;

  const since = base.economy.productionSettledAt;
  let cursor = since === null ? now.getTime() : Math.min(Date.parse(since), now.getTime());

  const advanceTo = (mark: number): void => {
    const hours = (mark - cursor) / HOUR_MS;
    if (hours > 0) {
      resources = accrueProduction(resources, buildings, hours);
      morale = driftMorale(morale, moraleTarget(buildings), hours);
      cursor = mark;
    }
  };

  for (const entry of due) {
    advanceTo(queueCompletesAt(entry).getTime());
    buildings = applyQueueEntry(buildings, entry);
  }
  advanceTo(now.getTime());

  return { buildings, resources, morale };
}

export function settleDistrict(repos: Repositories, base: Base, now: Date): DistrictSettlement {
  const { due, pending } = splitDueQueue(base.buildQueue, now);
  const since = base.economy.productionSettledAt;
  const elapsedMs = since === null ? 0 : now.getTime() - Date.parse(since);

  // A read moments after the last one owes nothing yet. Checked before any work, so the common
  // case — a client polling a page — costs one comparison and no writes at all.
  if (due.length === 0 && elapsedMs < PRODUCTION_MIN_STEP_MS && since !== null) {
    return { base, completed: [], awards: [] };
  }

  const { buildings, resources, morale } = walk(base, due, now);
  const settled: Base = {
    ...base,
    resources,
    buildings,
    buildQueue: pending,
    economy: { ...base.economy, morale, productionSettledAt: now.toISOString() },
  };

  if (due.length > 0) repos.bases.updateDistrict(settled.id, settled.buildings, settled.buildQueue);
  repos.bases.updateResources(settled.id, settled.resources);
  repos.bases.updateEconomy(settled.id, settled.economy);

  // XP last, and once per order: `awardPlayerXp` is the only writer of `Base.level` (INTERFACES
  // R7), and two builds landing on one read is two awards that may cross two thresholds.
  let carried = settled;
  const awards: PlayerXpAward[] = [];
  for (const _entry of due) {
    const { base: progressed, award } = awardPlayerXp(repos, carried, 'buildingConstructed');
    carried = progressed;
    awards.push(award);
  }

  return { base: carried, completed: [...due], awards };
}

/**
 * Everything a base owes on a read, in the one order that is correct — **the** entry point for
 * every route that touches a base.
 *
 * The district settles first and payroll second, and the order is load-bearing in both directions:
 * a Greenhouse has to have grown this week's rations before the upkeep is taken, and the Infirmary
 * that softens a missed payday has to be standing before the payday is missed. Routes that need
 * finer control can still call the two halves themselves; nothing else should.
 */
export function settleBase(repos: Repositories, base: Base, now: Date): DistrictSettlement {
  const district = settleDistrict(repos, base, now);
  return { ...district, base: settleBaseEconomy(repos, district.base, now) };
}
