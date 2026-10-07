import {
  chairPassiveOf,
  LOCATION_CATALOG,
  canAfford,
  spendResources,
  upgradeCost,
  upgradeNote,
  type Base,
  type Location,
  type LocationControl,
  cancelRefund,
  cancelWindowOpen,
  type PartialResources,
} from '@frontline/shared';
import { adminCost, adminSeconds, adminWaives } from '../admin/mode.js';
import { crewEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { creditBase, refuseWaste } from '../district/stores.js';

/**
 * Working a location up a level (§A4).
 *
 * The board-game half of the city: what a location is worth is whatever its holders have poured
 * into it. Four upgrades, each dearer than the last, the first three an authored sentence about
 * what actually changed on the ground and the last a shared ladder (`LATE_UPGRADE_NOTES`). None of
 * it is lost when somebody takes the location off you: the levels go with the ground, which is
 * settled in `battle/resolve.ts` rather than here. What that capture does clear is an upgrade
 * still under way, so a level charged for and not yet banked dies with the holding.
 *
 * A clock on the control row, charged up front, banked lazily on the next read
 * (`settleLocationUpgrades` in `actions.ts`), the way every other clock in the city works.
 */

/**
 * How long a level takes to work up. Longer at each step, like the price.
 *
 * Four steps, one per upgrade on the five-level ladder (maintainer, 2026-10-06): each upgrade to
 * level n takes what the old nine-step clock gave the upgrade to level 2n, the same way
 * `UPGRADE_COST_SCALE` reads the old price ladder at every second step. So the last level still
 * takes 11.5x the base, which on the worst ground in the catalogue (an Abandoned Nuclear Plant,
 * `baseDefense` 7) is about eight hours, the same "better part of a working day" the top of the
 * building ladder asks for; the whole climb is shorter because the in-between levels are gone.
 */
export const UPGRADE_BASE_SECONDS = 900;
export const UPGRADE_SECONDS_SCALE: readonly number[] = [3, 5.9, 9.2, 11.5];

export function upgradeSeconds(kind: Location['kind'], level: number): number {
  const step = Math.min(UPGRADE_SECONDS_SCALE.length, Math.max(1, level)) - 1;
  const weight = LOCATION_CATALOG[kind].baseDefense / 4;
  return Math.round(UPGRADE_BASE_SECONDS * (UPGRADE_SECONDS_SCALE[step] as number) * (1 + weight));
}

export const UPGRADE_REFUSALS = {
  not_yours: 'You do not hold that',
  at_ceiling: 'That is as far as it goes',
  already_working: 'Work is already under way there',
  cannot_afford: 'You cannot cover that',
} as const;
export type UpgradeRefusal = keyof typeof UPGRADE_REFUSALS;

export type UpgradeOutcome =
  | { kind: 'refused'; reason: UpgradeRefusal }
  | { kind: 'started'; control: LocationControl; base: Base; note: string; until: string };

/*
 * There is no `settleUpgrade` here.
 *
 * There was, and its doc said "called on every read of the city, the way every clock here settles",
 * and nothing called it: `settleLocationUpgrades` in `city/actions.ts` banks the clock on the row,
 * which is where it belongs, because a second settler over the same table is a second chance to
 * forget one. A second implementation sitting beside the
 * live one under a name that reads like the live one is worse than no implementation at all.
 */

/** The Engineer's passive on a location's next level (maintainer, 2026-10-04). */
function engineerCutFor(repos: Repositories, base: Base, now: Date): number {
  return chairPassiveOf(crewEffectsFor(repos, base, now), 'engineer', 'building_cost');
}

export function startUpgrade(
  repos: Repositories,
  args: {
    base: Base;
    location: Location;
    control: LocationControl;
    now: Date;
    /**
     * Testing mode: nothing charged and five seconds on the clock (`admin/mode.ts`; maintainer
     * ruling, 2026-09-29). `upgradingSince` is handed the same flag, so it derives the start off
     * the same five seconds rather than reading the job as one that began hours ago.
     */
    admin?: boolean;
  },
): UpgradeOutcome {
  const { base, location, control, now, admin = false } = args;

  if (control.holder.kind !== 'crew' || control.holder.baseId !== base.id) {
    return { kind: 'refused', reason: 'not_yours' };
  }
  if (control.upgradingUntil !== null) return { kind: 'refused', reason: 'already_working' };

  const cost = upgradeCost(location.kind, control.level, engineerCutFor(repos, base, now));
  const note = upgradeNote(location.kind, control.level);
  if (!cost || !note) return { kind: 'refused', reason: 'at_ceiling' };
  if (!canAfford(base.resources, cost) && !adminWaives('cannot_afford', admin)) {
    return { kind: 'refused', reason: 'cannot_afford' };
  }

  const until = new Date(
    now.getTime() + upgradeClockSeconds(location.kind, control.level, admin) * 1000,
  ).toISOString();
  const charged = adminCost(cost, admin);
  const upgraded: LocationControl = { ...control, upgradingUntil: until, upgradePaid: charged };
  const paid: Base = { ...base, resources: spendResources(base.resources, charged) };

  repos.city.put(upgraded);
  repos.bases.updateResources(paid.id, paid.resources);
  return { kind: 'started', control: upgraded, base: paid, note, until };
}

/**
 * The clock an upgrade actually runs on: the catalogue's, or five seconds in admin mode. The screen
 * still quotes the catalogue's (`upgradeSeconds`), as every flattened clock does.
 */
function upgradeClockSeconds(kind: Location['kind'], level: number, admin: boolean): number {
  return adminSeconds(upgradeSeconds(kind, level), admin);
}

/**
 * When the running upgrade began: its end, less the clock it was given. Null with none running.
 *
 * Derived rather than stored, so it needs the mode the job was started under. A server restarted
 * with the flag flipped mid-job misreads that one job's start, and nothing else: the end, which
 * is what lands it, is stored.
 */
export function upgradingSince(
  location: Location,
  control: LocationControl,
  admin = false,
): string | null {
  if (control.upgradingUntil === null) return null;
  return new Date(
    Date.parse(control.upgradingUntil) -
      upgradeClockSeconds(location.kind, control.level, admin) * 1000,
  ).toISOString();
}

export type UpgradeCancelOutcome =
  | { kind: 'refused'; reason: 'not_yours' | 'nothing_running' | 'window_closed' }
  | { kind: 'cancelled'; control: LocationControl; base: Base; refund: PartialResources };

/**
 * Call the work off (maintainer request, 2026-09-12; `time/cancel.ts`): inside the first tenth, with
 * ninety percent of the level's price back, as far as the stores have room (warned about first:
 * maintainer ruling, 2026-09-28). The clock's start is derived from its end and the duration the
 * level always takes, so nothing new is stored for it.
 */
export function cancelUpgrade(
  repos: Repositories,
  args: {
    base: Base;
    location: Location;
    control: LocationControl;
    now: Date;
    acceptWaste?: boolean | undefined;
    /** Testing mode took nothing for the work, so it hands nothing back. */
    admin?: boolean;
  },
): UpgradeCancelOutcome {
  const { base, location, control, now, admin = false } = args;
  if (control.holder.kind !== 'crew' || control.holder.baseId !== base.id) {
    return { kind: 'refused', reason: 'not_yours' };
  }
  const since = upgradingSince(location, control, admin);
  if (control.upgradingUntil === null || since === null) {
    return { kind: 'refused', reason: 'nothing_running' };
  }
  const total = Date.parse(control.upgradingUntil) - Date.parse(since);
  if (!cancelWindowOpen(Date.parse(since), total, now.getTime())) {
    return { kind: 'refused', reason: 'window_closed' };
  }
  // What was paid at the start, not today's price: the Engineer's cut is read live, and a chair
  // changed between the two would refund more or less than was spent (bug pass, 2026-10-04).
  const refund = adminCost(
    // A row from before the price was kept is refunded off the Engineer's cut as it stands now,
    // the nearest thing to what was paid; the bare catalogue price paid back more than went in.
    cancelRefund(
      control.upgradePaid ??
        upgradeCost(location.kind, control.level, engineerCutFor(repos, base, now)) ??
        {},
    ),
    admin,
  );
  const credit = creditBase(repos, base, refund, now);
  refuseWaste(credit, args.acceptWaste);
  const cleared: LocationControl = { ...control, upgradingUntil: null, upgradePaid: null };
  const repaid: Base = { ...base, resources: credit.resources };
  repos.city.put(cleared);
  repos.bases.updateResources(repaid.id, repaid.resources);
  return { kind: 'cancelled', control: cleared, base: repaid, refund };
}
