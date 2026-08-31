import {
  type PartialResources,
  accrueProduction,
  applyQueueEntry,
  BUILDING_CATALOG,
  disruptionPercentAt,
  queueCompletesAt,
  splitDueQueue,
  repairedDistrict,
  xpForClock,
  type Base,
  type Building,
  type BuildQueueEntry,
  type PlayerXpAward,
  type Resources,
  type CrewYield,
  type ProductionCarry,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import { awardPlayerXp } from '../progression/award.js';
import { settleTraining } from '../units/training.js';
import { notifyBase } from '../social/notify.js';

/**
 * Everything the district owes since it was last read (GDD §A1): finished builds, the resources
 * its structures made in the meantime.
 *
 * Lazy, like payroll (§H7), missions (§E2) and research (§B9). There is no tick. One stored
 * timestamp, `economy.productionSettledAt`, is the whole of the state this needs.
 *
 * It runs **before** payroll on every read path. A greenhouse that grew this week's rations has to
 * have grown them before the upkeep is taken, or the crew starves next to a full store.
 */

const HOUR_MS = 3_600_000;

/**
 * The shortest window worth settling.
 *
 * Below this, the settle is skipped **and the clock is left where it was**, so nothing is lost:
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
  /** §I1 pays for building things: one award per completed order. */
  awards: PlayerXpAward[];
}

/**
 * A settle is a walk along the timeline, not a single multiplication.
 *
 * Production depends on what is *standing*, and what is standing changes partway
 * through the window whenever a queued build lands in it. Accruing the whole window against the
 * final set of structures would back-date every one of them: three days away and a Greenhouse
 * finishing an hour ago would pay three days of harvests. So the window is cut at each completion
 * and each segment is accrued against the district as it actually was.
 */
function walk(
  base: Base,
  due: readonly BuildQueueEntry[],
  now: Date,
  crew: CrewYield,
  /** §A4: the hourly output of the ground this crew holds, on top of what it has built. */
  groundPerHour: PartialResources = {},
): { buildings: Building[]; resources: Resources; carry: ProductionCarry } {
  let buildings: Building[] = base.buildings.map((building) => ({ ...building }));
  let resources = base.resources;
  let carry = base.economy.productionCarry;

  const since = base.economy.productionSettledAt;
  let cursor = since === null ? now.getTime() : Math.min(Date.parse(since), now.getTime());

  // §A4: a district that has just been raided runs at reduced effectiveness for a few hours.
  // Applied as a *fraction of the window* rather than as a scale on the output, which is exactly
  // equivalent for a linear accrual and keeps `accrueProduction` a statement about structures.
  const working = 1 - disruptionPercentAt(base.economy.disruption, now) / 100;

  const advanceTo = (mark: number): void => {
    const hours = (mark - cursor) / HOUR_MS;
    if (hours > 0) {
      // §A4: the crew put the place right while all this was happening, so the district this
      // segment produced with is not the one it started as.
      //
      // Evaluated at the segment's **midpoint**, which is exact rather than a compromise: repair is
      // linear in time and a structure's effectiveness is linear in its damage, so the average of a
      // linear function over the window is its value halfway through it. Using the start would
      // charge a crew for a whole day of damage they spent that day fixing; using the end would
      // hand them a day they never had.
      const halfway = repairedDistrict(buildings, new Date(cursor + (mark - cursor) / 2));
      // The carry threads through every segment of the walk, so cutting the window at a completed
      // build cannot round anything away: three segments owe exactly what one segment would have.
      const accrued = accrueProduction(
        resources,
        halfway,
        hours * working,
        crew,
        carry,
        groundPerHour,
      );
      resources = accrued.resources;
      carry = accrued.carry;
      // ...and the state carried out of the segment is the district as it stands at `mark`.
      buildings = repairedDistrict(buildings, new Date(mark));
      cursor = mark;
    }
  };

  for (const entry of due) {
    advanceTo(queueCompletesAt(entry).getTime());
    buildings = applyQueueEntry(buildings, entry);
  }
  advanceTo(now.getTime());

  return { buildings, resources, carry };
}

/** Did the walk actually move a structure? Damage and its clock are the only fields it can move. */
function changed(before: readonly Building[], after: readonly Building[]): boolean {
  return after.some((building, index) => {
    const was = before[index];
    return (
      was === undefined ||
      was.damage !== building.damage ||
      (was.damagedAt ?? null) !== (building.damagedAt ?? null) ||
      was.level !== building.level
    );
  });
}

