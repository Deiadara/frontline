import {
  RESOURCE_KEYS,
  type PartialResources,
  accrueProduction,
  applyQueueEntry,
  BUILDING_CATALOG,
  disruptionPercentAt,
  drillEndsAt,
  findUnit,
  queueCompletesAt,
  researchCompletesAt,
  splitDueQueue,
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
import { tallyBuildingRaised, tallyResourcesEarned } from '../feats/tally.js';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import { settleTrainingFor } from '../crew/training.js';
import { awardPlayerXp, settleRetunedCurve } from '../progression/award.js';
import { settleResearchFor } from '../research/settle.js';
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

  /*
   * §A4: a district that has just been raided runs at reduced effectiveness for a few hours.
   *
   * Applied as a *fraction of the window* rather than as a scale on the output, which is exactly
   * equivalent for a linear accrual and keeps `accrueProduction` a statement about structures.
   *
   * Read **per segment**, and *both* edges of it are cuts in the walk, exactly like a completed
   * build is. It used to be read once from `now` and multiplied into every segment, which is only
   * right for a factor that is constant across the window, and `disruptionPercentAt` is a step
   * function of time: a crew last settled three days ago and raided an hour ago lost 30% of three
   * days, and the same crew opening the game after the disruption expired banked the disrupted
   * hours at full rate.
   *
   * The expiry was cut first and the raid itself only on 2026-09-18, which left the other half of
   * the same error in place: the step read as though the cut had always been on, so a crew raided
   * an hour ago and settling twelve hours of absence was charged against all twelve, a 12x
   * over-read and 23x at a day. It only ever hit players who were away, which is every player who
   * gets raided. With both edges cut each segment's factor is constant, so the midpoint reading
   * below is exact rather than an average.
   */
  /** A moment inside this window where the disruption steps, or null when it does not. */
  const stepAt = (iso: string | null): number | null => {
    if (iso === null) return null;
    const at = Date.parse(iso);
    return at > cursor && at < now.getTime() ? at : null;
  };
  const disruptionStarts = stepAt(base.economy.disruption.since);
  const disruptionEnds = stepAt(base.economy.disruption.until);

  const advanceTo = (mark: number): void => {
    const hours = (mark - cursor) / HOUR_MS;
    if (hours > 0) {
      const working =
        1 -
        disruptionPercentAt(base.economy.disruption, new Date(cursor + (mark - cursor) / 2)) / 100;
      // The carry threads through every segment of the walk, so cutting the window at a completed
      // build cannot round anything away: three segments owe exactly what one segment would have.
      const accrued = accrueProduction(
        resources,
        buildings,
        hours * working,
        crew,
        carry,
        groundPerHour,
      );
      resources = accrued.resources;
      carry = accrued.carry;
      cursor = mark;
    }
  };

  /**
   * Everything up to `mark`, cut at the raid and at its expiry so no stretch straddles either.
   *
   * `advanceTo` prices a stretch at its midpoint, which is exact only while the factor is constant
   * across it, and `disruptionPercentAt` is a step. A district settled once after three days away
   * and raided at the start of them read the midpoint as undisrupted and banked all three days at
   * full rate.
   */
  const advanceThrough = (mark: number): void => {
    // Both edges of the window, in order, so no stretch straddles either one.
    for (const step of [disruptionStarts, disruptionEnds]) {
      if (step !== null && step > cursor && step < mark) advanceTo(step);
    }
    advanceTo(mark);
  };

  for (const entry of due) {
    advanceThrough(queueCompletesAt(entry).getTime());
    buildings = applyQueueEntry(buildings, entry);
  }
  advanceThrough(now.getTime());

  return { buildings, resources, carry };
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
  // Read at the settle's own instant, not at the wall clock: both folds are step functions of time
  // (an officer is out of the room until `injuredUntil`, a raid's disruption until it expires), and
  // `now` is the moment this window is being priced at. Defaulting the argument read the clock of
  // whichever process happened to be running, which is the settle answering about a different day.
  const { productionPercent, storageCapacityPercent } = crewEffectsFor(repos, base, now);
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
  const { resourceYieldPercent, perHour } = standingEffectsFor(repos, base, now);
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

  // Nothing but a completed order can move a structure now, so a read that finished nothing does
  // not touch the district row at all.
  if (due.length > 0) {
    repos.bases.updateDistrict(settled.id, settled.buildings, settled.buildQueue);
  }
  repos.bases.updateResources(settled.id, settled.resources);
  repos.bases.updateEconomy(settled.id, settled.economy);

  /*
   * Feats (maintainer request, 2026-09-13): the levels that landed, and what the district earned.
   *
   * Production is the biggest faucet in the game and the only one with no record of its own, so
   * "caps ever earned" would be badly wrong without this: a crew that never sells anything still
   * earns most of its money here. The figure is the *difference* the walk produced rather than the
   * new total, and it is not rounded, because a settle can be a few seconds long and rounding each
   * one down would lose a steady trickle forever.
   */
  tallyBuildingRaised(repos, settled.id, due.length);
  tallyResourcesEarned(
    repos,
    settled.id,
    Object.fromEntries(
      RESOURCE_KEYS.map((key) => [
        key,
        Math.max(0, (settled.resources[key] ?? 0) - (base.resources[key] ?? 0)),
      ]),
    ),
  );

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
 *
 * The Lab and the drills are here because they were nowhere. `settleResearch` ran on the two
 * research routes alone and `settleTrainingFor` on the Training tab's, so a rung or an hour that
 * finished while the player was on any other screen stayed unpaid: every door the rung opens shut,
 * the sheet unmoved, the receipt silent until the player opened the page it points at. Both land
 * *inside* the district's walk rather than before or after it, at the instant they finished
 * (`crewChangesDue`), because `crewEffectsFor` reads the sheets and the Lab to price production:
 * settled before the district they were back-dated over the whole window, and after it they were
 * ignored for the rest of it. The due check is one comparison over the clocks in flight, so a read
 * with nothing finished pays for no lookup.
 */
export function settleBase(repos: Repositories, base: Base, now: Date): DistrictSettlement {
  /*
   * One transaction (hardening pass, 2026-09-27). The settle writes the district, the stockpile,
   * the economy and the tallies as separate statements, and it runs on nearly every read: as
   * separate commits that was a disk sync apiece, and a failure between the stockpile and the
   * economy stamp would have let the next read credit the same stretch of production again.
   * `repos.tx` nests as a savepoint when a route already holds a transaction.
   */
  return repos.tx(() => settleBaseNow(repos, base, now));
}

/**
 * Every crew named, settled to `now`, each once. Ids with no row are skipped.
 *
 * For code that is about to read or write crews other than the one asking: a fight, a change of
 * who holds a location. The row is read fresh here, so a caller must re-read any base it holds
 * after this rather than write back the copy it had.
 */
export function settleBasesById(
  repos: Repositories,
  ids: Iterable<string | null | undefined>,
  now: Date,
): void {
  for (const id of new Set(ids)) {
    const base = id ? repos.bases.findById(id) : undefined;
    if (base) settleBase(repos, base, now);
  }
}

/**
 * The instants inside this window where the crew itself changes: a drill landing on a sheet, a Lab
 * rung landing on `technologies`. Oldest first, and none at or after `now`'s own settle.
 *
 * Both move what the district makes (`crewEffectsFor` reads the sheets and the Lab for Engineering,
 * Chemistry and Logistics), so both are cuts in the timeline exactly as a finished build is.
 */
function crewChangesDue(base: Base, now: Date): number[] {
  const at = now.getTime();
  const instants = base.training.sessions.map(drillEndsAt);
  if (base.research.active) instants.push(researchCompletesAt(base.research.active).getTime());
  return [...new Set(instants.filter((instant) => instant <= at))].sort((a, b) => a - b);
}

function settleBaseNow(repos: Repositories, base: Base, now: Date): DistrictSettlement {
  /*
   * The window is walked in stretches, one per change to the crew (audit, 2026-09-28).
   *
   * The district is priced against one reading of the crew for the whole window, so the order the
   * clocks settled in decided which reading that was. Drills went first and the Lab last: an hour
   * of Chemistry that finished at 09:00 was paid across a window that began at 03:00, and a
   * Logistics rung that finished at 09:00 was not paid at all until the next read. Now the
   * district settles up to each change, the change lands, and the next stretch is priced with it.
   * A read with nothing finished has no changes and costs what it did.
   */
  let current = settleRetunedCurve(repos, base);
  const completed: BuildQueueEntry[] = [];
  const awards: PlayerXpAward[] = [];
  const settleDistrictTo = (at: Date): void => {
    const district = settleDistrict(repos, current, at);
    current = district.base;
    completed.push(...district.completed);
    awards.push(...district.awards);
  };
  for (const instant of crewChangesDue(current, now)) {
    // Never behind the production clock: a stretch already paid for is not walked twice.
    const since = current.economy.productionSettledAt;
    const at = new Date(since === null ? instant : Math.max(instant, Date.parse(since)));
    settleDistrictTo(at);
    if (current.training.sessions.some((session) => drillEndsAt(session) <= instant)) {
      current = settleTrainingFor(repos, current, at.toISOString()).base;
    }
    const researched = settleResearchFor(repos, current, at);
    current = researched.base;
    awards.push(...researched.awards);
  }
  settleDistrictTo(now);
  const district = { base: current, completed, awards };
  // Training second: a batch landing does not feed anything else in the settle.
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

  /*
   * And the bench, which had a notification kind and no emitter at all.
   *
   * One per *batch*, not per body: a batch hands its units over one at a time (see
   * `settleTraining`), so a receipt per delivery would ring every forty-five seconds for an order
   * of ten Razors. `finished` is the set that handed over its last one on this read.
   */
  for (const order of trained.finished) {
    const unit = findUnit(order.unitId);
    notifyBase(repos, base.id, {
      kind: 'unit_trained',
      title: `${order.count} ${unit?.name ?? order.unitId} off the bench`,
      body: 'They are on the roster.',
      link: '/game/units',
      subjectId: order.unitId,
      now,
    });
  }

  return {
    base: trained.base,
    completed: district.completed,
    awards: [...district.awards, ...trained.awards],
  };
}
