import {
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  canAfford,
  spendResources,
  upgradeCost,
  upgradeNote,
  type Base,
  type Location,
  type LocationControl,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Working a location up a level (§A4).
 *
 * The board-game half of the city: what a location is worth is whatever its holders have poured
 * into it. Nine upgrades, each dearer than the last, the first three an authored sentence about
 * what actually changed on the ground and the rest a shared ladder (`LATE_UPGRADE_NOTES`). None of
 * it is lost when somebody takes the location off you: the levels go with the ground, which is
 * settled in `battle/resolve.ts` rather than here. What that capture does clear is an upgrade
 * still under way, so a level charged for and not yet banked dies with the holding.
 *
 * Deliberately shaped exactly like fortifying (`actions.ts`): a clock on the control row, charged
 * up front, banked lazily on the next read. Two mechanics that behave the same way are one mechanic
 * a player has to learn.
 */

/**
 * How long a level takes to work up. Longer at each step, like the price.
 *
 * The first three entries are the ones that shipped, so a level 1, 2 or 3 location still takes
 * exactly as long as it did. From there the step is 1.25x rather than the price's 1.4x: the clock
 * is what a player waits through, and matching the money curve would put the tenth level on the
 * hard ground at over a day. At 1.25x the worst case in the catalogue (an Abandoned Nuclear Plant,
 * `baseDefense` 7) is about eight hours for its last level, which is the same "better part of a
 * working day" the top of the building ladder asks for.
 */
export const UPGRADE_BASE_SECONDS = 900;
export const UPGRADE_SECONDS_SCALE: readonly number[] = [1, 1.8, 3, 3.75, 4.7, 5.9, 7.3, 9.2, 11.5];

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

/** Banks a finished upgrade. Called on every read of the city, the way every clock here settles. */
export function settleUpgrade(control: LocationControl, now: Date): LocationControl {
  if (control.upgradingUntil === null) return control;
  if (Date.parse(control.upgradingUntil) > now.getTime()) return control;
  return {
    ...control,
    level: Math.min(MAX_LOCATION_LEVEL, control.level + 1),
    upgradingUntil: null,
  };
}

export function startUpgrade(
  repos: Repositories,
  args: { base: Base; location: Location; control: LocationControl; now: Date },
): UpgradeOutcome {
  const { base, location, control, now } = args;

  if (control.holder.kind !== 'crew' || control.holder.baseId !== base.id) {
    return { kind: 'refused', reason: 'not_yours' };
  }
  if (control.upgradingUntil !== null) return { kind: 'refused', reason: 'already_working' };

  const cost = upgradeCost(location.kind, control.level);
  const note = upgradeNote(location.kind, control.level);
  if (!cost || !note) return { kind: 'refused', reason: 'at_ceiling' };
  if (!canAfford(base.resources, cost)) return { kind: 'refused', reason: 'cannot_afford' };

  const until = new Date(
    now.getTime() + upgradeSeconds(location.kind, control.level) * 1000,
  ).toISOString();
  const upgraded: LocationControl = { ...control, upgradingUntil: until };
  const paid: Base = { ...base, resources: spendResources(base.resources, cost) };

  repos.city.put(upgraded);
  repos.bases.updateResources(paid.id, paid.resources);
  return { kind: 'started', control: upgraded, base: paid, note, until };
}