export function settleDistrict(repos: Repositories, base: Base, now: Date): DistrictSettlement {
  const { due, pending } = splitDueQueue(base.buildQueue, now);
  const since = base.economy.productionSettledAt;
  const elapsedMs = since === null ? 0 : now.getTime() - Date.parse(since);

  // A read moments after the last one owes nothing yet. Checked before any work, so the common
  // case, a client polling a page, costs one comparison and no writes at all.
  if (due.length === 0 && elapsedMs < PRODUCTION_MIN_STEP_MS && since !== null) {
    return { base, completed: [], awards: [] };
  }

  // §F2: Engineering and Chemistry on the line, Logistics on the warehouse. Read once for the
  // whole window rather than per segment: a crew does not change halfway through a settle, and
  // re-reading it inside the walk would cost a database round trip per completed build.
  const { productionPercent, storageCapacityPercent } = crewEffectsFor(repos, base);
  // §A4, and what the ground makes go further (the Abandoned Nuclear Plant). Read from the
  // territory fold rather than the crew one: this is a location's doing, not a person's.
  /*
   * §A4: what the ground makes, and what it makes go further.
   *
   * `perHour` is the half that was doing nothing. Every `resource` bonus in the location catalogue
   * folds into it, `combineEffects` merges it, and until now nothing spent it: a crew holding
   * every location in the city banked exactly zero from them. Measured rather than reasoned about,
   * with a probe that settled ten hours against a full sweep of the map and watched the stockpile
   * not move.
   *
   * Read off the territory fold rather than the crew one, like `resourceYieldPercent` beside it:
   * both are a location's doing rather than a person's.
   */
  const { resourceYieldPercent, perHour } = standingEffectsFor(repos, base);
  const { buildings, resources, carry } = walk(
    base,
    due,
    now,
    { productionPercent, storageCapacityPercent, resourceYieldPercent },
    perHour,
  );
  const settled: Base = {
    ...base,
    resources,
    buildings,
    buildQueue: pending,
    economy: {
      ...base.economy,
      productionSettledAt: now.toISOString(),
      productionCarry: carry,
    },
  };

  // Written when a build landed **or** when the repair clock moved a structure: the second is
  // silent and would otherwise be recomputed and thrown away on every read, so a district would
  // never actually come back.
  if (due.length > 0 || changed(base.buildings, settled.buildings)) {
    repos.bases.updateDistrict(settled.id, settled.buildings, settled.buildQueue);
  }
  repos.bases.updateResources(settled.id, settled.resources);
  repos.bases.updateEconomy(settled.id, settled.economy);

  // XP last, and once per order: `awardPlayerXp` is the only writer of `Base.level` (INTERFACES
  // R7), and two builds landing on one read is two awards that may cross two thresholds.
  let carried = settled;
  const awards: PlayerXpAward[] = [];
  for (const entry of due) {
    // §I1: priced off the clock this order was actually placed under, not off a flat table entry.
    // `durationSeconds` is frozen at order time (see `BuildQueueEntrySchema`), so raising the Nexus
    // mid-build cannot re-price the XP any more than it can re-time the build.
    const { base: progressed, award } = awardPlayerXp(
      repos,
      carried,
      'buildingConstructed',
      0,
      xpForClock('buildingConstructed', entry.durationSeconds),
    );
    carried = progressed;
    awards.push(award);
  }

  return { base: carried, completed: [...due], awards };
}

/**
 * Everything a base owes on a read, in the one order that is correct: **the** entry point for
 * every route that touches a base.
 *
 * The district settles first and training second. There used to be a weekly upkeep pass between
 * the two, and the order mattered because the Greenhouse had to have grown the week's rations
 * before they were eaten; no recurring charge is left in the game, so what is left is production
 * and then the batches it paid for.
 */
export function settleBase(repos: Repositories, base: Base, now: Date): DistrictSettlement {
  const district = settleDistrict(repos, base, now);
  // Training last: a batch landing does not feed anything else in the settle.
  const trained = settleTraining(repos, district.base, now);

  /*
   * The receipts, written once, here.
   *
   * This is the one function every route calls before touching a base, so it is the one place a
   * finished build can be noticed exactly once. Emitting from the routes instead would mean a
   * building announced twice when two screens settled the same crew, or not at all on whichever
   * route somebody forgot. `notify` is filtered by the player's own settings and never throws, so a
   * receipt that cannot be written does not take the settle down with it.
   */
  for (const entry of district.completed) {
    notifyBase(repos, base.id, {
      kind: 'building_done',
      title: `${BUILDING_CATALOG[entry.kind].name} is finished`,
      body: `Standing at level ${entry.level}.`,
      link: '/game/base',
      now,
    });
  }

  return { ...district, base: trained.base, awards: [...district.awards, ...trained.awards] };
}
